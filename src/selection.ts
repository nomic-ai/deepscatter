import { Deeptable } from './Deeptable';
import { Scatterplot } from './scatterplot';
import { Tile } from './tile';
import type * as DS from './shared.d';
import {
  Bool,
  DataType,
  StructRowProxy,
  Type,
  Vector,
  makeData,
} from 'apache-arrow';
import { bisectLeft } from 'd3-array';
interface SelectParams {
  name: string;
  useNameCache?: boolean; // If true and a selection with that name already exists, use it and ignore all passed parameters. Otherwise, throw an error.
  foreground?: boolean;
  batchCallback?: (t: Tile) => Promise<void>; // a function that will called after each individual tile is processed. You can use this for progress bars, etc.
}

export const defaultSelectionParams: SelectParams = {
  name: 'unnamed selection',
  foreground: true,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  batchCallback: (t: Tile) => Promise.resolve(),
};

export interface IdSelectParams extends SelectParams {
  ids: string[] | number[] | bigint[];
  idField: string;
}

function isIdSelectParam(params: unknown): params is IdSelectParams {
  return params && params['ids'] !== undefined;
}

export interface BooleanColumnParams extends SelectParams {
  field: string;
}

export interface CompositionSelectParams extends SelectParams {
  composition: Composition;
}

// function isBooleanColumnParam(params: unknown): params is BooleanColumnParams {
//   return params && params['field'] !== undefined;
// }

/**
[
  "AND"
  selection1,
  [
    "OR",
    selection2,
    [
      "NOT",
      selection3
    ]
  ]
]
*/

type PluralOperation = 'ANY' | 'ALL' | 'NONE';
type BinaryOperation = 'AND' | 'OR' | 'XOR';
type UnaryOperation = 'NOT';

type CompArgs = DataSelection | Composition;

/**
 * A composition represents an operation on selections. The syntax is basically
 * a lisp-like list of operations and selections. The first element is the operation,
 * and the rest of the elements are the arguments.
 */
type Composition =
  | [UnaryOperation, CompArgs]
  | [BinaryOperation, CompArgs, CompArgs]
  | [PluralOperation, CompArgs, CompArgs?, CompArgs?, CompArgs?]; // Plural operations accept indefinite length, but this at least gets the internal signatures working.
export interface CompositeSelectParams extends SelectParams {
  composition: Composition;
}

function isCompositeSelectParam(
  params: Record<string, any>,
): params is CompositeSelectParams {
  return params.composition !== undefined;
}

function isComposition(elems: unknown): elems is Composition {
  if (elems === undefined) throw new Error('Undefined composition');
  if (!elems) return false;
  if (!Array.isArray(elems)) return false;
  const op = elems[0] as unknown;
  if (typeof op !== 'string') return false;
  console.log('OP', op, elems);
  return ['AND', 'OR', 'XOR', 'NOT', 'ANY', 'ALL'].indexOf(op) == 0;
}

async function extractBitmask(tile: Tile, arg: CompArgs): Promise<Bitmask> {
  if (isComposition(arg)) {
    return applyCompositeFunctionToTile(tile, arg);
  } else {
    const column = tile.get_column((arg as DataSelection).name) as Promise<
      Vector<Bool>
    >;
    return Bitmask.from_arrow(await column);
  }
}

