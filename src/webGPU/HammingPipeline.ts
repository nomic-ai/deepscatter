import { DeepGPU, ReusableWebGPUPipeline } from './lib';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { createSingletonBuffer } from './buffertools';
import { Deeptable, Tile, Transformation } from '../deepscatter';
import { Bool, Type, Vector, vectorFromArray } from 'apache-arrow';


export class HammingPipeline extends ReusableWebGPUPipeline {
	public gpuState: DeepGPU;
	public dimensionality? : number;
	public comparisonBuffer: GPUBuffer;
	private fieldName : string;
	constructor(
		gpuState: DeepGPU,
		fieldName: string
	) {
		super(gpuState)
		this.fieldName = fieldName
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
		arrs: Vector<Bool>[]
	) {
		if (arrs.length === 0) {
			throw new Error("No embeddings provided.");
		}
		// Ensure all have the same length and type.
		const length = arrs[0].length;
		for (const arr of arrs) {
			if (arr.length !== length) {
				throw new Error("All provided embeddings must have the same length.");
			}
			const underlying = arr.data[0];
			if (underlying.type.typeId !== Type.Bool) {
				throw new Error("All embeddings must be boolean.");
			}
		}
		
		this.dimensionality = length;
		
		// Convert each embedding into bytes and concatenate.
		const allBytes: Uint8Array[] = [];
		for (const arr of arrs) {
			const underlying = arr.data[0];
			const bytes = underlying.values.slice(
				underlying.offset / 8,
				underlying.offset / 8 + underlying.length / 8
			);
			allBytes.push(bytes);
		}

		// Concatenate all embeddings into one large Uint8Array
		const totalLength = allBytes.reduce((acc, b) => acc + b.length, 0);
		const concatenated = new Uint8Array(totalLength);
		let offset = 0;
		for (const b of allBytes) {
			concatenated.set(b, offset);
			offset += b.length;
		}

		this.comparisonBuffer = createSingletonBuffer(
			this.gpuState.device,
			concatenated,
			GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
		);
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
	
		const outputBuffer = device.createBuffer({
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
			returnVal[i] = usable[i] / embeddingSize
		}
		return vectorFromArray(returnVal)
	}
}
	

export async function create_multi_hamming_transform(
	deeptable: Deeptable,
	field: string,
	views: Vector<Bool>[],
) : Promise<Transformation> {
	const gpuState = await deeptable.deepGPU
	const pipeline = new HammingPipeline(gpuState, field);
	pipeline.setComparisonArray(views)
	pipeline.prep();
	return (tile: Tile) => pipeline.runOnTile(tile)
}
