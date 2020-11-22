import { json as d3Json, csv as d3Csv } from 'd3-fetch';
import { quadtree } from 'd3-quadtree';
import { scaleLinear } from 'd3-scale';
import {contourDensity} from 'd3-contour';
import {geoPath} from 'd3-geo';
import {extent, range, shuffle, group, rollup, bisectLeft} from 'd3-array';
// Shouldn't be here, just while contours are.
import {select} from 'd3-selection';
import 'regenerator-runtime/runtime'
import { Table, Column, Dictionary, Vector, Utf8, Int32, Float32Vector } from 'apache-arrow';
import ArrowTree from './ArrowTree';
import * as Comlink from 'comlink';
import Counter from './Counter';

class BaseTile {
  // Can this usefully do anything?
}

class Tile extends BaseTile {

  constructor(base_url, key, parent = undefined, prefs) {
    // Accepts prefs only for the case of the root tile.
    super()
    this.url = base_url;
    this.parent = parent;
    if (parent === undefined) {
      this._mutations = prefs.mutate
    }
    this.key = key
    this.codes = this.key.split("/").map(t => parseInt(t))
    this.min_ix = undefined;
    this.max_ix = undefined;

    this.promise = Promise.resolve(1)
    // Start a download process immediately.
    // populates this.download
    this.extend_promise(() => this.download())

    this.class = new.target
  }


  get dictionary_lookups() {
    return this.parent.dictionary_lookups
  }


  smoothed_density_estimates(depth, width = 128, height = 128) {
    // Not implemented.
    // The idea is to use a Gaussian blur on

    const n_pixels = width * height;

    const rawValues = new Uint16Array(new ArrayBuffer(2 * width * height));

    for (let row of this.values()) {
      // set the relevant pixel of count += 1
    }
  }


  is_visible(max_ix, viewport_limits) {
    // viewport_limits is in coordinate points.
    // Will typically be got by calling current_corners.

    // Top tile is always visible (even if offscreen).
    // if (!this.parent) {return true}

    if (this.min_ix == undefined || this.max_ix == undefined) {
      return false
    }
    if (this.min_ix > max_ix) {
      return false;
    }

    if (viewport_limits === undefined) {
      return false
    }
    const c = this.extent;
    return (
      !(c.x[0] > viewport_limits.x[1] ||
        c.x[1] < viewport_limits.x[0] ||
        c.y[0] > viewport_limits.y[1] ||
        c.y[1] < viewport_limits.y[0]))

  }

  download_to_depth(depth, corners = {"x":[-1, 1], "y": [-1, 1]}, recurse=false) {
    // First, execute the download to populate this.max_ix
    if (this.max_ix < depth && this.is_visible(depth, corners) && !recurse) {
        return this.children().map(child => child.download_to_depth(depth, corners, false))
    }

    return this.download()
    .then(_ => {
      // If the last point here is less than the target depth, keep going.
      if (this.max_ix < depth &&
        this.is_visible(depth, corners) && recurse
      ) {
        // Create the children. (Be careful about this, because a '.children()'
        // call actually generates a bunch of fetch promises.
        const child_processes = this.children()
        // Filter to visible. Newly generated children
        // will return invisible.
              .map(child => child.download_to_depth(depth, corners))
        return Promise.all(child_processes)
          // .catch(err => undefined)
          .then(d => this)
      }
      return this;
    })
  }

  get tileWorker() {
    // Bubbles up to grab one from the root tile.
    return this.parent.tileWorker
  }

  get needed_mutations() {

    this._current_mutations = this._current_mutations || {}

    const needed = {}

    for (let [k, v] of Object.entries(this.mutations)) {
      // Shallow copy to avoid overwriting.
      const current = this._current_mutations[k];
      if (v != current) {
        needed[k] = v
      }
    }

    return needed
  }


  apply_mutations_once() {
    // Default to a resolved promise; if work is required,
    // it will be populated.

    const {needed_mutations} = this;

    let new_promise;

    if (Object.keys(needed_mutations).length === 0) {
      return Promise.resolve("complete")
    }

    if (needed_mutations === undefined) {
      return Promise.resolve("deferred")
    }

    return this.extend_promise(() => {
      // Nuke the table
      this._table = undefined;
      console.log("Posting", ...Object.keys(needed_mutations), "on", this.key)
      return this.tileWorker
        .run_transforms(
          needed_mutations, Comlink.transfer(this._table_buffer, [this._table_buffer])
        )
      .then( ([buffer, codes]) => {
        // console.log(`Off location operation took ${Date.now() - start}ms on ${this.key}`)
        this._table_buffer = buffer;
        Object.assign(this._current_mutations, needed_mutations)

        this.local_dictionary_lookups = codes
        this.update_master_dictionary_lookups()

        return "changed"
      })
      })

  }



