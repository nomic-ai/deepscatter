import { sum, range as arange, shuffle, extent } from 'd3-array';
import { scaleLinear, scaleSqrt, scaleLog, scaleIdentity } from 'd3-scale'
import { rgb } from 'd3-color';
import { interpolatePuOr, interpolateViridis, interpolateWarm, interpolateCool
 } from 'd3-scale-chromatic';

import * as d3Chromatic from 'd3-scale-chromatic';

const scales = {
  sqrt: scaleSqrt,
  log: scaleLog,
  linear: scaleLinear,
  literal: scaleIdentity
}

const palette_size = 4096

function to_buffer(data) {
  const output = new Uint8Array(4 * palette_size)
  output.set(data.flat())
  return output
}


function materialize_color_interplator(interpolator) {
  const rawValues = arange(palette_size).map(i => {
    const p = rgb(interpolator(i/palette_size));
    return [p.r, p.g, p.b, 255]
  });
  return to_buffer(rawValues)
}

const color_palettes = {}

for (let [k, v] of Object.entries(d3Chromatic)) {
  if (k.startsWith("scheme") && typeof(v[0]) == "string") {
    const colors = new Array(palette_size)
    const scheme = v.map(v => {
      const col = rgb(v)
      return [col.r, col.g, col.b, 255]
    })
    for (let i of arange(palette_size)) {
      colors[i] = scheme[i % v.length]
    }
    const name = k.replace("scheme", "").toLowerCase()

    color_palettes[name] = to_buffer(colors)
  }
  if (k.startsWith("interpolate")) {
    const name = k.replace("interpolate", "").toLowerCase()
    color_palettes[name] = materialize_color_interplator(v)
    if (name == 'rainbow') {
      color_palettes.shufbow = shuffle(color_palettes[name])
    }
  }
}

export const default_aesthetics = {
  "x": {
    range: [-1, 1],
    transform: "literal"
  },
  "y": {
    range: [-1, 1],
    transform: "literal"
  },
  "color": {
    range: color_palettes.viridis,
    transform: "linear"
  },
  "jitter_radius": {
    range: [0, 0.05],
    transform: 'sqrt'
  },
  "jitter_speed": {
    range: [.05, 1],
    transform: "linear"
  },
  "size": {
    range: [.5, 5],
    transform: "sqrt"
  },
  "alpha": {
    range: [0, 1],
    transform: "linear"
  },
  "filter": {
    range: [0, 1],
    transform: "linear"
  }
}

class Aesthetic {

  constructor(label, scatterplot, regl, tile) {
    this.label = label
    this.scatterplot = scatterplot
    this.regl = regl

    this._current_code = undefined;
    this._last_code = undefined;

    this._domain = this.default_domain
    this._last_domain = this.default_domain
    this._range = this.default_data()
    this._transform = default_aesthetics[label]['transform']
    this.tileSet = tile;

    this._domains = {}
    this.create_textures()
  }

  get default_val() {return 1};

  get texture_size() {
    return 4096
  }

  get transform() {
    if (this._transform) return this._transform
    return default_aesthetics[this.label].transform
  }

  get default_range() {
    return default_aesthetics[this.label].range
  }

  get scale() {
    return scales[this.transform]()
      .domain(this.domain)
      .range(this.range)
  }

  get default_domain() {

    if (this.field == undefined) {
      return [1, 1]
    }
    if (this._domains[this.field]) {
      return this._domains[this.field]
    } else {
      // Maybe the table is checked out
      if (!this.tileSet.table) {return [1,1]}
      const column = this.tileSet.table.getColumn(this.field)
      if (column.type.dictionary) {
        this._domains[this.field] = [0, this.texture_size - 1]
      } else {
        this._domains[this.field] = extent(column.toArray())
      }
      return this._domains[this.field]
    }
  }


  get last_domain() {
    return this._last_domain;
  }

  default_data() {
    return encodeFloatsRGBA(Array(this.texture_size)
      .fill(this.default_val))
  }


  get domain() {
    return this._domain || this.default_domain
  }
  get range() {
    return this._range || this.default_range
  }

  get scale() {
    return scales[this.transform]()
      .domain(this.domain)
      .range(this.range)
  }

  value_for(point) {
    return point[this.field];
  }

  create_textures() {

    this.texture_buffer = new Uint8Array(this.texture_size * 4)
    this.texture_buffer.set(this.default_data())

    const params = {
      width: 1,
      height: this.texture_size,
      type: 'uint8',
      format: 'rgba',
      data: this.default_data()
    }

    // Store the current and the last values for transitions.
    this.textures = [
      this.regl.texture(params),
      this.regl.texture(params)
    ]
    this.post_to_regl_buffer(0)
    this.post_to_regl_buffer(1)

    return this.textures;
  }

