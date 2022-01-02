/* eslint-disable no-underscore-dangle */
import { range as arange, shuffle, extent } from 'd3-array';
import {
  scaleLinear, scaleSqrt, scaleLog, scaleIdentity, scaleOrdinal,
  scaleSequential, scaleSequentialLog, scaleSequentialPow,
} from 'd3-scale';
import { rgb } from 'd3-color';
import * as d3Chromatic from 'd3-scale-chromatic';
import { encodeFloatsRGBArange } from './util';

const scales : {[key : string] : Function} = {
  sqrt: scaleSqrt,
  log: scaleLog,
  linear: scaleLinear,
  literal: scaleIdentity,
};

const palette_size = 4096;

function to_buffer(data) {
  const output = new Uint8Array(4 * palette_size);
  output.set(data.flat());
  return output;
}

function materialize_color_interplator(interpolator) {
  const rawValues = arange(palette_size).map((i) => {
    const p = rgb(interpolator(i / palette_size));
    return [p.r, p.g, p.b, 255];
  });
  return to_buffer(rawValues);
}

const color_palettes : Record<string, [Number, Number, Number, Number][]> = {
  white: arange(palette_size).map(() => [255, 255, 255, 255]),
};

const schemes = {};
for (const [k, v] of Object.entries(d3Chromatic)) {
  if (k.startsWith('scheme') && typeof (v[0]) === 'string') {
    const colors = new Array(palette_size);
    const scheme = v.map((v) => {
      const col = rgb(v);
      return [col.r, col.g, col.b, 255];
    });
    for (const i of arange(palette_size)) {
      colors[i] = scheme[i % v.length];
    }
    const name = k.replace('scheme', '').toLowerCase();
    color_palettes[name] = to_buffer(colors);
    schemes[name] = v;
  }
  if (k.startsWith('interpolate')) {
    const name = k.replace('interpolate', '').toLowerCase();
    color_palettes[name] = materialize_color_interplator(v);
    if (name === 'rainbow') {
      color_palettes.shufbow = shuffle(color_palettes[name]);
    }
  }
}

function okabe() {
  // Okabe-Ito color scheme.
  const okabe_palette = ['#E69F00', '#CC79A7', '#56B4E9', '#009E73', '#0072B2', '#D55E00', '#F0E442'];
  const colors = new Array(palette_size);
  const scheme = okabe_palette.map((v) => {
    const col = rgb(v);
    return [col.r, col.g, col.b, 255];
  });
  for (const i of arange(palette_size)) {
    colors[i] = scheme[i % okabe_palette.length];
  }
  color_palettes.okabe = to_buffer(colors);
  schemes.okabe = okabe_palette;
}

okabe();

export const default_aesthetics = {
  x: {
    field: 'x',
    constant: 1,
    range: [0, 500],
    transform: 'literal',
  },
  y: {
    field: 'y',
    constant: 1,
    range: [0, 500],
    transform: 'literal',
  },
  x0: {
    constant: 0,
    range: [0, 500],
    transform: 'literal',
  },
  y0: {
    constant: 0,
    range: [0, 500],
    transform: 'literal',
  },
  color: {
    constant: [1, 1, 1],
    range: color_palettes.white,
    transform: 'linear',
  },
  jitter_radius: {
    constant: 0,
    range: [0, 1],
    transform: 'linear',
  },
  jitter_speed: {
    constant: 0,
    range: [0.05, 1],
    transform: 'linear',
  },
  size: {
    constant: 1.5,
    range: [0.5, 5],
    transform: 'sqrt',
  },
  filter1: {
    constant: 1, // Necessary though meaningless.
    range: [0, 1],
    transform: 'linear',
  },
  filter2: {
    constant: 1, // Necessary though meaningless.
    range: [0, 1],
    transform: 'linear',
  },
};

class Aesthetic {
  label : string;
  scatterplot : any;

  constructor(label, scatterplot, regl, tile) {
    this.label = label;
    this.scatterplot = scatterplot;
    this.regl = regl;

    this._domain = this.default_domain;
    this._range = this.default_range;
    this._transform = default_aesthetics[label].transform;
    this.tileSet = tile;

    // A flag that will be turned on and off in AestheticSet.
    this.needs_transitions = true;

    this._domains = {};
  }

  // eslint-disable-next-line class-methods-use-this
  get default_val() {
    return 1;
  }

  get texture_size() {
    return 4096;
  }

