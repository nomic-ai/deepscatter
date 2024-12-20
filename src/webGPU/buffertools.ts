import { type TypedArray } from 'webgpu-utils';
import { BufferSet } from '../regl_rendering';
import { WebGPUBufferLocation } from '../types';
import { Some, TupleMap } from '../utilityFunctions';

// Unlike in webgl, we keep track of both size -- the number of meaningful data bytes
// and paddedSize -- the number of bytes including 256-byte padding.

export class WebGPUBufferSet extends BufferSet<
  GPUBuffer,
  WebGPUBufferLocation
> {
  public device: GPUDevice;
  private stagingBuffer: GPUBuffer;
  public usage: number;

  public store: TupleMap<string, WebGPUBufferLocation> = new TupleMap();

  /**
   *
   * @param regl the Regl context we're using.
   * @param buffer_size The number of bytes on each strip of memory that we'll ask for.
   */

  constructor(
    device: GPUDevice,
    buffer_size: number,
    usage: number = GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_DST |
      GPUBufferUsage.COPY_SRC,
  ) {
    super(buffer_size);
    this.device = device;
    // Track the ends in case we want to allocate smaller items.
    this.usage = usage;
    this.generate_new_buffer();
    this.stagingBuffer = device.createBuffer({
      size: buffer_size,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE,
      mappedAtCreation: false, // saves a little trouble in the passThrough function
    });
  }

  private async passThroughStagingBuffer(
    values: Uint32Array,
    bufferLocation: WebGPUBufferLocation,
  ) {
    // WebGPU
    const { buffer, offset, paddedSize } = bufferLocation;
    while (this.stagingBuffer.mapState !== 'unmapped') {
      // Wait in line for a millisecond.
      // Would be better to hold a queue and apply more than one of these at once.
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await this.stagingBuffer.mapAsync(GPUMapMode.WRITE, 0, paddedSize);
    new Uint32Array(
      this.stagingBuffer.getMappedRange(0, values.byteLength),
    ).set(values);
    this.stagingBuffer.unmap();
    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(
      this.stagingBuffer,
      0,
      buffer,
      offset,
      paddedSize,
    );
    this.device.queue.submit([commandEncoder.finish()]);
  }

  register(k: Some<string>, v: WebGPUBufferLocation) {
    this.store.set(k, v);
  }

  async set(key: Some<string>, value: TypedArray) {
    if (this.store.has(key)) {
      throw new Error(`Key ${key.join(', ')} already exists in buffer set.`);
    }
    const byte_size = value.byteLength;
    const paddedSize = Math.ceil(byte_size / 256) * 256;

    const { buffer, offset } = this.allocate_block(paddedSize);

    // If it's a typed array, we can just copy it directly.
    // cast it to uint32array
    const v2 = value;
    const data = new Uint32Array(v2.buffer, v2.byteOffset, v2.byteLength / 4);
    const description = { buffer, offset, byte_size, paddedSize };
    await this.passThroughStagingBuffer(data, description);
    this.register(key, description);
  }

  _create_buffer(): GPUBuffer {
    return this.device.createBuffer({
      size: this.buffer_size,
      usage: this.usage,
      mappedAtCreation: false,
    });
  }

  _create_leftover_buffer(): WebGPUBufferLocation {
    return {
      buffer: this.buffers[0],
      offset: this.pointer,
      stride: 4, // meaningless here.
      byte_size: this.buffer_size - this.pointer,
      paddedSize: this.buffer_size - this.pointer,
    };
  }
}

export function createSingletonBuffer(
  device: GPUDevice,
  data: Uint32Array | Int32Array | Float32Array | Uint8Array | ArrayBuffer,
  usage: number,
): GPUBuffer {
  // Creates a disposable singleton buffer.
  // ReadonlyBufferSet ought to provide better performance; but
  // this allows more different buffer sizes and easier destruction.
  const buffer = device.createBuffer({
    size: data.byteLength,
    usage,
    mappedAtCreation: true,
  });
  const mappedRange = buffer.getMappedRange();
 
	  // Write the data into the buffer
		if (data instanceof Uint32Array) {
			new Uint32Array(mappedRange).set(data);
		} else if (data instanceof Int32Array) {
			new Int32Array(mappedRange).set(data);
		} else if (data instanceof Float32Array) {
			new Float32Array(mappedRange).set(data);
		} else if (data instanceof Uint8Array) {
			new Uint8Array(mappedRange).set(data);
		} else if (data instanceof ArrayBuffer) {
			// Treat ArrayBuffer as raw data, copy it into the mapped range
			const view = new Uint8Array(mappedRange);
			view.set(new Uint8Array(data));
		} else {
			throw new Error("Unsupported data type for buffer creation");
		}
	
  buffer.unmap();
  return buffer;
}