  summary() {
    console.log(this.label)
    console.log(`  Field : ${this.field}`)
  }

  key() {
    return this.field + this.domain + this.range + this.transform
  }

  post_to_regl_buffer(buffer_index) {
    this.textures[buffer_index].subimage({
      data: this.texture_buffer, width: 1, height: this.texture_size
    })
  }

  get last_field() {
    return this._last_field || this.field
  }

  clear() {
    // cache last values.
    this.post_to_regl_buffer(0);
    this.texture_buffer.set(this.default_data())
    this.post_to_regl_buffer(1)
    this._last_field = this.field
    this._last_transform = this._transform;
    this._last_domain = safe_expand(this.domain);
    this.field = undefined;

    this._domain = undefined;
    this._range = undefined;
    this._transform = undefined;
  }

  update(encoding) {
    if (encoding === null) {
      return this.clear()
    }

    if (encoding === undefined) {
      this.post_to_regl_buffer(0)
      this._last_field = this.field
      this._last_domain = safe_expand(this.domain);
      this._last_transform = this._transform;

      return;
    }

    if (typeof(encoding) == "string") {
      encoding = parseLambdaString(encoding, false)
      if (this.label === 'filter') {
        encoding.domain = [0, this.texture_size - 1]
      }
    }

  if (typeof(encoding) == "numeric") {
    encoding = {
      "field": "ix",
      "domain": [0, 0],
      "range": [encoding, encoding]
    }
  }

  if (encoding.lookup) {
    // These are the possible elements of the lookup.
    const {table, value, filter} = encoding.lookup;
    const key = encoding.field;
    if (key === undefined) {
      console.log
    }
    let filter_func, data_func, key_func;
    const lookup = new Map();

    if (filter) {
      // Pass a function that filters each row.
      filter_func = parseLambdaString(filter, true)
    } else {
      filter_func = () => true
    }
    if (value) {
      data_func = parseLambdaString(value, true)
    } else {
      data_func = function(row) {
        return row[this.label]
      }
    }
    key_func = function(row) {
      // Should allow alternate keys.
      return row[encoding.field]
    }
    const t = this.scatterplot.lookup_tables.get(table);
    for (let row of t) {
      if (!filter_func(row)) {
        continue
      }
      if (Math.random() < -.01) {
        console.log(row)
        console.log(key_func(row))
        console.log(data_func(row))
      }
      lookup.set(key_func(row), data_func(row))
    }
    console.log(lookup)
    encoding.lambda = (value) => {
      if (Math.random() < .01) {console.log(value, lookup.get(value))}
      return this.scale(lookup.get(value))
    }
  }

  if (encoding.lambda && typeof(encoding.lambda) == "string")  {
    // May overwrite 'field!!'
    Object.assign(encoding, parseLambdaString(encoding.lambda, false))
  }
  const {
    label
  } = this;
  
  const {
    lambda,
    field
  } = encoding;


  // Store the last and current values.

  this._last_transform = this._transform;
  this._last_field = this.field
  this.field = field
  this._last_domain = safe_expand(this._domain)
  this._domain = safe_expand(encoding.domain)
  this.last_range = safe_expand(this.range)
  this._range = safe_expand(encoding.range)

  // resets to default if undefined

  /*
  console.log("Last Domain", this.label,
   "domains", this.domain, this.last_domain,
   this.field, this.last_field
  )*/

  this._transform = encoding.transform || this._last_transform;

  if (typeof(encoding) == "number") {
    this._range = [encoding, encoding]
  }

  const {
    range,
    domain,
    transform
  } = this;

  // Passing a number directly means that all data
  // will simply be represented as that number.
  // Still maybe at the cost of a texture lookup, though.

  // Set up the 'previous' value from whatever's currently
  // being used.
  this.post_to_regl_buffer(0)

  if (lambda) {
    this.apply_function_to_textures(field, this.domain, lambda)
  } else {
    this.encode_for_textures(this.range)
  }

  this.post_to_regl_buffer(1)}

  encode_for_textures(range) {

    const values = new Array(this.texture_size);
    this.scaleFunc = scales[this.transform]()
      .range(range)
      .domain([0, this.texture_size - 1])

    for (let i = 0; i < this.texture_size; i += 1) {
      values[i] = this.scaleFunc(i)
    }

    this.texture_buffer.set(
      encodeFloatsRGBA(values, this.texture_buffer)
    );
    
  }