async function applyCompositeFunctionToTile(
  tile: Tile,
  args: Composition,
): Promise<Bitmask> {
  const operator = args[0];
  if (args[0] === 'NOT') {
    const bitmask = await extractBitmask(tile, args[1]);
    return bitmask.not();
  } else if (isBinarySelectOperation(operator)) {
    const [op, arg1, arg2] = args;
    const bitmask1 = await extractBitmask(tile, arg1);
    const bitmask2 = await extractBitmask(tile, arg2);
    if (op === 'AND') {
      return bitmask1.and(bitmask2);
    } else if (op === 'OR') {
      return bitmask1.or(bitmask2);
    } else if (op === 'XOR') {
      return bitmask1.xor(bitmask2);
    } else {
      throw new Error('Unknown binary operation');
    }
  } else if (isPluralSelectOperator(operator)) {
    const op = args[0];
    const bitmasks = await Promise.all(
      args.slice(1).map((arg) => extractBitmask(tile, arg)),
    );
    const accumulated = bitmasks
      .slice(1)
      .reduce((previousValue, currentValue) => {
        switch (op) {
          case 'ALL':
            return previousValue.and(currentValue);
          case 'ANY':
            return previousValue.or(currentValue);
          case 'NONE':
            return previousValue.or(currentValue);
        }
      }, bitmasks[0]);
    // For none, we've been secretly running an OR query;
    // flip it.
    if (op === 'NONE') return accumulated.not();
    return accumulated;
  }
  console.error('UNABLE TO PARSE', args);
  throw new Error('UNABLE TO PARSE');
}

export interface FunctionSelectParams extends SelectParams {
  name: string;
  tileFunction: (t: Tile) => Promise<Vector<Bool>>;
}

function isPluralSelectOperator(
  params: PluralOperation | BinaryOperation | UnaryOperation,
): params is PluralOperation {
  const things = new Set(['ANY', 'ALL', 'NONE']);
  return things.has(params);
}

function isBinarySelectOperation(
  params: PluralOperation | BinaryOperation | UnaryOperation,
): params is BinaryOperation {
  const things = new Set(['AND', 'OR', 'XOR', 'NAND']);
  return things.has(params);
}

function isFunctionSelectParam(
  params: Record<string, any>,
): params is FunctionSelectParams {
  return params.tileFunction !== undefined;
}

/**
 * A DataSelection is a set of data that the user is working with.
 * It is copied into the underlying Arrow files and available to the GPU,
 * so it should not be abused; as a rule of thumb, it's OK to create
 * these in response to user interactions but it shouldn't be done
 * more than once a second or so.
 */

export class Bitmask {
  public mask: Uint8Array;
  public length: number;

  constructor(length: number, mask?: Uint8Array) {
    this.length = length;
    this.mask = mask || new Uint8Array(Math.ceil(length / 8));
  }

  static from_arrow(vector: Vector<Bool>): Bitmask {
    const mask = vector.data[0].values;
    // Copy to make sure we don't mess up the old mask in place
    // TODO: Is this necessary?
    return new Bitmask(vector.length, new Uint8Array(mask));
  }

  to_arrow() {
    return new Vector([
      makeData({
        type: new Bool(),
        data: this.mask,
        length: this.length,
      }),
    ]);
  }

  // set the ith position to true
  set(i: number) {
    const byte = Math.floor(i / 8);
    const bit = i % 8;
    this.mask[byte] |= 1 << bit;
  }

  // set the ith position to false
  unset(i: number) {
    const byte = Math.floor(i / 8);
    const bit = i % 8;
    this.mask[byte] = this.mask[byte] & ~(1 << bit);
  }

  // Is the ith position on the mask set?
  get(i: number) {
    const byte = Math.floor(i / 8);
    const bit = i % 8;
    return ((1 << bit) & byte) > 0;
  }

  and(other: Bitmask) {
    const result = new Bitmask(this.length);
    for (let i = 0; i < this.mask.length; i++) {
      result.mask[i] = this.mask[i] & other.mask[i];
    }
    return result;
  }

  or(other: Bitmask) {
    const result = new Bitmask(this.length);
    for (let i = 0; i < this.mask.length; i++) {
      result.mask[i] = this.mask[i] | other.mask[i];
    }
    return result;
  }

  xor(other: Bitmask) {
    const result = new Bitmask(this.length);
    for (let i = 0; i < this.mask.length; i++) {
      result.mask[i] = this.mask[i] ^ other.mask[i];
    }
    return result;
  }

