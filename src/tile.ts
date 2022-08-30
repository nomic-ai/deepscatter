import {
  extent, range, min, max, bisectLeft,
} from 'd3-array';

import {
  Table, Vector, Utf8, Float32, Float, Int,
  Uint32, Int32, Int64, Dictionary,
  tableFromIPC,
  tableToIPC,
  vectorFromArray,
  tableFromArrays,
  makeBuilder,
  makeVector,
  RecordBatch,
  Schema,
  Data,
  Field
} from 'apache-arrow';
import * as Comlink from 'comlink';
import Counter from './Counter';

import TileWorker from './tileworker.worker.js?worker&inline';
import Zoom from './interaction';
import { StructRowProxy } from 'apache-arrow/row/struct';


type Rectangle = {
  x: [number, number],
  y: [number, number]
}
type Point = [number, number]

class Batch {
  // Can this usefully do anything?
}

interface schema_entry{
  name: string,
  type : string, 
  extent: Array<any>,
  keys ? : Array<any>,
}

type MinMax = [number, number];

export class Tile extends Batch {
  max_ix : number;
  promise : Promise<void>;
  download_state : string;
  public _table? : Table;
  public _current_mutations?: Record<string, any>;
  parent? : Tile;
  _table_buffer?: ArrayBuffer;
  public _children : Array<Tile> = [];
  public _highest_known_ix? : number;
  public _min_ix? : number;
  public _max_ix? : number;
  public _download? : Promise<void>;
  __schema?: schema_entry[];
  local_dictionary_lookups? : Map<string, any>;
  codes? : [number, number, number];
  public _extent? : {'x' : MinMax, 'y': MinMax};

  constructor() {
    // Accepts prefs only for the case of the root tile.
    super();
    this.max_ix = undefined;
    this.promise = Promise.resolve();
    this.download_state = 'Unattempted';
  }

  get children() {
    return this._children;
  }

