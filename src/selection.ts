import { Dataset } from './Dataset';
import Scatterplot from './deepscatter';
import { Tile } from './tile';

interface SelectParams {
  foreground?: boolean;
  batchCallback?: (t: Tile) => Promise<void>;
  instant?: boolean;
}

export const defaultSelectionParams: SelectParams = {
  foreground: true,
  batchCallback: (t : Tile) => Promise.resolve(),
  instant: false,
};

export interface IdSelectParams extends SelectParams {
  name: string;
  ids: string[] | number[] | bigint[];
  idField: string;
};

function isIdSelectParam(
  params: Record<string, any>
): params is IdSelectParams {
  return params.ids !== undefined;
}

interface BooleanColumnParams extends SelectParams {
  name: string;
  field: string;
};

function isBooleanColumnParam(
  params: Record<string, any>
): params is BooleanColumnParams {
  return params.field !== undefined;
}

/**
 * A DataSelection is a set of data that the user is working with.
 * It is copied into the underlying Arrow files and available to the GPU,
 * so it should not be abused; as a rule of thumb, it's OK to create
 * these in response to user interactions but it shouldn't be done
 * more than once a second or so.
 */

export class DataSelection<T extends Tile> {
  dataset: Dataset<T>;
  plot: Scatterplot<T>;
  name: string;
  constructor(plot: Scatterplot<T>, params: IdSelectParams);
  constructor(plot: Scatterplot<T>, params: BooleanColumnParams);
  constructor(
    plot: Scatterplot<T>,
    params: IdSelectParams | BooleanColumnParams
  ) {
    this.plot = plot;
    this.dataset = plot.dataset as Dataset<T>;
    this.name = params.name;
    if (isIdSelectParam(params)) {
      this.add_identifier_column(params.name, params.ids, params.idField);
    } else if (isBooleanColumnParam(params)) {
      this.add_boolean_column(params.name, params.field);
    }
  }
  async add_identifier_column(
    name: string,
    codes: string[] | bigint[] | number[],
    key_field: string
  ): Promise<void> {
    if (this.dataset.has_column(name)) {
      throw new Error(`Column ${name} already exists, can't create`);
    }
    if (typeof(codes[0]) === 'string') {
    const matcher = stringmatcher(key_field, codes as string[]);
    this.dataset.transformations[name] = matcher;
    await this.dataset.root_tile.apply_transformation(name);
    return this.apply_to_foreground({});
    } else {
      throw new Error('Not implemented');
    }
  }
  add_boolean_column(name: string, field: string): void {
    throw new Error('Method not implemented.');
  }
  apply_to_foreground(params: BackgroundOptions): Promise<void> {
    const field = this.name;
    const background_options : BackgroundOptions = {
      size: [0.5, 10],
      ...params
    }
    return this.plot.plotAPI({

      background_options,
      encoding: {
        foreground: {
          field,
          op: 'gt',
          a: 0,
        }
      }
    })
  }
}

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
    const encoder = new TextEncoder();
    for (const str of matches) {
        const arr = encoder.encode(str);
        addToTrie(arr);
    }

    // The async function has access to variables in the outer function (closure)
    return async function(tile: T) {
        const col = (await tile.get_column(field)).data[0];
        const bytes = col.values as Uint8Array;
        const offsets = col.valueOffsets;
        // Initialize results as a Float32Array with the same length as the 'all' array, initialized to 0
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
            return node[256] !== undefined
        }

        // For each offset
        for (let o = 0; o < tile.record_batch.numRows; o++) {
            const start = offsets[o];
            const end = offsets[o + 1];
            // If the slice exists in the trie, set the corresponding index in the results to 1
            if (existsInTrie(start, end - start)) {
                results[o] = 1;
                console.log('match', {...tile.record_batch.get(o)})
            }
        }
        return results; // Return the results
    };
}
