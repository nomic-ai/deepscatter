/* eslint-disable no-constant-condition */
import { Deeptable } from './Deeptable';
import { Scatterplot } from './scatterplot';
import { Tile } from './tile';
import { getTileFromRow } from './tixrixqid';
import type * as DS from './types';
import {
  Bool,
  Struct,
  StructRowProxy,
  Utf8,
  Vector,
  makeData,
} from 'apache-arrow';
import { bisectLeft, bisectRight, range } from 'd3-array';
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
  params: CompositeSelectParams | BooleanColumnParams | IdSelectParams,
): params is CompositeSelectParams {
  return (params as CompositeSelectParams).composition !== undefined;
}

function isComposition(elems: unknown): elems is Composition {
  if (elems === undefined) throw new Error('Undefined composition');
  if (!elems) return false;
  if (!Array.isArray(elems)) return false;
  const op = elems[0] as unknown;
  if (typeof op !== 'string') return false;
  return ['AND', 'OR', 'XOR', 'NOT', 'ANY', 'ALL'].indexOf(op) > -1;
}

async function extractBitmask(tile: Tile, arg: CompArgs): Promise<Bitmask> {
  if (isComposition(arg)) {
    return applyCompositeFunctionToTile(tile, arg);
  } else {
    const column = tile.get_column(arg.name) as Promise<Vector<Bool>>;
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
      args.slice(1).map((arg: CompArgs) => extractBitmask(tile, arg)),
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
            // Same as any for now.
            return previousValue.or(currentValue);
        }
      }, bitmasks[0]);
    // For none, we've been secretly running an ANY query;
    // we flip it.
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
  params:
    | CompositeSelectParams
    | BooleanColumnParams
    | IdSelectParams
    | FunctionSelectParams,
): params is FunctionSelectParams {
  return (params as FunctionSelectParams).tileFunction !== undefined;
}

/**
 * A Bitmask is used to hold boolean filters across a single record batch.
 * It it used internally to manage selections, and can also be useful
 * inside user-defined transformations that return booleans in a value.
 */
export class Bitmask {
  public mask: Uint8Array;
  public length: number;

  /**
   *
   * @param length The number of points in the bitmask
   * @param mask A Uint8 array to store the boolean bits in. If not passed,
   *             one will be initialized with all false values.
   */
  constructor(length: number, mask?: Uint8Array) {
    this.length = length;
    this.mask = mask || new Uint8Array(Math.ceil(length / 8));
  }

  /**
   *
   * @param vector An Boolean Arrow Vector. If the vector is composed of more
   * than one arrow `Data`, only the first will be used.
   * @returns
   */
  static from_arrow(vector: Vector<Bool>): Bitmask {
    const mask = vector.data[0].values;
    // Copy to make sure we don't mess up the old mask in place
    // TODO: Is this necessary?
    return new Bitmask(vector.length, new Uint8Array(mask));
  }

  /**
   *
   * @returns This bitmask as an Arrow Vector.
   */
  to_arrow() {
    return new Vector([
      makeData({
        type: new Bool(),
        data: this.mask,
        length: this.length,
      }),
    ]);
  }

  /**
   * Returns the indices of the array which are set.
   * Use with care--on dense bitmasks, this will be 16x
   * larger in memory than the bitmask itself.
   */
  which(): Uint16Array {
    const result: number[] = [];
    for (let chunk = 0; chunk < this.length / 8; chunk++) {
      const b = this.mask[chunk];
      // THese are sparse, so we can usually skip the whole byte.
      if (b !== 0) {
        for (let bit = 0; bit < 8; bit++) {
          if ((b & (1 << bit)) !== 0) {
            result.push(chunk * 8 + bit);
          }
        }
      }
    }
    return new Uint16Array(result);
  }

  /**
   * Set the ith element in the bitmask to true
   *
   * @param i A position in the bitmask
   */
  set(i: number) {
    const byte = Math.floor(i / 8);
    const bit = i % 8;
    this.mask[byte] |= 1 << bit;
  }

