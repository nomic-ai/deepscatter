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

type IndicesType = Int8Array | Int16Array | Int32Array;
type DictionaryType = Dictionary<Utf8, Int8 | Int16 | Int32>;

// We need to keep track of the current dictionary number
// to avoid conflicts. I start these at 07540, the zip code
// for Montclair, NJ, to avoid conflicts with ranges starting
// at zero.
let currentDictNumber = 7540;

// Function overloads to make this curryable.
export function dictionaryFromArrays(
  labels: string[],
): (indices: IndicesType) => Vector<DictionaryType>;
export function dictionaryFromArrays(
  labels: string[],
  indices: IndicesType,
): Vector<DictionaryType>;

/**
 * Create a dictionary from labels and integer indices.
 * If called with just labels, returns a function from indices to
 * dictionaries--this method is *strongly* recommended if you don't
 * want things to be really slow.
 */
export function dictionaryFromArrays(
  labels: string[],
  indices?: IndicesType,
): Vector<DictionaryType> | ((indices: IndicesType) => Vector<DictionaryType>) {
  // Run vectorFromArray only once to create labelsArrow.
  const labelsArrow: Vector<Utf8> = vectorFromArray(labels, new Utf8());

  // Return a function that captures labelsArrow.
  if (indices === undefined) {
    return (indices: IndicesType) =>
      createDictionaryWithVector(labelsArrow, indices);
  }

  return createDictionaryWithVector(labelsArrow, indices);
}

function createDictionaryWithVector(
  labelsArrow: Vector<Utf8>,
  indices: IndicesType,
): Vector<DictionaryType> {
  let t;

  if (indices[Symbol.toStringTag] === `Int8Array`) {
    t = new Int8();
  } else if (indices[Symbol.toStringTag] === `Int16Array`) {
    t = new Int16();
  } else if (indices[Symbol.toStringTag] === `Int32Array`) {
    t = new Int32();
  } else {
    throw new Error(
      'values must be an array of signed integers, 32 bit or smaller.',
    );
  }
  const type = new Dictionary(
    labelsArrow.type,
    t,
    currentDictNumber++,
    false,
  ) as Dictionary<Utf8, Int8 | Int16 | Int32>;
  const returnval = makeVector({
    type,
    length: indices.length,
    nullCount: 0,
    data: indices,
    dictionary: labelsArrow,
  });

  return returnval;
}

export class TupleMap<K = Object, V = Object> {
  private map: Map<K, TupleMap<K, V>> = new Map();
  private value?: V;

  set(keys: K[], value: V): void {
    let currentMap: TupleMap<K, V> = this;
    for (const key of keys) {
      if (!currentMap.map.has(key)) {
        currentMap.map.set(key, new TupleMap<K, V>());
      }
      currentMap = currentMap.map.get(key);
    }
    currentMap.value = value;
  }

  get(keys: K[]): V | undefined {
    let currentMap: TupleMap<K, V> = this;
    for (const key of keys) {
      currentMap = currentMap.map.get(key) as TupleMap<K, V>;
      if (!currentMap) {
        return undefined;
      }
    }
    return currentMap.value;
  }

  has(keys: K[]): boolean {
    let currentMap: TupleMap<K, V> = this;
    for (const key of keys) {
      currentMap = currentMap.map.get(key) as TupleMap<K, V>;
      if (!currentMap) {
        return false;
      }
    }
    return currentMap.value !== undefined;
  }

  delete(keys: K[]): boolean {
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

// finds the first set bit.
function ffs(n: number): number {
  return Math.log2(n & -n);
}
