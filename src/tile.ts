import {
  extent, range, min, max, bisectLeft,
} from 'd3-array';

import { tableFromIPC, Table } from 'apache-arrow';
import Counter from './Counter';

import TileWorker from './tileworker.worker.js?worker&inline';
import Zoom from './interaction';
import { APICall } from './types';
import type { Dataset, QuadtileSet } from './Dataset'
import Scatterplot from './deepscatter';
type MinMax = [number, number];

export type Rectangle = {
  x:  MinMax,
  y:  MinMax
}


interface schema_entry{
  name: string,
  type : string, 
  extent: Array<any>,
  keys ? : Array<any>,
}


export abstract class Tile {
  public max_ix : number = -1;
  readonly key : string; // A unique identifier for this tile.
  promise : Promise<void>;
  download_state : string;
  public _table? : Table;
  parent: this | null;
  _table_buffer?: ArrayBuffer;
  public _children : Array<this> = [];
  public _highest_known_ix? : number;
  public _min_ix? : number;
  public _max_ix? : number;
  public dataset : QuadtileSet;
  public _download? : Promise<void>;
  __schema?: schema_entry[];
  local_dictionary_lookups? : Map<string, any>;
  public _extent? : {'x' : MinMax, 'y': MinMax};

  constructor(dataset : QuadtileSet) {
    // Accepts prefs only for the case of the root tile.
    this.promise = Promise.resolve();
    this.download_state = 'Unattempted';
    this.key = '' + Math.random()
    this.parent = null;
    this.dataset = dataset;
    if (dataset === undefined) {
      throw new Error('No dataset provided');
    }
  }

  get children() {
    return this._children;
  }

  get dictionary_lookups() {
    return this.dataset.dictionary_lookups;
  }

  download() {
    throw new Error('Not implemented');
  }

  is_visible(max_ix : number, viewport_limits : Rectangle ) : boolean {
    // viewport_limits is in coordinate points.
    // Will typically be got by calling current_corners.

    // Top tile is always visible (even if offscreen).
    // if (!this.parent) {return true}
    if (this.min_ix === undefined) {
      return false
    }

    if (this.min_ix > max_ix) {
      return false;
    }

    const c = this.extent;
    return (
      !(c.x[0] > viewport_limits.x[1]
        || c.x[1] < viewport_limits.x[0]
        || c.y[0] > viewport_limits.y[1]
        || c.y[1] < viewport_limits.y[0]));
  }

  get tileWorker() : TileWorker {
    const worker = this.dataset.tileWorker;
    return worker
  }


  /*
  *points(bounding : Rectangle | undefined = undefined, sorted = false) : Iterable<StructRowProxy> {
    // Iterate over the rows one at a time.
    if (bounding && !this.is_visible(1e100, bounding)) {
      return;
    }
    for (const p of this) {
      if (p_in_rect([p.x, p.y], bounding)) {
        yield p;
      }
    }
    //    console.log("Exhausted points on ", this.key)
    if (sorted == false) {
      for (const child of this.children) {
        if (!child.ready) {
          continue;
        }
        for (const p of child.points(bounding, sorted)) {
          if (p_in_rect([p.x, p.y], bounding)) {
            yield p;
          }
        }
      }
    } else {
      let children = this.children
        .map((tile) => {
          const f = {
            t: tile,
            iterator: tile.points(bounding, sorted),
            next : undefined
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
    }
  }

  forEach(callback : (p : StructRowProxy) => void) {
    for (const p of this.points()) {
      if (p === undefined) {
        continue;
      }
      callback(p);
    }
  }
  */
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

  get highest_known_ix() : number {
    return this._highest_known_ix || -1;
  }

  get table() {
    if (this._table) { return this._table; }
    // Constitute table if there's a present buffer.
    if (this._table_buffer && this._table_buffer.byteLength > 0) {
      return this._table = tableFromIPC(this._table_buffer);
    }
    throw new Error("Attempted to access table on tile without table buffer.");
  }

  get min_ix() {
    if (this._min_ix !== undefined) {
      return this._min_ix;
    }
    if (this.parent) {
      return this.parent.max_ix + 1;
    }
    return undefined;
  }

  async schema() {
    await this.download()
    return this._schema;
  }

  /**
   * 
   * @param callback A function (possibly async) to execute before this cell is ready. 
   * @returns A promise that includes the callback and all previous promises.
   */
  extend_promise(callback : () => Promise<any>) {
    this.promise = this.promise.then(() => callback());
    return this.promise;
  }

  get ready() : boolean {
    // The flag for readiness is whether there is
    // an arraybuffer at this._table_buffer

    // Unlike 'promise,' this returns asychronously
    return this._table_buffer !== undefined && this._table_buffer.byteLength > 0;
  }

  protected get _schema() {
    // Infer datatypes from the first file.
    if (this.__schema) {
      return this.__schema;
    }
    const attributes : schema_entry[] = [];
    for (const field of this.table.schema.fields) {
      const { name, type } = field;
      console.log({type, id: type.typeId})
      if (type?.typeId == 5) {
        // character
        attributes.push({
          name,
          type: 'string',
          extent: []
        });
      }
      if (type && type.dictionary) {
        attributes.push({
          name,
          type: 'dictionary',
          keys: this.table.getChild(name).data[0].dictionary.toArray(),
          extent: [-2047, this.table.getChild(name).data[0].dictionary.length - 2047],
        });
      }
      if (type && type.typeId == 8) {
        console.log(type)
        attributes.push({
          name,
          type: 'date',
          extent: extent(this.table.getChild(name).data[0].values),
        });
      }
      if (type && type.typeId == 3) {
        console.log({type})
        attributes.push({
          name, type: 'float', extent: extent(this.table.getChild(name).data[0].values),
        });
      }
    }
    this.__schema = attributes;
    return attributes;
  }

