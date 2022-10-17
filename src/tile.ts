import {
  extent
} from 'd3-array';

import {
  Table, Vector, Utf8, Float32, Float, Int,
  Uint32, Int32, Int64, Dictionary,
  tableFromIPC,
  tableToIPC,
  vectorFromArray,
  table, RecordBatchFromArrays,
  makeBuilder,
  makeVector,
  RecordBatch,
  Schema,
  Data,
  Field
} from 'apache-arrow';

import TileWorker from './tileworker.worker.js?worker&inline';
import type { Dataset, QuadtileSet } from './Dataset';
import Scatterplot from './deepscatter';
type MinMax = [number, number];

export type Rectangle = {
  x:  MinMax,
  y:  MinMax
};

interface schema_entry{
  name: string,
  type : string, 
  extent: Array<any>,
  keys ? : Array<any>,
}

// Keep a global index of tile numbers. These are used to identify points.
let tile_identifier = 0;

export abstract class Tile {
  public max_ix  = -1;
  readonly key : string; // A unique identifier for this tile.
  promise : Promise<void>;
  download_state : string;
  public _batch? : RecordBatch;
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
  public _extent? : { 'x' : MinMax, 'y': MinMax };
  public numeric_id: number;
  constructor(dataset : QuadtileSet) {
    // Accepts prefs only for the case of the root tile.
    this.promise = Promise.resolve();
    this.download_state = 'Unattempted';
    this.key = String(Math.random());
    this.parent = null;
    this.dataset = dataset;
    if (dataset === undefined) {
      throw new Error('No dataset provided');
    }
    // Grab the next identifier off the queue. This should be async safe with the current setup, but
    // the logic might fall apart in truly parallel situations.
    this.numeric_id = tile_identifier++;
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
      return false;
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
    const worker : TileWorker = this.dataset.tileWorker;
    return worker;
  }


