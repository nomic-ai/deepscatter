import { extent } from 'd3-array';

import {
  Table,
  Vector,
  tableFromIPC,
  RecordBatch,
  StructRowProxy,
} from 'apache-arrow';
import { add_or_delete_column } from './Dataset';
import type { Dataset } from './Dataset';
type MinMax = [number, number];

export type Rectangle = {
  x: MinMax;
  y: MinMax;
};

interface schema_entry {
  name: string;
  type: string;
  extent: Array<any>;
  keys?: Array<any>;
}

import type { TileBufferManager } from './regl_rendering';
// Keep a global index of tile numbers. These are used to identify points.
let tile_identifier = 0;

/**
 * A Tile is, essentially, code to create an Arrow RecordBatch
 * and to associate metadata with it, in the context of a larger dataset.
 *
 */
export class Tile {
  public max_ix = -1;
  readonly key: string; // A unique identifier for this tile.
  promise: Promise<void>;
  download_state: string;
  public _batch?: RecordBatch;
  parent: this | null;
  public _children: Array<Tile> = [];
  public _highest_known_ix?: number;
  public _min_ix?: number;
  public _max_ix?: number;
  public dataset: Dataset;
  public _download?: Promise<void>;
  public ready: boolean;
  __schema?: schema_entry[];
  public _extent?: Rectangle;
  public numeric_id: number;
  // bindings to regl buffers holdings shadows of the RecordBatch.
  public _buffer_manager?: TileBufferManager;
  url: string;
  codes: number[];
  _already_called = false;
  public child_locations: string[] = [];

  constructor(
    key: string,
    parent: Tile | null,
    dataset: Dataset,
    base_url: string
  ) {
    this.key = key;
    this.promise = Promise.resolve();
    this.download_state = 'Unattempted';
    this.parent = null;
    this.dataset = dataset;
    this.ready = false;
    if (dataset === undefined) {
      throw new Error('No dataset provided');
    }
    // Grab the next identifier off the queue. This should be async safe with the current setup, but
    // the logic might fall apart in truly parallel situations.
    this.numeric_id = tile_identifier++;
    this.url = base_url;
  }

  delete_column_if_exists(colname: string) {
    if (this._batch) {
      this._buffer_manager?.release(colname);
      this._batch = add_or_delete_column(this.record_batch, colname, null);
    }
  }

  async get_column(colname: string): Promise<Vector> {
    if (this._batch === undefined) {
      await this.promise;
    }
    const existing = this.record_batch.getChild(colname);
    if (existing) {
      return existing;
    }
    if (this.dataset.transformations[colname]) {
      await this.apply_transformation(colname);
      return this.record_batch.getChild(colname);
    }
    throw new Error(`Column ${colname} not found`);
  }

  private transformation_holder: Record<string, Promise<void>> = {};

  async apply_transformation(name: string): Promise<void> {
    if (this.transformation_holder[name] !== undefined) {
      return this.transformation_holder[name];
    }
    const transform = this.dataset.transformations[name];
    if (transform === undefined) {
      throw new Error(`Transformation ${name} is not defined`);
    }

    this.transformation_holder[name] = Promise.resolve(transform(this)).then(
      (transformed) => {
        if (transformed === undefined) {
          throw new Error(`Transformation ${name} failed by returning empty data`);
        }
        this._batch = add_or_delete_column(
          this.record_batch,
          name,
          transformed
        );
      }
    );
    return this.transformation_holder[name];
  }

  add_column(name: string, data: Float32Array) {
    this._batch = add_or_delete_column(this.record_batch, name, data);
    return this._batch;
  }

  is_visible(max_ix: number, viewport_limits: Rectangle | undefined): boolean {
    // viewport_limits is in coordinate points.
    // Will typically be got by calling current_corners.

    // Top tile is always visible (even if offscreen).
    // if (!this.parent) {return true}
    if (this.min_ix === undefined) {
      return false;
    }

    if (this.min_ix > max_ix) {
      return false;
    }
    if (viewport_limits === undefined) {
      return true;
    }

    const c = this.extent;
    return !(
      c.x[0] > viewport_limits.x[1] ||
      c.x[1] < viewport_limits.x[0] ||
      c.y[0] > viewport_limits.y[1] ||
      c.y[1] < viewport_limits.y[0]
    );
  }

