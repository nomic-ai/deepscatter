import { Dataset } from './Dataset';
import Scatterplot from './deepscatter';
import { Tile } from './tile';
import type * as DS from './shared.d'
import { StructRowProxy } from 'apache-arrow';
interface SelectParams {
  foreground?: boolean;
  batchCallback?: (t: Tile) => Promise<void>;
  instant?: boolean;
}


export const defaultSelectionParams: SelectParams = {
  foreground: true,
  batchCallback: (t: Tile) => Promise.resolve(),
  instant: false,
};

export interface IdSelectParams extends SelectParams {
  name: string;
  ids: string[] | number[] | bigint[];
  idField: string;
}

function isIdSelectParam(
  params: Record<string, any>
): params is IdSelectParams {
  return params.ids !== undefined;
}

export interface BooleanColumnParams extends SelectParams {
  name: string;
  field: string;
}



function isBooleanColumnParam(
  params: Record<string, any>
): params is BooleanColumnParams {
  return params.field !== undefined;
}
export interface FunctionSelectParams extends SelectParams {
  name: string;
  tileFunction: (t: Tile) => Promise<Float32Array>;
}

function isFunctionSelectParam(
  params: Record<string, any>
): params is FunctionSelectParams {
  return params.tileFunction !== undefined;
}

type IdentifierOptions = {
  plot_after? : boolean;
}

/**
 * A DataSelection is a set of data that the user is working with.
 * It is copied into the underlying Arrow files and available to the GPU,
 * so it should not be abused; as a rule of thumb, it's OK to create
 * these in response to user interactions but it shouldn't be done
 * more than once a second or so.
 */

export class DataSelection<T extends Tile> implements DS.ScatterSelection<T> {
  dataset: Dataset<T>;
  plot: Scatterplot<T>;
  name: string;
  ready: Promise<void>;
  cursor: number = 0;
  complete: boolean = false;
  selectionSize: number = 0;
  evaluationSetSize: number = 0;
  tiles: T[] = [];

  // The match count is the number of matches **per tile**;
  // used to access numbers by index.

  match_count: number[] = [];

  private _bitmask : Record<string, Uint8Array> = {};

  constructor(
    plot: Scatterplot<T>,
    params: IdSelectParams | BooleanColumnParams | FunctionSelectParams
  ) {
    this.plot = plot;
    this.dataset = plot.dataset as Dataset<T>;
    this.name = params.name;
    let markReady = function() {}
    this.ready = new Promise((resolve, reject) => {
      markReady = resolve;
    })
    console.log('Creating selection', {plot, params})
    if (isIdSelectParam(params)) {
      this.add_identifier_column(params.name, params.ids, params.idField).then(markReady);
    } else if (isBooleanColumnParam(params)) {
      this.add_boolean_column(params.name, params.field).then(markReady);
    } else if (isFunctionSelectParam(params)) {
      console.log('adding function column', params.name, params.tileFunction)
      this.add_function_column(params.name, params.tileFunction).then(markReady);
    }
  }

  /**
   * 
   * @param name the name for the column to assign in the dataset.
   * @param tileFunction The transformation to apply
   */
  async add_function_column(name: string, tileFunction: (t: T) => Float32Array): Promise<void> {
    if (this.dataset.has_column(name)) {
      throw new Error(`Column ${name} already exists, can't create`);
    }
    this.plot.dataset.transformations[name] = this.wrapWithSelectionMetadata(tileFunction);
    // Await the application to the root tile, which may be necessary 
    await this.dataset.root_tile.apply_transformation(name);
  }

  /**
   * 
   * Takes a user-defined supplied transformation and adds some bookkeeping
   * for the various count variables.
   * 
   * @param functionToApply the user-defined transformation
   */