  /**
   * Set the ith element in the bitmask to false
   *
   * @param i A position in the bitmask
   */
  unset(i: number) {
    const byte = Math.floor(i / 8);
    const bit = i % 8;
    this.mask[byte] = this.mask[byte] & ~(1 << bit);
  }

  /**
   * Retrieves the boolean for the ith value in the bitmask
   *
   * @param i A position in the bitmask
   */
  get(i: number) {
    const byte = Math.floor(i / 8);
    const bit = i % 8;
    return ((1 << bit) & byte) > 0;
  }

  /**
   * The element-wise logical comparison of this bitmask with another one.
   * @param other another bitmask
   * @returns
   */
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

type SelectionSortInfo = {
  indices: Uint16Array;
  // Note that we can't sort by strings.
  values: Float64Array;
  start: number;
  end: number;
};

class SelectionTile {
  // The deepscatter Tile object.
  public tile: Tile;

  // The match count is the number of matches **per tile**;
  // used to access numbers by index.
  public _matchCount: number;

  public sorts: Record<string, SelectionSortInfo> = {};

  public bitmask: Vector<Bool>;

  // Created with a tile and the set of matches.
  // If building from another SelectionTile, may also pass
  // the matchCount.
  constructor({
    tile,
    arrowBitmask,
    matchCount,
  }: {
    tile: Tile;
    arrowBitmask: Vector<Bool>;
    matchCount?: number;
  }) {
    this.tile = tile;
    this.bitmask = arrowBitmask;
    if (matchCount !== undefined) {
      this._matchCount = matchCount;
    }
  }

  get matchCount(): number {
    if (this._matchCount) {
      return this._matchCount;
    }
    let matchCount = 0;
    const { bitmask } = this;
    for (const v of [...bitmask]) {
      if (v) {
        matchCount++;
      }
    }
    this._matchCount = matchCount;
    return this._matchCount;
  }

