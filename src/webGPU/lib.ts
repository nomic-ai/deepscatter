import { WebGPUBufferSet } from './buffertools';
import { Deeptable, Tile } from '../deepscatter';

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