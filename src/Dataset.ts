// A Dataset manages the production and manipulation of *tiles*.

import { Tile, Rectangle, QuadTile, ArrowTile, p_in_rect } from './tile';
import { range, min, max, bisectLeft, extent, sum } from 'd3-array';
import Scatterplot from './deepscatter';
import {
  RecordBatch,
  StructRowProxy,
  Table,
  vectorFromArray,
  Data,
  Schema,
  tableFromIPC,
  Vector,
  makeVector,
} from 'apache-arrow';

type Key = string;

function nothing() {
  /* do nothing */
}

type ArrowBuildable = Vector | Float32Array;
type Transformation<T> = (arg0: T) => ArrowBuildable | Promise<ArrowBuildable>;

export abstract class Dataset<T extends Tile> {
  public transformations: Record<string, Transformation<T>> = {};
  abstract root_tile: T;
  protected plot: Plot;
  abstract ready: Promise<void>;
  abstract get extent(): Rectangle;
  abstract promise: Promise<void>;
  private extents: Record<string, [number, number]> = {};
  public _ix_seed = 0;
  public _schema?: Schema;
  constructor(plot: Plot) {
    this.plot = plot;
    // If a linear identifier does not exist in the passed data, we add the ix columns in the order that
    // they are passed.
  }

  get highest_known_ix(): number {
    return this.root_tile.highest_known_ix;
  }

  get table(): Table {
    return new Table(
      this.map((d) => d)
        .filter((d) => d.ready)
        .map((d) => d.record_batch)
    );
  }

  static from_quadfeather(
    url: string,
    prefs: APICall,
    plot: Plot
  ): QuadtileSet {
    return new QuadtileSet(url, prefs, plot);
  }
  static from_arrow_table(
    table: Table,
    prefs: APICall,
    plot: Plot
  ): ArrowDataset {
    return new ArrowDataset(table, prefs, plot);
  }
  abstract download_most_needed_tiles(
    bbox: Rectangle | undefined,
    max_ix: number,
    queue_length: number
  ): void;
  /**
   *
   * @param name The name of the column to check for
   * @returns True if the column exists in the dataset, false otherwise.
   */
  has_column(name: string) {
    return (
      this.root_tile.record_batch.schema.fields.some((f) => f.name == name) ||
      name in this.transformations
    );
  }
  delete_column_if_exists(name: string) {
    // This is a complicated operation to actually free up memory.
    // Clone the record batches, without this data;
    // This function on each tile also frees up the associated GPU memory.
    this.map((d) => d.delete_column_if_exists(name));

    // There may be data bound up in the function that creates it.
    delete this.transformations[name];
  }

  domain(dimension: string, max_ix = 1e6): [number, number] {
    if (this.extents[dimension]) {
      return this.extents[dimension];
    }
    const dim = this._schema?.fields.find((d) => d.name === dimension);
    if (dim !== undefined) {
      let min: number | string | undefined = undefined;
      let max: number | string | undefined = undefined;
      const extent1 = dim.metadata.get('extent');
      if (extent1) {
        [min, max] = JSON.parse(extent1) as [number | string, number | string];
      }
      const mmin = dim.metadata.get('min');
      if (mmin) {
        min = JSON.parse(mmin) as number | string;
      }
      const mmax = dim.metadata.get('max');
      if (mmax) {
        max = JSON.parse(mmax) as number | string;
      }
      // Can pass min, max as strings for dates.
      if (dim.type.typeId == 10 && typeof min === 'string') {
        min = Number(new Date(min));
      }
      if (dim.type.typeId == 10 && typeof max === 'string') {
        max = Number(new Date(max));
      }
      if (typeof max === 'string') {
        throw new Error('Failed to parse min-max as numbers');
      }
      if (min !== undefined) {
        return (this.extents[dimension] = [min as number, max as number]);
      }
    }
    return (this.extents[dimension] = extent([
      ...this.table.getChild(dimension),
    ]));
  }