  *yielder() {
    for (const row of this.table) {
      if (row) {
        yield row;
      }
    }
  }

  get theoretical_extent() : Rectangle { 
    // QUADTREE SPECIFIC CODE.
    const base = this.dataset.extent;
    const [z, x, y] = this.codes;

    const x_step = base.x[1] - base.x[0];
    const each_x = x_step / (2 ** z);

    const y_step = base.y[1] - base.y[0];
    const each_y = y_step / (2 ** z);
    //    console.log({key: this.key, each_y, pow: 2**z})

    return {
      x: [base.x[0] + x * each_x, base.x[0] + (x + 1) * each_x],
      y: [base.y[0] + y * each_y, base.y[0] + (y + 1) * each_y],
    };
  }

  get extent() : Rectangle {
    if (this._extent) {
      return this._extent;
    }
    return this.theoretical_extent;
  }

  [Symbol.iterator]() {
    return this.yielder();
  }

  get root_extent() : Rectangle {
    if (this.parent === undefined) {
      // infinite extent
      return {
        x: [-Infinity, Infinity],
        y: [-Infinity, Infinity],
      };
    }
    return this.parent.root_extent;
  }
}

export class QuadTile extends Tile {
  url : string;
  key : string;
  public _children : Array<this> = [];
  codes : [number, number, number];
  _already_called = false;
  public child_locations : String[] = [];
  constructor(base_url : string, key : string, parent : null | this, dataset : Dataset) {
    super(dataset);
    this.url = base_url;
    this.parent = parent;
    this.key = key;
    const [z, x, y] = key.split('/').map((d) => parseInt(d));
    this.codes = [z, x, y];
    this.class = new.target;
  }

  download() : Promise<void> {
    // This should only be called once per tile.
    if (this._download) { return this._download }

    if (this._already_called) {
      throw ('Illegally attempting to download twice');
    }

    this._already_called = true;

    // new: must include protocol and hostname.
    const url = `${this.url}/${this.key}.feather`
    this.download_state = 'In progress';

    this._download = this.tileWorker
      .fetch(url, {})
      .then(([buffer, metadata, codes]): Table<any> => {
        this.download_state = 'Complete';

        // metadata is passed separately b/c I dont know
        // how to fix it on the table in javascript, just python.
        this._table_buffer = buffer;
        this._table = tableFromIPC(buffer);
        this._extent = JSON.parse(metadata.get('extent'));
        this.child_locations = JSON.parse(metadata.get('children'));
        const ixes = this.table.getChild('ix')
        if (ixes === null) {
          throw ('No ix column in table');
        }
        this._min_ix = Number(ixes.get(0));
        this.max_ix = Number(ixes.get(ixes.length - 1));
        this.highest_known_ix = this.max_ix;
        //    this.setDataTypes()

        this.local_dictionary_lookups = codes;
        return this.table;
      })
      .catch((e) => {        
        this.download_state = 'Failed';
        console.error(`Error: Remote Tile at ${this.url}/${this.key}.feather not found.
        
        `);
        throw e;
      });
    return this._download;
  }

  get children() : Array<this> {
    // create or return children.
    if (this.download_state !== 'Complete') {
      return [];
    }
    if (this._children.length < this.child_locations.length) {
      for (const key of this.child_locations) {
        //this._children.push(key)
        this._children.push(new this.class(this.url, key, this, this.dataset));
      }
    }
    // }
    // }
    return this._children;
  }
}

export class ArrowTile extends Tile {
  batch_num: number;
  full_tab: Table;
  constructor(table: Table, dataset : Dataset<ArrowTile>, batch_num : number, plot: Scatterplot, parent = null) {
    super(dataset);
    this.full_tab = table;
    this._table = new Table(table.batches[batch_num]);
    this.download_state = 'Complete';
    this.batch_num = batch_num;
    this._extent = {
      x: [-4, 4],
      y: [-4, 4],
    }
    this.parent = parent;
    const row_last = this._table.get(this._table.numRows - 1)
    if (row_last === null) {
      throw ('No rows in table');
    }
    this.max_ix = row_last.ix;
    this.highest_known_ix = this.max_ix;
    const row_1 = this._table.get(0)
    if (row_1 === null) {
      throw ('No rows in table');
    }
    this._min_ix = row_1.ix;
    this.highest_known_ix = this.max_ix;
    this.create_children()
  }

  create_children() {
    let ix = this.batch_num * 4;
    while (++ix <= (this.batch_num * 4 + 4)) {
      if (ix < this.full_tab.batches.length) {
        this._children.push(new ArrowTile(this.full_tab, this.dataset, ix, this.plot, this));
      }
    }
    console.log(this._children, this.children)
  }  
  download() : Promise<Table> {
    return Promise.resolve(this._table);
  }
  get ready() : boolean {
    // Arrow tables are always ready.
    return true;
  }
}