  private wrapWithSelectionMetadata(functionToApply : DS.BoolTransformation<T>) : DS.BoolTransformation<T> {
    
    return async (tile : T) => {
      const array = await functionToApply(tile);
      const batch = tile.record_batch;
      let matches = 0;
      for (let i = 0; i < batch.numRows; i++) {
        if (array[i] > 0) {
          matches++;
        }
      }
      this.match_count.push(matches);
      this.selectionSize += matches;
      this.evaluationSetSize += batch.numRows;

      return array;
    }
  }

  get totalSetSize() {
    return 1e6;
    //return this.dataset.root_tile.metadata;
  }
  
  /**
   * 
   * Returns the nth element in the selection. This is a bit tricky because
   * the selection is stored as a list of tiles, each of which has a list of
   * matches. So we have to iterate through the tiles until we find the one
   * that contains the nth match, then iterate through the matches in that
   * tile until we find the nth match.
   * 
   * @param i the index of the row to get
   */
  get(i) : StructRowProxy {
    if (i > this.selectionSize) {
      throw new Error(`Index ${i} out of bounds for selection of size ${this.selectionSize}`);
    }
    let currentOffset = 0;
    let relevantTile : T;
    for (let match_length of this.match_count) {
      if (i < currentOffset + match_length) {
        relevantTile = this.tiles[i];
        break;
      }
      currentOffset += match_length;
    }
    const column = relevantTile.record_batch.getChild(this.name).toArray() as Float32Array;
    const offset = i - currentOffset;
    let ix_in_match = 0;
    for (let j = 0; j < column.length; j++) {
      if (column[j] > 0) {
        if (ix_in_match === offset) {
          return relevantTile.record_batch.get(j);
        }
        ix_in_match++;
      }
    }
    
  }
  async add_identifier_column(
    name: string, 
    codes: string[] | bigint[] | number[],
    key_field: string, 
    options: IdentifierOptions = {}
  ): Promise<void> {
    if (this.dataset.has_column(name)) {
      throw new Error(`Column ${name} already exists, can't create`);
    }
    if (typeof codes[0] === 'string') {
      const matcher = stringmatcher(key_field, codes as string[]);
      this.dataset.transformations[name] = matcher;
      await this.dataset.root_tile.apply_transformation(name);
    } else if (typeof(codes[0]) === 'bigint') {
      const matcher = bigintmatcher(key_field, codes as bigint[]);
      this.dataset.transformations[name] = matcher;
      await this.dataset.root_tile.apply_transformation(name);
    }
    if (options.plot_after) {
      return this.apply_to_foreground({});
    }
  }


  async add_boolean_column(name: string, field: string): Promise<void> {
    throw new Error('Method not implemented.');
  }

  /**
   * Get the bitmask for this selection. This is a map from tile key to
   * Uint8Array, where each byte represents 8 rows in the tile. The bits
   * are set to 1 if the row is selected, 0 otherwise.
   */
  get bitmask() {
    const promises = [];
    for (let tile of this.dataset.map(tile => tile)) {
      // Don't redefine; selections are immutable.
      if (this._bitmask[tile.key]) {
        continue;
      }
      // Placeholder to prevent multiple application--a zero-length array
      // indicates 'in process'
      this._bitmask[tile.key] = new Uint8Array(0);
      const p = tile.get_column(this.name).then(col => {
        const values = col.data[0].values as Float32Array;
        const bitmask = new Uint8Array(Math.ceil(tile.record_batch.numRows / 8));
        for (let i = 0; i < tile.record_batch.numRows; i++) {
          const bit = i % 8;
          const byte = Math.floor(i / 8);
          // set the byte to itself OR-equalsed with the bit value popped
          // into the appropriate place.
          bitmask[byte] |= (values[i] > 0 ? 1 : 0) << bit;
        }

      })
      promises.push(p);
    }
    return Promise.all(promises).then(() => this._bitmask);
  }