  not() {
    const result = new Bitmask(this.length);
    for (let i = 0; i < this.mask.length; i++) {
      result.mask[i] = ~this.mask[i];
    }
    return result;
  }
}
export class DataSelection {
  deeptable: Deeptable;
  plot: Scatterplot;
  // The match count is the number of matches **per tile**;
  // used to access numbers by index.

  match_count: number[] = [];

  /**
   * name: The name of the selection. This will be used as the colun
   * name in the Arrow record batches and are necessary for users
   * to define so that they can use the selection in subsequent
   * plotAPI calls to apply aesthetics to the selection.
   *
   * They must be globally unique in the session.
   *
   * e.g. 'search: fish', '54-abcdf', 'selection at 07:34:12',
   * 'selección compuesta número 1'
   *
   */
  name: string;
  /**
   * Has the selection been applied to the deeptable
   * (does *not* mean it has been applied to all points.)
   */
  ready: Promise<void>;
  /**
   * The cursor is an index that points to the current position
   * within the selected points in the Scatter plot.
   */
  cursor: number = 0;

  /**
   * Has the selection run on all tiles in the deeptable?
   */
  complete: boolean = false;

  /**
   * The total number of points in the selection.
   * It is used to know the size of the selected data.
   */
  selectionSize: number = 0;

  /**
   * The total number of points that have been evaluated for the selection.
   *
   * This is supplied because deepscatter doesn't evaluate functions on tiles
   * untile they are loaded.
   */
  evaluationSetSize: number = 0;
  tiles: Tile[] = [];

  /**
   * Optionally, a user-defined for defining.
   *
   * If you're using this, I recommend defining your own application
   * schema but I'm not going to force you throw type hints right now
   * because, you know. I'm not a monster.
   *
   * e.g.: ['search', 'lasso', 'random', 'cherry-pick']
   *
   */
  type?: string;
  composition: null | Composition = null;
  private events: { [key: string]: Array<(args) => void> } = {};

  constructor(
    deeptable: Deeptable,
    params:
      | IdSelectParams
      | BooleanColumnParams
      | FunctionSelectParams
      | CompositeSelectParams,
  ) {
    this.deeptable = deeptable;
    if (deeptable === undefined) {
      throw new Error("Can't create a selection without a deeptable");
    }
    this.name = params.name;
    let markReady = function () {};
    this.ready = new Promise((resolve) => {
      markReady = resolve;
    });
    this.composition = null;
    if (isIdSelectParam(params)) {
      void this.add_identifier_column(
        params.name,
        params.ids,
        params.idField,
      ).then(markReady);
      // } else if (isBooleanColumnParam(params)) {
      //   void this.add_boolean_column(params.name, params.field).then(markReady);
    } else if (isFunctionSelectParam(params)) {
      void this.add_function_column(params.name, params.tileFunction).then(
        markReady,
      );
    } else if (isCompositeSelectParam(params)) {
      const { name, composition } = params;
      this.composition = composition;
      this.add_function_column(name, async (tile: Tile) => {
        const bitmask = await applyCompositeFunctionToTile(tile, composition);
        return bitmask.to_arrow();
      }).then(markReady);
    }
  }

  /**
   *
   * @param event an internally dispatched event.
   * @param listener a function to call back. It takes
   * as an argument the `tile` that was just added.
   */
  on(event: string, listener: (args: any) => void): void {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
  }

  private dispatch(event: string, args: any): void {
    if (this.events[event]) {
      this.events[event].forEach((listener) => listener(args));
    }
  }

  /**
   *
   * Ensures that the selection has been evaluated on all
   * tiles loaded in the deeptable. This is useful if, for example,
   * your selection represents a search, and you are zoomed in on
   * one portion of the map; this will immediately execute the search
   * (subject to delays to avoid blocking the main thread) on all tiles
   * that have been fetched even if out of the viewport.
   *
   * Resolves upon completion.
   */

  applyToAllLoadedTiles(): Promise<void> {
    return Promise.all(
      this.deeptable.map((tile) => {
        // triggers creation of the deeptable column as a side-effect.
        return tile.get_column(this.name);
      }),
    ).then(() => {});
  }