  apply(point) {
    return this.scale(this.value_for(point));
  }

  get transform() {
    if (this._transform) return this._transform;
    return default_aesthetics[this.label].transform;
  }

  get default_range() {
    return default_aesthetics[this.label].range;
  }

  get scale() {
    function capitalize(r) {
      return r.charAt(0).toUpperCase() + r.slice(1);
    }
    let scale = scales[this.transform]()
      .domain(this.domain)
      .range(this.range);

    const range = this.range;
    if (typeof(range) == 'string') {
      // Convert range from 'viridis' to InterpolateViridis.

      const interpolator = d3Chromatic["interpolate" + capitalize(range)]
      if (interpolator !== undefined) {
        // linear maps to nothing, but.
        // scaleLinear, and scaleLog but 
        // scaleSequential and scaleSequentialLog. 
        if (this.transform === 'sqrt') {
          return scaleSequentialPow(interpolator)
              .exponent(0.5)
              .domain(this.domain);
        } else if (this.transform === 'log') {
          return scaleSequentialLog(interpolator)
              .domain(this.domain);
        } else {
          return scaleSequential(interpolator)
              .domain(this.domain);
        }
      }
    }
    if (this.is_dictionary()) {
      scale = scaleOrdinal().range(range).domain(this.domain);
      if (schemes[range]) {
        scale.range(schemes[range]).domain(this.column.dictionary.toArray());
      }
    }


    return scale
  }

  get column() {
    return this.tileSet.table.getColumn(this.field);
  }

  _domains: {
    [key: string]: any;
  }

  field: string;

  get default_domain() {
    if (this.field == undefined) {
      return [1, 1];
    }
    if (this._domains[this.field]) {
      return this._domains[this.field];
    }
    // Maybe the table is checked out
    if (!this.tileSet.table) { return [1, 1]; }
    const { column } = this;
    if (column.type.dictionary) {
      this._domains[this.field] = [0, this.texture_size - 1];
    } else {
      this._domains[this.field] = extent(column.toArray());
    }
    return this._domains[this.field];
  }

  default_data() {
    return Array(this.texture_size).fill(this.default_val);
    return encodeFloatsRGBArange(Array(this.texture_size)
      .fill(this.default_val)).array;
  }

  get domain() {
    return this._domain || this.default_domain;
  }

  get range() {
    return this._range || this.default_range;
  }

  value_for(point) {
    const field = this.field || this.partner.field;
    return point[field];
  }

  get texture_buffer() {
    if (this._texture_buffer) {
      return this._texture_buffer;
    }
    this._texture_buffer = new Float32Array(this.texture_size);
    this._texture_buffer.set(this.default_data());
    return this._texture_buffer;
  }

  get textures() {
    if (this._textures) {
      return this._textures;
    }

    this.texture_type = this.regl.hasExtension('OES_texture_float')
      ? 'float' : this.regl.hasExtension('OES_texture_half_float')
        ? 'half float' : 'uint8';

    this.texture_format = this.texture_type === 'uint8' ? 'rgba' : 'alpha';

    const params = {
      width: 1,
      height: this.texture_size,
      type: this.texture_type,
      format: this.texture_format,
      data: this.default_data(),
    };

    // Store the current and the last values for transitions.
    this._textures = {
      one_d: this.regl.texture(params),
    };

    return this._textures;
  }

  key() {
    return this.field + this.domain + this.range + this.transform;
  }

  post_to_regl_buffer(buffer_name) {
    this.textures[buffer_name].subimage({
      data: this.texture_buffer,
      width: 1,
      height: this.texture_size,
    });
  }

  clear() {
    this.texture_buffer.set(this.default_data());
    this.post_to_regl_buffer('one_d');
    this.lookup = undefined;
    this.field = undefined;
    this._domain = undefined;
    this._range = undefined;
    this._transform = undefined;
  }

  get use_lookup() {
    const { lookup } = this;
    return lookup ? 1 : 0;
  }

