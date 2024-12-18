import { Deeptable } from '../deepscatter';
import { createSingletonBuffer, WebGPUBufferSet } from './buffertools';
import { DeepGPU } from './lib';

type TinyForestParams = {
  nTrees: number;
  depth: number;
  // The number of features to consider at each split.
  maxFeatures: number;
  D: number;
};

const defaultTinyForestParams: TinyForestParams = {
  nTrees: 128,
  depth: 8,
  maxFeatures: 32,
  D: 768,
};

export class TinyForest extends DeepGPU {
  params: TinyForestParams;

  private _bootstrapSamples?: GPUBuffer; // On the order of 100 KB
  protected _forests?: GPUBuffer; // On the order of 10 MB.
  // private trainedThrough: number = 0;
  constructor(
    device: GPUDevice,
    bufferSize = 1024 * 1024 * 256,
    t: Partial<TinyForestParams> = {},
    deeptable: Deeptable
  ) {
    throw new Error("Not implemented")
    super(device, deeptable);
    this.params = { ...defaultTinyForestParams, ...t };
    this.initializeForestsToZero();
    this.bufferSet = new WebGPUBufferSet(device, bufferSize);
  }

  countPipeline(): GPUComputePipeline {
    const { device } = this;
    // const { maxFeatures, nTrees } = this.params
    // const OPTIONS = 2;
    // const countBuffer = device.createBuffer({
    //   size: OPTIONS * maxFeatures * nTrees * 4,
    //   usage: GPUBufferUsage.STORAGE & GPUBufferUsage.COPY_SRC,
    //   mappedAtCreation: false
    // });

    const layout = device.createBindGroupLayout({
      entries: [
        {
          // features buffer;
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          // dims to check array;
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          // output count buffer.
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
      ],
    });

    // const subsetsToCheck = this.chooseNextFeatures();
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [layout],
    });

    const shaderModule = device.createShaderModule({
      code: `
      @group(0) @binding(0) var<storage, read> features: array<u32>;
      @group(0) @binding(1) var<storage, read> dimsToCheck: array<u16>;
      @group(0) @binding(2) var<storage, write> counts: array<u32>;

      @compute @workgroup_size(64)
      //TODOD HERE
      `,
    });

    return device.createComputePipeline({
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    });
  }

  //@ts-expect-error foo
  private chooseNextFeatures(n = 32) {
    console.log({ n });
    const { maxFeatures, nTrees, D } = this.params;
    const features = new Uint16Array(maxFeatures * D);
    for (let i = 0; i < nTrees; i++) {
      const set = new Set<number>();
      while (set.size < maxFeatures) {
        set.add(Math.floor(Math.random() * D));
      }
      const arr = new Uint16Array([...set].sort());
      features.set(arr, i * maxFeatures);
    }
    return createSingletonBuffer(this.device, features, GPUBufferUsage.STORAGE);
  }

  initializeForestsToZero() {
    // Each tree is a set of bits; For every possible configuration
    // the first D indicating
    // the desired outcome for the dimension,
    // the second D indicating whether the bits in those
    // positions are to be considered in checking if the tree
    // fits. There are 2**depth bitmasks for each dimension--each point
    // will match only one, and part of the inference task is determining which one.

    const treeSizeInBytes = (2 * this.params.D * 2 ** this.params.depth) / 8;

    const data = new Uint8Array(treeSizeInBytes * this.params.nTrees);
    this._forests = createSingletonBuffer(
      this.device,
      data,
      GPUBufferUsage.STORAGE,
    );
  }

  // Rather than actually bootstrap, we generate a single
  // list of 100,000 numbers drawn from a poisson distribution.
  // These serve as weights for draws with replacement; to
  // bootstrap any given record batch, we take a sequence of
  // numbers from the buffer with offset i.
  get bootstrapSamples() {
    if (this._bootstrapSamples) {
      return this._bootstrapSamples;
    } else {
      const arr = new Uint8Array(100000);
      for (let i = 0; i < arr.length; i++) {
        arr[i] = poissonRandomNumber();
      }
      this._bootstrapSamples = createSingletonBuffer(
        this.device,
        arr,
        GPUBufferUsage.STORAGE,
      );
      return this._bootstrapSamples;
    }
  }
}

function poissonRandomNumber(): number {
  let p = 1.0;
  let k = 0;

  do {
    k++;
    p *= Math.random();
  } while (p > 1 / Math.E);

  return k - 1;
}
