// A Dataset manages the production and manipulation of *tiles*.
import { Tile, Rectangle, p_in_rect } from './tile';
import { min, max, bisectLeft, extent } from 'd3-array';
import type * as DS from './shared';
import {
  RecordBatch,
  StructRowProxy,
  Table,
  Data,
  Schema,
  tableFromIPC,
  Vector,
  makeVector,
  Float32,
  Int64,
  Field,
  List,
  Int,
  Utf8,
  Uint64,
  Type,
  Uint8,
  Dictionary,
  Int16,
  Int32,
  Int8,
  tableToIPC,
} from 'apache-arrow';
import { Scatterplot } from './scatterplot';
import { wrapArrowTable } from './wrap_arrow';

type Key = string;

type ArrowBuildable = DS.ArrowBuildable;
type Transformation = DS.Transformation;

// Some variables are universally available.
const defaultTransformations: Record<string, Transformation> = {
  ix: async function (tile) {
    // console.warn(`Getting ix ${tile.key}`);
    const batch = await tile.get_arrow(null);
    return batch.getChild('ix') as Vector<Int64 | Int32>;
  },
  x: async function (tile) {
    // console.warn(`Getting x ${tile.key}`);
    const batch = await tile.get_arrow(null);
    return batch.getChild('x') as Vector<Float32>;
  },
  y: async function (tile) {
    // console.warn(`Getting y ${tile.key}`);
    const batch = await tile.get_arrow(null);
    return batch.getChild('y') as Vector<Float32>;
  },
};

/**
 * A Dataset manages the production and manipulation of tiles. Each plot has a
 * single dataset; the dataset handles all transformations around data through
 * batchwise operations.
 */
export class Dataset {
  public transformations: Record<string, Transformation> =
    defaultTransformations;
  protected plot: Scatterplot;
  private extents: Record<string, [number, number] | [Date, Date]> = {};
  // A 3d identifier for the tile. Usually [z, x, y]
  private _extent?: Rectangle;
  public _ix_seed = 0;
  public _schema?: Schema;
  public tileProxy?: DS.TileProxy;
  protected _download_queue: Set<Key> = new Set();
  public promise: Promise<void>;
  public root_tile: Tile;
  public manifest?: DS.TileManifest;

  // Whether the tileset is structured as a pure quadtree.

  public readonly tileStucture: DS.TileStructure = 'quadtree';
  /**
   * @param plot The plot to which this dataset belongs.
   **/