  *points(
    bounding: Rectangle | undefined,
    sorted = false
  ): Iterable<StructRowProxy> {
    //if (!this.is_visible(1e100, bounding)) {
    //  return;
    //}
    for (const p of this) {
      if (p_in_rect([p.x as number, p.y as number], bounding)) {
        yield p;
      }
    }
    if (sorted === false) {
      for (const child of this.children) {
        if (!child.ready) {
          continue;
        }
        if (bounding && !child.is_visible(1e100, bounding)) {
          continue;
        }
        for (const p of child.points(bounding, sorted)) {
          if (p_in_rect([p.x as number, p.y as number], bounding)) {
            yield p;
          }
        }
      }
    } else {
      throw new Error('Sorted iteration not supported');
      /*
      let children = this.children.map((tile) => {
        const f = {
          t: tile,
          iterator: tile.points(bounding, sorted),
          next: undefined,
        };
        f.next = f.iterator.next();
        return f;
      });
      children = children.filter((d) => d?.next?.value);
      while (children.length > 0) {
        let mindex = 0;
        for (let i = 1; i < children.length; i++) {
          if (children[i].next.value.ix < children[mindex].next.value.ix) {
            mindex = i;
          }
        }
        yield children[mindex].next.value;
        children[mindex].next = children[mindex].iterator.next();
        if (children[mindex].next.done) {
          children = children.splice(mindex, 1);
        }
      }
    */
    }
  }

  forEach(callback: (p: StructRowProxy) => void) {
    for (const p of this.points(undefined, false)) {
      if (p === undefined) {
        continue;
      }
      callback(p);
    }
  }

  set highest_known_ix(val) {
    // Do nothing if it isn't actually higher.
    if (this._highest_known_ix == undefined || this._highest_known_ix < val) {
      this._highest_known_ix = val;
      if (this.parent) {
        // bubble value to parent.
        this.parent.highest_known_ix = val;
      }
    }
  }

  get highest_known_ix(): number {
    return this._highest_known_ix || -1;
  }

  get record_batch() {
    if (this._batch) {
      return this._batch;
    }
    // Constitute table if there's a present buffer.
    throw new Error('Attempted to access table on tile without table buffer.');
  }

  get min_ix() {
    if (this._min_ix !== undefined) {
      return this._min_ix;
    }
    if (this.parent) {
      return this.parent.max_ix + 1;
    }
    return 0;
  }

  async schema() {
    await this.download();
    await this.promise;
    return this._schema;
  }

  /**
   *
   * @param callback A function (possibly async) to execute before this cell is ready.
   * @returns A promise that includes the callback and all previous promises.
   */
  extend_promise(callback: () => Promise<void>) {
    this.promise = this.promise.then(() => callback());
    return this.promise;
  }

  protected get _schema() {
    // Infer datatypes from the first file.
    if (this.__schema) {
      return this.__schema;
    }
    const attributes: schema_entry[] = [];
    for (const field of this.record_batch.schema.fields) {
      const { name, type } = field;
      if (type?.typeId == 5) {
        // character
        attributes.push({
          name,
          type: 'string',
          extent: [],
        });
      }
      if (type && type.dictionary) {
        attributes.push({
          name,
          type: 'dictionary',
          keys: this.record_batch.getChild(name).data[0].dictionary.toArray(),
          extent: [
            0,
            this.record_batch.getChild(name).data[0].dictionary.length,
          ],
        });
      }
      if (type && type.typeId == 8) {
        attributes.push({
          name,
          type: 'date',
          extent: extent(this.record_batch.getChild(name).data[0].values),
        });
      }
      if (type?.typeId === 10) {
        // MUST HANDLE RESOLUTIONS HERE.
        return [10, 100];
        attributes.push({
          name,
          type: 'datetime',
          extent: this.dataset.domain(name),
        });
      }
      if (type && type.typeId == 3) {
        attributes.push({
          name,
          type: 'float',
          extent: extent(this.record_batch.getChild(name).data[0].values),
        });
      }
    }
    this.__schema = attributes;
    return attributes;
  }