  *points(bounding = undefined, sorted = false) {

    for (let p of this) {
      if (p_in_rect(bounding)) {
        yield p
      }
    }

    if (this._children) {
      let children = this._children
        .filter(d => d.table && (bounding === undefined || d.is_visible(1e100, bounding)))
        .map(tile => {
          const f = {
            t: tile,
            iterator: tile.points()
          }
          f.next = f.iterator.next()
          return f
        })
      if (!sorted) {
        for (const child of this._children) {
          if (!child.ready) {
            continue
          }
          for (const p of child.points(bounding, sorted)) {
            yield p
          }
        }
      } else {
        children.sort((a,b) => a.next.value.ix - b.next.value.ix)
        if (children) {
          while (children.length > 0) {
            if (children[0].next.done) {
                children = children.slice(1)
              } else {
                children.sort((a,b) => a.next.value.ix - b.next.value.ix)
                if (p_in_rect(children[0].next, bounding)) {
                  yield children[0].next
                }
                children[0].next = children[0].iterator.next()
              }
            }
        }
      }
    }
}

  forEach(callback) {
    for (let p of this.points()) {
      if (p === undefined) {
        continue
      }
      callback(p)
    }
  }

  children() {
    // create or return children.
    if (this._children !== undefined) {
      return this._children;
    }
    this._children = []

      for (let key of this.child_locations) {
        this._children.push(new this.class(this.url, key, this))
      }
      //}
    //}
    return this._children;
  }

  /*kdtree() {
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

    if (this._table) {return this._table}
    // Constitute table if there's a present buffer.
    if (this._table_buffer && this._table_buffer.byteLength > 0) {
      return this._table = Table.from(this._table_buffer)
    } else {
      return undefined
    }

  }

  download() {
    // This should only be called once per tile.
    if (this._download) {return this._download}

    if (this._already_called) {
      throw("Illegally attempting to download twice")
    }
    this._already_called = true;

    const url = `${window.location.origin}/${this.url}/${this.key}.feather`

    this._download = this.tileWorker
        .fetch(url, this.needed_mutations)
        .then(([buffer, metadata, codes]) => {
          // metadata is passed separately b/c I dont know
          // how to fix it on the table in javascript, just python.
          this._current_mutations = JSON.parse(JSON.stringify(this.needed_mutations))
          this._table_buffer = buffer
          this.extent = JSON.parse(metadata.get("extent"));
          this.child_locations = JSON.parse(metadata.get("children"))
          this.min_ix = this.table.getColumn("ix").get(0)
          this.max_ix = this.table.getColumn("ix").get(this.table.length - 1)
          this._current_mutations = JSON.parse(JSON.stringify(this.needed_mutations))
          this.setDataTypes()

          this.local_dictionary_lookups = codes
          this.update_master_dictionary_lookups()

          return this.table
        })
    return this._download
  }


  extend_promise(callback) {
    this.promise = this.promise.then(() => callback())
    return this.promise
  }

  get ready() {
    // The flag for readiness is whether there is
    // an arraybuffer at this._table_buffer

    // Unlike 'promise,' this returns asychronously
    return this._table_buffer && this._table_buffer.byteLength > 0
  }

  /*buffer() {
    const table = this.table

    if (table == undefined) {return undefined}
    if (this._buffer) {
      return this._buffer;
    }

    const columns = Object.keys(this._datatypes);
    // One fewer than columns.length because
    // we double count position, x, and y.

    // and over-allocate 4 floats for characters, etc.
    const n_col = (columns.length - 1);
    const buffer = new Float32Array(n_col * table.length);
    let offset = -1;

    for (let column of columns) {
      // Just an alias for x, y--not passed separately
      if (column == "position") continue

      offset += 1;

      const c = table.getColumn(column)
      let row = 0;

      let reverse_lookup = undefined

      if (c.dictionary) {
        for (let val of c.data.values) {
          const char_value = this.local_dictionary_lookups[column].get(val)
          buffer[offset + row * n_col] = this.dictionary_lookups[column].get(char_value)
          row += 1;
        }
      } else {
        for (let val of c.data.values) {
          buffer[offset + row * n_col] = val;
          row += 1;
        }
      }
    }
    this._buffer = buffer
    return buffer
  }*/