  *points(bbox: Rectangle | undefined, max_ix = 1e99) {
    const stack: T[] = [this.root_tile];
    let current;
    while ((current = stack.shift())) {
      if (
        current.download_state == 'Complete' &&
        (bbox === undefined || current.is_visible(max_ix, bbox))
      ) {
        for (const point of current) {
          if (
            p_in_rect([point.x as number, point.y as number], bbox) &&
            point.ix <= max_ix
          ) {
            yield point;
          }
        }
        stack.push(...current.children);
      }
    }
  }
  /**
   * Map a function against all tiles.
   * It is often useful simply to invoke Dataset.map(d => d) to
   * get a list of all tiles in the dataset at any moment.
   *
   * @param callback A function to apply to each tile.
   * @param after Whether to perform the function in bottom-up order
   * @returns A list of the results of the function in an order determined by 'after.'
   */

  map<U>(callback: (tile: T) => U, after = false): U[] {
    const results: U[] = [];
    this.visit((d: T) => {
      results.push(callback(d));
    }, after);
    return results;
  }

  /**
   * Invoke a function on all tiles in the dataset that have been downloaded.
   * The general architecture here is taken from the
   * d3 quadtree functions. That's why, for example, it doesn't
   * recurse.

   * @param callback The function to invoke on each tile.
   * @param after Whether to execute the visit in bottom-up order. Default false.
   * @param filter 
   */

  visit(
    callback: (tile: T) => void,
    after = false,
    filter: (t: T) => boolean = (x) => true
  ) {
    // Visit all children with a callback function.

    const stack: T[] = [this.root_tile];
    const after_stack = [];
    let current;
    while ((current = stack.shift())) {
      if (!after) {
        callback(current);
      } else {
        after_stack.push(current);
      }
      if (!filter(current)) {
        continue;
      }
      // Only create children for downloaded tiles.
      if (current.download_state == 'Complete') {
        stack.push(...current.children);
      }
    }
    if (after) {
      while ((current = after_stack.pop())) {
        callback(current);
      }
    }
  }

  async schema() {
    await this.ready;
    if (this._schema) {
      return this._schema;
    }
    this._schema = this.root_tile.record_batch.schema;
    return this.root_tile.record_batch.schema;
  }

  /**
   *
   * @param field_name the name of the column to create
   * @param buffer An Arrow IPC Buffer that deserializes to a table with columns('data' and '_tile')
   */
  add_tiled_column(field_name: string, buffer: Uint8Array): void {
    const tb = tableFromIPC(buffer);
    const records: Record<string, Float32Array> = {};
    for (const batch of tb.batches) {
      const offsets = batch.getChild('data')!.data[0].valueOffsets;
      const values = batch.getChild('data')!.data[0].children[0];
      for (let i = 0; i < batch.data.length; i++) {
        const tilename = batch.getChild('_tile').get(i) as string;
        records[tilename] = values.values.slice(
          offsets[i],
          offsets[i + 1]
        ) as Float32Array;
      }
    }
    this.transformations[field_name] = function (tile) {
      const { key } = tile;
      const array = records[key];
      return array;
    };
  }

  add_sparse_identifiers(field_name: string, ids: PointUpdate) {
    this.transformations[field_name] = function (tile) {
      const { key } = tile;
      const length = tile.record_batch.numRows;
      const array = new Float32Array(length);
      const sparse_values = ids.values[key] ?? [];
      for (const [ix, value] of Object.entries(sparse_values)) {
        array[Number.parseInt(ix)] = value;
      }
      return array;
    };
  }

  /**
   *
   * @param ids A list of ids to get, keyed to the value to set them to.
   * @param field_name The name of the new field to create
   * @param key_field The column in the dataset to match them against.
   */

