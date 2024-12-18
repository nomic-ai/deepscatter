import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { WebGPUBufferSet, createSingletonBuffer } from './buffertools';
import { Deeptable, Scatterplot, Tile } from '../deepscatter';
import { Bool, Vector, vectorFromArray } from 'apache-arrow';

export class DeepGPU {
  // This is a stateful class for bundling together GPU buffers and resources.
  // It's sort of replacing regl? I don't know yet, just feeling this out.
  device: GPUDevice;
  bufferSet: WebGPUBufferSet;
  deeptable: Deeptable;

  /**
   * Create a DeepGPU synchronously. Usually call DeepGPU.create()
   *
   * @param device The initialized
   * @param bufferSize
   */
  constructor(
    device: GPUDevice,
    deeptable: Deeptable,
    bufferSize = 1024 * 1024 * 256,
  ) {
    this.device = device;
    this.deeptable = deeptable;
    this.bufferSet = new WebGPUBufferSet(device, bufferSize);
  }

  static async create(deeptable: Deeptable): Promise<DeepGPU> {
    // Create a DeepGPU object.
    if (!navigator.gpu) {
      throw new Error('WebGPU is not supported in this browser.');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to get GPU adapter.');
    }

    const device = await adapter.requestDevice();
    return new DeepGPU(device, deeptable);
  }

	async get(field: string, tile: Tile) {
		if (this.bufferSet.store.has([field, tile.key])) {
			return this.bufferSet.store.get([field, tile.key])
		} else {
			const values = (await tile.get_column(field)).data[0].children[0]
				.values as Uint8Array;
			await this.bufferSet.set([field, tile.key], values);
			return this.bufferSet.store.get([field, tile.key])
		}
	}
}




export abstract class ReusableWebGPUPipeline {
	public gpuState: DeepGPU
	constructor(
		gpuState: DeepGPU,
	) {
		this.gpuState = gpuState
	}
	abstract shaderCode() : string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	abstract uniforms(): Record<string, any>;
	protected uniformBuffer?: GPUBuffer;
	protected pipeline?: GPUComputePipeline;
}

export class HammingPipeline extends ReusableWebGPUPipeline {
	public gpuState: DeepGPU;
	public dimensionality? : number;
	public comparisonBuffer: GPUBuffer;
	private fieldName = '_hamming_embeddings';
	constructor(
		gpuState: DeepGPU,
	) {
		super(gpuState)
	}

	bindGroupLayout(device: GPUDevice) {
		return device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'read-only-storage' },
				},
				{
					binding: 1,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'read-only-storage' },
				},
				{
					binding: 2,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'storage' },
				},
				{
					binding: 3,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'uniform' },
				},
			],
		});
	}

	shaderCode() {
		return `
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
	`}

	setComparisonArray(
		arr: Vector<Bool>
	) {
		const underlying = arr.data[0].values;
		this.comparisonBuffer = createSingletonBuffer(
			this.gpuState.device,
			underlying,
			GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
		);
		this.dimensionality = underlying.length;
	}

	uniforms() {
		return {
			objectSize: this.dimensionality / 32,
		}
	}

	prepUniforms() {
		const defs = makeShaderDataDefinitions(this.shaderCode());
	
		const myUniformValues = makeStructuredView(defs.uniforms.myUniforms);
	
		myUniformValues.set(this.uniforms());
		return myUniformValues;
	}

	prep() {
		const { device } = this.gpuState;
		const layout = device.createPipelineLayout({
			bindGroupLayouts: [this.bindGroupLayout(device)],
		});
		// Create shader module and pipeline
		const shaderModule = device.createShaderModule({ code: this.shaderCode() });
		this.pipeline = device.createComputePipeline({
			layout,
			compute: {
				module: shaderModule,
				entryPoint: 'main',
			},
		});
		this.uniformBuffer = createSingletonBuffer(
			device,
			this.prepUniforms().arrayBuffer,
			GPUBufferUsage.UNIFORM,
		);
	}

	async runOnTile(tile: Tile) {
		const { comparisonBuffer, fieldName, pipeline, uniformBuffer, dimensionality: embeddingSize } = this;
		const { device } = this.gpuState;
		const commandEncoder = device.createCommandEncoder();
	
		const { buffer, offset, byte_size: size } = await this.gpuState.get(fieldName, tile)
		const outputSize = (size / embeddingSize) * 8;
		const paddedSize = Math.ceil(outputSize / 4) * 4;
	
		// TODO this should be a permanent buffer.
		const outputBuffer = device.createBuffer({
			// Put a ceiling on it.
			size: paddedSize * 4,
			usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE,
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
					{ binding: 3, resource: { buffer: uniformBuffer } },
				],
			}),
		);
	
		passEncoder.dispatchWorkgroups(size / 4 / 64);
		passEncoder.end();

		// Submit the commands
		const gpuReadBuffer = device.createBuffer({
			size: paddedSize * 4,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		});

		commandEncoder.copyBufferToBuffer(
			outputBuffer,
			0,
			gpuReadBuffer,
			0,
			paddedSize * 4,
		);
		device.queue.submit([commandEncoder.finish()]);

		// Read back the results
		await gpuReadBuffer.mapAsync(GPUMapMode.READ);
		const outputArray = new Uint32Array(gpuReadBuffer.getMappedRange());
		const usable = outputArray.slice(0, outputSize);
		const returnVal = new Float32Array(usable.length)
		for (let i = 0; i < returnVal.length; i++) {
			returnVal[i] = usable[i] / embeddingSize // (originally this was squared??)
		}
		return vectorFromArray(returnVal)
	}
}
	
// hide the state in a global variable.
const dumb: DeepGPU[] = [];

export async function create_hamming_transform(
	scatterplot: Scatterplot,
	id: string,
	view: Vector<Bool>,
) {
	if (dumb.length === 0) {
		dumb.push(await DeepGPU.create(scatterplot.deeptable));
	}
	if (scatterplot.dataset.transformations[id] !== undefined) {
		return;
	}

	const [gpuState] = dumb;
	const pipeline = new HammingPipeline(gpuState);
	pipeline.setComparisonArray(view)
	pipeline.prep();

	scatterplot.dataset.transformations[id] = (tile) => pipeline.runOnTile(tile)
}