  find_closest(p, dist = Infinity, filter) {
    let my_dist = dist;
    let candidate = undefined;

    /*
    const DEBOUNCE = 1/60 * 1000;
    this._last_kdbuild_time = this._last_kdbuild_time || 0;
    */

    this.visit(tile => {
      // Don't visit tiles too far away.
      if (corner_distance(tile.extent, p[0], p[1]) > my_dist) {
        return
      }
      if (!tile._kdtree) {
        // Spawn trees on all tiles we need,
        // even if they're not populated yet.
        tile.kdtree()
      }
      if (tile._kdtree) { // may not have loaded yet; if not, ignored.
        const closest = tile._kdtree.find(p[0], p[1], my_dist, filter);
        if (closest) {
          const d = Math.sqrt((closest.x - p[0])**2 + (closest.y - p[1])**2)
          candidate = closest;
          my_dist = d;
        }
      }
    })

    return candidate;
  }

  setDataTypes() {
    // Infer datatypes from the first file.

    const attributes = {}
    const attr_list = []


    // Note that x and y are also registered *separately*.
    // I don't think there's any major cost to this, but who knows.

    let offset = 0;
    const table = this.table
    for (let field of table.schema.fields) {
      const { name, type, nullable} = field
      if (type && type.typeId == 5) {
        // character
        continue
      }
      attributes[name] = {
        offset: offset * 4,
        // Everything is packed as a float.
        dtype: 'float',
        name: name
      }
      attr_list.push(attributes[name])
      offset++;
    }

    attributes['position'] = {
      offset: attributes['x']['offset'],
      dtype: "vec2",
      name: "position",
    }

    attr_list.push(attributes['position'])

    // Whatever number we've come up with is the stride.
    attr_list.forEach(attr => {
      attr.stride = (attr_list.length - 1) * 4
    })

    if (attributes.x.offset != (attributes.y.offset - 4)) {
      console.error("PLOTTING IS BROKEN BECAUSE X AND Y ARE NOT IN ORDER")
    }

    // store position as a vec2.

    // Store it both non-asynchronously and asynchronously
    this._datatypes = attributes;
  }

  *yielder() {

    /*const batch_size = 1000;
    const field_names = this.table.schema.fields.map(d => d.name)
    const yieldable = new Object()
    for (let field_name of field_names) {
      yieldable[field_name] = undefined
    }

    let start_ix = 0;
    while (start_ix < this.table.length) {
      const buffer = {}
      for (let col of range(field_names.length)) {
        buffer[field_names[col]] = this.table.getColumnAt(col).slice(start_ix, start_ix + batch_size).toArray()
      }
      for (let i of range(buffer.ix.length)) {
        for (let j of range(field_names.length)) {
          yieldable[field_names[j]] = buffer[field_names[j]][i]
        }
        yield yieldable
      }
      start_ix
    }
    map._root._data.getColumnAt(3).toArray()
    */
    for (let row of this.table) {
      if (row) {
        yield row
      }
    }

  }

  update_master_dictionary_lookups() {
    const fields = this.local_dictionary_lookups;
    for (let [fieldname, dictionary] of Object.entries(fields)) {
      // Create lookup if needed.
      this.dictionary_lookups[fieldname] = this.dictionary_lookups[fieldname] || new Map()
      let map = this.dictionary_lookups[fieldname]
      let ix = 0;
      for (let [index, textvalue] of dictionary.entries()) {
        if (!map.has(textvalue)) {
          // Since double-storing, the next highest index is double the length.
          ix = map.size/2

          // safe to go both ways at once because one is a string and
          // the other an int.
          map.set(ix, textvalue)
          map.set(textvalue, ix)
        }
        this.dictionary_lookups[fieldname]
      }
    }
    this.dictionary_lookups
  }

  get mutations() {
    return this.parent.mutations
  }

  [Symbol.iterator]() {
    return this.yielder()
  }



  count(...category_names) {
    const cols = []
    for (const k of category_names) {
       cols.push(this.table.getColumn(k))
    }
    const counts = new Counter()
    for (let i = 0; i < this.table.length; i++) {
      const k = cols.map(d => d.get(i))
      counts.inc(...k)
    }
    return counts
  }

}