  addSort(
    key: string,
    getter: (row: StructRowProxy) => number,
    order: 'ascending' | 'descending',
  ) {
    const { bitmask } = this;
    const indices = Bitmask.from_arrow(bitmask).which();
    const pairs: [number, number][] = new Array(indices.length);
    for (let i = 0; i < indices.length; i++) {
      const v = getter(this.tile.record_batch.get(indices[i]));
      pairs[i] = [v, indices[i]];
    }
    // Sort according to the specified order
    pairs.sort((a, b) => (order === 'ascending' ? a[0] - b[0] : b[0] - a[0]));
    const values = new Float64Array(indices.length);
    for (let i = 0; i < indices.length; i++) {
      indices[i] = pairs[i][1];
      values[i] = pairs[i][0];
    }
    this.sorts[key] = {
      indices,
      values,
      start: 0,
      end: indices.length,
    };
  }
}

/**
 * A DataSelection is a set of data that the user is working with.
 * It is copied into the underlying Arrow files and available to the GPU,
 * so it should not be abused; as a rule of thumb, it's OK to create
 * these in response to user interactions but it shouldn't be done
 * more than once a second or so.
 */

export class DataSelection {
  deeptable: Deeptable;
  plot: Scatterplot;

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
   * until they are loaded.
   */
  evaluationSetSize: number = 0;
  tiles: SelectionTile[] = [];

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
  public params:
    | IdSelectParams
    | BooleanColumnParams
    | FunctionSelectParams
    | CompositeSelectParams;

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
      void this.add_function_column(name, async (tile: Tile) => {
        const bitmask = await applyCompositeFunctionToTile(tile, composition);
        return bitmask.to_arrow();
      }).then(markReady);
    }
    this.params = params;
  }

  /**
   *
   * @param event an internally dispatched event.
   * @param listener a function to call back. It takes
   * as an argument the `tile` that was just added.
   */
  on(event: string, listener: (args: unknown) => void): void {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
  }

  protected dispatch(event: string, args: unknown): void {
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

  async applyToAllTiles(threads = 4): Promise<void> {
    const allTiles = [this.deeptable.root_tile];
    const promises: (() => Promise<void>)[] = [];

    // Go through the entire tree, generating promises
    // @eslint-ignore-rule no-constant-condition
    while (true) {
      const t = allTiles.shift();
      if (t === undefined) {
        break;
      }
      promises.push(async () => {
        await t.get_column(this.name);
      });
      for (const child of await t.allChildren()) {
        allTiles.push(child);
      }
    }

    // Create threads number of consumers.
    const workers = range(threads).map(async () => {
      while (true) {
        const p = promises.shift();
        if (p === undefined) {
          break;
        }
        await p();
      }
    });
    // Wait for them to finish
    await Promise.all(workers);
    return;
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
   * @param by the number of rows to move the cursor by.
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

  async removePoints(
    name: string,
    points: StructRowProxy[],
  ): Promise<DataSelection> {
    return this.add_or_remove_points(name, points, 'remove');
  }

  async addPoints(
    name: string,
    points: StructRowProxy[],
  ): Promise<DataSelection> {
    return this.add_or_remove_points(name, points, 'add');
  }

  /**
   * Returns all the data points in the selection, limited to
   * data currently on the screen.
   *
   * @param fields A list of fields in the data to export.
   */
  // async export(fields: string[], format: 'json' = 'json') {
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
  //   const columns = Object.fromEntries(fields.map((field) => [field, []]));
  //   for (let row of this) {
  //     for (let field of fields) {
  //       columns[field].push(row[field]);
  //     }
  //   }
  //   return columns;
  // }

  public moveCursorToPoint(point: StructRowProxy) {
    // The point contains a field called 'ix', which increases in each tile;
    // we use this for moving because it lets us do binary search for relevant tile.
    const rowNumber = point[Symbol.for('rowIndex')] as number;
    const relevantTile = getTileFromRow(point, this.deeptable);

    let currentOffset = 0;
    let positionInTile: number;

    for (const { tile, matchCount } of this.tiles) {
      if (tile.key === relevantTile.key) {
        positionInTile = rowNumber;
        break;
      }
      currentOffset += matchCount;
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
    points: StructRowProxy[],
    which: 'add' | 'remove',
  ): Promise<DataSelection> {
    const matches: Record<string, number[]> = {};
    for (const point of points) {
      const t = getTileFromRow(point, this.deeptable);
      const rowNum = point[Symbol.for('rowIndex')] as number;
      if (!matches[t.key]) {
        matches[t.key] = [rowNum];
      } else {
        matches[t.key].push(rowNum);
      }
    }

    const tileFunction = async (tile: Tile) => {
      await this.ready;

      // First, get the current version of the tile.
      const original = (await tile.get_column(this.name)) as Vector<Bool>;

      // Then if there are matches.
      if (matches[tile.key] !== undefined) {
        const mask = Bitmask.from_arrow(original);
        for (const rowNum of matches[tile.key]) {
          if (which === 'add') {
            mask.set(rowNum);
          } else {
            mask.unset(rowNum);
          }
        }
        return mask.to_arrow();
      } else {
        // If not, we can re-use the same underlying array which should save
        // lots of memory.
        return original;
      }
    };

    const selection = new DataSelection(this.deeptable, {
      name: newName,
      tileFunction,
    });

    await selection.ready;
    for (const { tile } of this.tiles) {
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

  protected wrapWithSelectionMetadata(
    functionToApply: DS.BoolTransformation,
  ): DS.BoolTransformation {
    return async (tile: Tile) => {
      const array = await functionToApply(tile);
      await tile.populateManifest();
      const t = new SelectionTile({
        arrowBitmask: array,
        tile,
      });
      this.tiles.push(t);
      this.selectionSize += t.matchCount;
      this.evaluationSetSize += tile.manifest.nPoints;
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
  get(i: number | undefined = undefined): StructRowProxy | undefined {
    if (i === undefined) {
      i = this.cursor;
    }
    if (i > this.selectionSize) {
      undefined;
    }
    let currentOffset = 0;
    let relevantTile: Tile | undefined = undefined;
    for (const { tile, matchCount } of this.tiles) {
      if (i < currentOffset + matchCount) {
        relevantTile = tile;
        break;
      }
      currentOffset += matchCount;
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
    for (const { tile } of this.tiles) {
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
      node = node[byte];
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
    const col = ((await tile.get_column(field)) as Vector<Utf8>).data[0];
    const bytes = col.values;
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
        node = node[byte];
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

export class SortedDataSelection extends DataSelection {
  public tiles: SelectionTile[] = [];
  public neededFields: string[];
  public comparisonGetter: (a: StructRowProxy) => number;
  public order: 'ascending' | 'descending';
  public key: string;

  constructor(
    deeptable: Deeptable,
    params:
      | IdSelectParams
      | BooleanColumnParams
      | FunctionSelectParams
      | CompositeSelectParams,
    sortOperation: (a: StructRowProxy) => number,
    neededFields: string[],
    order: 'ascending' | 'descending' = 'ascending',
    key?: string,
  ) {
    super(deeptable, params);
    this.neededFields = neededFields;
    this.comparisonGetter = sortOperation;
    this.order = order;
    this.key = key || Math.random().toFixed(10).slice(2);
  }

  // To create a sorted selection from a selection that already
  // has some tiles loaded on it, we need to
  // go back and create and add all the stats that would have been
  // calculated at wrapWithSelectionMetadata.
  static async fromSelection(
    sel: DataSelection,
    neededFields: string[],
    sortOperation: (a: StructRowProxy) => number,
    order: 'ascending' | 'descending' = 'ascending',
    tKey: string | undefined = undefined,
    name: string | undefined = undefined,
  ): Promise<SortedDataSelection> {
    const key = tKey || Math.random().toFixed(10).slice(2);
    const newer = new SortedDataSelection(
      sel.deeptable,
      {
        name: Math.random().toFixed(10).slice(2),
        tileFunction: async (tile: Tile): Promise<Vector<Bool>> =>
          tile.get_column(sel.name),
      },
      sortOperation,
      neededFields,
      order,
      key,
    );

    // Ensure that all the fields we need are ready.
    const withSort = sel.tiles.map(
      async (tile: SelectionTile): Promise<SelectionTile> => {
        await Promise.all(neededFields.map((f) => tile.tile.get_column(f)));
        tile.addSort(key, sortOperation, order);
        return tile;
      },
    );
    newer.tiles = await Promise.all(withSort);
    newer.selectionSize = newer.tiles.reduce((sum, t) => sum + t.matchCount, 0);
    return newer;
  }
  // In addition to the regular things, we also need to add sort fields.
  protected wrapWithSelectionMetadata(
    functionToApply: DS.BoolTransformation,
  ): DS.BoolTransformation {
    return async (tile: Tile) => {
      const array = await functionToApply(tile);

      await tile.populateManifest();

      // Ensure that all the fields needed for the sort operation are present.
      await Promise.all(this.neededFields.map((f) => tile.get_column(f)));

      // Store the indices and values in the tile

      let ix = this.tiles.findIndex((having) => having.tile === tile);
      let t: SelectionTile;
      if (ix !== -1) {
        t = this.tiles[ix];
        t.addSort(this.key, this.comparisonGetter, this.order);
      } else {
        t = new SelectionTile({
          arrowBitmask: array,
          tile,
        });
        t.addSort(this.key, this.comparisonGetter, this.order);
        this.selectionSize += t.matchCount;
        this.evaluationSetSize += tile.manifest.nPoints;
        this.tiles.push(t);
      }

      this.dispatch('tile loaded', tile);
      return array;
    };
  }

  /**
   * Returns the k-th element in the sorted selection.
   * This implementation uses Quickselect with a pivot selected from actual data.
   */
  get(k: number): StructRowProxy | undefined {
    if (k < 0 || k >= this.selectionSize) {
      console.error('Index out of bounds');
      return undefined;
    }

    // Adjust k based on the order
    const targetIndex =
      this.order === 'ascending' ? k : this.selectionSize - k - 1;

    // Implement Quickselect over the combined data
    return quickSelect(targetIndex, this.tiles, this.key);
  }

  // Given a point, returns cursor number that would select it in this selection
  which(row: StructRowProxy) {}

  *yieldSorted(start = undefined, direction = 'up') {
    if (start !== undefined) {
      this.cursor = start;
    }
  }
}

interface QuickSortTile {
  tile: Tile;
  sorts: Record<string, SelectionSortInfo>;
}

function quickSelect(
  k: number,
  tiles: QuickSortTile[],
  key: string,
): StructRowProxy | undefined {
  // Recalculate size based on the current tiles
  const size = tiles.reduce(
    (acc, t) => acc + (t.sorts[key].end - t.sorts[key].start),
    0,
  );

  if (size === 1) {
    for (const t of tiles) {
      const { indices, start, end } = t.sorts[key];
      if (end - start > 0) {
        const recordIndex = indices[start];
        return t.tile.record_batch.get(recordIndex);
      }
    }
    return undefined;
  }

  // Select a random pivot from actual data
  const pivot = randomPivotFromData(tiles, key);

  let countLess = 0;
  let countEqual = 0;
  let countGreater = 0;

  const lessTiles: QuickSortTile[] = [];
  const equalTiles: QuickSortTile[] = [];
  const greaterTiles: QuickSortTile[] = [];

  for (const t of tiles) {
    const { values, indices, start, end } = t.sorts[key];

    const left = bisectLeft(values, pivot, start, end);
    const right = bisectRight(values, pivot, start, end);

    const lessSize = left - start;
    const equalSize = right - left;
    const greaterSize = end - right;

    if (lessSize > 0) {
      lessTiles.push({
        tile: t.tile,
        sorts: {
          [key]: { indices, values, start, end: left },
        },
      });
      countLess += lessSize;
    }

    if (equalSize > 0) {
      equalTiles.push({
        tile: t.tile,
        sorts: {
          [key]: { indices, values, start: left, end: right },
        },
      });
      countEqual += equalSize;
    }

    if (greaterSize > 0) {
      greaterTiles.push({
        tile: t.tile,
        sorts: {
          [key]: { indices, values, start: right, end },
        },
      });
      countGreater += greaterSize;
    }
  }

  // Verify that counts sum up correctly
  if (countLess + countEqual + countGreater !== size) {
    throw new Error('Counts do not sum up to size');
  }

  if (k < countLess) {
    return quickSelect(k, lessTiles, key);
  } else if (k < countLess + countEqual) {
    const indexInEqual = k - countLess;
    return selectInEqualTiles(indexInEqual, equalTiles, key);
  } else {
    const newK = k - (countLess + countEqual);
    return quickSelect(newK, greaterTiles, key);
  }
}

function selectInEqualTiles(
  indexInEqual: number,
  tiles: QuickSortTile[],
  key: string,
): StructRowProxy | undefined {
  let count = 0;
  for (const t of tiles) {
    const { indices, start, end } = t.sorts[key];
    const numValues = end - start;
    if (indexInEqual < count + numValues) {
      const idxInTile = start + (indexInEqual - count);
      const recordIndex = indices[idxInTile];
      return t.tile.record_batch.get(recordIndex);
    }
    count += numValues;
  }
  return undefined;
}

function randomPivotFromData(tiles: QuickSortTile[], key: string): number {
  const totalSize = tiles.reduce(
    (acc, t) => acc + (t.sorts[key].end - t.sorts[key].start),
    0,
  );
  const randomIndex = Math.floor(Math.random() * totalSize);
  let count = 0;
  for (const t of tiles) {
    const { values, start, end } = t.sorts[key];
    const numValues = end - start;
    if (randomIndex < count + numValues) {
      const idxInTile = start + (randomIndex - count);
      return values[idxInTile];
    }
    count += numValues;
  }
  throw new Error('Got lost in randomPivotFromData');
}