  apply_function_to_textures(field, range, function_reference) {

    let func;
    
    if (typeof(func) == "string") {
      let [name, lambda] = function_reference.split("=>").map(d => d.trim())
      if (lambda == undefined) {
        func = Function("x", function_reference)
      } else {
        func = Function(name, lambda)
      }
    } else {
      func = function_reference
    }
        
    this.scaleFunc = scaleLinear().range(range).domain([0, this.texture_size - 1])
    let input = arange(this.texture_size)
    if (field === undefined || this.tileSet.table == undefined) {
      this.texture_buffer.set(encodeFloatsRGBA(arange(this.texture_size).map(i => 1)))
      return
    }
    const column = this.tileSet.table.getColumn(field)
    if (!column) {
      throw(`Column ${field} does not exist on table.`)
    }

    if (column.type.dictionary) {
      const lookup = this.tileSet.dictionary_lookups[field]
      try {
        input = input.map(d => lookup.get(d))
      } catch(err) {
        console.log(err)
      }
    } else {
      input = input.map(d => this.scaleFunc(d))
    }
    console.log(func)
    const values = input.map(i => +func(i))
    this.texture_buffer.set(encodeFloatsRGBA(values))
  }
}

class Size extends Aesthetic {
  get default_val() {return 1};
}

class X extends Aesthetic {

  constructor(max, ...args) {
    super(...args)
    this.max = max
    this._transform = "literal"
  }

  get range() {
    return [0, this.max]
  }

  get previous_range() {
    return [0, this.max]
  }

  get default_val() {return 0};
}

class Y extends X {
  get range() {
    return [this.max, 0]
  }

  get previous_range() {
    return [this.max, 0]
  }
}

class Alpha extends Aesthetic {
  get default_val() {return 1};
}

class Filter extends Aesthetic {
  get default_val() {
    return 1
  };
}

function safe_expand(range) {
  
  // the range of a scale can sensibly take several different forms.
  
  // Usually for a color.
  if (typeof(range)=="string") {
    return range
  }
  
  // If it's a number, put it at both ends of the scale.
  if (typeof(range)=="numeric") {
    return [range, range]
  }
  if (range === undefined) {
    // Sketchy.
    return [1, 1]
  }
  // Copy the elements by spreading because a copy-by-reference will 
  // 
  try {
    return [...range]
  } catch (err) {
    console.warn("No list for range", range)
    return [1, 1]
  }
}

class Jitter_speed extends Aesthetic {
  get default_val() {return .1};
}

class Jitter_radius extends Aesthetic {
  get default_val() {return .05};
}

class Color extends Aesthetic {

  get default_val() {return [128, 150, 213, 255]}

  default_data() {
    return color_palettes.viridis
  }

  encode_for_textures(range) {

    if (color_palettes[range]) {
      this.texture_buffer.set(color_palettes[range])
    } else if (range.length == this.texture_size * 4) {
      this.texture_buffer.set(range)
    } else {
      console.warn(`${range} unknown`)
    }
  }

}

export default {
  Size, Alpha, Jitter_speed, Jitter_radius, Color, Filter, X, Y
};

// A really stupid way to encode floats into rgb values.
// Stores numbers from -255.98 to 255.98 with a resolution of
// 1/255/255.
function encodeFloatsRGBA(values, array) {
  if (array == undefined) {
    array = new Uint8Array(values.length * 4)
  }
  if (typeof(values[0])=="boolean") {
    // true, false --> 1, 0
    values = values.map(d => +d)
  }
  let p = 0
  for (let value of values) {
    const logged = Math.log(value)
    if (value < 0) {
      array[p] = 1; value = -value;
    } else {
      array[p] = 0
    }
    array[p + 1] = (value % (1/256)) * 256 * 256
    array[p + 2] = (value % 1 - value % (1/256)) * 256
    array[p + 3] = value;
    p += 4
   }
  return array
}/*
float RGBAtoFloat(in vec4 floater) {
  decoder = vec4(-1., 1./255./255., 1./255., 1.]);
  return dot(floater, decoder);
}
*/



function parseLambdaString(lambdastring, materialize = false) {
  // Materialize an arrow function from its string.
  // Note that this *does* reassign 'this'.
  let [field, lambda] = lambdastring.split("=>").map(d => d.trim())
  console.log(lambda)
  if (lambda === undefined) {
    throw `Couldn't parse ${lambdastring} into a function`
  }
  
  if (lambda.slice(0,1) != "{" && lambda.slice(0, 6) != "return") {
    lambda = "return " + lambda
  }
  
  const func = `${field} => ${lambda}`
  
  if (materialize) {
    console.log(field, lambda)
    return Function(field, lambda)
  }
  
  return {
    field: field,
    lambda: func
  }

}