  /**
   *
   * Downloads all unloaded tiles in the deeptable and applies the
   * transformation to them. Use with care! For > 10,000,000 point
   * deeptables, if called from Europe this may cause the transatlantic fiber-optic internet backbone
   * cables to melt.
   */

  applyToAllTiles(): Promise<void> {
    throw new Error('Method not implemented.');
  }

  /**
   *
   * A function that combines two selections into a third
   * selection that is the union of the two.
   */
  union(other: DataSelection, name: string | undefined): DataSelection {
    return new DataSelection(this.deeptable, {
      name: name || this.name + ' union ' + other.name,
      composition: ['OR', this, other],
    });
  }

  /**
   *
   * A function that combines two selections into a third
   * selection that is the intersection of the two. Note--for more complicated
   * queries than simple intersection/union, use the (not yet defined)
   * disjunctive normal form constructor.
   */
  intersection(other: DataSelection, name: string | undefined): DataSelection {
    return new DataSelection(this.deeptable, {
      name: name || this.name + ' intersection ' + other.name,
      composition: ['AND', this, other],
    });
  }
  /**
   * Advances the cursor (the currently selected point) by a given number of rows.
   * steps forward or backward. Wraps from the beginning to the end.
   *
   * @param by the number of rows to move the cursor by
   *
   * @returns the selection, for chaining
   */
  moveCursor(by: number) {
    this.cursor += by;
    if (this.cursor >= this.selectionSize) {
      this.cursor = this.cursor % this.selectionSize;
    }
    if (this.cursor < 0) {
      this.cursor = this.selectionSize + this.cursor;
    }
    return this;
  }

  async removePoints(name: string, ixes: bigint[]): Promise<DataSelection> {
    return this.add_or_remove_points(name, ixes, 'remove');
  }

  // Non-editable behavior:
  // if a single point is added, will also adjust the cursor.
  async addPoints(name: string, ixes: bigint[]): Promise<DataSelection> {
    return this.add_or_remove_points(name, ixes, 'add');
  }

  /**
   * Returns all the data points in the selection, limited to
   * data currently on the screen.
   *
   * @param fields A list of fields in the data to export.
   */
  async export(fields: string[], format: 'json' = 'json') {
    /*
    This would have benefits, but might fetch data we don't actually need.

    const preparation = []
    for (const field of fields) {
      for (const tile of this.tiles) {
        preparation.push(tile.get_column(field))
      }
    }
    await Promise.all(preparation)
    */
    const columns = Object.fromEntries(fields.map((field) => [field, []]));
    for (let row of this) {
      for (let field of fields) {
        columns[field].push(row[field]);
      }
    }
    return columns;
  }

  public moveCursorToPoint(
    point: StructRowProxy<{ ix: DataType<Type.Int64> }>,
  ) {
    // The point contains a field called 'ix', which increases in each tile;
    // we use this for moving because it lets us do binary search for relevant tile.
    const rowNumber = point[Symbol.for('rowIndex')] as number;
    const ix = point.ix as bigint;
    if (point.ix === undefined) {
      throw new Error(
        'Unable to move cursor to point, because it has no `ix` property.',
      );
    }
    let currentOffset = 0;
    let relevantTile: Tile = undefined;
    let current_tile_ix = 0;
    let positionInTile: number;
    for (const match_length of this.match_count) {
      const tile = this.tiles[current_tile_ix];

      const ixcol = tile.record_batch.getChild('ix').data[0];
      if (ixcol[rowNumber] === ix) {
        relevantTile = tile;
        positionInTile = rowNumber;
        break;
      }
      current_tile_ix += 1;
      currentOffset += match_length;
    }

    if (relevantTile === undefined || positionInTile === undefined) {
      return null;
    }

    const column = relevantTile.record_batch.getChild(
      this.name,
    ) as Vector<Bool>;

    for (let j = 0; j < positionInTile; j++) {
      if (column.get(j)) {
        currentOffset += 1;
      }
    }

    this.cursor = currentOffset;
  }

