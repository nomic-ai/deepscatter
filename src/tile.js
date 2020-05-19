import { json as d3Json, csv as d3Csv } from 'd3-fetch';
import { quadtree } from 'd3-quadtree';
import { scaleLinear } from 'd3-scale';
import stringHash from 'string-hash';
import {contourDensity} from 'd3-contour';
import {geoPath} from 'd3-geo';
import {extent, range} from 'd3-array';
// Shouldn't be here, just while contours are.
import {select} from 'd3-selection';
import 'regenerator-runtime/runtime'
import { Table, Dictionary, Vector, Utf8, Int32 } from 'apache-arrow';
// import  Quad  from 'd3-quadtree/src/quad.js'
import ArrowTree from './ArrowTree'


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

    if (this.parent !== undefined) {
      this.keylist = this.parent.keylist
    } else {
      this.keylist = {}
    }

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

  mutate(fieldname, type) {
    const func = function(row) {
      return row.lc1 ? row.lc1.slice(0, 1) : ""
    }

    let output = Array(this._data.length);
    {
      // assume it's a function.
      let i = 0;
      for (let row of this._data) {
        output[i] = func(row)
        i++;
      }
    }
    const vector = Vector.from({
      values: output,
      type: new Dictionary(new Utf8(), new Int32()),
      highWaterMark: Infinity
    })

    // Make output into an Arrow Vector.
    const names =   [...this.table.schema.fields.map(d => d.name), fieldname]
    vector.type.id = names.length
    this.table = Table.new(
      [...this.table.data.childData, vector.data],
      names
    )
    return this.table
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
        .filter(d =>  d._data)
        .map(tile => {
          const f = {
            t: tile,
            iterator: tile.points()
          }
          f.next = f.iterator.next()
          return f
        })
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

  kdtree() {
    if (this._kdtree) {
      return this._kdtree
    }
    if (this._data == undefined) {
      return undefined
    }
    this._kdtree = new ArrowTree(this._data, "x", "y")
    return this._kdtree
  }

  _download() {
    // This should only be called once per tile.
    const url = `${this.url}/tiles/${this.key}.arrow`
    this.promise =
      this.description()
      .then(() => fetch(url))
      .then(resp => resp.arrayBuffer())
      .then(response => {
        return Table.from([new Uint8Array(response)])
      })
      .then(d => {
        this._data = d
        if (this._data.length == 0) {
          return undefined
        }
        // Store a little info on the object.
        this.min_ix = d.getColumn("ix").get(0)
        this.max_ix = d.getColumn("ix").get(d.length - 1)

        // The "table" object may be mutated.
        this.table = this._data

        return this._data


      })
/*      .catch(err => {
        console.warning(err)
        this.min_ix = Infinity;
        this.max_ix = -Infinity;
//        return Promise.resolve([])
}) */
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
        let offset = -1;

        for (let column of columns) {
          // Just an alias for x, y--not passed separately
          if (column == "position") continue
          offset += 1;



          const c = this._data.getColumn(column)
          let row = 0;

          let reverse_lookup = undefined


          if (c.dictionary) {
            reverse_lookup = []
            const keys = c.dictionary.toArray()


            if (this.keylist[column] === undefined) {
              this.keylist[column] = new Map()
            }

            let i = 0;
            for (let k of keys) {
              if (!this.keylist[column].has(k)) {
                this.keylist[column].set(k, this.keylist[column].size)
              }
              reverse_lookup[i++] = this.keylist[column].get(k)
            }
            for (let val of c.data.values) {
              buffer[offset + row * n_col] = reverse_lookup[val]
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
      })
  }

  find_closest(p, dist = Infinity, filter) {
    let my_dist = dist;
    let candidate = undefined;
    const DEBOUNCE = 1/60 * 1000;
    this._last_kdbuild_time = this._last_kdbuild_time || 0;


    this.visit(tile => {
      // Don't visit tiles too far away.
      if (corner_distance(tile.corners, p[0], p[1]) > my_dist) {
        return
      }
      if (tile._data && !tile._kdtree) {
        // Spawn trees on all tiles
        tile.kdtree()
      }
      if (tile._kdtree) { // may not have loaded yet.
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

          // Initialize the attributes field that
          // we share with regl.

          const attributes = {}
          const attr_list = []
          // store position as a vec2.

          // Note that x and y are also registered *separately*.
          // I don't think there's any major cost to this, but who knows.

          let offset = 0;

          for (let field of this._data.schema.fields) {
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

          // Store it both non-asynchronously and asynchronously
          this.__datatypes = attributes;
          return attributes
        })

    return this._datatypes
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
    for (let row of this._data) {
      if (row) {
        yield row
      }
    }

  }

  nth(n) {
    // get the nth row. This is probably possible,
    // but the docs on arrow are so lousy...
    return this._data.get(n)
  }

  [Symbol.iterator]() {
    return this.yielder()
  }
/*
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
*/

}
/*
quadtree.prototype.add_arrow = function(tile, xkey = "x", ykey = "y") {

    // Compute the points and their extent.
  const xz = tile._data.getColumn(xkey).data.values
  const yz = tile._data.getColumn(ykey).data.values

  const [x0, x1] = extent(xz)
  const [y0, y1] = extent(yz)


  // If there were no (valid) points, abort.
  if (x0 > x1 || y0 > y1) return this;

  // Expand the tree to cover the new points.
  this.cover(x0, y0).cover(x1, y1);

  // Add the new points.
  // To fix--using the exposed add function
  // uselessly tries to cover the quadtree each time.
  // Better to import https://github.com/d3/d3-quadtree/blob/9804ee5307efa3822097b3e49de8061555dfe792/src/add.js#L7-L34
  for (let i = 0; i < xz.length; ++i) {
    this.add({x: xz[i], y: yz[i], i: i, parent: tile});
  }

  return this;
}
*/

/*
//D3-quadtree needs numbered accessors.
quadtree.prototype.find2 = function(x, y, radius, filter) {
  var data,
      x0 = this._x0,
      y0 = this._y0,
      x1,
      y1,
      x2,
      y2,
      x3 = this._x1,
      y3 = this._y1,
      quads = [],
      node = this._root,
      q,
      i;

  if (node) quads.push(new Quad(node, x0, y0, x3, y3));
  if (radius == null) radius = Infinity;
  else {
    x0 = x - radius, y0 = y - radius;
    x3 = x + radius, y3 = y + radius;
    radius *= radius;
  }

  while (q = quads.pop()) {

    // Stop searching if this quadrant can’t contain a closer node.
    if (!(node = q.node)
        || (x1 = q.x0) > x3
        || (y1 = q.y0) > y3
        || (x2 = q.x1) < x0
        || (y2 = q.y1) < y0) continue;

    // Bisect the current quadrant.
    if (node.length) {
      var xm = (x1 + x2) / 2,
          ym = (y1 + y2) / 2;

      quads.push(
        new Quad(node[3], xm, ym, x2, y2),
        new Quad(node[2], x1, ym, xm, y2),
        new Quad(node[1], xm, y1, x2, ym),
        new Quad(node[0], x1, y1, xm, ym)
      );

      // Visit the closest quadrant first.
      if (i = (y >= ym) << 1 | (x >= xm)) {
        q = quads[quads.length - 1];
        quads[quads.length - 1] = quads[quads.length - 1 - i];
        quads[quads.length - 1 - i] = q;
      }
    }
    else {
      // Visit this point. (Visiting coincident points is necessary.
      if (node) { // Are there points?
        var dx = x - +this._x.call(null, node.data),
            dy = y - +this._y.call(null, node.data),
            d2 = dx * dx + dy * dy;
        if (d2 < radius) {
          if (filter) {
            // Run the filter function on
            // all coincident points.

            while (true) {
              if (filter(node.data)) {
                continue
              } else {
                node = node.next
                if (node === undefined) {continue}
              }
            }
            if (node === undefined) {continue}
          }
          var d = Math.sqrt(radius = d2);
          x0 = x - d, y0 = y - d;
          x3 = x + d, y3 = y + d;
          data = node.data;
        }
      }
    }
  }

  return data;
}
*/

function corner_distance(corners, x, y) {
  //https://stackoverflow.com/questions/5254838/calculating-distance-between-a-point-and-a-rectangular-box-nearest-point
  var dx = Math.max(corners.x[0] - x, 0, x - corners.x[1]);
  var dy = Math.max(corners.y[0] - y, 0, y - corners.y[1]);
  return Math.sqrt(dx*dx + dy*dy);
}