  add_label_identifiers(
    ids: Record<string, number>,
    field_name: string,
    key_field = '_id'
  ) {
    if (this.transformations[field_name]) {
      throw new Error(
        `Can't overwrite existing transformation for ${field_name}`
      );
    }
    this.transformations[field_name] = function (tile: T) {
      return supplement_identifiers(
        tile.record_batch,
        ids,
        field_name,
        key_field
      );
    };
  }

  /**
   * Given an ix, apply a transformation to the point at that index and
   * return the transformed point (not just the transformation, the whole point)
   * This applies the transformaation to all other points in the same tile.
   *
   * @param transformation The name of the transformation to apply
   * @param ix The index of the point to transform
   */

  async applyTransformationToPoint(transformation: string, ix: number) {
    const matches = this.findPointRaw(ix);

    if (matches.length == 0) {
      throw new Error(`No point for ix ${ix}`);
    }
    const [tile, row] = matches[0];
    // Check if the column exists; if so, return the row.
    if (tile.record_batch.getChild(transformation) !== null) {
      return row;
    }
    await tile.apply_transformation(transformation);
    const ixcol = tile.record_batch.getChild('ix') as Vector;
    const mid = bisectLeft([...ixcol.data[0].values], ix);
    return tile.record_batch.get(mid);
  }
  /**
   *
   * @param ix The index of the point to get.
   * @returns A structRowProxy for the point with the given index.
   */
  findPoint(ix: number): StructRowProxy[] {
    return this.findPointRaw(ix).map(([, point]) => point);
  }

  /**
   * Finds the points and tiles that match the passed ix
   * @param ix The index of the point to get.
   * @returns A list of [tile, point] pairs that match the index.
   */
  findPointRaw(ix: number): [Tile, StructRowProxy][] {
    const matches: [Tile, StructRowProxy][] = [];
    this.visit((tile: T) => {
      if (
        !(
          tile.ready &&
          tile.record_batch &&
          tile.min_ix <= ix &&
          tile.max_ix >= ix
        )
      ) {
        return;
      }
      const mid = bisectLeft(
        [...tile.record_batch.getChild('ix')!.data[0].values],
        ix
      );
      const val = tile.record_batch.get(mid);
      if (val !== null && val.ix === ix) {
        matches.push([tile, val]);
      }
    });
    return matches;
  }
}

export class ArrowDataset extends Dataset<ArrowTile> {
  public promise: Promise<void> = Promise.resolve();
  public root_tile: ArrowTile;

  constructor(table: Table, prefs: APICall, plot: Plot) {
    super(plot);
    this.root_tile = new ArrowTile(table, this, 0, plot);
  }

  get extent() {
    return this.root_tile.extent;
  }

  get ready() {
    return Promise.resolve();
  }

  download_most_needed_tiles(
    bbox: Rectangle | undefined,
    max_ix: number,
    queue_length: number
  ): void {
    // Definitionally, they're already there if using an Arrow table.
    return undefined;
  }
}

export class QuadtileSet extends Dataset<QuadTile> {
  protected _download_queue: Set<Key> = new Set();
  public promise: Promise<void> = new Promise(nothing);
  root_tile: QuadTile;

  constructor(base_url: string, prefs: APICall, plot: Plot) {
    super(plot);
    this.root_tile = new QuadTile(base_url, '0/0/0', null, this, prefs);
    this.promise = this.root_tile.download().then((d) => {
      const schema = this.root_tile.record_batch.schema;
      if (schema.metadata.has('sidecars')) {
        const cars = schema.metadata.get('sidecars') as string;
        const parsed = JSON.parse(cars) as Record<string, string>;
        for (const [k, v] of Object.entries(
          parsed
        )) {
          this.transformations[k] = async function (tile) {
            const batch = await tile.get_arrow(v);
            const column = batch.getChild(k);
            if (column === null) {
              throw new Error(
                `No column named ${k} in sidecar tile ${batch.schema.fields.map(
                  (f) => f.name
                ).join(', ')}`
              );
            }
            return column;
          };
        }
      } else {
        // "NO SIDECARS"
      }
    });
  }