  *yielder() {
    for (const row of this.record_batch) {
      if (row) {
        yield row;
      }
    }
  }

  get extent(): Rectangle {
    if (this._extent) {
      return this._extent;
    }
    return this.theoretical_extent;
  }
  [Symbol.iterator](): IterableIterator<StructRowProxy> {
    return this.yielder();
  }

  get root_extent(): Rectangle {
    if (this.parent === null) {
      // infinite extent
      return {
        x: [Number.MIN_VALUE, Number.MAX_VALUE],
        y: [Number.MIN_VALUE, Number.MAX_VALUE],
      };
    }
    return this.parent.root_extent;
  }

  async download_to_depth(max_ix: number): Promise<void> {
    /**
     * Recursive fetch all tiles up to a certain depth. Triggers many unnecessary calls: prefer
     * download instead if possible.
     */
    await this.download();
    let promises: Array<Promise<void>> = [];
    if (this.max_ix < max_ix) {
      promises = this.children.map((child) => child.download_to_depth(max_ix));
    }
    await Promise.all(promises);
  }

  async get_arrow(
    suffix: string | undefined = undefined
  ): Promise<RecordBatch> {    
    // By default fetches .../0/0/0.feather
    // But if you pass a suffix, gets
    // 0/0/0.suffix.feather
    let url = `${this.url}/${this.key}.feather`;
    if (suffix) {
      // 3/4/3
      // suffix: 'text'
      // 3/4/3.text.feather
      url = url.replace('.feather', `.${suffix}.feather`);
    }
    let tb: Table;
    let buffer: ArrayBuffer;

    if (this.dataset.tileProxy !== undefined) {
      const endpoint = new URL(url).pathname;
      // This method apiCall is crafted to match the
      // ts-nomic package.
      const bytes = await this.dataset.tileProxy.apiCall(
        endpoint,
        'GET',
        null,
        null,
        { octetStreamAsUint8: true }
      );
      tb = tableFromIPC(bytes);
    } else {
      //TODO: Remove outdated atlas-specific code.
      let headers = {};
      if (window.localStorage.getItem('isLoggedIn') === 'true') {
        url = url.replace('/public', '');
        const accessToken = localStorage.getItem('access_token');
        headers = {
          Authorization: `Bearer ${accessToken}`,
        };
      }
      const request: RequestInit = {
        method: 'GET',
        ...headers,
      };
      const response = await fetch(url, request);
      buffer = await response.arrayBuffer();
      tb = tableFromIPC(buffer);
    }
    if (tb.batches.length > 1) {
      console.warn(
        `More than one record batch at ${url}; all but first batch will be ignored.`
      );
    }
    const batch = tb.batches[0];
    if (suffix === undefined) {
      this.download_state = 'Complete';
      this._batch = tb.batches[0];
    }
    return batch;
  }

  async download(): Promise<void> {
    // This should only be called once per tile.
    if (this._download !== undefined) {
      return this._download;
    }

    if (this._already_called) {
      throw 'Illegally attempting to download twice';
    }

    this._already_called = true;
    this.download_state = 'In progress';
    return (this._download = this.get_arrow()
      .then((batch) => {
        this.ready = true;
        const metadata = batch.schema.metadata;
        const extent = metadata.get('extent');
        if (extent) {
          this._extent = JSON.parse(extent) as Rectangle;
        }

        const children = metadata.get('children');

        if (children) {
          this.child_locations = JSON.parse(children) as string[];
        }
        const ixes = batch.getChild('ix');

        if (ixes === null) {
          throw 'No ix column in table';
        }
        this._min_ix = Number(ixes.get(0));
        this.max_ix = Number(ixes.get(ixes.length - 1));
        if (this._min_ix > this.max_ix) {
          this.max_ix = this._min_ix + 1e5;
          this._min_ix = 0;
        }
        this.highest_known_ix = this.max_ix;
      })
      .catch((error) => {
        this.download_state = 'Failed';
        console.error(`Error: Remote Tile at ${this.url}/${this.key}.feather not found.
        `);
        throw error;
      }));
  }