  apply_to_foreground(params: DS.BackgroundOptions): Promise<void> {
    const field = this.name;
    const background_options: DS.BackgroundOptions = {
      size: [0.5, 10],
      ...params,
    };
    return this.plot.plotAPI({
      background_options,
      encoding: {
        foreground: {
          field,
          op: 'gt',
          a: 0,
        },
      },
    });
  }
}

function bigintmatcher<T extends Tile>(field: string, matches: bigint[]) {
  const matchings = new Set(matches);
  return async function (tile: T) {
    const col = (await tile.get_column(field)).data[0];
    const values = col.values as bigint[];
    const results = new Float32Array(tile.record_batch.numRows);
    for (let i = 0; i < tile.record_batch.numRows; i++) {
      results[i] = matchings.has(values[i]) ? 1 : 0;
    }
    return results;
  }
}

/**
 * A function for matching strings. Because it's expensive to decode UTF-8 in 
 * Javascript, we don't; instead, we encode the list of matching strings *into*
 * UTF and build a prefix-trie data structure. 
 * 
 * This is a bit intricate to try to tap into some internals of javascript lists.
 * I'm not sure if it succeeds, but it seems fast enough. We
 * can build this out by coding presence a string in the tree as set of lists at the codepoints.
 * For example, if the string [66, 101, 110] is in the array, then we set trie[66] from 
 * undefined to
 * an array (meaning), set trie[66][101] to an array (something begins with 66, 101)
 * and set trie[66][101][110] to an array (something begins with 66, 101, 110). We 
 * also need a convention to mark the *end* of a string; since there are only 255 Uint8s, we
 * do this by setting trie[66][101][110][256] to []. (I use [] instead of, say, 'true', in
 * the superstition that having an array *only* of arrays probably gives some optimizers 
 * more to work with.)
 * 
 * 
 * @param field The column in the deepscatter dataset to search in
 * @param matches A list of strings to match in that column
 * @returns 
 */
function stringmatcher<T extends Tile>(field: string, matches: string[]) {
  // Initialize an empty array for the root of the trie
  type TrieArray = (TrieArray | undefined)[];

  const trie: TrieArray = [];

  // Function to add a Uint8Array to the trie
  function addToTrie(arr: Uint8Array) {
    let node = trie;
    for (const byte of arr) {
      // If the node for this byte doesn't exist yet, initialize it as an empty array
      if (!node[byte]) {
        node[byte] = [];
      }
      node = node[byte] as TrieArray;
    }

    // Mark the end of a Uint8Array with a special property
    // 256 will never be a valid byte, so it won't conflict with any actual bytes

    node[256] = [];
  }

  // Convert strings in matches to Uint8Arrays and add them to the trie
  // This is a one-time cost.
  const encoder = new TextEncoder();
  for (const str of matches) {
    const arr = encoder.encode(str);
    addToTrie(arr);
  }

  /* 
  * The Deepscatter transformation function.
  */
  return async function (tile: T) {
    const col = (await tile.get_column(field)).data[0];
    const bytes = col.values as Uint8Array;
    const offsets = col.valueOffsets;

    // Initialize results as a Float32Array with the same
    // length as the 'all' array,
    // initialized to 0.

    const results = new Float32Array(tile.record_batch.numRows);

    // Function to check if a slice of 'all' Uint8Array exists in the trie
    function existsInTrie(start: number, len: number) {
      let node = trie;
      for (let i = 0; i < len; i++) {
        const byte = bytes[start + i];
        node = node[byte] as TrieArray;
        // If the node for this byte doesn't exist, the slice doesn't exist in the trie
        if (!node) {
          return false;
        }
      }
      // If we've reached the end of the slice, check if it's a complete match
      return node[256] !== undefined;
    }

    // For each offset
    for (let o = 0; o < tile.record_batch.numRows; o++) {
      const start = offsets[o];
      const end = offsets[o + 1];
      // If the slice exists in the trie, set the corresponding index in the results to 1
      if (existsInTrie(start, end - start)) {
        results[o] = 1;
      }
    }
    return results; // Return the results
  };
}
