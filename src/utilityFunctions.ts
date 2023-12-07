

import { Dictionary, Utf8, Int8, Int16, Int32, vectorFromArray, Vector, makeVector } from "apache-arrow";

type IndicesType = null | Int8Array | Int16Array | Int32Array;
type DictionaryType = Dictionary<Utf8, Int8| Int16| Int32>;

// We need to keep track of the current dictionary number
// to avoid conflicts. I start these at 07540, the zip code
// for Montclair, NJ, to avoid conflicts with ranges starting 
// 
let currentDictNumber = 7540;

// Function overloads to make this curryable.
export function dictionaryFromArrays(labels: string[]): (indices: IndicesType) => DictionaryType;
export function dictionaryFromArrays(labels: string[], indices: IndicesType): DictionaryType;

/** 
 * Create a dictionary from labels and integer indices.
 * If call with just labels, returns a function from indices to 
 * dictionaries--this method is *strongly* recommended if you don't
 * want things to be really slow.
 */
export function dictionaryFromArrays(
  labels: string[],
  indices?: IndicesType
): DictionaryType | ((indices: IndicesType) => DictionaryType) {

  // Run vectorFromArray only once to create labelsArrow.
  const labelsArrow: Vector<Utf8> = vectorFromArray(labels, new Utf8());

  // Return a function that captures labelsArrow.
  if (indices === undefined) {
    return (indices: IndicesType) => createDictionaryWithVector(labelsArrow, indices);
  }

  return createDictionaryWithVector(labelsArrow, indices);
}

function createDictionaryWithVector(
  labelsArrow: Vector<Utf8>,
  indices: IndicesType
): DictionaryType {
  let t;

  if (indices[Symbol.toStringTag] === `Int8Array`) {
    t = new Int8();
  } else if (indices[Symbol.toStringTag] === `Int16Array`) {
    t = new Int16();
  } else if (indices[Symbol.toStringTag] === `Int32Array`) {
    t = new Int32();
  } else {
    throw new Error(
      'values must be an array of signed integers, 32 bit or smaller.'
    );
  }
  const type = new Dictionary(labelsArrow.type, t, currentDictNumber++, false);
  const returnval = makeVector({
    type,
    length: indices.length,
    nullCount: 0,
    data: indices,
    dictionary: labelsArrow,
  }) as unknown as Dictionary<Utf8, Int8| Int16| Int32>; // WTF typesciprt why do you make me cast to unknown???

  return returnval;
}