  get dictionary_lookups() {
    return this.parent.dictionary_lookups;
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

  get tileWorker() {
    // Bubbles up to grab one from the root tile.
    return this.parent.tileWorker;
  }

  get needed_mutations() {
    this._current_mutations = this._current_mutations || {};

    const needed = {};

    for (const [k, v] of Object.entries(this.mutations)) {
      // Shallow copy to avoid overwriting.
      const current = this._current_mutations[k];
      if (v !== current) {
        needed[k] = v;
      }
    }

    return needed;
  }

  apply_mutations_once() {
    // Default to a resolved promise; if work is required,
    // it will be populated.

    const { needed_mutations } = this;

    if (Object.keys(needed_mutations).length === 0) {
      return Promise.resolve('complete');
    }

    if (needed_mutations === undefined) {
      return Promise.resolve('deferred');
    }

    
    return this.extend_promise(() => {
      // Nuke the table
      this._table = undefined;
      return this.tileWorker
        .run_transforms(
          needed_mutations, Comlink.transfer(this._table_buffer, [this._table_buffer]),
        )
        .then(([buffer, codes]) => {
        // console.log(`Off location operation took ${Date.now() - start}ms on ${this.key}`)
          this._table_buffer = buffer;
          Object.assign(this._current_mutations, needed_mutations);

          this.local_dictionary_lookups = codes;
          this.update_master_dictionary_lookups();
          return 'changed';
        });
    });
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
    return this._highest_known_ix;
  }


  /* kdtree() {
    if (this._kdtree) {
      return this._kdtree
    }
    if (this.underway_promises.has("kdtree")) {
      return undefined
    }
    if (!this.ready) {
      return undefined
    }

    this.underway_promises.add("kdtree")

    // Always drop the table cache before sending off the buffer.
    this._table = undefined;
    this.tileWorker.kdtree(
      Comlink.transfer(this._table_buffer, [this._table_buffer])
    ).then(
      ([buffer, treedata]) => {
      //  console.log("Returned", buffer, treedata);
        this.underway_promises.delete("kdtree");
        this._table_buffer = buffer;
        this._kdtree = ArrowTree.from_buffer(treedata, this.table);
      }
    )

    this._kdtree = new ArrowTree(this.table, "x", "y")
    return this._kdtree
  }
  */
  get table() {
    if (this._table) { return this._table; }
    // Constitute table if there's a present buffer.
    if (this._table_buffer && this._table_buffer.byteLength > 0) {
      return this._table = tableFromIPC(this._table_buffer);
    }
    throw new Error("Attempted to access table on tile without table buffer.");
  }
  /*
  column(key : string) : ColumnProxy {
    return new ColumnProxy(this, key);
  } */

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

  extend_promise(callback : () => Promise<any>) {
    this.promise = this.promise.then(() => callback());
    return this.promise;
  }

  get ready() {
    // The flag for readiness is whether there is
    // an arraybuffer at this._table_buffer

    // Unlike 'promise,' this returns asychronously
    return this._table_buffer && this._table_buffer.byteLength > 0;
  }

/*  find_closest(p, dist = Infinity, filter) {
    let my_dist = dist;
    let candidate;

    /*
    const DEBOUNCE = 1/60 * 1000;
    this._last_kdbuild_time = this._last_kdbuild_time || 0;
    */
/*
    this.visit((tile) => {
      // Don't visit tiles too far away.
      if (corner_distance(tile.extent, p[0], p[1]) > my_dist) {
        return;
      }
      if (!tile._kdtree) {
        // Spawn trees on all tiles we need,
        // even if they're not populated yet.
        tile.kdtree();
      }
      if (tile._kdtree) { // may not have loaded yet; if not, ignored.
        const closest = tile._kdtree.find(p[0], p[1], my_dist, filter);
        if (closest) {
          const d = Math.sqrt((closest.x - p[0]) ** 2 + (closest.y - p[1]) ** 2);
          candidate = closest;
          my_dist = d;
        }
      }
    });

    return candidate;
  }
*/
  get _schema() {
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

  * yielder() {
    for (const row of this.table) {
      if (row) {
        yield row;
      }
    }
  }

  update_master_dictionary_lookups() {
    const fields = this.local_dictionary_lookups;
    for (const [fieldname, dictionary] of Object.entries(fields)) {
      // Create lookup if needed.
      this.dictionary_lookups[fieldname] = this.dictionary_lookups[fieldname] || new Map();
      const map = this.dictionary_lookups[fieldname];
      let ix = 0;
      for (const [index, textvalue] of dictionary.entries()) {
        if (!map.has(textvalue)) {
          // Since double-storing, the next highest index is double the length.
          ix = map.size / 2;

          // safe to go both ways at once because one is a string and
          // the other an int.
          map.set(ix, textvalue);
          map.set(textvalue, ix);
        }
        this.dictionary_lookups[fieldname];
      }
    }
    this.dictionary_lookups;
  }

  get theoretical_extent() : Rectangle { 
    const base = this.root_extent;
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

  get mutations() {
    return this.parent.mutations;
  }

  [Symbol.iterator]() {
    return this.yielder();
  }

  count(...category_names) {
    const cols = [];
    for (const k of category_names) {
      const column = this.table.getChild(k);
      if (column) cols.push(column);
    }
    const counts = new Counter();
    for (let i = 0; i < this.table.data[0].length; i++) {
      const k = cols.map((d) => d.get(i));
      counts.inc(...k);
    }
    return counts;
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
  _mutations : Map<string, any> = new Map();
  key : string;
  public _children : Array<QuadTile> = [];
  class : Tile;
  codes : [number, number, number];
  _already_called = false;
  public child_locations : String[] = [];
  constructor(base_url : string, key : string, parent : QuadTile, prefs) {
    super();
    this.url = base_url;
    this.parent = parent;
    if (parent === undefined) {
      this._mutations = prefs.mutate;
    }
    this.key = key;
    const [z, x, y] = key.split('/').map((d) => parseInt(d));
    this.codes = [z, x, y];
    //@ts-ignore
    this.class = new.target;
  }

  async download_to_depth(depth : number, corners : Rectangle = { x: [-1, 1], y: [-1, 1] }, recurse = false) : Promise<QuadTile[]>{
    // First, execute the download to populate this.max_ix
    console.log("Downloading")
    if (!this.is_visible(depth, corners)) {
      return [];
    }
    if (this.max_ix < depth && recurse) {
      const promises = this.children.map((child) => child.download());
      if (this.children.length) {
        // Already-downloaded children must also launch downloads.
        for (const child of this._children) {
          promises.concat(
            child.download_to_depth(depth, corners, false),
          );
        }
      }
      return Promise.all(promises);
      // return this.children().map(child => child.download_to_depth(depth, corners, false))
    }

  await this.download()

  // If the last point here is less than the target depth, keep going.
    if (this.max_ix < depth
      && this.is_visible(depth, corners) && recurse
      ) {
      // Create the children.
        const child_processes = this._children
        // Filter to visible. Newly generated children
        // will return invisible.
          .map((child) => child.download_to_depth(depth, corners));
        return Promise.all(child_processes)
          .then((d) => this);
    }
    return this;
  }

  download() : Promise<Table> {
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
      .fetch(url, this.needed_mutations)
      .then(([buffer, metadata, codes]): Table<any> => {
        this.download_state = 'Complete';

        // metadata is passed separately b/c I dont know
        // how to fix it on the table in javascript, just python.
        this._current_mutations = JSON.parse(JSON.stringify(this.needed_mutations));
        this._table_buffer = buffer;
        this._table = tableFromIPC(buffer);
        if(!this._table.getChild('_isSelected')){
        const isSelectedArray = Array(this._table.numRows).fill('0');
        isSelectedArray[0] = '1';
        const isSelectedVector = vectorFromArray(isSelectedArray, new Utf8);
        const isSelectedDictionary = makeVector({
          data: isSelectedArray.map((v) => parseInt(v)),
          dictionary: isSelectedVector,
          type: new Dictionary(new Utf8, new Uint32)
        });
        var buffers = [undefined,isSelectedDictionary.data[0].values,this._table.batches[0].data.children[0].nullBitmap,undefined];
        const isSelectedData = new Data(new Dictionary(new Utf8, new Uint32), 0, this._table.numRows, 0, buffers, isSelectedDictionary);
        isSelectedData.dictionary = isSelectedDictionary.memoize();
        isSelectedData.children = [];
        var isSelectedSchemaField = new Field('_isSelected', new Dictionary(new Utf8, new Uint32), false);
        this._table.schema.fields.push(isSelectedSchemaField);
        this._table.batches[0].data.children.push(isSelectedData);
        const float_version = new Float32Array(this._table.numRows);
        for (let i = 0; i < this._table.numRows; i++) {
          float_version[i] = this._table.getChild('_isSelected').data[0].values[i] - 2047;
        }
        const float_vector = makeVector(float_version);
        var float_buffers = [undefined,float_vector.data[0].values,this._table.batches[0].data.children[0].nullBitmap,undefined];
        const float_data = new Data(new Float(), 0, this._table.numRows, 0, float_buffers);
        var float_field = new Field('_isSelected_float_version', new Float(), false);
        this._table.batches[0].data.children.push(float_data);
        this._table.schema.fields.push(float_field);
        var selected_codes = new Map();
        selected_codes.set(0, '1');
        selected_codes.set(1, '0');
        codes['_isSelected'] = selected_codes;
        }
        this._extent = JSON.parse(metadata.get('extent'));
        this.child_locations = JSON.parse(metadata.get('children'));
        const ixes = this.table.getChild('ix')
        if (ixes === null) {
          throw ('No ix column in table');
        }
        this._min_ix = Number(ixes.get(0));
        this.max_ix = Number(ixes.get(ixes.length - 1));
        this.highest_known_ix = this.max_ix;
        this._current_mutations = JSON.parse(JSON.stringify(this.needed_mutations));
        //    this.setDataTypes()

        this.local_dictionary_lookups = codes;
        this.update_master_dictionary_lookups();
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

  get children() : Array<QuadTile> {
    // create or return children.
    if (this.download_state !== 'Complete') {
      return [];
    }
    if (this._children.length < this.child_locations.length) {
      for (const key of this.child_locations) {
        //this._children.push(key)
        this._children.push(new this.class(this.url, key, this));
      }
    }
    // }
    // }
    return this._children;
  }
}

type Key = string;

export default class RootTile extends QuadTile {
  // The parent tile carries some data for the full set.
  // For clarity, I keep those elements in this class.
  public _tileWorkers : TileWorker[];
  public _download_queue : Set<Key>;
  public key : Key = "0/0/0";
  public _zoom? : Zoom;
  constructor(base_url, prefs = {}) {
    let key;

    if (base_url.match(/(\/[0-9]+){3}/)) {
      const sections = base_url.split('/');
      base_url = sections.slice(0, -3).join('/');
      key = sections.slice(-3).join('/');
    } else {
      key = '0/0/0';
    }
    super(base_url, key, undefined, prefs);
    // The root tile must be downloaded immediately.
    this.extend_promise(() => this.download());
    this._min_ix = 1;
  }

  get root_extent() : Rectangle {
    // this is the extent
    if (this._extent) {
      return this._extent;
    }
    return {
      x: [parseFloat("-inf"), parseFloat("inf")],
      y: [parseFloat("-inf"), parseFloat("inf")]
    }
  }

  log_tiles(depth = 1, f = (tile : Tile) => `${tile.children.length}`) {
    const array = [];
    const w = range(2 ** depth);
    for (const i of w) {
      array[i] = [];
      for (const j of w) {
        array[i][j] = ' ';
      }
      array[i][2 ** depth] = '|';
    }
    
    array[2 ** depth] = Array(2 ** depth + 1).fill('-');

    this.visit((tile) => {
      const [z, x, y] = tile.key.split('/').map((d) => +d);
      if (z === depth) {
        array[y][x] = '_';
        //        if (tile.download_state == "Complete") {
        array[y][x] = f(tile);
        //        }
      }
    });
  }

  download_most_needed_tiles(bbox : Rectangle, max_ix: number, queue_length = 4) {
    /*
      Browsing can spawn a  *lot* of download requests that persist on
      unneeded parts of the database. So the tile handles its own queue for dispatching
      downloads in case tiles have slipped from view while parents were requested.
    */

    if (!this._download_queue) {
      this._download_queue = new Set();
    }

    const queue = this._download_queue;

    if (queue.size >= queue_length) {
      return;
    }
    /*
    for (let child of this.children) {
      console.log(check_overlap(child, this.extent), child.key, this.key)

      for (let child2 of child.children) {
        console.log("   ", check_overlap(child2, child.extent), child2.key, child.key)
        if (check_overlap(child2, child.extent) < .2) {
        console.log("   ", area(child2.extent)*1e-15, child2.key)
        }
        for (let child3 of child2.children) {
          console.log("      ", check_overlap(child3, child2.extent), child3.key, child2.key)
        }
      }

    } */

    const scores : [number, Tile, Rectangle][] = [];
    function callback (tile : Tile) {
      if (tile.download_state === 'Unattempted') {
        const distance = check_overlap(tile, bbox);
        scores.push([distance, tile, bbox]);
      }
    };

    this.visit(
      callback,
    );
    scores.sort((a, b) => a[0] - b[0]);
    while (scores.length && queue.size < queue_length) {
      const upnext = scores.pop();
      if (upnext === undefined) {throw new Error("Ran out of tiles unexpectedly");}
      const [distance, tile, _] = upnext;
      if ((tile.min_ix && tile.min_ix > max_ix) || distance <= 0) {
        continue;
      }
      queue.add(tile.key);
      tile.download()
        .catch((err) => {
          console.warn('Error on', tile.key);
          queue.delete(tile.key);
          throw (err);
        })
        .then(() => queue.delete(tile.key));
    }
  }

  get children() : Array<QuadTile> {
    // create or return children.
    if (this.download_state !== 'Complete') {
      return [];
    }
    if (this._children.length < this.child_locations.length) {
      for (const key of this.child_locations) {
        this._children.push(new QuadTile(this.url, key, this, {}));
      }
    }
    // }
    // }
    return this._children;
  }

  get mutations() {
    return this._mutations
      ? this._mutations : this._mutations = new Map();
  }

  findPoint(ix : number) {
    return this
      .map((t) => t) // iterates over children.
      .filter((t) => t.ready && t.table && t.min_ix <= ix && t.max_ix >= ix)
      .map((t) => {
        const mid = bisectLeft([...t.table.getChild('ix').data[0].values], ix);
        if (t.table.get(mid) && t.table.get(mid).ix === ix) {
          return t.table.get(mid);
        }
        return null;
      })
      .filter((d) => d);
  }

  apply_mutations(function_map, synchronous = false) {
    // For each, get the tile and a reference to the promise.

    // The returned promise is a string that tells
    // if the mutation was applied.

    Object.assign(this.mutations, function_map);
    const all = this.map((tile) => tile.apply_mutations_once(function_map));
    if (synchronous) {
      return all;
    }
    return Promise.all(all);
  }

  get dictionary_lookups() {
    return this._dictionary_lookups ? this._dictionary_lookups : this._dictionary_lookups = {};
  }

  /*
  count_values(...category_names) {
    const counts = new Counter();

    this.forEach((tile) => {
      counts.merge(tile.count(...category_names));
    });

    return counts.values();
  }
*/
  get tileWorker() {
    const NUM_WORKERS = 4;

    if (this._tileWorkers !== undefined) {
      // Apportion the workers randomly whener one is asked for.
      // Might be a way to have a promise queue that's a little more
      // orderly.
      this._tileWorkers.unshift(this._tileWorkers.pop());
      return this._tileWorkers[0];
    }
    this._tileWorkers = [];
    for (const i of range(NUM_WORKERS)) {
      this._tileWorkers.push(
        //          Comlink.wrap(new Worker(this.url + '/../worker.js')),
        Comlink.wrap(new TileWorker()),
      );
    }

    return this._tileWorkers[0];
  }

  map(callback : (tile: Tile) => any, after = false) {
    // perform a function on each tile and return the values in order.
    const q : any[] = [];
    this.visit((d : any) => { q.push(callback(d)); }, after = after);
    return q;
  }

  visit(callback :  (tile: Tile) => void, after = false, filter = () => true) {
    // Visit all children with a callback function.
    // The general architecture here is taken from the
    // d3 quadtree functions. That's why, for example, it doesn't
    // recurse.

    // filter is a condition to stop descending a node.
    const stack = [this];
    const after_stack = [];
    let current;
    while (current = stack.shift()) {
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
      while (current = after_stack.pop()) {
        callback(current);
      }
    }
  }
}

/*
function setsAreEqual(a, b) {
  return a.size === b.size && [...a].every((value) => b.has(value));
} */

function corner_distance(corners, x, y) {
  if (corners === undefined) {
    return parseFloat('inf');
  }
  // https://stackoverflow.com/questions/5254838/calculating-distance-between-a-point-and-a-rectangular-box-nearest-point
  const dx = Math.max(corners.x[0] - x, 0, x - corners.x[1]);
  const dy = Math.max(corners.y[0] - y, 0, y - corners.y[1]);
  return Math.sqrt(dx * dx + dy * dy);
}

function p_in_rect(p : Point, rect : Rectangle | undefined) {
  if (rect === undefined) { return true; }
  const c = rect;
  return (p[0] < rect.x[1]
             && p[0] > rect.x[0]
             && p[1] < rect.y[1]
             && p[1] > rect.y[0]);
}

function area(rect : Rectangle) {
  return (rect.x[1] - rect.x[0]) * (rect.y[1] - rect.y[0]);
}

const thrower = function (r : Rectangle) {
  if (r.x[1] < r.x[0]) {
    throw 'x';
  }
  if (r.y[1] < r.y[0]) {
    throw 'y';
  }
};

function check_overlap(tile : Tile, bbox : Rectangle) : number {
  /* the area of Intersect(tile, bbox) expressed
     as a percentage of the area of bbox */
  const c : Rectangle = tile.extent;

  if (bbox.x === undefined || bbox.y === undefined) {
    throw 'no corners';
  }
  if (c.x[0] > bbox.x[1]
      || c.x[1] < bbox.x[0]
      || c.y[0] > bbox.y[1]
      || c.y[1] < bbox.y[0]
  ) {
    return 0;
  }

  const intersection : Rectangle = {
    x: [
      max([bbox.x[0], c.x[0]]),
      min([bbox.x[1], c.x[1]]),
    ],
    y: [
      max([bbox.y[0], c.y[0]]),
      min([bbox.y[1], c.y[1]]),
    ],
  };
  const { x, y } = intersection;
  let disqualify = 0;
  if (x[0] > x[1]) { disqualify -= 1; }
  if (y[0] > y[1]) { disqualify -= 2; }
  if (disqualify < 0) {
    return disqualify;
  }
  return area(intersection) / area(bbox);
}

export type Tileset = RootTile;

export class ArrowTile extends Tile {
  
  constructor(table_buffer : ArrayBuffer) {
    super();
    this.download_state = 'Complete';
    this._table_buffer = table_buffer;
    this._table = tableFromIPC(table_buffer);
  }
  
  download() : Promise<Table> {
    return Promise.resolve(this._table);
  }

}