export default class RootTile extends Tile {
  // The parent tile carries some data for the full set.
  // For clarity, I keep those elements in this class.

  constructor(base_url, prefs = {}) {

    let key;

    if (base_url.match(/(\/[0-9]+){3}/)) {
      const sections = base_url.split("/")
      base_url = sections.slice(0, -3).join("/")
      // this.codes = sections.slice(-3).map(d => parseInt(d))
      key = sections.slice(-3).join("/")
    } else {
      key = "0/0/0"
      //this.codes = [0, 0, 0]
    }
    console.log(base_url, key, undefined, prefs)
    super(base_url, key, undefined, prefs)

  }

  children() {
    // create or return children.
    if (this._children !== undefined) {
      return this._children;
    }
    this._children = []

    for (let key of this.child_locations) {
      this._children.push(new Tile(this.url, key, this))
    }
    return this._children
  }

  get mutations() {
    return this._mutations ?
      this._mutations : this._mutations = {}
  }

  findPoint(ix) {
    let row;
    window.bisectLeft = bisectLeft;
    return this
      .map(t => t)
      .filter(t => t.table && t.min_ix < ix && t.max_ix > ix)
      .map(t => {
        const mid = bisectLeft(t.table.getColumn("ix").data.values, ix);
        if (t.table.get(mid).ix == ix) {
          return t.table.get(mid)
        } else {
          return null
        }
      })
      .filter(d => d)
  }

  apply_mutations(function_map, synchronous = false) {

    // For each, get the tile and a reference to the promise.

    // The returned promise is a string that tells
    // if the mutation was applied.

    Object.assign(this.mutations, function_map)
    const all = this.map(tile => tile.apply_mutations_once(function_map))
    if (synchronous) {
      return all
    } else {
      return Promise.all(all)
    }

  }

  get dictionary_lookups() {
    return this._dictionary_lookups ? this._dictionary_lookups : this._dictionary_lookups = {}
  }

  count_values(...category_names) {
    const counts = new Counter()

    this.map(tile => {
      console.log(tile.key)
      counts.merge(tile.count(...category_names))
    })

    return counts.values()

  }

  get tileWorker() {
    const NUM_WORKERS = 8
    if (this._tileWorkers !== undefined) {
      // Apportion the workers randomly whener one is asked for.
      // Might be a way to have a promise queue that's a little more
      // orderly.
      this._tileWorkers.unshift(this._tileWorkers.pop())
      return this._tileWorkers[0]
    }
    this._tileWorkers = []
    for (let i of range(NUM_WORKERS)) {
      console.log(`Allocating worker ${i}`)
      this._tileWorkers.push(
        Comlink.wrap(new Worker('./tileworker.worker.js', { type: 'module' }))
      )
    }

    return this._tileWorkers[0]

  }

  map(callback, after = false) {
    // perform a function on each tile and return the values in order.
    const q = [];
    this.visit(d => {q.push(callback(d))}, after = after)
    return q
  }

  visit(callback, after = false) {
    // Visit all children with a callback function.
    // The general architecture here is taken from the
    // d3 quadtree functions. That's why, for example, it doesn't
    // recurse.

    const stack = [this]
    const after_stack = []
    let current;
    while (current = stack.shift()) {
      if ( !after ) {
        callback(current)
      } else {
        after_stack.push(current)
      }

      // Only walk actually existing children; don't create new ones.
      if (current._children) {
        stack.push(...current._children)
      }
    }
    if (after) {
      while (current = after_stack.pop()) {
        callback(current)
      }
    }
  }
}

function setsAreEqual(a, b) {

  return a.size === b.size && [...a].every(value => b.has(value))
}


function corner_distance(corners, x, y) {
  if (corners === undefined) {
    return parseFloat("inf")
  }
  //https://stackoverflow.com/questions/5254838/calculating-distance-between-a-point-and-a-rectangular-box-nearest-point
  var dx = Math.max(corners.x[0] - x, 0, x - corners.x[1]);
  var dy = Math.max(corners.y[0] - y, 0, y - corners.y[1]);
  return Math.sqrt(dx*dx + dy*dy);
}


function p_in_rect(p, rect) {
    if (rect === undefined) {return true}
    const c = rect;
    return ( p[0] < rect.x[1] &&
             p[0] > rect.x[0] &&
             p[1] < rect.y[1] &&
             p[1] > rect.y[0])
}
