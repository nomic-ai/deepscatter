import { json as d3Json, csv as d3Csv } from 'd3-fetch';
import { quadtree } from 'd3-quadtree';
import { scaleLinear } from 'd3-scale';
import stringHash from 'string-hash';

export default class Tile {

  constructor(base_url, key, parent = undefined, image_settings = undefined) {
    this.url = base_url;
    this.parent = parent;
    if (this.parent) {
      this.image_settings = parent.image_settings;
      this.scales = this.parent.scales;
      this.limits = this.parent.limits;
    } else {
      this.scales = {};
    }
    this.key = key || "0/0/0";
    
    this.codes = this.key.split("/").map(t => parseInt(t))
    this.min_ix = undefined;
    this.max_ix = undefined;

    // Start a download process immediately.
    // populates this.promise
    this._download()
    this.underway_promises = new Set(["download"])
    this.class = new.target
  }

  corners() {
    const [d, x, y] = this.codes;
    const t = 2**d;
    return {
      x: [x/t*2 - 1, (x+1)/t*2 - 1],
      y: [(t-y - 1)/t*2 - 1, (t - y)/t*2 - 1]
    }

  }

  is_visible(max_ix, viewport_limits) {
    // viewport_limits is in the webgl scale -1, 1
    // Will typically be got by calling current_corners
    if (this.min_ix == undefined || this.max_ix == undefined) {
      return false
    }
    if (this.min_ix > max_ix) {
      return false;
    }

    const c = this.corners()

    return (
      !(c.x[0] > viewport_limits.x[1] ||
        c.x[1] < viewport_limits.x[0] ||
        c.y[0] > viewport_limits.y[1] ||
        c.y[1] < viewport_limits.y[0]))
    //return has_overlaps(corners, viewport_limits)
  }

  download_to_depth(depth, corners = {"x":[-1, 1], "y": [-1, 1]}) {
    // First, execute the download to populate this.max_ix

    return this.promise.then(() => {
      // If the last point here is less than the target depth, keep going.
      if (this.max_ix < depth & this.is_visible(depth, corners)) {
        // Create the children. (Be careful about this, because a '.children()'
        // call actually generates a bunch of promises.
        const child_processes = this.children()
        // Filter to visible. Newly generated children
        // will return invisible.
              .map(child => child.download_to_depth(depth, corners))
        return Promise.all(child_processes).catch(err => undefined).then(d => this)
      }
      return this;
    })
  }

  description() {
    if (this.parent) {
      return this.parent.description()
    } else {
      if (this._description) {
        return this._description
      } else {
        this._description = d3Json(`${this.url}/data_description.json`)
          .then(d => {
            this.limits = d.limits
            const limits = d.limits
            this.scales.x = scaleLinear().domain(limits[0]).range([-1, 1])

            // Foreign x-y systems are assumed to go bottom to top, not top to bottom.
            this.scales.y = scaleLinear().domain(limits[1]).range([-1, 1])
            return d
          })
        return this._description
      }
    }
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

    const stack = this.parent ? [] : [this]
    const after_stack = []
    let current;
    while (current = stack.pop()) {
      if (!after) {
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

  children() {
    // create or return children.
    if (this._children !== undefined) {
      return this._children;
    }
    this._children = []
    for (const i of [0,1]) {
      for (const j of [0,1]) {
        const key = `${this.codes[0] + 1}/${this.codes[1]*2 + i}/${this.codes[2]*2 + j}`
        this._children.push(new this.class(this.url, key, this, this.image_settings))
      }
    }
    return this._children;
  }

  _download() {
    // This should only be called once per tile.
    const url = `${this.url}/tiles/${this.key}.csv`
    this.promise = this.description()
      .then(() => d3Csv(url))
      .then(d => {
        d.forEach(e => {
          e._position = [
//            +e.x,
//            +e.y
            this.scales.x(e.x),
            this.scales.y(e.y)
          ],
          e.ix = +e.ix
        })
        
        // Store a little info on the object.
        this.min_ix = d[0].ix
        this.max_ix = d[d.length-1].ix

        this._quadtree = quadtree(d, d => d._position[0], d => d._position[1])
        this._data = d
        return this._data
      })
      .catch(err => {
        this.min_ix = Infinity;
        this.max_ix = -Infinity;
        return Promise.resolve([])
      })
  }

  buffer() {
    return Promise.all([this.promise, this.dataTypes()])
      .then(([datalist, datatypes]) => {
        if (!this._buffer) {
          this._buffer = datalist.map(d => this.parse_datum(d, datatypes))
        }
        return this._buffer
      })
  }

  find_closest(p) {
    let dist = Infinity;
    let candidate = undefined;
    this.visit(tile => {
      if (tile._quadtree) { // may not have loaded yet.
        const closest = tile._quadtree.find(p[0], p[1], dist)
        if (closest) {
          const d = Math.sqrt((closest._position[0] - p[0])**2 + (closest._position[1] - p[1])**2)
          candidate = closest;
          dist = d;
        }
      }
    })
    return candidate;
  }

  dataTypes() {
    // Infer datatypes from the first file.

    // It would be amazing to work with typed data, not csv.

    // Also, this whole method is kind of junk. Must be re-inventing the wheel.
    
    if (this.parent) {
      return this.parent.dataTypes()
    }
    if (this._datatypes) {
      return this._datatypes
    }
    this._datatypes = Promise.all([this.description(), this.promise])
      .then(
        ([description, datalist]) => {
          const { fields } = description

          const first_elems = new Map()

          fields
            .forEach(field_name => first_elems.set(field_name, new Set()))
          datalist.forEach(datum => {
            Object.keys(datum).forEach(
              k => {
                if (first_elems.has(k)) {
                  first_elems.get(k).add(datum[k])
                }
              }
            )
          })
          const my_types = [['x', 'float'], ['y', 'float'], ['ix', 'float']]
          for (const [k, v] of first_elems.entries()) {
            if (['x', 'y', 'ix'].indexOf(k) > -1) {
              continue
            }
            if (k == 'word') {
              my_types.push(['char0', 'ascii'])
              my_types.push(['char2', 'ascii'])
              my_types.push(['char4', 'ascii'])                            
//              my_types.push(['char8', 'ascii'])
            }
            if (v.size <= 8) {
              my_types.push([k, "categorical"])
              continue
            }
            const n_floats = [...v.values()].filter(v => v != "").map(parseFloat).filter(d => d).length
            if (n_floats/v.size > .9) {
              my_types.push([k, "float"])
              continue
            }
            
            my_types.push([k, "unknown"])
          }
          return my_types
        })
    return this._datatypes
  }

  parse_datum(datum, datatypes) {
    const out = new Array(datatypes.length);
    let i = 0
    for (const [k, dtype] of datatypes) {
      if (k == 'x') {
        out[i] = datum._position[0]
      } else if (k == 'y') {
        out[i] = datum._position[1]
      } else if (dtype == 'float') {
        out[i] = +datum[k];
      } else if (k.match(/char[0-9]+/)) {
        let code = +(k.replace("char", ""))
        let [one, two] = [code, code + 1].map(i => datum.word.charCodeAt(i))
        if (two > 255) {two = 128}
        out[i] = one * 256 + two;
      } else {
        // Set to an integer hash.
        out[i] = stringHash(datum[k]);
      }
      i += 1
    }
    return out
  }
}
