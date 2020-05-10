import { json as d3Json, csv as d3Csv } from 'd3-fetch';
import { quadtree } from 'd3-quadtree';
import { scaleLinear } from 'd3-scale';
import stringHash from 'string-hash';
import {contourDensity} from 'd3-contour';
import {geoPath} from 'd3-geo';
// Shouldn't be here, just while contours are.
import {select} from 'd3-selection';
import 'regenerator-runtime/runtime'

export default class Tile {

  constructor(base_url, key, parent = undefined, image_settings = undefined) {
    this.url = base_url;
    this.parent = parent;
    if (this.parent) {
      this.image_settings = parent.image_settings;
      this.limits = this.parent.limits;
    }

    this.key = key || "0/0/0";
    this.codes = this.key.split("/").map(t => parseInt(t))
    this.min_ix = undefined;
    this.max_ix = undefined;

    this.corners = {
      x: [Infinity, -Infinity],
      y: [Infinity, -Infinity]
    }

    // Start a download process immediately.
    // populates this.promise
    this._download()

    this.underway_promises = new Set(["download"])

    this.class = new.target
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

    if (this.corners.x[0] == Infinity) {
      this.set_corners()
    }

    const c = this.corners;

    return (
      !(c.x[0] > viewport_limits.x[1] ||
        c.x[1] < viewport_limits.x[0] ||
        c.y[0] > viewport_limits.y[1] ||
        c.y[1] < viewport_limits.y[0]))

  }