  constructor(
    base_url: string,
    plot: Scatterplot,
    options: DS.DatasetOptions = {},
  ) {
    this.plot = plot;
    this.tileProxy = options.tileProxy;

    const rootKey = options['rootKey'] || '0/0/0';
    if (options.tileStructure) {
      this.tileStucture = options.tileStructure;
    }

    if (options.extent) {
      this._extent = options.extent;
    }

    // If no manifest is passed, we still know
    // that there is a root tile at the root key.

    const defaultManifest: Partial<DS.TileManifest> = {
      key: rootKey,
      children: undefined,
      min_ix: 0,
      max_ix: Number.MAX_SAFE_INTEGER,
      ...(options.tileManifest || {}),
    };
    // Must come after manifest is set.
    this.root_tile = new Tile(defaultManifest, null, this, base_url);
    const preProcessRootTile = this.root_tile.preprocessRootTileInfo();

    this.promise = preProcessRootTile.then(async () => {
      const batch = await this.root_tile.get_arrow(null);
      const schema = batch.schema;
      console.log('HERE');
      await this.root_tile.loadManifestInfoFromTileMetadata();
      console.log(this.root_tile.max_ix);
      console.log('BHERE');

      console.log(this.extent);
      if (schema.metadata.has('sidecars')) {
        const cars = schema.metadata.get('sidecars');
        const parsed = JSON.parse(cars as string) as Record<string, string>;
        for (const [k, v] of Object.entries(parsed)) {
          this.transformations[k] = async function (tile) {
            const batch = await tile.get_arrow(v);
            const column = batch.getChild(k);
            if (column === null) {
              throw new Error(
                `No column named ${k} in sidecar tile ${batch.schema.fields
                  .map((f) => f.name)
                  .join(', ')}`,
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
    return this.promise;
  }

  get extent(): Rectangle {
    if (this._extent) {
      return this._extent;
    }
    if (this.tileStucture === 'other') {
      return (this._extent = {
        x: this.domain('x') as [number, number],
        y: this.domain('y') as [number, number],
      });
    }
    if (!this.root_tile.hasLoadedColumn('x')) {
      throw new Error("Can't access extent without a root tile");
    }
    return this.root_tile.extent;
  }

  /**
   * Ensures that all the tiles in a dataset are downloaded that include
   * datapoints of index less than or equal to max_ix.
   * @param max_ix the depth to download to.
   */
  async download_to_depth(max_ix: number, suffix: string | null = null) {
    await this.root_tile.download_to_depth(max_ix, suffix);
  }

  /**
   * The highest known point that deepscatter has seen so far. This is used
   * to adjust opacity size.
   */
  get highest_known_ix(): number {
    return this.root_tile.highest_known_ix;
  }

  /**
   * This allows creation of a new column in your chart.
   *
   * A few thngs to be aware of: the point function may be run millions of times.
   * For best performance, you should not wrap complicated
   * logic in this: instead, generate any data structures outside the function.
   *
   * name: the name to identify the new column in the data.
   * pointFunction: a function that runs on a single row of data. It accepts a single
   * argument, the data point to be transformed: technically this is a StructRowProxy
   * on the underlying Arrow frame, but for most purposes you can treat it as a dict.
   * The point is read-only--you cannot change attributes.
   *
   * For example: suppose you have a ['lat', 'long'] column in your data and want to create a
   * new set of geo coordinates for your data. You can run the following.
   * {
   * const scale = d3.geoMollweide().extent([-20, -20, 20, 20])
   * scatterplot.register_transformation('mollweide_x', datum => {
   *  return scale([datum.long, datum.lat])[0]
   * })
   * scatterplot.register_transformation('mollweide_y', datum => {
   *  return scale([datum.long, datum.lat])[1]
   * })
   * }
   *
   * Note some constraints: the scale is created *outside* the functions, to avoid the
   * overhead of instantiating it every time; and the x and y coordinates are created separately
   * with separate function calls, because it's not possible to assign to both x and y simultaneously.
   */

  register_transformation(
    name: string,
    pointFunction: DS.PointFunction,
    prerequisites: string[] = [],
  ) {
    const transform: Transformation = async (tile: Tile) => {
      //
      await Promise.all(prerequisites.map((key) => tile.get_column(key)));
      const returnVal = new Float32Array(tile.record_batch.numRows);
      let i = 0;
      for (const row of tile.record_batch) {
        returnVal[i] = pointFunction(row);
        i++;
      }
      return returnVal;
    };

    this.transformations[name] = transform;
  }

  /**
   * Attempts to build an Arrow table from all record batches.
   * If some batches have different transformations applied,
   * this will error
   *
   **/
  get table(): Table {
    return new Table(
      this.map((d) => d)
        .filter((d) => d.record_batch)
        .map((d) => d.record_batch),
    );
  }

  static from_quadfeather(url: string, plot: Scatterplot): Dataset {
    const options: Partial<DS.DatasetOptions> = {};
    if (plot.tileProxy) {
      options['tileProxy'] = plot.tileProxy;
    }
    return new Dataset(url, plot, options);
  }

  /**
   * Generate an ArrowDataset from a single Arrow table.
   *
   * @param table A single Arrow table
   * @param prefs The API Call to use for rendering.
   * @param plot The Scatterplot to use.
   * @returns
   */
  static from_arrow_table(table: Table, plot: Scatterplot): Dataset {
    return wrapArrowTable(tableToIPC(table), plot);
  }

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

  /**
   * Returns the minimum and maximum values for a named column.
   * This attempts to use table metadata; if that is not present,
   * it will at the first attempt calculate the min and max values.
   *
   * The generic T tracks whether this reads strings from JSON and return dates,
   * or reads numbers from JSON and returns numbers
   *
   * @param columnName A column in the dataset.
   * @returns A pair of numbers. Dates and bigints will be
   * converted to numbers.
   */

  domain<T extends [number, number] | [string, Date] = [number, number]>(
    columnName: string,
  ): [T[1], T[1]] {
    if (this.extents[columnName]) {
      return this.extents[columnName];
    }
    const dim = this._schema?.fields.find(
      (d) => d.name === columnName,
    ) as Field<DS.SupportedArrowTypes>;
    if (dim !== undefined) {
      let min: T[0] | undefined = undefined;
      let max: T[0] | undefined = undefined;
      const extent1 = dim.metadata.get('extent');
      if (extent1) {
        [min, max] = JSON.parse(extent1) as [T[0], T[0]];
      }
      const mmin = dim.metadata.get('min');
      if (mmin) {
        min = JSON.parse(mmin) as T[0];
      }
      const mmax = dim.metadata.get('max');
      if (mmax) {
        max = JSON.parse(mmax) as T[0];
      }
      // Can pass min, max as strings for dates.
      if (dim.type.typeId === Type.Timestamp) {
        if (typeof min !== 'string' || typeof max !== 'string') {
          throw new Error(
            'Date field extents in metadata must be passed as strings',
          );
        }
        return (this.extents[columnName] = [new Date(min), new Date(max)]);
      }
      if (typeof max === 'string') {
        throw new Error('Failed to parse min-max as numbers');
      }
      if (min !== undefined) {
        return (this.extents[columnName] = [min as T[1], max as T[1]] as
          | [number, number]
          | [Date, Date]);
      }
    }
    return (this.extents[columnName] = extent([
      ...new Vector(
        this.map((d) => d)
          .filter((d) => d.hasLoadedColumn(columnName))
          .map((d) => d.record_batch.getChild(columnName))
          .filter((d) => d !== null),
      ),
    ]));
  }

  *points(bbox: Rectangle | undefined, max_ix = 1e99) {
    const stack: Tile[] = [this.root_tile];
    let current: Tile;
    while ((current = stack.shift())) {
      if (
        current.hasLoadedColumn('ix') &&
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
        stack.push(...current.loadedChildren);
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

  map<U>(callback: (tile: Tile) => U, after = false): U[] {
    const results: U[] = [];
    this.visit((d: Tile) => {
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
    callback: (tile: Tile) => void,
    after = false,
    filter: (t: Tile) => boolean = () => true,
  ) {
    // Visit all children with a callback function.

    const stack: Tile[] = [this.root_tile];
    const after_stack = [];
    let current: Tile | undefined;
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
      stack.push(...current.loadedChildren);
    }
    if (after) {
      while ((current = after_stack.pop() as Tile)) {
        callback(current);
      }
    }
  }

  /**
   * Invoke a function on all tiles in the dataset, downloading those that aren't 
   * here yet..
   * The general architecture here is taken from the
   * d3 quadtree functions. That's why, for example, it doesn't
   * recurse.

   * @param callback The function to invoke on each tile.
   * @param after Whether to execute the visit in bottom-up order. Default false.
   * @param filter 
   */

  async visit_full(
    callback: (tile: Tile) => Promise<void>,
    after = false,
    starting_tile: Tile | null = null,
    filter: (t: Tile) => boolean = () => true,
    updateFunction: (tile: Tile, completed, total) => Promise<void>,
  ) {
    // Visit all children with a callback function.
    // In general recursing quadtrees isn't that fast, but
    // we rarely have more than ten tiles deep and the
    // code is much cleaner this way than an async queue.

    let seen = 0;
    const start = starting_tile || this.root_tile;
    await start.loadManifestInfoFromTileMetadata();
    const total_points = JSON.parse(
      start.record_batch.schema.metadata.get('total_points'),
    ) as number;

    async function resolve(tile: Tile) {
      await tile.loadManifestInfoFromTileMetadata();
      if (!filter(tile)) {
        return;
      }
      if (after) {
        await Promise.all(tile.loadedChildren.map(resolve));
        await callback(tile);
        seen += tile.record_batch.numRows;
        void updateFunction(tile, seen, total_points);
      } else {
        await callback(tile);
        seen += tile.record_batch.numRows;
        void updateFunction(tile, seen, total_points);
        await Promise.all(tile.loadedChildren.map(resolve));
      }
    }
    await resolve(start);
  }

  async schema() {
    throw new Error('Schema access is deprecated');
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
      const data = batch.getChild('data').data[0];
      if (data === null) {
        throw new Error('tiled columns must contain "data" field.');
      }
      const offsets = data.valueOffsets as Int32Array;
      const values = data.children[0] as Data<List<Float32>>;
      for (let i = 0; i < batch.data.length; i++) {
        const tilename = batch.getChild('_tile').get(i) as string;
        records[tilename] = values.values.slice(
          offsets[i],
          offsets[i + 1],
          // Type coercion necessary because Float[]
          // and the backing Float32Array are not recognized as equivalent.
        ) as unknown as Float32Array;
      }
    }
    this.transformations[field_name] = function (tile) {
      const { key } = tile;
      const array = records[key];
      return array;
    };
  }

  add_sparse_identifiers(field_name: string, ids: DS.PointUpdate) {
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
    key_field = '_id',
  ) {
    if (this.transformations[field_name]) {
      throw new Error(
        `Can't overwrite existing transformation for ${field_name}`,
      );
    }
    this.transformations[field_name] = function (tile: Tile) {
      return supplement_identifiers(
        tile.record_batch,
        ids,
        field_name,
        key_field,
      );
    };
  }

  /**
   * Given an ix, apply a transformation to the point at that index and
   * return the transformed point (not just the transformation, the whole point)
   * As a side-effect, this applies the transformaation to all other
   * points in the same tile.
   *
   * @param transformation The name of the transformation to apply
   * @param ix The index of the point to transform
   */

  async applyTransformationToPoint(transformation: string, ix: number) {
    const matches = this.findPointRaw(ix);

    if (matches.length == 0) {
      throw new Error(`No point for ix ${ix}`);
    }
    const [tile, row, mid] = matches[0];
    // Check if the column exists; if so, return the row.
    if (tile.record_batch.getChild(transformation) !== null) {
      return row;
    }
    await tile.apply_transformation(transformation);
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
  findPointRaw(ix: number): [Tile, StructRowProxy, number][] {
    console.log({ ix });
    const matches: [Tile, StructRowProxy, number][] = [];
    this.visit((tile: Tile) => {
      if (!(tile.record_batch && tile.min_ix <= ix && tile.max_ix >= ix)) {
        return;
      }
      const ixcol = tile.record_batch.getChild('ix') as Vector<Int>;
      const mid = bisectLeft(ixcol.toArray() as ArrayLike<number>, ix);
      const val = tile.record_batch.get(mid);
      if (val !== null && val.ix === ix) {
        matches.push([tile, val, mid]);
      }
    });
    return matches;
  }

  download_most_needed_tiles(
    bbox: Rectangle | undefined,
    max_ix: number,
    queue_length = 8,
  ) {
    /*
      Browsing can spawn a  *lot* of download requests that persist on
      unneeded parts of the dataset. So the dataset handles its own queue for dispatching
      downloads in case tiles have slipped from view while parents were requested.
    */

    const queue = this._download_queue;

    if (queue.size >= queue_length) {
      return;
    }

    const scores: [number, Tile][] = [];

    function callback(tile: Tile) {
      if (!tile.hasLoadedColumn('x')) {
        if (bbox === undefined) {
          // Just depth.
          scores.push([1 / tile.min_ix, tile]);
        } else {
          const distance = check_overlap(tile, bbox);
          scores.push([distance, tile]);
        }
      }
    }

    this.visit(callback);
    scores.sort((a, b) => a[0] - b[0]);

    while (scores.length > 0 && queue.size < queue_length) {
      const upnext = scores.pop();
      if (upnext === undefined) {
        throw new Error('Ran out of tiles unexpectedly');
      }
      const [distance, tile] = upnext;
      if ((tile.min_ix && tile.min_ix > max_ix) || distance <= 0) {
        continue;
      }
      queue.add(tile.key);
      tile
        .loadManifestInfoFromTileMetadata()
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
    transformation: (ids: string[]) => Promise<Uint8Array>,
  ): void {
    const macrotile_tasks: Record<string, Promise<void>> = {};
    const records: Record<string, ArrowBuildable> = {};

    async function get_table(tile: Tile) {
      const { macrotile } = tile;
      if (macrotile_tasks[macrotile] !== undefined) {
        return await macrotile_tasks[macrotile];
      } else {
        macrotile_tasks[macrotile] = transformation(tile.macro_siblings).then(
          (buffer) => {
            const tb = tableFromIPC(buffer);
            for (const batch of tb.batches) {
              const data = batch.getChild('data') as Vector<
                List<DS.SupportedArrowTypes>
              >;
              for (let i = 0; i < batch.data.length; i++) {
                const tilename = batch.getChild('_tile').get(i) as string;
                records[tilename] = data.get(i);
              }
            }
            return;
          },
        );
        return macrotile_tasks[macrotile];
      }
    }

    this.transformations[field_name] = async function (tile) {
      await get_table(tile);
      const array = records[tile.key];
      if (array instanceof Uint8Array) {
        const v = new Float32Array(array.length);
        for (let i = 0; i < tile.record_batch.numRows; i++) {
          // pop out the bitmask one at a time.
          const byte = array[i];
          for (let j = 0; j < 8; j++) {
            const bit = (byte >> j) & 1;
            v[i * 8 + j] = bit;
          }
        }
        return v;
      } else {
        return array;
      }
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
  batch: RecordBatch | undefined,
  field_name: string,
  data: ArrowBuildable | null,
): RecordBatch {
  const tb: Record<string, Data> = {};

  for (const field of batch?.schema.fields || []) {
    if (field.name === field_name) {
      if (data === null) {
        // Then it's dropped.
        continue;
      } else {
        console.warn(`Name ${field.name} already exists, can't add.`);
        return batch as RecordBatch;
      }
    }
    const current = batch.getChild(field.name);
    const coldata = current.data[0] as Data;
    tb[field.name] = coldata;
  }
  if (data === undefined) {
    throw new Error('Must pass data to bind_column');
  }
  if (data !== null) {
    if (data instanceof Float32Array) {
      tb[field_name] = makeVector({
        type: new Float32(),
        data,
        length: data.length,
      }).data[0];
    } else if (data instanceof BigInt64Array) {
      tb[field_name] = makeVector({
        type: new Int64(),
        data,
        length: data.length,
      }).data[0];
    } else if (data instanceof Uint8Array) {
      tb[field_name] = makeVector({
        type: new Uint8(),
        data,
        length: data.length,
      }).data[0];
    } else if ((data as Vector<DS.SupportedArrowTypes>).data.length > 0) {
      let newval = data.data[0];
      if (newval.dictionary) {
        const dicto = newval as Data<Dictionary<Utf8, Int8 | Int16 | Int32>>;
        const existingKeys = batch?.schema.dictionaries.keys() || [];
        const dictionary_id = max([0, ...existingKeys]) + 1;
        const newv = makeVector({
          data: dicto.values, // indexes into the dictionary
          dictionary: dicto.dictionary as Vector<Utf8>, // keys
          type: new Dictionary(
            dicto.type.dictionary,
            dicto.type.indices,
            dictionary_id,
          ), // increment the identifier.
        });
        newval = newv.data[0];
      }
      tb[field_name] = newval;
    } else {
      console.warn(
        `Unknown data format object passed to add or remove columns--treating as Data, but this behavior is deprecated`,
        data,
      );
      // Stopgap--maybe somewhere there are
      tb[field_name] = data as unknown as Data;
    }
  }

  const new_batch = new RecordBatch(tb);
  for (const [k, v] of batch?.schema.metadata || []) {
    new_batch.schema.metadata.set(k, v);
  }
  for (const oldfield of batch?.schema.fields || []) {
    const newfield = new_batch.schema.fields.find(
      (d) => d.name === oldfield.name,
    );
    if (newfield !== undefined) {
      for (const [k, v] of oldfield.metadata) {
        newfield.metadata.set(k, v);
      }
    } else if (data !== null) {
      // OK to be null, that means it should have been deleted.
      throw new Error('Error!');
    }
  }
  // Store the creation time on the table metadata.
  if (data !== null) {
    const this_field = new_batch.schema.fields.find(
      (d) => d.name === field_name,
    );
    this_field?.metadata.set(
      'created by deepscatter',
      new Date().toISOString(),
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
  key_field = '_id',
): ArrowBuildable {
  /* Add the identifiers from the batch to the ids array */
  // A quick lookup before performing a costly string decode.
  const updatedFloatArray = new Float32Array(batch.numRows);

  const kfield = batch.getChild(key_field) as Vector<Utf8 | Int64 | Uint64>;
  if (kfield === null) {
    throw new Error(`Field ${key_field} not found in batch`);
  }

  if (kfield.type.typeId === Type.Int64 || kfield.type.typeId === Type.Uint64) {
    for (let i = 0; i < batch.numRows; i++) {
      // the object coerces bigints to strings. We just live with that.
      const value = ids[String(kfield.get(i))];
      if (value !== undefined) {
        updatedFloatArray[i] = value;
      }
    }
    return updatedFloatArray;
  }
  //
  const hashtab = new Set();

  for (const item of Object.keys(ids)) {
    const code = [0, 1, 2, 3].map((i) => item.charCodeAt(i) || '').join('');
    hashtab.add(code);
  }

  const offsets = (kfield as Vector<Utf8>).data[0].valueOffsets;
  const values = kfield.data[0].values;

  // For every identifier, look if it's in the id array.
  for (let i = 0; i < batch.numRows; i++) {
    const code = values.slice(offsets[i], offsets[i + 1]) as Uint8Array;
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

// class AsyncQueue<T> {
//   private promises: Promise<T>[] = [];

//   constructor(promises: Promise<T>[] = []) {
//     this.promises.concat(promises);
//   }

//   add(promise: Promise<T>): void {
//     // Add a promise onto the queue.
//     this.promises.push(promise);
//   }

//   private removeFromArray(item: Promise<T>): void {
//     const index = this.promises.indexOf(item);
//     if (index > -1) {
//       this.promises.splice(index, 1);
//     }
//   }

//   async apop(): Promise<T> {
//     /**
//      * Pop the first promise to resolve off the queue.
//      */
//     if (this.promises.length === 0) {
//       throw new Error('No promises to race');
//     }

//     return new Promise((resolve, reject) => {
//       this.promises.forEach((promise) => {
//         promise
//           .then((value) => {
//             this.removeFromArray(promise);
//             resolve(value);
//           })
//           .catch((error) => {
//             this.removeFromArray(promise);
//             reject(error);
//           });
//       });
//     });
//   }

//   get length(): number {
//     return this.promises.length;
//   }
// }
