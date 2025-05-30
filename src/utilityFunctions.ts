import {
  Dictionary,
  Utf8,
  Int8,
  Int16,
  Int32,
  vectorFromArray,
  Vector,
  makeVector,
} from 'apache-arrow';
import { DataProps } from 'apache-arrow/data';

type ArrayToArrayMap = {
  Int8Array: Int8;
  Int16Array: Int16;
  Int32Array: Int32;
};

// We need to keep track of the current dictionary number
// to avoid conflicts. I start these at 07540, the zip code
// for Montclair, NJ, to avoid conflicts with ranges starting
// at zero.
let currentDictNumber = 7540;

// Function overloads to make this curryable.
export function dictionaryFromArrays<T extends keyof ArrayToArrayMap>(
  labels: string[],
): (indices: T) => Vector<Dictionary<Utf8, ArrayToArrayMap[T]>>;
export function dictionaryFromArrays<T extends keyof ArrayToArrayMap>(
  labels: string[],
  indices: T,
): Vector<Dictionary<Utf8, ArrayToArrayMap[T]>>;

/**
 * Create a dictionary from labels and integer indices.
 * If called with just labels, returns a function from indices to
 * dictionaries--this method is *strongly* recommended if you don't
 * want things to be really slow.
 */
export function dictionaryFromArrays<T extends keyof ArrayToArrayMap>(
  labels: string[],
  indices?: T,
):
  | Vector<Dictionary<Utf8, ArrayToArrayMap[T]>>
  | ((indices: T) => Vector<Dictionary<Utf8, ArrayToArrayMap[T]>>) {
  // Run vectorFromArray only once to create labelsArrow.
  const labelsArrow: Vector<Utf8> = vectorFromArray(labels, new Utf8());

  // Return a function that captures labelsArrow.
  if (indices === undefined) {
    return (indices: T) => createDictionaryWithVector(labelsArrow, indices);
  }

  return createDictionaryWithVector(labelsArrow, indices);
}

function createDictionaryWithVector<T extends keyof ArrayToArrayMap>(
  labelsArrow: Vector<Utf8>,
  indices: T,
): Vector<Dictionary<Utf8, ArrayToArrayMap[T]>> {
  let t: ArrayToArrayMap[T];

  if (indices[Symbol.toStringTag] === `Int8Array`) {
    t = new Int8() as ArrayToArrayMap[T];
  } else if (indices[Symbol.toStringTag] === `Int16Array`) {
    t = new Int16() as ArrayToArrayMap[T];
  } else if (indices[Symbol.toStringTag] === `Int32Array`) {
    t = new Int32() as ArrayToArrayMap[T];
  } else {
    throw new Error(
      'values must be an array of signed integers, 32 bit or smaller.',
    );
  }
  const type: Dictionary<Utf8, ArrayToArrayMap[T]> = new Dictionary(
    labelsArrow.type,
    t,
    currentDictNumber++,
    false,
  );

  // @ts-expect-error These are correct and unit tested, but
  // the typing fails for reasons I don't understand.
  const props: DataProps<Dictionary<Utf8, ArrayToArrayMap[T]>> = {
    type: type,
    length: indices.length,
    nullCount: 0,
    data: indices,
    dictionary: labelsArrow,
  };
  const returnval = makeVector(props);
  return returnval;
}

// An array, but with a guarantee there is at least element.
export type Some<T> = [T, ...T[]];

/**
 * A Map that allows for tuples as keys with proper identity checks.
 */
export class TupleMap<K = object, V = object> {
  private map: Map<K, TupleMap<K, V>> = new Map();
  private value?: V;

  constructor(v: [Some<K>, V][] = []) {
    for (const [keys, value] of v) {
      this.set(keys, value);
    }
  }

  get size(): number {
    return this.map.size;
  }

