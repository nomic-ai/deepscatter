import {
  extent, range, min, max, bisectLeft,
} from 'd3-array';
import { Table } from '@apache-arrow/es5-cjs';
import * as Comlink from 'comlink';
import Counter from './Counter';

import TileWorker from './tileworker.worker.js?worker&inline';

class Batch {
  // Can this usefully do anything?

  download_to_depth() {}

}

class Tile extends Batch {
  constructor() {
    // Accepts prefs only for the case of the root tile.
    super();
    this.max_ix = undefined;

    this.promise = Promise.resolve(1);

    this.download_state = 'Unattempted';

//    this.class = new.target;
  }

  get dictionary_lookups() {
    return this.parent.dictionary_lookups;
  }

  is_visible(max_ix, viewport_limits) {
    // viewport_limits is in coordinate points.
    // Will typically be got by calling current_corners.

    // Top tile is always visible (even if offscreen).
    // if (!this.parent) {return true}

    if (this.min_ix > max_ix) {
      return false;
    }

    if (viewport_limits === undefined) {
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

  * points(bounding = undefined, sorted = false) {
    if (!this.is_visible(1e100, bounding)) {
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
          };
          f.next = f.iterator.next();
          return f;
        });
      children = children.filter((d) => d.next.value);
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

  forEach(callback) {
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

  get highest_known_ix() {
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
      console.log('BYTES', this._table_buffer.byteLength);
      return this._table = Table.from(this._table_buffer);
    }
    return undefined;
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


  get schema() {
    return this.download().then(
      (results) => this._schema,
    );
  }

  extend_promise(callback) {
    this.promise = this.promise.then(() => callback());
    return this.promise;
  }

  get ready() {
    // The flag for readiness is whether there is
    // an arraybuffer at this._table_buffer

    // Unlike 'promise,' this returns asychronously
    return this._table_buffer && this._table_buffer.byteLength > 0;
  }

  find_closest(p, dist = Infinity, filter) {
    let my_dist = dist;
    let candidate;

    /*
    const DEBOUNCE = 1/60 * 1000;
    this._last_kdbuild_time = this._last_kdbuild_time || 0;
    */

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

  get _schema() {
    // Infer datatypes from the first file.
    if (this.__schema) {
      return this.__schema;
    }
    const attributes = [];

    for (const field of this.table.schema.fields) {
      const { name, type, nullable } = field;
      if (type && type.typeId == 5) {
        // character
        attributes.push({
          name, type: 'string',
        });
      }
      if (type && type.dictionary) {
        attributes.push({
          name,
          type: 'dictionary',
          keys: this.table.getColumn(name).data.dictionary.toArray(),
          extent: [-2047, this.table.getColumn(name).data.dictionary.length - 2047],

        });
      }
      if (type && type.typeId == 8) {
        attributes.push({
          name,
          type: 'date',
          extent: extent(this.table.getColumn(name).data.values),
        });
      }
      if (type && type.typeId == 3) {
        attributes.push({
          name, type: 'float', extent: extent(this.table.getColumn(name).data.values),
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

  get theoretical_extent() {
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

  get extent() {
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
      cols.push(this.table.getColumn(k));
    }
    const counts = new Counter();
    for (let i = 0; i < this.table.length; i++) {
      const k = cols.map((d) => d.get(i));
      counts.inc(...k);
    }
    return counts;
  }

  get root_extent() {
    return this.parent.root_extent;
  }
}

export class QuadTile extends Tile {
  constructor(base_url, key, parent = undefined, prefs) {
    super();
    this.url = base_url;
    this.parent = parent;
    if (parent === undefined) {
      this._mutations = prefs.mutate;
    }
    this.key = key;
    this.codes = this.key.split('/').map((t) => +t);
    this.class = new.target;
  }

  download_to_depth(depth, corners = { x: [-1, 1], y: [-1, 1] }, recurse = false) {
    // First, execute the download to populate this.max_ix

    if (this.max_ix < depth && this.is_visible(depth, corners) && !recurse) {
      const promises = this.children.map((child) => child.download());
      if (this._children) {
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

    return this.download()
      .then(() => {
      // If the last point here is less than the target depth, keep going.
        if (this.max_ix < depth
        && this.is_visible(depth, corners) && recurse
        ) {
        // Create the children.
          const child_processes = this.children
          // Filter to visible. Newly generated children
          // will return invisible.
            .map((child) => child.download_to_depth(depth, corners));
          return Promise.all(child_processes)
          // .catch(err => undefined)
            .then((d) => this);
        }
        return this;
      });
  }

  download() {
    // This should only be called once per tile.
    if (this._download) { return this._download; }

    if (this._already_called) {
      throw ('Illegally attempting to download twice');
    }
    this._already_called = true;

    const url = this.url.match('//')
      ? `${this.url}/${this.key}.feather`
      : `${window.location.origin}/${this.url}/${this.key}.feather`;

    this.download_state = 'In progress';

    this._download = this.tileWorker
      .fetch(url, this.needed_mutations)
      .catch((err) => {
        this.download_state = 'Errored';
        throw err;
      })
      .then(([buffer, metadata, codes]) => {
        this.download_state = 'Complete';

        // metadata is passed separately b/c I dont know
        // how to fix it on the table in javascript, just python.
        this._current_mutations = JSON.parse(JSON.stringify(this.needed_mutations));
        this._table_buffer = buffer;
        this._table = Table.from(buffer);
        this._extent = JSON.parse(metadata.get('extent'));
        this.child_locations = JSON.parse(metadata.get('children'));
        this._min_ix = this.table.getColumn('ix').get(0);
        this.max_ix = this.table.getColumn('ix').get(this.table.length - 1);
        this.highest_known_ix = this.max_ix;
        this._current_mutations = JSON.parse(JSON.stringify(this.needed_mutations));
        //    this.setDataTypes()

        this.local_dictionary_lookups = codes;
        this.update_master_dictionary_lookups();
        return this.table;
      });
    return this._download;
  }

  
  get children() {
    // create or return children.
    if (this._children !== undefined) {
      return this._children;
    }
    if (this.download_state !== 'Complete') {
      return [];
    }
    this._children = [];

    for (const key of this.child_locations) {
      this._children.push(new this.class(this.url, key, this));
    }
    // }
    // }
    return this._children;
  }


}

export default class RootTile extends QuadTile {
  // The parent tile carries some data for the full set.
  // For clarity, I keep those elements in this class.

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

  get root_extent() {
    // this is the extent
    if (this._extent) {
      return this._extent;
    }
    // avoid infinite doom loop.
    return undefined;
  }

  log_tiles(depth = 1, f = (tile) => `${tile.children.length}`) {
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
    const lines = array.map((a) => a.join(''));
  }

  download_most_needed_tiles(bbox, max_ix, queue_length = 4) {
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

    const scores = [];
    const callback = (tile) => {
      //      if (tile.download_state == "Unattempted") {
      const distance = check_overlap(tile, bbox);
      scores.push([distance, tile, bbox, tile.download_state]);
      //      }
    };

    this.visit(
      callback,
    );
    scores.sort((a, b) => a[0] - b[0]);
    for (const [d, t, bb, state] of scores) {
      //      console.log({d, t, k: t.key, bb, state})
    }
    while (scores.length && queue.size < queue_length) {
      const [distance, tile, bbox, _] = scores.pop();
      if (tile.min_ix > max_ix || distance < 0) {
        continue;
      }
      if (tile.download_state !== 'Unattempted') {
        continue;
      }

      //      console.log("Getting", {distance, tile: tile.key, bbox, abbox: area(bbox), a_tile: area(tile.extent), e: tile.extent})
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

  get children() {
    // create or return children.
    if (this._children !== undefined) {
      return this._children;
    }
    if (this.download_state !== 'Complete') {
      return [];
    }

    this._children = [];

    for (const key of this.child_locations) {
      this._children.push(new QuadTile(this.url, key, this));
    }

    return this._children;
  }

  get mutations() {
    return this._mutations
      ? this._mutations : this._mutations = {};
  }

  findPoint(ix) {
    return this
      .map((t) => t)
      .filter((t) => t.table && t.min_ix < ix && t.max_ix > ix)
      .map((t) => {
        const mid = bisectLeft(t.table.getColumn('ix').data.values, ix);
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
    const NUM_WORKERS = 8;

    if (this._tileWorkers !== undefined) {
      // Apportion the workers randomly whener one is asked for.
      // Might be a way to have a promise queue that's a little more
      // orderly.
      this._tileWorkers.unshift(this._tileWorkers.pop());
      return this._tileWorkers[0];
    }
    this._tileWorkers = [];
    for (const i of range(NUM_WORKERS)) {
      console.log(`Allocating worker ${i}`);
      this._tileWorkers.push(
        //          Comlink.wrap(new Worker(this.url + '/../worker.js')),
        Comlink.wrap(new TileWorker()),
      );
    }

    return this._tileWorkers[0];
  }

  map(callback, after = false) {
    // perform a function on each tile and return the values in order.
    const q = [];
    this.visit((d) => { q.push(callback(d)); }, after = after);
    return q;
  }

  visit(callback, after = false, filter = () => true) {
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

function p_in_rect(p, rect) {
  if (rect === undefined) { return true; }
  const c = rect;
  return (p[0] < rect.x[1]
             && p[0] > rect.x[0]
             && p[1] < rect.y[1]
             && p[1] > rect.y[0]);
}

function area(rect) {
  return (rect.x[1] - rect.x[0]) * (rect.y[1] - rect.y[0]);
}

const thrower = function (r) {
  if (r.x[1] < r.x[0]) {
    throw 'x';
  }
  if (r.y[1] < r.y[0]) {
    throw 'y';
  }
};

function check_overlap(tile, bbox) {
  /* the area of Intersect(tile, bbox) expressed
     as a percentage of the area of bbox */
  const c = tile.extent;
//  thrower(c);
//  thrower(bbox);

  if (c.x[0] > bbox.x[1]
      || c.x[1] < bbox.x[0]
      || c.y[0] > bbox.y[1]
      || c.y[1] < bbox.y[0]
  ) {

  }

  const intersection = {
    x: [max([bbox.x[0], c.x[0]]),
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