  get lookup_texture() {
    const { lookup } = this;
    if (lookup === undefined) {
      return {
        texture: this.textures.one_d,
        y_domain: [-1, 1],
        x_domain: [-1, 1],
        z_domain: [-1, 1],
        y_constant: 0,
      };
    }

    const { field } = this;

    // These are the possible elements of the lookup.
    const {
      table, value, y, z,
    } = lookup;

    if (!y.constant) {
      throw 'Only constant lookups for the secondary dimension are currently supported.';
    }

    const dimensions = {
      x: field,
      y: y.field,
      z: z.field,
    };

    const lookup_handler = this.scatterplot.lookup_tables.get(table);

    // Wrap as a function to avoid unnecessary execution. Yuck.
    const x_names = () => this.arrow_column().data.dictionary.toArray();

    let actual_values;
    if (lookup_handler === undefined) {
      actual_values = {
        texture: this.textures.one_d,
        y_domain: [-1, 1],
        z_domain: [-1, 1],
        x_domain: [-1, 1],
      };
    } else {
      actual_values = lookup_handler.get_cached_crosstab_texture(
        dimensions, { x: x_names }, this.regl,
      );
    }
    const {
      texture, z_domain, y_domain, x_domain, shape,
      crosstabs,
    } = actual_values;


    return {
      value: y.constant || 0,
      crosstabs,
      texture,
      shape,
      x_domain,
      y_domain,
      z_domain,
    };
  }

  update(encoding) {
    if (encoding === null) {
      this.clear();
      return;
    }

    if (encoding === undefined) {
      throw 'This should have been removed earlier';
    }

    if (
      (encoding.field === 'x' || encoding.field === 'y')
        && encoding.range) {
      console.warn(`Asked for an x or y range, but it will be automatically
                    set to the window scale.`);
    }

    this.stringversion = JSON.parse(JSON.stringify(encoding));

    if (encoding.field === this.field
        && encoding.op && this.field !== undefined) {
      // op functions don't need any more caching than just the JSON.
      return;
    }

    if (typeof (encoding) === 'string') {
      encoding = parseLambdaString(encoding, false);
      if (this.label.startsWith('filter')) {
        encoding.domain = [-2047, 2047];
      }
    }

    // Numbers or arrays treated as constants.
    if (typeof (encoding) === 'number' || encoding.length) {
      encoding = {
        constant: encoding,
        transform: 'literal',
      };
    }

    if (encoding.lambda && typeof (encoding.lambda) === 'string') {
    // May overwrite 'field!!'
      Object.assign(encoding, parseLambdaString(encoding.lambda, false));
    }

    this.lookup = encoding.lookup;

    this.field = encoding.field;

    this._domain = safe_expand(encoding.domain);
    this._range = safe_expand(encoding.range);

    this._constant = encoding.constant;

    const {
      label,
    } = this;

    const {
      lambda,
      field,
    } = encoding;

    // Store the last and current values.

    // resets to default if undefined

    this._transform = encoding.transform || this.default_transform;

    const {
      range,
      domain,
      transform,
    } = this;

    // Passing a number directly means that all data
    // will simply be represented as that number.
    // Still maybe at the cost of a texture lookup, though.

    // Set up the 'previous' value from whatever's currently
    // being used.

    if (lambda) {
      this.apply_function_to_textures(field, this.domain, lambda);
    } else if (encoding.range) {
      this.encode_for_textures(this.range);
      this.post_to_regl_buffer('one_d');
    }
  }

  encode_for_textures(range) {
    const values = new Array(this.texture_size);
    this.scaleFunc = scales[this.transform]()
      .range(range)
      .domain([0, this.texture_size - 1]);

    for (let i = 0; i < this.texture_size; i += 1) {
      values[i] = this.scaleFunc(i);
    }

    this.texture_buffer.set(values);
  }

  arrow_column() {
    const c = this.tileSet.table.getColumn(this.field);
    if (c === null) {
      throw `No column ${this.field} on arrow table for aesthetic ${this.label}`;
    }
    return c;
  }

  is_dictionary() {
    if (this.field == undefined) {
      return false;
    }
    return this.arrow_column().type.dictionary;
  }

  get constant() {
    return this._constant;
  }

  get use_map_on_regl() {
    if (this.is_dictionary()) {
      if (this.domain[0] === -2047 && this.domain[1] == 2047) {
        return 1;
      }
    }
    return 0;
  }