  set(keys: Some<K>, value: V): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let currentMap: TupleMap<K, V> = this;
    for (const key of keys) {
      if (!currentMap.map.has(key)) {
        currentMap.map.set(key, new TupleMap<K, V>());
      }
      currentMap = currentMap.map.get(key);
    }
    currentMap.value = value;
  }

  *entries(): IterableIterator<[Some<K>, V]> {
    for (const [key, map] of this.map) {
      for (const [keys, value] of map.entries()) {
        yield [[key, ...keys], value];
      }
    }
    if (this.value !== undefined) {
      // If this map has a value, yield it with an empty key array
      // @ts-expect-error - the empty array gets around the type check
      // but is OK because this only happens BELOW the first level;
      // the first level is not allowed to have a value but I don't feel
      // like explicitly classing the first level as a different type from
      // the rest.
      yield [[], this.value];
    }
  }

  *keys(): IterableIterator<Some<K>> {
    for (const [k] of this.entries()) {
      yield k;
    }
  }

  get(keys: Some<K>): V | undefined {
    let currentMap: TupleMap<K, V> = this;
    for (const key of keys) {
      currentMap = currentMap.map.get(key) as TupleMap<K, V>;
      if (!currentMap) {
        return undefined;
      }
    }
    return currentMap.value;
  }

  has(keys: Some<K>): boolean {
    let currentMap: TupleMap<K, V> = this;
    for (const key of keys) {
      currentMap = currentMap.map.get(key) as TupleMap<K, V>;
      if (!currentMap) {
        return false;
      }
    }
    return currentMap.value !== undefined;
  }

  delete(keys: Some<K>): boolean {
    let currentMap: TupleMap<K, V> = this;
    const stack: TupleMap<K, V>[] = [];

    for (const key of keys) {
      if (!currentMap.map.has(key)) {
        return false;
      }
      stack.push(currentMap);
      currentMap = currentMap.map.get(key) as TupleMap<K, V>;
    }

    currentMap.value = undefined;

    // Clean up empty nested maps
    for (let i = keys.length - 1; i >= 0; i--) {
      const parentMap = stack[i];
      const key = keys[i];
      const childMap = parentMap.map.get(key) as TupleMap<K, V>;

      // Remove map if it has no value and no nested maps
      if (!childMap.value && childMap.map.size === 0) {
        parentMap.map.delete(key);
      }
    }
    return true;
  }
}

export class TupleSet<K = object> {
  private map = new TupleMap<K, boolean>();

  constructor(v: Some<K>[] = []) {
    for (const keys of v) {
      this.add(keys);
    }
  }

  add(keys: Some<K>): void {
    this.map.set(keys, true);
  }

  has(keys: Some<K>): boolean {
    return this.map.has(keys);
  }

  delete(keys: Some<K>): boolean {
    return this.map.delete(keys);
  }

  *values(): IterableIterator<Some<K>> {
    for (const keys of this.map.keys()) {
      yield keys;
    }
  }

  [Symbol.iterator](): IterableIterator<Some<K>> {
    return this.values();
  }

  get size(): number {
    // TODO: Keep a tally at this._size
    return [...this.values()].length;
  }

  clear(): void {
    this.map = new TupleMap();
  }
}

export class MinHeap<T> {
  private heap: T[] = [];
  private comparator: (a: T, b: T) => number;

  constructor(comparator: (a: T, b: T) => number) {
    this.comparator = comparator;
  }

  /** Inserts a new element into the heap */
  public insert(value: T): void {
    this.heap.push(value);
    this.bubbleUp();
  }

  /** Extracts and returns the minimum element from the heap */
  public extractMin(): T | undefined {
    if (this.heap.length === 0) return undefined;

    const min = this.heap[0];
    const end = this.heap.pop();

    if (this.heap.length > 0 && end !== undefined) {
      this.heap[0] = end;
      this.bubbleDown();
    }

    return min;
  }

  /** Returns true if the heap is empty */
  public isEmpty(): boolean {
    return this.heap.length === 0;
  }

  /** Returns the size of the heap */
  public size(): number {
    return this.heap.length;
  }

  /** Returns the minimum element without removing it */
  public peek(): T | undefined {
    return this.heap[0];
  }

  private bubbleUp(): void {
    let index = this.heap.length - 1;
    const element = this.heap[index];

    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.heap[parentIndex];

      if (this.comparator(element, parent) >= 0) break;

      this.heap[index] = parent;
      this.heap[parentIndex] = element;
      index = parentIndex;
    }
  }

  private bubbleDown(): void {
    let index = 0;
    const length = this.heap.length;
    const element = this.heap[0];

    while (true) {
      let swapIndex: number | null = null;
      const leftChildIndex = 2 * index + 1;
      const rightChildIndex = 2 * index + 2;

      if (leftChildIndex < length) {
        const leftChild = this.heap[leftChildIndex];
        if (this.comparator(leftChild, element) < 0) {
          swapIndex = leftChildIndex;
        }
      }

      if (rightChildIndex < length) {
        const rightChild = this.heap[rightChildIndex];
        if (
          (swapIndex === null && this.comparator(rightChild, element) < 0) ||
          (swapIndex !== null &&
            this.comparator(rightChild, this.heap[swapIndex]) < 0)
        ) {
          swapIndex = rightChildIndex;
        }
      }

      if (swapIndex === null) break;

      this.heap[index] = this.heap[swapIndex];
      this.heap[swapIndex] = element;
      index = swapIndex;
    }
  }
}


export class FifoTupleMap<K, V> extends TupleMap<K, V> {
  // private f: (key: K, arg: ArgT) => V;
  max: number;
  constructor(max: number) {
    super();
    this.max = max;
  }

  set(key: Some<K>, value: V) {
    super.set(key, value);
    if (this.size > this.max) {
      const next = this.keys().next();
      if (next.value) {        
        // using 'as' here because we lose the type in the iteration.
        this.delete(next.value as Some<K>);
      }
    }
    return this;
  }
}
