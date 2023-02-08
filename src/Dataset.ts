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
} from 'apache-arrow';
type Key = string;

function nothing() {
  /* do nothing */
}

export abstract class Dataset<T extends Tile> {
  public transformations: Record<string, (arg0: T) => RecordBatch> = {};
  abstract root_tile: T;
  protected plot: Scatterplot;
  abstract ready: Promise<void>;
  abstract get extent(): Rectangle;
  abstract promise: Promise<void>;
  private extents: Record<string, [number, number]> = {};
  public _ix_seed: number = 0;
  public _schema?: Schema;
  constructor(plot: Scatterplot) {
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
    plot: Scatterplot
  ): QuadtileSet {
    return new QuadtileSet(url, prefs, plot);
  }
  static from_arrow_table(
    table: Table,
    prefs: APICall,
    plot: Scatterplot
  ): ArrowDataset {
    return new ArrowDataset(table, prefs, plot);
  }
  abstract download_most_needed_tiles(
    bbox: Rectangle | undefined,
    max_ix: number,
    queue_length: number
  ): void;

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
          if (p_in_rect([point.x, point.y], bbox) && point.ix <= max_ix) {
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
    }, (after = after));
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

  add_tiled_column(field_name: string, buffer: Uint8Array): void {
    const tb = tableFromIPC(buffer);
    const records = {};
    window.tb = tb;
    for (let batch of tb.batches) {
      const offsets = batch.getChild('data').data[0].valueOffsets;
      const values = batch.getChild('data').data[0].children[0];
      for (let i = 0; i < batch.data.length; i++) {
        const tilename = batch.getChild('_tile').get(i);
        records[tilename] = values.values.slice(offsets[i], offsets[i + 1]);
      }
    }
    this.transformations[field_name] = function (tile) {
      const { key } = tile;
      const length = tile.record_batch.numRows;
      const array = records[key];
      return bind_column(tile.record_batch, field_name, array);
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
      return bind_column(tile.record_batch, field_name, array);
    };
  }

  /**
   *
   * @param ids A list of ids to get, keyed to the value to set them to.
   * @param field_name The name of the new field to create
   * @param key_field
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
    this.transformations[field_name] = function (tile) {
      return supplement_identifiers(
        tile.record_batch,
        ids,
        field_name,
        key_field
      );
    };
  }

  /**
   *
   * @param ix The index of the point to get.
   * @returns
   */
  findPoint(ix: number): StructRowProxy[] {
    const matches: StructRowProxy[] = [];
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
        [...tile.record_batch.getChild('ix').data[0].values],
        ix
      );
      const val = tile.record_batch.get(mid);
      if (val.ix === ix) {
        matches.push(val);
      }
    });
    return matches;
  }
}

export class ArrowDataset extends Dataset<ArrowTile> {
  public promise: Promise<void> = Promise.resolve();
  public root_tile: ArrowTile;

  constructor(table: Table, prefs: APICall, plot: Scatterplot) {
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

  constructor(base_url: string, prefs: APICall, plot: Scatterplot) {
    super(plot);
    this.root_tile = new QuadTile(base_url, '0/0/0', null, this, prefs);
    this.promise = this.root_tile.promise;
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

export function bind_column(
  batch: RecordBatch,
  field_name: string,
  data: Float32Array
): RecordBatch {
  if (data === undefined) {
    throw new Error('Must pass data to bind_column');
  }
  const current_keys: Set<string> = new Set(
    [...batch.schema.fields].map((d) => d.name)
  );
  if (current_keys.has(field_name)) {
    throw new Error(`Field ${field_name} already exists in batch`);
  }
  const tb: Record<string, Data> = {};
  for (const key of current_keys) {
    tb[key] = batch.getChild(key).data[0];
  }
  tb[field_name] = vectorFromArray(data).data[0];
  const new_batch = new RecordBatch(tb);
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
): RecordBatch {
  /* Add the identifiers from the batch to the ids array */

  // A quick lookup before performing a costly string decode.
  const hashtab = new Set();
  for (const item of Object.keys(ids)) {
    const code = [0, 1, 2, 3].map((i) => item.charCodeAt(i) || '').join('');
    hashtab.add(code);
  }
  const updatedFloatArray = new Float32Array(batch.numRows);
  const kfield = batch.getChild(key_field);
  if (kfield === null) {
    throw new Error(`Field ${key_field} not found in batch`);
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
  return bind_column(batch, field_name, updatedFloatArray);
}