  private async add_or_remove_points(
    newName: string,
    ixes: bigint[],
    which: 'add' | 'remove',
  ) {
    let newCursor = 0;
    let tileOfMatch = undefined;
    const tileFunction = async (tile: Tile) => {
      newCursor = -1;
      await this.ready;

      // First, get the current version of the tile.
      const original = (await tile.get_column(this.name)) as Vector<Bool>;
      // Then locate the ix column and look for matches.
      const ixcol = tile.record_batch.getChild('ix').data[0]
        .values as BigInt64Array;
      const mask = Bitmask.from_arrow(original);
      for (const ix of ixes) {
        // Since ix is ordered, we can do a fast binary search to see if the
        // point is there--no need for a full scan.

        //@ts-expect-error d3.bisect is not aware it works with bigints as well as numbers
        const mid = bisectLeft([...ixcol], ix as unknown as number);
        const val = tile.record_batch.get(mid);
        // We have to check that there's actually a match,
        // because the binary search identifies where it *would* be.
        if (val !== null && val.ix === ix) {
          // Copy the buffer so we don't overwrite the old one.
          // Set the specific value.
          if (which === 'add') {
            mask.set(mid);
            if (ixes.length === 1) {
              tileOfMatch = tile.key;
              // For single additions, we also move the cursor to the
              // newly added point.
              // First we see the number of points earlier on the current tile.
              let offset_in_tile = 0;
              for (let i = 0; i < mid; i++) {
                if (mask.get(i)) {
                  offset_in_tile += 1;
                }
              }
              // Then, we count the number of matches already seen
              newCursor = offset_in_tile;
            }
          } else {
            // If deleting, we set it to zero.
            mask.unset(mid);
          }
        }
      }
      return mask.to_arrow();
    };
    const selection = new DataSelection(this.deeptable, {
      name: newName,
      tileFunction,
    });

    selection.on('tile loaded', () => {
      // The new cursor gets moved when we encounter a singleton
      if (newCursor >= 0) {
        selection.cursor = newCursor;
        for (let i = 0; i < selection.tiles.length; i++) {
          const tile = selection.tiles[i];
          if (tile.key === tileOfMatch) {
            // Don't add the full number of matches here.
            break;
          }
          selection.cursor += this.match_count[i];
        }
      }
    });
    await selection.ready;
    for (const tile of this.tiles) {
      // This one we actually apply. We'll see if that gets to be slow.
      await tile.get_column(newName);
    }
    return selection;
  }

  get ordering() {
    throw new Error('Method not implemented.');
  }
  /**
   *
   * @param name the name for the column to assign in the deeptable.
   * @param tileFunction The transformation to apply
   */
  async add_function_column(
    name: string,
    tileFunction: DS.BoolTransformation,
  ): Promise<void> {
    if (this.deeptable.has_column(name)) {
      throw new Error(`Column ${name} already exists, can't create`);
    }
    this.deeptable.transformations[name] =
      this.wrapWithSelectionMetadata(tileFunction);
    // Await the application to the root tile, which may be necessary
    await this.deeptable.root_tile.apply_transformation(name);
  }

  /**
   *
   * Takes a user-defined supplied transformation and adds some bookkeeping
   * for the various count variables.
   *
   * @param functionToApply the user-defined transformation
   */

  private wrapWithSelectionMetadata(
    functionToApply: DS.BoolTransformation,
  ): DS.BoolTransformation {
    return async (tile: Tile) => {
      const array = await functionToApply(tile);
      const batch = tile.record_batch;
      let matches = 0;
      for (let i = 0; i < batch.numRows; i++) {
        if ((array['get'] && array['get'](i)) || array[i]) {
          matches++;
        }
      }
      this.match_count.push(matches);
      this.tiles.push(tile);
      this.selectionSize += matches;
      this.evaluationSetSize += batch.numRows;
      // DANGER! Possible race condition. Although the tile loaded
      // dispatches here, it may take a millisecond or two
      // before the actual assignment has happened in the recordbatch.
      this.dispatch('tile loaded', tile);
      return array;
    };
  }