  /**
   * Sometimes it's useful to do operations on batches of tiles. This function
   * defines a grouping of tiles in the same general region to be operated on.
   * In general they will have about 80 elements (16 + 64), but the top level
   * has just 5. (4 + 1). Note a macro tile with the name [2/0/0] does not actually include
   * the tile [2/0/0] itself, but rather the tiles [4/0/0], [4/1/0], [4/0/1], [4/1/1], [5/0/0] etc.
   */
  get macrotile(): string {
    return macrotile(this.key);
  }

  get macro_siblings(): Array<string> {
    return macrotile_siblings(this.key);
  }

  get children(): Array<Tile> {
    // create or return children.

    if (this.download_state !== 'Complete') {
      return [];
    }

    if (this._children.length < this.child_locations.length) {
      for (const key of this.child_locations) {
        const child = new Tile(key, this, this.dataset, this.url);
        this._children.push(child);
      }
    }
    return this._children;
  }

  get theoretical_extent(): Rectangle {

    // QUADTREE SPECIFIC CODE.

    if (this.dataset.tileStucture === 'other') {
      // Only three-length-keys are treated as quadtrees.
      return this.dataset.extent;
    }
    const base = this.dataset.extent;
    const [z, x, y] = this.codes;

    const x_step = base.x[1] - base.x[0];
    const each_x = x_step / 2 ** z;

    const y_step = base.y[1] - base.y[0];
    const each_y = y_step / 2 ** z;

    return {
      x: [base.x[0] + x * each_x, base.x[0] + (x + 1) * each_x],
      y: [base.y[0] + y * each_y, base.y[0] + (y + 1) * each_y],
    };
  }
}

type Point = [number, number];

export function p_in_rect(p: Point, rect: Rectangle | undefined) {
  if (rect === undefined) {
    return true;
  }
  return (
    p[0] < rect.x[1] && p[0] > rect.x[0] && p[1] < rect.y[1] && p[1] > rect.y[0]
  );
}
function macrotile(key: string, size = 2, parents = 2) {
  let [z, x, y] = key.split('/').map((d) => parseInt(d));
  let moves = 0;
  while (!(moves >= parents && z % size == 0)) {
    x = Math.floor(x / 2);
    y = Math.floor(y / 2);
    z = z - 1;
    moves++;
  }
  return `${z}/${x}/${y}`;
}

function macrotile_siblings(key: string, size = 2, parents = 2): Array<string> {
  return macrotile_descendants(macrotile(key, size, parents), size, parents);
}

const descendant_cache = new Map<string, string[]>();
function macrotile_descendants(
  macrokey: string,
  size = 2,
  parents = 2
): Array<string> {
  if (descendant_cache.has(macrokey)) {
    return descendant_cache.get(macrokey);
  }
  const parent_tiles = [[macrokey]];
  while (parent_tiles.length < parents) {
    parent_tiles.unshift(parent_tiles[0].map(children).flat());
  }
  const sibling_tiles = [parent_tiles[0].map(children).flat()];
  while (sibling_tiles.length < size) {
    sibling_tiles.unshift(sibling_tiles[0].map(children).flat());
  }
  sibling_tiles.reverse();
  const descendants = sibling_tiles.flat();
  descendant_cache.set(macrokey, descendants);
  return descendants;
}

function children(tile: string) {
  const [z, x, y] = tile.split('/').map((d) => parseInt(d)) as [
    number,
    number,
    number
  ];
  const children = [];
  for (let i = 0; i < 4; i++) {
    children.push(`${z + 1}/${x * 2 + (i % 2)}/${y * 2 + Math.floor(i / 2)}`);
  }
  return children as string[];
}

// Deprecated, for backwards compatibility.
export const QuadTile = Tile;