  apply_function_to_textures(field, range, function_reference) {
    let func;
    if (typeof (function_reference) === 'string') {
      const [name, lambda] = function_reference.split('=>').map((d) => d.trim());
      if (lambda === undefined) {
        func = Function('x', function_reference);
      } else {
        func = Function(name, lambda);
      }
    } else {
      func = function_reference;
    }

    this.scaleFunc = scaleLinear().range(range)
      .domain([0, this.texture_size - 1]);

    let input = arange(this.texture_size);
    if (field === undefined || this.tileSet.table === undefined) {
      this.texture_buffer.set(arange(this.texture_size).map((i) => 1));
      //      this.texture_buffer.set(encodeFloatsRGBA(arange(this.texture_size).map(i => 1)))
      return;
    }
    const { column } = this;

    if (!column) {
      throw (`Column ${field} does not exist on table.`);
    }

    if (column.type.dictionary) {
      // NB--Assumes string type for dictionaries.
      input.fill('');
      const dvals = column.data.dictionary.toArray();
      dvals.forEach((d, i) => { input[i] = d; });
    } else {
      input = input.map((d) => this.scaleFunc(d));
    }

    const values = input.map((i) => func(i));
    this.texture_buffer.set(values);
    this.post_to_regl_buffer('one_d');
  }
}

class Size extends Aesthetic {
  get default_val() { return 1; }
}

class X extends Aesthetic {
  constructor(...args) {
    super(...args);
    this._transform = 'literal';
  }

  get range() {
    return this.tileSet.extent ? this.tileSet.extent.x : [-20, 20];
  }

  get previous_range() {
    return this.range;
  }

  get default_val() { return 1; }
}

class X0 extends X {}

class Y extends X {
  get range() {
    const [min, max] = this.tileSet.extent ? this.tileSet.extent.y : [-20, 20];
    return [max, min];
  }

  get previous_range() {
    return this.range;
  }
}

class Y0 extends Y {}
class Filter extends Aesthetic {
  get default_val() {
    return 1;
  }

  get domain() {
    return this.is_dictionary()
      ? [-2047, 2047] : [0, 1];
  }

  get_function() {
    const input = this.stringversion;

    if (input && input.op) {
      if (input.op == 'gt') {
        return (d) => d > input.a;
      }
      if (input.op == 'lt') {
        return (d) => d < input.a;
      }
      if (input.op == 'eq') {
        return (d) => d == input.a;
      }
      if (input.op == 'within') {
        return (d) => Math.abs(d - input.a) <= input.b;
      }
    }
    if (!this.encoding) {
      return () => true;
    }
    const {
      lambda,
      field,
    } = this.encoding;

    if (!lambda) { return (d) => true; }
    return (d) => lambda(d[field]);
  }

  ops_to_array() {
    const input = this.stringversion;
    if (!input || !input.op) {
      return [0, 0, 0];
    }

    const val = [
      // Encoding of op as number.
      [null, 'lt', 'gt', 'eq', 'within']
        .indexOf(input.op),
      input.a || 0,
      input.b || 0,
    ];
    return val;
  }
}

function safe_expand(range) {
  // the range of a scale can sensibly take several different forms.

  // Usually for a color.
  if (typeof (range) === 'string') {
    return range;
  }

  // If it's a number, put it at both ends of the scale.
  if (typeof(range) === 'number') {
    return [range, range];
  }
  if (range === undefined) {
    // Sketchy.
    return [1, 1];
  }
  // Copy the elements by spreading because a copy-by-reference will
  //
  try {
    return [...range];
  } catch (err) {
    console.warn('No list for range', range);
    return [1, 1];
  }
}

class Filter1 extends Filter {}
class Filter2 extends Filter {}

class Jitter_speed extends Aesthetic {
  get default_val() { return 0.1; }
}

function encode_jitter_to_int(jitter) {
  if (jitter === 'spiral') {
    // animated in a logarithmic spiral.
    return 1;
  } if (jitter === 'uniform') {
    // Static jitter inside a circle
    return 2;
  } if (jitter === 'normal') {
    // Static, normally distributed, standard deviation 1.
    return 3;
  } if (jitter === 'circle') {
    // animated, evenly distributed in a circle with radius 1.
    return 4;
  } if (jitter === 'time') {
    // Cycle in and out.
    return 5;
  }
  return 0;
}

class Jitter_radius extends Aesthetic {
  constructor(...args) {
    super(...args);
    this.method = 'None';
  }

  get default_val() { return 0.05; }

  update(encoding) {
    // The jitter method is buried in here.
    if (typeof (encoding) === 'number') {
      encoding = { constant: encoding };
    }
    if (encoding.method) {
      this.method = encoding.method;
    } else if (this.partner.method) {
      this.method = this.partner.method;
    }

    if (encoding.method === null) {
      this.method = 'None';
    }
    super.update(encoding);
  }