  /**
   * The total number of points in the set. At present, always a light wrapper around
   * the total number of points in the deeptable.
   */
  get totalSetSize() {
    return this.deeptable.highest_known_ix;
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
  get(i: number | undefined): StructRowProxy | undefined {
    if (i === undefined) {
      i = this.cursor;
    }
    if (i > this.selectionSize) {
      undefined;
    }
    let currentOffset = 0;
    let relevantTile: Tile | undefined = undefined;
    let current_tile_ix = 0;
    for (const match_length of this.match_count) {
      if (i < currentOffset + match_length) {
        relevantTile = this.tiles[current_tile_ix];
        break;
      }
      current_tile_ix += 1;
      currentOffset += match_length;
    }
    if (relevantTile === undefined) {
      return undefined;
    }
    const column = relevantTile.record_batch.getChild(
      this.name,
    ) as Vector<Bool>;
    const offset = i - currentOffset;
    let ix_in_match = 0;
    for (let j = 0; j < column.length; j++) {
      if (column.get(j)) {
        if (ix_in_match === offset) {
          return relevantTile.record_batch.get(j) || undefined;
        }
        ix_in_match++;
      }
    }
    throw new Error(`unable to locate point ${i}`);
  }

  // Iterate over the points in raw order.
  *[Symbol.iterator]() {
    for (const tile of this.tiles) {
      const column = tile.record_batch.getChild(this.name) as Vector<Bool>;
      for (let i = 0; i < column.length; i++) {
        if (column.get(i)) {
          yield tile.record_batch.get(i);
        }
      }
    }
  }

  async add_identifier_column(
    name: string,
    codes: string[] | bigint[] | number[],
    key_field: string,
    // options: IdentifierOptions = {},
  ): Promise<void> {
    if (this.deeptable.has_column(name)) {
      throw new Error(`Column ${name} already exists, can't create`);
    }
    if (typeof codes[0] === 'string') {
      const matcher = stringmatcher(key_field, codes as string[]);
      this.deeptable.transformations[name] =
        this.wrapWithSelectionMetadata(matcher);
      await this.deeptable.root_tile.apply_transformation(name);
    } else if (typeof codes[0] === 'bigint') {
      const matcher = bigintmatcher(key_field, codes as bigint[]);
      this.deeptable.transformations[name] =
        this.wrapWithSelectionMetadata(matcher);
      await this.deeptable.root_tile.apply_transformation(name);
    } else {
      console.error('Unable to match type', typeof codes[0]);
    }
  }
}

function bigintmatcher(field: string, matches: bigint[]) {
  const matchings = new Set(matches);
  return async function (tile: Tile) {
    const col = (await tile.get_column(field)).data[0];
    const values = col.values as bigint[];
    const bitmask = new Bitmask(tile.record_batch.numRows);
    for (let i = 0; i < tile.record_batch.numRows; i++) {
      matchings.has(values[i]) && bitmask.set(i);
    }
    return bitmask.to_arrow();
  };
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
 * @param field The column in the deepscatter deeptable to search in
 * @param matches A list of strings to match in that column
 * @returns
 */
function stringmatcher(field: string, matches: string[]) {
  if (field === undefined) {
    throw new Error('Field must be defined');
  }
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
  return async function (tile: Tile) {
    const col = (await tile.get_column(field)).data[0];
    const bytes = col.values as Uint8Array;
    const offsets = col.valueOffsets;

    // Initialize results as a Float32Array with the same
    // length as the 'all' array,
    // initialized to 0.

    //const results = new Float32Array(tile.record_batch.numRows);
    const bitmask = new Bitmask(tile.record_batch.numRows);
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
        bitmask.set(o);
      }
    }
    return bitmask.to_arrow(); // Return the results
  };
}