  get ready() {
    return this.root_tile.download();
  }
  get extent() {
    return this.root_tile.extent;
  }

  async download_to_depth(max_ix) {
    await this.root_tile.download_to_depth(max_ix);
  }

  download_most_needed_tiles(
    bbox: Rectangle | undefined,
    max_ix: number,
    queue_length = 4
  ) {
    /*
      Browsing can spawn a  *lot* of download requests that persist on
      unneeded parts of the database. So the tile handles its own queue for dispatching
      downloads in case tiles have slipped from view while parents were requested.
    */

    const queue = this._download_queue;

    if (queue.size >= queue_length) {
      return;
    }

    const scores: [number, QuadTile, Rectangle][] = [];

    function callback(tile: QuadTile) {
      if (bbox === undefined) {
        // Just depth.
        return 1 / tile.codes[0];
      }
      if (tile.download_state === 'Unattempted') {
        const distance = check_overlap(tile, bbox);
        scores.push([distance, tile, bbox]);
      }
    }

    this.visit(callback);

    scores.sort((a, b) => Number(a[0]) - Number(b[0]));
    while (scores.length > 0 && queue.size < queue_length) {
      const upnext = scores.pop();
      if (upnext === undefined) {
        throw new Error('Ran out of tiles unexpectedly');
      }
      const [distance, tile, _] = upnext;
      if ((tile.min_ix && tile.min_ix > max_ix) || distance <= 0) {
        continue;
      }
      queue.add(tile.key);
      tile
        .download()
        .then(() => queue.delete(tile.key))
        .catch((error) => {
          console.warn('Error on', tile.key);
          queue.delete(tile.key);
          throw error;
        });
    }
  }

  /**
   *
   * @param field_name the name of the column to create
   * @param buffer An Arrow IPC Buffer that deserializes to a table with columns('data' and '_tile')
   */
  add_macrotiled_column(
    field_name: string,
    transformation: (ids: string[]) => Promise<Uint8Array>
  ): void {
    const megatile_tasks: Record<string, Promise<void>> = {};
    const records: Record<string, Float32Array> = {};

    async function get_table(tile: QuadTile) {
      const { key, macrotile } = tile;
      if (megatile_tasks[macrotile] !== undefined) {
        return await megatile_tasks[macrotile];
      } else {
        megatile_tasks[macrotile] = transformation(tile.macro_siblings).then(
          (buffer) => {
            const tb = tableFromIPC(buffer);
            for (const batch of tb.batches) {
              const offsets = batch.getChild('data')!.data[0].valueOffsets;
              const values = batch.getChild('data')!.data[0].children[0];
              for (let i = 0; i < batch.data.length; i++) {
                const tilename = batch.getChild('_tile').get(i) as string;
                records[tilename] = values.values.slice(
                  offsets[i],
                  offsets[i + 1]
                ) as Float32Array;
              }
            }
            return;
          }
        );
        return megatile_tasks[macrotile];
      }
    }

    this.transformations[field_name] = async function (tile) {
      await get_table(tile);
      const array = records[tile.key];
      return array;
    };
  }
}

function area(rect: Rectangle) {
  return (rect.x[1] - rect.x[0]) * (rect.y[1] - rect.y[0]);
}

function check_overlap(tile: Tile, bbox: Rectangle): number {
  /* the area of Intersect(tile, bbox) expressed
     as a percentage of the area of bbox */
  const c: Rectangle = tile.extent;

  if (
    c.x[0] > bbox.x[1] ||
    c.x[1] < bbox.x[0] ||
    c.y[0] > bbox.y[1] ||
    c.y[1] < bbox.y[0]
  ) {
    return 0;
  }

  const intersection: Rectangle = {
    x: [max([bbox.x[0], c.x[0]]), min([bbox.x[1], c.x[1]])],
    y: [max([bbox.y[0], c.y[0]]), min([bbox.y[1], c.y[1]])],
  };
  const { x, y } = intersection;
  let disqualify = 0;
  if (x[0] > x[1]) {
    disqualify -= 1;
  }
  if (y[0] > y[1]) {
    disqualify -= 2;
  }
  if (disqualify < 0) {
    return disqualify;
  }
  return area(intersection) / area(bbox);
}

