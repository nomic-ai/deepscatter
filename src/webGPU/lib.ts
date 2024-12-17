import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { WebGPUBufferSet, createSingletonBuffer } from './buffertools';
import { Scatterplot, Tile } from '../deepscatter';

export class StatefulGPU {
	device: GPUDevice;
	bufferSet: WebGPUBufferSet;
	constructor(device: GPUDevice, bufferSize = 1024 * 1024 * 256) {
		this.device = device;
		this.bufferSet = new WebGPUBufferSet(device, bufferSize);
	}
	static async initializeWebGPU(): Promise<StatefulGPU> {
		if (!navigator.gpu) {
			throw new Error('WebGPU is not supported in this browser.');
		}
	
		const adapter = await navigator.gpu.requestAdapter();
		if (!adapter) {
			throw new Error('Failed to get GPU adapter.');
		}
	
		const device = await adapter.requestDevice();
		return new StatefulGPU(device);
	}
}

const bindGroupLayout = (device: GPUDevice) =>
	device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.COMPUTE,
				buffer: { type: 'read-only-storage' }
			},
			{
				binding: 1,
				visibility: GPUShaderStage.COMPUTE,
				buffer: { type: 'read-only-storage' }
			},
			{
				binding: 2,
				visibility: GPUShaderStage.COMPUTE,
				buffer: { type: 'storage' }
			},
			{
				binding: 3,
				visibility: GPUShaderStage.COMPUTE,
				buffer: { type: 'uniform' }
			}
		]
	});

  export function prepareComputeShader(
	state: StatefulGPU,
	comparisonArray: Uint32Array,
	embeddingSize: number = 128
): (tile, key) => Promise<Uint32Array> {
	// Create buffers
	const { device, bufferSet } = state;
	const comparisonBuffer = createSingletonBuffer(
		device,
		comparisonArray,
		GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
	);

	// Shader code
	const shaderCode = `

  struct SizeEtc {
    objectSize: u32,
  };
  
  @group(0) @binding(0) var<storage, read> comparisonArray : array<u32>;
  @group(0) @binding(1) var<storage, read> matrixArray : array<u32>;
  @group(0) @binding(2) var<storage, read_write> outputArray : array<u32>;
  @group(0) @binding(3) var<uniform> myUniforms: SizeEtc;
  
  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
      let idx = global_id.x;
			let o = myUniforms.objectSize;
      if (idx < arrayLength(&matrixArray)) {
          var totalDistance: u32 = 0;
          for (var i: u32 = 0; i < o; i = i + 1) {
              for (var j: u32 = 0; j < arrayLength(&comparisonArray) / o; j = j + 1) {
                totalDistance = totalDistance + countOneBits(comparisonArray[j * o + i] ^ matrixArray[idx * o + i]);
              }
          }
          outputArray[global_id.x] = totalDistance;
      }
  }
`;

	const defs = makeShaderDataDefinitions(shaderCode);
	const myUniformValues = makeStructuredView(defs.uniforms.myUniforms);
	myUniformValues.set({
		objectSize: embeddingSize / 32
	});
	const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout(device)] });
	// Create shader module and pipeline
	const shaderModule = device.createShaderModule({ code: shaderCode });
	const pipeline = device.createComputePipeline({
		layout,
		compute: {
			module: shaderModule,
			entryPoint: 'main'
		}
	});
	const uniformBuffer = createSingletonBuffer(
		device,
		myUniformValues.arrayBuffer,
		GPUBufferUsage.UNIFORM
	);

	const run = async function (tile: Tile, fieldName: string) {
		const commandEncoder = device.createCommandEncoder();
		const key = `${tile.key}_${fieldName}`;
		if (!bufferSet.store.has(key)) {
			const values = (await tile.get_column(fieldName)).data[0].children[0].values as Uint8Array;
			await bufferSet.set(key, values);
		}
		const { buffer, offset, byte_size: size } = bufferSet.store.get(key);
		const outputSize = (size / embeddingSize) * 8;
		const paddedSize = Math.ceil(outputSize / 4) * 4;

		// TODO this should be a permanent buffer.
		const outputBuffer = device.createBuffer({
			// Put a ceiling on it.
			size: paddedSize * 4,
			usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE
		});

		const passEncoder = commandEncoder.beginComputePass();
		passEncoder.setPipeline(pipeline);
		passEncoder.setBindGroup(
			0,
			device.createBindGroup({
				layout: pipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: { buffer: comparisonBuffer } },
					{ binding: 1, resource: { buffer, offset, size } },
					{ binding: 2, resource: { buffer: outputBuffer } },
					{ binding: 3, resource: { buffer: uniformBuffer } }
				]
			})
		);

		passEncoder.dispatchWorkgroups(size / 4 / 64);
		passEncoder.end();

		// Submit the commands
		const gpuReadBuffer = device.createBuffer({
			size: paddedSize * 4,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
		});

		commandEncoder.copyBufferToBuffer(outputBuffer, 0, gpuReadBuffer, 0, paddedSize * 4);
		device.queue.submit([commandEncoder.finish()]);

		// Read back the results
		await gpuReadBuffer.mapAsync(GPUMapMode.READ);
		const outputArray = new Uint32Array(gpuReadBuffer.getMappedRange());
		return outputArray.slice(0, outputSize);
	};
	return run;
}

// hide the state in a global variable.
const dumb: StatefulGPU[] = [];

export async function create_hamming_transform(
	scatterplot: Scatterplot,
	id: string,
	view: Uint8Array,
	dims: number,
	column: string
) {
	if (dumb.length === 0) {
		dumb.push(await StatefulGPU.initializeWebGPU());
	}
	if (scatterplot.dataset.transformations[id] !== undefined) {
		return;
	}
	// Cast from int8 to int32
	const comparisonArray = new Uint32Array(view.buffer);
	const run = prepareComputeShader(dumb[0], comparisonArray, dims);

	scatterplot.dataset.transformations[id] = async function (tile) {
		const value = await run(tile, column);
		const scaled = [...value].map((d) => d  / ( comparisonArray.length * 32 / dims));
		return 	new Float32Array(scaled)
	};
	await scatterplot.dataset.root_tile.get_column(id);
}