  download_to_depth(depth, corners = {"x":[-1, 1], "y": [-1, 1]}) {
    // First, execute the download to populate this.max_ix

    return Promise.all([this.promise, this.description()])
    .then(([data, description]) => {
      // If the last point here is less than the target depth, keep going.
      if (this.max_ix < depth &&
        this.is_visible(depth, corners) &&
        data.length == description.tileSize
      ) {
        // Create the children. (Be careful about this, because a '.children()'
        // call actually generates a bunch of promises.
        const child_processes = this.children()
        // Filter to visible. Newly generated children
        // will return invisible.
              .map(child => child.download_to_depth(depth, corners))
        return Promise.all(child_processes)
        .catch(err => undefined).then(d => this)
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

            this.limits =
              {
                x: d.limits[0],
                y: d.limits[1]
              }
            const limits = d.limits
            // The ranges are not set here; because that's
            // for the interaction elements to understand.
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

  update_visibility_buffer(
    viewport, filters, max_time = 5, max_ix = 0,
    original_start_time, recursive = true
  ) {

    // A tile stores a float32 array of 1 or zero about
    // whether it is currently visible.

    // viewport: corners in dataspace as returned by
    // scattershot.zoom.current_corners()

    // filters: a map to functions. The keys to the filter map
    // are used to determine if the function has already
    // been applied.

    // max_time: unused, optimization parameter.

    // max_ix; the greatest depth to plot.

    // original_start: used to make sure the filtering
    // isn't taking too long. Unimplemented.

    // recursive: apply this to children. If so, each child
    // is done one tick ('requestAnimationFrame') after the current one.
    const original_start = original_start_time || Date.now();
    let start_time = original_start;
    const filter_names = new Set(Array.from(filters.keys()));
    // https://stackoverflow.com/questions/31128855/comparing-ecma6-sets-for-equality
    if (!this._data || !this._data.length || !this.is_visible(max_ix, viewport)) {
      return
      // Note--without bothering to update the buffers or the children.
    }

    // allocated once.
    this.visibility_buffer = this.visibility_buffer ||
        new Float32Array(this._data.length);

    const isSetsEqual = (a, b) => a.size === b.size && [...a].every(value => b.has(value));

    this.current_filters = this.current_filters || new Set();

    // https://stackoverflow.com/questions/31128855/comparing-ecma6-sets-for-equality
    if (!isSetsEqual(this.current_filters, filter_names) && this._regl_elements) {
      // Only update if the filters have different names.
      // but still update the children at the end.

      // The next start point to write to.
      let start_next_flush_at = 0;
      let i = 0;
      for (let datum of this) {
        if (Array.from(filters.values()).every(func => func(datum))) {
          this.visibility_buffer[i] = 1.0;
        } else {
          this.visibility_buffer[i] = 0.0;
        }
        /* A decent idea about splitting up inside this code.
        if (false && Date.now() - start_time > max_time) {
          tile._regl_elements.visibility
          .subdata(
          values.slice(start_next_flush_at, i + 1),
          start_next_flush_at)
            console.log("buffering")
          window.requestAnimationFrame(d => undefined)
          start_next_flush_at = i + 1 // the next start point.
          start_time = Date.now()
        }
        */
        i++;
      }

      // A REGL method that doesn't belong in this file.
      // The logic should be handled in regl_rendering.js
      // XXX
      if (this._regl_elements) {
        this._regl_elements.visibility
        .subdata(this.visibility_buffer, 0)
      }

      this.current_filters = filter_names;
      this.last_update_time = Date.now()
      this.update_filter_promise_status = "completed"
    }

    if (recursive && this._children) {
    for (const child of this._children) {

      // Could only request the animation frame if
      // the start time has been a while. But I don't.

      window.requestAnimationFrame(() => {
        child.update_visibility_buffer(
        viewport, filters, max_time, max_ix,
        original_start_time)
      })
    }
    }
  }

  *points() {

    for (let p of this) {
      yield p
    }


    if (this._children) {
      let children = this._children
        .filter(d=>d)
        .map(tile => {
          const f = {
            t: tile,
            iterator: tile.points()
          }
          f.next = f.iterator.next()
          return f
        }).filter(
          d => d._data
        )

      children.sort((a,b) => a.next.value.ix - b.next.value.ix)

      if (children) {
        while (children.length > 0) {
          if (children[0].next.done) {
              children = children.slice(1)
            } else {
              children.sort((a,b) => a.next.value.ix - b.next.value.ix)
              yield children[0].next
              children[0].next = children[0].iterator.next()
            }
          }
      }
    }
}

  forEach(callback) {
    for (let p of this.points()) {
      // console.log(p)
      if (p === undefined) {
        continue
      }
      callback(p)
    }
  }

  contours(drawTo) {

    const {x_, y_} = this._zoom.scales();
    const {width, height} = this._zoom;
    const contours = contourDensity()
    .x(d=>x_(d.x))
    .y(d=>y_(d.y))
    .size([width, height])
    (this)
    const drawTwo = drawTo || select("body");

    const svg = drawTwo.select("svg")

    svg.append("g")
      .attr("fill", "none")
      .attr("stroke", "steelblue")
      .attr("stroke-linejoin", "round")
      .selectAll("path")
      .data(contours)
      .join("path")
      .attr("stroke-width", (d, i) => i % 5 ? 0.25 : 1)
      .attr("d", geoPath());

    const renderer = {
      tick: () => svg.attr("transform", this._zoom.transform)
    }

    this._zoom.renderers.set("contours", renderer)

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

  set_corners() {
    // Can't run until the parent's
    // limits are loaded.

    // Use the limits to determine
    // what the quad tiles actually indicate
    // in terms of data.

    // Note that these are not the actual
    // data corners; they can't be, because
    // a *child* tile of this one
    // might be visible even if this one
    // isn't.

    const [d, x, y] = this.codes;
    const t = 2**d;
    const zero_one_space_limits =  {
      x: [x/t, (x+1)/t],
      y: [y/t, (y+1)/t],
    }

    for (let axis of ['x', 'y']) {

      const scale = scaleLinear()
            .domain([0, 1])
            .range(this.limits[axis])

      this.corners[axis] =
        zero_one_space_limits[axis].map( d => scale(d)

        )
    }
  }
  _download() {
    // This should only be called once per tile.
    const url = `${this.url}/tiles/${this.key}.csv`
    this.promise =
      this.description()
      .then(() => d3Csv(url))
      .then(d => {
        d.forEach(e => {
          e._position = [
            +e.x,
            +e.y
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

        if (this._buffer) {
          return Promise.resolve(this._buffer);
        }

        const columns = Object.keys(datatypes);

        // One fewer than columns.length because
        // we double count position, x, and y.

        // and over-allocate 4 floats for characters, etc.
        const n_col = (columns.length - 1);
        const buffer = new Float32Array(n_col * datalist.length);

        let offset = 0;
        for (let d of datalist) {
          this.parse_datum(d, datatypes, buffer, offset);
          offset += n_col;
        }
        this._buffer = buffer
        return buffer
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
      return this.parent.dataTypes().then( d => {this.__datatypes = d; return d})
    }
    if (this._datatypes) {
      return this._datatypes
    }
    this._datatypes = Promise.all([this.description(), this.promise])
      .then(
        ([description, datalist]) => {
          let { fields } = description
          fields = [...fields]
          fields.push("flexbuff1")
          fields.push("flexbuff2")
          fields.push("flexbuff3")
          fields.push("flexbuff4")

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

          // Initialize the attributes field that
          // we share with regl.

          const attributes = {}

          // store position as a vec2.

          // Note that x and y are also registered *separately*.
          // I don't think there's any major cost to this, but who knows.

          fields.forEach((k, i) => {

            const v = first_elems.get(k);

            attributes[k] = {
              offset: i * 4,
              stride: fields.length * 4
            }

            if (k.startsWith("flexbuff")) {
              attributes[k].dtype = "float";
              return
            }

            const n_floats = [...v.values()]
              .filter(v => v != "")
              .map(parseFloat)
              .filter(d => d)
              .length

            if (n_floats/v.size > .5) {
              attributes[k].dtype = "float";
              return
            }

            if (v.size <= 32) {
              attributes[k].dtype = "categorical"
              return
            }

            attributes[k].dtype = "unknown";
          })

          attributes['position'] = {
            stride: fields.length * 4,
            offset: attributes['x']['offset'],
            dtype: "vec2"
          }

          if (attributes.x.offset != (attributes.y.offset - 4)) {
            console.error("PLOTTING IS BROKEN BECAUSE X AND Y ARE NOT IN ORDER")
          }

          // Store it both non-asynchronously and asynchronously
          this.__datatypes = attributes;
          return attributes
        })

    return this._datatypes
  }

  [Symbol.iterator]() {
     let i = 0;
     return {
       next: () => {
         if (this._data && i < this._data.length) {
           return {value: this._data[i++], done: false}
         } else {
           return {done: true}
         }
       }
     }
  }

  parse_datum(datum, datatypes, buffer, offset) {
    // Optionally can write *in place* to an array buffer
    // at an offset described by offset. This is strongly preferred.
    // If not, it will simply write to a new js array.

    const out = buffer || new Array(datatypes.length);
    let ix = offset || 0;
    for (const [k, description] of Object.entries(datatypes)) {

      if (k == 'position') {
        continue
      }  else if (k.startsWith("flexbuff")) {
        out[ix] = 0
      } else if (description.dtype == 'float') {
        out[ix] = +datum[k];
      } else {
        // Set to an integer hash.
        out[ix] = stringHash(datum[k]);
      }
      ix += 1
    }


    return out
  }
}