/**
 *
 * @param batch the batch to delete from.
 * @param field_name the name of the field.
 * @param data the data to add OR if null, the existing column to delete.
 * @returns
 */
export function add_or_delete_column(
  batch: RecordBatch,
  field_name: string,
  data: ArrowBuildable | null
): RecordBatch {
  const tb: Record<string, Data> = {};
  for (const field of batch.schema.fields) {
    if (field.name === field_name) {
      if (data === null) {
        // Then it's dropped.
        continue;
      } else {
        throw new Error(`Name ${field.name} already exists, can't add.`);
      }
    }
    tb[field.name] = batch.getChild(field.name)!.data[0] as Data;
  }

  if (data === undefined) {
    throw new Error('Must pass data to bind_column');
  }
  if (data !== null) {
    if (data instanceof Float32Array || data instanceof BigInt64Array) {
      tb[field_name] = makeVector(data).data[0];
    } else {
      tb[field_name] = data.data[0] as Data;
    }
  }

  const new_batch = new RecordBatch(tb);
  for (const [k, v] of batch.schema.metadata) {
    new_batch.schema.metadata.set(k, v);
  }
  for (const oldfield of batch.schema.fields) {
    const newfield = new_batch.schema.fields.find(
      (d) => d.name === oldfield.name
    );
    if (newfield !== undefined) {
      for (const [k, v] of oldfield.metadata) {
        newfield.metadata.set(k, v);
      }
    } else if (data !== null) {
      throw new Error('Error!');
    }
  }
  // Store the creation time on the table metadata.
  if (data !== null) {
    const this_field = new_batch.schema.fields.find(
      (d) => d.name === field_name
    );
    this_field?.metadata.set(
      'created by deepscatter',
      new Date().toISOString()
    );
  }
  return new_batch;
}

/**
 *
 * @param batch
 * @param ids
 * @param field_name
 * @param key_field
 * @returns
 */
function supplement_identifiers(
  batch: RecordBatch,
  ids: Record<string, number>,
  field_name: string,
  key_field = '_id'
): ArrowBuildable {
  /* Add the identifiers from the batch to the ids array */
  // A quick lookup before performing a costly string decode.
  const updatedFloatArray = new Float32Array(batch.numRows);

  const kfield = batch.getChild(key_field);
  if (kfield === null) {
    throw new Error(`Field ${key_field} not found in batch`);
  }

  let keytype = 'string';
  if (kfield?.type?.typeId === 2) {
    keytype = 'bigint';
  }

  if (keytype === 'bigint') {
    for (let i = 0; i < batch.numRows; i++) {
      // the object coerces bigints to strings. We just live with that.
      const value = ids[String(kfield.get(i))];
      if (value !== undefined) {
        updatedFloatArray[i] = value as number;
      }
    }
    return updatedFloatArray;
  }

  const hashtab = new Set();

  for (const item of Object.keys(ids)) {
    const code = [0, 1, 2, 3].map((i) => item.charCodeAt(i) || '').join('');
    hashtab.add(code);
  }

  const offsets = kfield.data[0].valueOffsets;
  const values = kfield.data[0].values;
  // For every identifier, look if it's in the id array.
  for (let i = 0; i < batch.numRows; i++) {
    const code = values.slice(offsets[i], offsets[i + 1]);
    const shortversion: string = code.slice(0, 4).join('');
    if (hashtab.has(shortversion)) {
      const stringtime = String.fromCharCode(...code);
      if (ids[stringtime] !== undefined) {
        updatedFloatArray[i] = ids[stringtime];
      }
    }
  }

  return updatedFloatArray;
}