  *points(bounding : Rectangle | undefined = undefined, sorted = false) : Iterable<StructRowProxy> {
    //if (!this.is_visible(1e100, bounding)) {
    //  return;
    //}
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

  get record_batch() {
    if (this._batch) { return this._batch; }
    // Constitute table if there's a present buffer.
    if (this._table_buffer && this._table_buffer.byteLength > 0) {
      return this._batch = tableFromIPC(this._table_buffer).batches[0];
    }
    throw new Error('Attempted to access table on tile without table buffer.');
  }

  get min_ix() {
    if (this._min_ix !== undefined) {
      return this._min_ix;
    }
    if (this.parent) {
      return this.parent.max_ix + 1;
    }
    return;
  }

  async schema() {
    await this.download();
    return this._schema;
  }

  /**
   * 
   * @param callback A function (possibly async) to execute before this cell is ready. 
   * @returns A promise that includes the callback and all previous promises.
   */
  extend_promise(callback : () => Promise<void>) {
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
    for (const field of this.record_batch.schema.fields) {
      const { name, type } = field;
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
          keys: this.record_batch.getChild(name).data[0].dictionary.toArray(),
          extent: [-2047, this.record_batch.getChild(name).data[0].dictionary.length - 2047],
        });
      }
      if (type && type.typeId == 8) {
        attributes.push({
          name,
          type: 'date',
          extent: extent(this.record_batch.getChild(name).data[0].values),
        });
      }
      if (type && type.typeId == 3) {
        attributes.push({
          name, type: 'float', extent: extent(this.record_batch.getChild(name).data[0].values),
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

  get extent() : Rectangle {
    if (this._extent) {
      return this._extent;
    }
    return {
      x: [Number.MIN_VALUE, Number.MAX_VALUE],
      y: [Number.MIN_VALUE, Number.MAX_VALUE]
    };
  }

  [Symbol.iterator]() {
    return this.yielder();
  }

  get root_extent() : Rectangle {
    if (this.parent === null) {
      // infinite extent
      return {
        x: [Number.MIN_VALUE, Number.MAX_VALUE],
        y: [Number.MIN_VALUE, Number.MAX_VALUE]
      };
    }
    return this.parent.root_extent;
  }
}

export class QuadTile extends Tile {
  url : string;
  bearer_token = '';
  key : string;
  public _children : Array<this> = [];
  codes : [number, number, number];
  _already_called = false;
  public child_locations : string[] = [];
  constructor(base_url : string, key : string, parent : null | this, dataset : QuadtileSet, prefs) {
    super(dataset);
    this.url = base_url;
    if (prefs != undefined && 'bearer_token' in prefs) {
      this.bearer_token = prefs['bearer_token'];
    }

    this.parent = parent;
    this.key = key;
    const [z, x, y] = key.split('/').map((d) => Number.parseInt(d));
    this.codes = [z, x, y];
    this.class = new.target;
  }


  get extent() : Rectangle {
    if (this._extent) {
      return this._extent;
    }
    return this.theoretical_extent;
  }

  async download() : Promise<void> {
    // This should only be called once per tile.
    if (this._download) { return this._download; }

    if (this._already_called) {
      throw 'Illegally attempting to download twice';
    }
    this._already_called = true;
    var url = `${this.url}/${this.key}.feather`;
    this.download_state = 'In progress';
    if (this.bearer_token) {
      url = url.replace('/public', '');
    }
    const request : RequestInit | undefined = 
    this.bearer_token ? 
      {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + this.bearer_token }
      } :
      undefined;

    this._download = this.tileWorker
      .fetch(url, {}, request)
      .then(([buffer, metadata, codes]): Table<any> => {
        this.download_state = 'Complete';
        this._table_buffer = buffer;
        this._batch = tableFromIPC(buffer).batches[0];
        if (this._batch === undefined) {
          throw 'Batch was empty'
        }
        if (!this._batch.getChild('_isSelected')) {
          const isSelectedArray = Array(this._batch.numRows).fill('0');
          const isSelectedVector = vectorFromArray(isSelectedArray, new Utf8());
          const isSelectedDictionary = makeVector({
            data: isSelectedArray.map((v) => parseInt(v)),
            dictionary: isSelectedVector,
            type: new Dictionary(new Utf8(), new Uint32())
          });
          var buffers = [void 0, isSelectedDictionary.data[0].values, this._batch.data.children[0].nullBitmap, void 0];
          const isSelectedData = new Data(new Dictionary(new Utf8(), new Uint32()), 0, this._batch.numRows, 0, buffers, isSelectedDictionary);
          isSelectedData.dictionary = isSelectedDictionary.memoize();
          isSelectedData.children = [];
          //const selfield = this.tileSet.currentSelected;
          var sorted_fields = [{'name': '_isSelected'}];
          if (this.parent !== undefined && this.parent !== null && this.parent._batch !== undefined) {
            sorted_fields = this.parent._batch.schema.fields
                .filter(f => f.name.includes('Selected'))
                .filter(f => !f.name.includes('float_version'))
                .sort()
                .reverse();
          }
          var child_field_names = this._batch.schema.fields.map(f => f.name);
          sorted_fields.forEach(field => {
            if (child_field_names.includes(field.name)) {
              return
            }
            var isSelectedSchemaField = new Field(field.name, new Dictionary(new Utf8(), new Uint32()), false);
            this._batch.schema.fields.push(isSelectedSchemaField);
            this._batch.data.children.push(isSelectedData);
            const float_version = new Float32Array(this._batch.numRows);
            for (let i = 0; i < this._batch.numRows; i++) {
              float_version[i] = this._batch.getChild(field.name).data[0].values[i] - 2047;
            }
            const float_vector = makeVector(float_version);
            var float_buffers = [void 0, float_vector.data[0].values, this._batch.data.children[0].nullBitmap, void 0];
            const float_data = new Data(new Float(), 0, this._batch.numRows, 0, float_buffers);
            var float_field = new Field(field.name + '_float_version', new Float(), false);
            this._batch.data.children.push(float_data);
            this._batch.schema.fields.push(float_field);
          });

          var selected_codes = /* @__PURE__ */ new Map();
          selected_codes.set(0, '1');
          selected_codes.set(1, '0');
          codes['_isSelected'] = selected_codes;
        }

        this._extent = JSON.parse(metadata.get('extent'));
        this.child_locations = JSON.parse(metadata.get('children'));
        const ixes = this._batch.getChild('ix');
        if (ixes === null) {
          throw 'No ix column in table';
        }
        this._min_ix = Number(ixes.get(0));
        this.max_ix = Number(ixes.get(ixes.length - 1));
        this.highest_known_ix = this.max_ix;
        this._current_mutations = JSON.parse(JSON.stringify(this.needed_mutations || {}));
        this.local_dictionary_lookups = codes;
//        this.update_master_dictionary_lookups();
      })
      .catch((error) => {        
        this.download_state = 'Failed';
        console.error(`Error: Remote Tile at ${this.url}/${this.key}.feather not found.
        
        `);
        throw error;
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
        this._children.push(new this.class(this.url, key, this, this.dataset, {'bearer_token': this.bearer_token}));
      }
    }
    // }
    // }
    return this._children;
  }

  get theoretical_extent() : Rectangle { 
    // QUADTREE SPECIFIC CODE.
    const base = this.dataset.extent;
    const [z, x, y] = this.codes;

    const x_step = base.x[1] - base.x[0];
    const each_x = x_step / (2 ** z);

    const y_step = base.y[1] - base.y[0];
    const each_y = y_step / (2 ** z);

    return {
      x: [base.x[0] + x * each_x, base.x[0] + (x + 1) * each_x],
      y: [base.y[0] + y * each_y, base.y[0] + (y + 1) * each_y],
    };
  }


}

export class ArrowTile extends Tile {
  batch_num: number;
  full_tab: Table;
  constructor(table: Table, dataset : Dataset<this>, batch_num : number, plot: Scatterplot, parent = null) {
    super(dataset);
    this.full_tab = table;
    this._batch = table.batches[batch_num];
    this.download_state = 'Complete';
    this.batch_num = batch_num;
    this._extent = {
      x: extent(this._batch.getChild('x')),
      y: extent(this._batch.getChild('y'))
    };
    this.parent = parent;
    const row_last = this._batch.get(this._batch.numRows - 1);
    if (row_last === null) {
      throw ('No rows in table');
    }
    this.max_ix = row_last.ix;
    this.highest_known_ix = this.max_ix;
    const row_1 = this._batch.get(0);
    if (row_1 === null) {
      throw ('No rows in table');
    }
    this._min_ix = row_1.ix;
    this.highest_known_ix = this.max_ix;
    this.create_children();
  }

  create_children() {
    let ix = this.batch_num * 4;
    while (++ix <= (this.batch_num * 4 + 4)) {
      if (ix < this.full_tab.batches.length) {
        this._children.push(new ArrowTile(this.full_tab, this.dataset, ix, this.plot, this));
      }
    }
  }  
  download() : Promise<RecordBatch> {
    
    return Promise.resolve(this._batch);
  }
  get ready() : boolean {
    // Arrow tables are always ready.
    return true;
  }
}