  get jitter_int_format() {
    return encode_jitter_to_int(this.method);
  }
}

class Color extends Aesthetic {
  get default_val() { return [128, 150, 213, 255]; }

  default_data() {
    return color_palettes.viridis;
  }

  get texture_buffer() {
    if (this._texture_buffer) {
      return this._texture_buffer;
    }
    this._texture_buffer = new Uint8Array(this.texture_size * 4);
    this._texture_buffer.set(this.default_data());

    return this._texture_buffer;
  }

  get textures() {
    if (this._textures) { return this._textures; }

    const params = {
      width: 1,
      height: this.texture_size,
      type: 'uint8',
      format: 'rgba',
      data: this.default_data(),
    };
    // Store the current and the last values for transitions.
    this._textures = {
      one_d: this.regl.texture(params),
    };

    this.post_to_regl_buffer('one_d');

    return this._textures;
  }

  get constant() {
    // Perform color conversion.
    if (this._constant === undefined) { return undefined; }
    if (typeof (this._constant) === 'string') {
      const { r, g, b } = rgb(this._constant);
      this._constant = [r / 255, g / 255, b / 255];
      return this._constant;
    }
    return this._constant;
  }

/*  get scale() {
    return this._scale ? this._scale : (x) => 'white';
  } */

  encode_for_textures(range) {
    this._scale = scales[this.transform]().range(range).domain(this.domain);
  
    if (color_palettes[range]) {
      this.texture_buffer.set(color_palettes[range]);
    } else if (range.length === this.texture_size * 4) {
      this.texture_buffer.set(range);
    } else if (range.length && range[0].length && range[0].length === 3) {
      // manually set colors.
      const r = arange(palette_size).map((i) => {
        const [r, g, b] = range[i % range.length];
        return [r, g, b, 255];
      });
      this.texture_buffer.set(r.flat());
    } else {
      console.warn(`request range of ${range} for color ${this.field} unknown`);
    }
  }
}

export const dimensions = {
  Size, Jitter_speed, Jitter_radius, Color, Filter1, Filter2, X, Y, X0, Y0,
};

export class StatefulAesthetic {
  // An aesthetic that tracks two states--current and last.
  // The point is to handle transitions.
  // It might make sense to handle more than two states, but there are
  // diminishing returns.

  constructor(label, scatterplot, regl, tile) {
    this.states = [];
    const lower = label.toLowerCase();
    const Factory = dimensions[label];

    // state 0
    this.states.push(new Factory(lower, scatterplot, regl, tile));
    // state 1
    this.states.push(new Factory(lower, scatterplot, regl, tile));

    const [first, second] = this.states;
    first.partner = second;
    second.partner = first;
    /*    this.states[0].partner = this.states[1];
    this.states[1].partner = this.states[0]; */

    for (const state of this.states) {
      state.update({ constant: default_aesthetics[lower].constant });
    }

    // Allow them to peek at each other.
    this.current_encoding = JSON.stringify(
      { constant: default_aesthetics[lower].constant },
    );
  }

  get current() {
    return this.states[0];
  }

  get last() {
    return this.states[1];
  }

  update(encoding) {
    const stringy = JSON.stringify(encoding);
    // Overwrite the last version.
    if (stringy == this.current_encoding || encoding === undefined) {
      // If an undefined encoding is passed, that means
      // we've seen an update without any change.
      if (this.needs_transitions) {
        // The first one is fine, but we gotta update the *last* one.
        this.states[1].update(JSON.parse(this.current_encoding));
      }
      this.needs_transitions = false;
      return;
    }
    // Flip the current encoding to the second position.
    this.states.reverse();
    this.states[0].update(encoding);
    this.needs_transitions = true;
    this.current_encoding = stringy;
  }
}

function parseLambdaString(lambdastring, materialize = false) {
  // Materialize an arrow function from its string.
  // Note that this *does* reassign 'this'.
  let [field, lambda] = lambdastring.split('=>').map((d) => d.trim());
  if (lambda === undefined) {
    throw `Couldn't parse ${lambdastring} into a function`;
  }

  if (lambda.slice(0, 1) !== '{' && lambda.slice(0, 6) !== 'return') {
    lambda = `return ${lambda}`;
  }

  const func = `${field} => ${lambda}`;

  if (materialize) {
    return Function(field, lambda);
  }

  return {
    field,
    lambda: func,
  };
}
