/* eslint-disable no-underscore-dangle */
import { range as arange, shuffle, extent } from 'd3-array';
import {
  scaleLinear, scaleSqrt, 
  scaleLog, scaleIdentity,
  scaleOrdinal,
  scaleSequential, scaleSequentialLog, 
  scaleSequentialPow,
} from 'd3-scale';
import { rgb } from 'd3-color';
import * as d3Chromatic from 'd3-scale-chromatic';
import { encodeFloatsRGBArange } from './util';
import type Scatterplot from './deepscatter';


import type { Regl, Texture2D } from 'regl';
import type RootTile from './tile';
import {isOpChannel, isLambdaChannel,
   isConstantChannel} from './types';
import type {
  OpChannel, LambdaChannel,
  Channel, BasicChannel, ConstantChannel,
  ConstantColorChannel, ColorChannel, OpArray

} from './types';
import { ArrowJSONLike } from '@apache-arrow/es5-cjs';

const scales : {[key : string] : Function} = {
  sqrt: scaleSqrt,
  log: scaleLog,
  linear: scaleLinear,
  literal: scaleIdentity,
};

const palette_size = 4096;

function to_buffer(data: number[] | number[][]) {
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

const color_palettes : Record<string, Uint8Array> = {
  white: to_buffer(arange(palette_size).map(() => [.5, .5, .5, .5])),
};

const schemes = {};
for (const [k, v] of Object.entries(d3Chromatic)) {
  if (k.startsWith('scheme') && typeof (v[0]) === 'string') {
    const colors = new Array(palette_size);
    //@ts-ignore The startsWith filters this.
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
  schemes['okabe'] = okabe_palette;
}

okabe();

type Transform = "log" | "sqrt" | "linear" | "literal";
interface Default {
  constant : number | number[];
  range : [number, number] | Uint8Array;
  transform : Transform;
}
export const default_aesthetics : Record<string, Default> = {
  x: {
    constant: 1,
    range: [0, 500],
    transform: 'literal',
  },
  y: {
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
    constant: [.5, .5, .5],
    range: color_palettes.viridis,
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
  filter: {
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

abstract class Aesthetic {
  public label : string;
  public scatterplot : Scatterplot;
  public regl : Regl
  public _texture_buffer : Float32Array | Uint8Array | null = null;
  public _domain : [number, number];
  public _range : [number, number] | Uint8Array;
  public _transform : "log" | "sqrt" | "linear" | "literal";
  public tileSet : RootTile;
  public needs_transitions : boolean;
  public partner : Aesthetic | null = null;
  public _textures : Record<string, Texture2D> = {};
  public _constant : any;
  public _scale : Function;
  public texture_type : "float" | "uint8" | "half float" = "float";
  public texture_format : "rgba" | "rgb" | "alpha" = "rgba"
  public current_encoding : BasicChannel | OpChannel | LambdaChannel | ConstantChannel;
  public number : number;
  public _func : (x : any) => any;
  public scaleFunc : (x : number | string) => number;
  public default_val : number | [number, number, number];
  public texture_size = 4096;
  public aes_type: "undefined" | "one_d" | "boolean" | "color" = "undefined" 
  constructor(label : string, scatterplot : Scatterplot, regl : Regl, tile : RootTile, number = -1) {
    this.number = number;
    this.label = label;
    this.scatterplot = scatterplot;
    this.regl = regl;

    this._domain = this.default_domain;
    this._range = this.default_range;
    this._transform = default_aesthetics[label].transform;
    this.tileSet = tile;
    this.aes_type = "undefined";
    // A flag that will be turned on and off in AestheticSet.
    this.needs_transitions = true;

    this._domains = {};
  }
  
  apply(point) {
    // Takes an arrow point and returns the aesthetic value.
    return this.scale(this.value_for(point));
  }

  get transform() {    
    if (this._transform) return this._transform;
    return default_aesthetics[this.label].transform;
  }

  set transform(transform) {
    this._transform = transform;
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
            //@ts-ignore
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
        scale = scaleOrdinal()
          .domain(this.domain);
        if (typeof(range) === "string" && schemes[range]) {
          scale.range(schemes[range]).domain(this.column.dictionary.toArray());
      } else {
        scale.range(this.range)
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
    // Look at the data to determine a reasonable default domain.
    // Cached to _domains.
    if (this.field == undefined) {
      return [1, 1];
    }
    if (this._domains[this.field]) {
      return this._domains[this.field];
    }
    // Maybe the table is checked out
    if (!this.tileSet.table) { return [1, 1]; }
    const { column } = this;
    if (!column) { return [1, 1]; }
    if (column.type.dictionary) {
      this._domains[this.field] = [0, this.texture_size - 1];
    } else {
      this._domains[this.field] = extent(column.toArray());
    }
    return this._domains[this.field];
  }

  default_data() : Uint8Array | Float32Array | Array<number> {
    return Array(this.texture_size).fill(this.default_val);
/*    return encodeFloatsRGBArange(
      Array(this.texture_size)
      .fill(this.default_val)).array;*/
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
    if (this._textures.one_d) {
      return this._textures;
    }

    this.texture_type = this.regl.hasExtension('OES_texture_float')
      ? 'float' : this.regl.hasExtension('OES_texture_half_float')
        ? 'half float' : 'uint8';
//    if (this.label == 'color') console.log("getting textures", this.texture_type)
    this.texture_format = this.texture_type === 'uint8' ? 'rgba' : 'alpha';

    const params = {
      width: 1,
      height: this.texture_size,
      type: this.texture_type,
      format: this.texture_format,
      data: this.default_data(),
    };

    // Store the current and the last values for transitions.
    this._textures.one_d = this.regl.texture(params)

    return this._textures;
  }

  key() {
    return this.field + this.domain + this.range + this.transform;
  }

  post_to_regl_buffer(buffer_name : string) {
    if (this.label==='color') {
//      console.log("POSTING", this.textures, this.texture_buffer)
    }
    this.textures[buffer_name].subimage({
      data: this.texture_buffer,
      width: 1,
      height: this.texture_size,
    });
  }

  convert_string_encoding(channel : string) {
    const v : BasicChannel = {
      field : channel,
      domain : this.default_domain,
      range : this.default_range,
    }
    return v
  }

  complete_domain(encoding : BasicChannel) {
    encoding.domain = encoding.domain || this.default_domain;
    return encoding
  }

  update(encoding : string | BasicChannel | null | ConstantChannel | LambdaChannel | OpChannel) {
    if (encoding === null) {
      this.current_encoding = null;
      return;
    }

    if (typeof(encoding) === 'string') {
      encoding = this.convert_string_encoding(encoding);
    }

//    this.current_encoding = encoding;
    this.current_encoding = JSON.parse(JSON.stringify(encoding));
    
    if (isConstantChannel(encoding)) {
      this._constant = encoding.constant;
      return;
    }

    // Numbers or arrays treated as constants.
    if (typeof (encoding) !== 'object') {
      let x : ConstantChannel = {
        constant: encoding,
      }
      this._constant = x.constant;
      this.current_encoding = x;
      return;
    }

    if (isLambdaChannel(encoding)) {
       this._func = lambda_to_function(encoding);
    }
    if (isOpChannel(encoding)) {
      this._func = op_to_function(encoding)
    }
    this.field = encoding.field;
    if (encoding.domain === undefined) {
      encoding.domain = this.default_domain;
    }

    this._domain = encoding.domain
    this._range = encoding.range;

    const {
      lambda,
      field,
    } = encoding;

    // Store the last and current values.

    // resets to default if undefined

    this._transform = encoding.transform || undefined;


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
    if (this.label === 'color') {
      return 1
    }
    return 0;
  }

  apply_function_to_textures(field, range, function_reference) {
    let func;
    if (typeof (function_reference) === 'string') {
      const [name, lambda, sentinel] = function_reference.split('=>').map((d) => d.trim());
      if (sentinel !== undefined) {
        throw `Can't handle multiple '=>' in function definition`;
      }
      if (lambda === undefined) {
        // Allow functions of 'x'.
        func = Function('x', function_reference);
      } else {
        func = Function(name, lambda);
      }
    } else {
      func = function_reference;
    }
    //@ts-ignore TEMPORARY XXX
    this.scaleFunc = scaleLinear()
      .range(range)
      .domain([0, this.texture_size - 1]);

    let input = arange(this.texture_size);
    if (field === undefined || this.tileSet.table === undefined) {
      console.warning("SETTING EMPTY FIELD")
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

abstract class OneDAesthetic extends Aesthetic {
  public aes_type = "one_d";
  static get default_value() {return 1.5;}
  static get_default_domain() {return [0, 1]}
  static get_default_range() {return [0, 1]}
}

abstract class BooleanAesthetic extends Aesthetic {
  public aes_type = "boolean";
}

class Size extends OneDAesthetic {
 
}

abstract class PositionalAesthetic extends OneDAesthetic {
  constructor(label, scatterplot, regl, tile, number = -1) {
    super(label, scatterplot, regl, tile, number = -1);
    this._transform = 'literal';
  }
  get range() : [number, number] {
    if (this.tileSet.extent && this.tileSet.extent[this.label]) return this.tileSet.extent[this.label] 
    return [-20, 20];
  }
  static get default_val() { return 0; }
}

class X extends PositionalAesthetic {
}

class X0 extends X {}

class Y extends PositionalAesthetic {}

class Y0 extends Y {}

abstract class AbstractFilter extends BooleanAesthetic {
  public current_encoding : LambdaChannel | OpChannel;
  static get default_val() {
    return 1;
  }
  static get default_domain() {
    return [0, 1];
  }
  get domain() {
//    return [-2047, 2047];
    return this.is_dictionary()
      ? [-2047, 2047] : [0, 1];
  }

  ops_to_array() : OpArray {
    const input = this.current_encoding;
    if (input === null) return [0, 0, 0];
    if (!isOpChannel(input)) {
      return [0, 0, 0];
    }
    if (input.op === 'within') {
      return [4, input.a, input.b]
    }
    const val : OpArray = [
      // Encoding of op as number.
      [null, 'lt', 'gt', 'eq']
        .indexOf(input.op),
      input.a,
      0
    ];
    return val;
  }
}


class Filter extends AbstractFilter {}

class Filter2 extends AbstractFilter {}

class Jitter_speed extends Aesthetic {

  constructor(label, scatterplot, regl, tile, number = -1) {
    super(label, scatterplot, regl, tile, number = -1);
    this.default_val = 0.5;
  }

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
  public jitter_int_formatted : 0 | 1 | 2 | 3 | 4 | 5;
  public partner : Jitter_radius ;
  public _method : string;
  constructor(label, scatterplot, regl, tile, number = -1) {
    super(label, scatterplot, regl, tile, number = -1);
    this.default_val = 0.1;
  }

  get method() {
    return this._method || "None";
  }

  set method(value : string) {
    this._method = value;
  }

  update(encoding): void {
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
  public label = 'color';
  public texture_type : "uint8";

  constructor(label, scatterplot, regl, tile, number = -1) {
    super(label, scatterplot, regl, tile, number = -1);
    this.default_val = [0.5, .5, 0.5];
  }
  
  default_data() : Uint8Array {
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
    if (this._textures.one_d) { return this._textures; }

    const params = {
      width: 1,
      height: this.texture_size,
      type: 'uint8',
      format: 'rgba',
      data: this.default_data(),
    };
    // Store the current and the last values for transitions.
    this._textures = {
      // @ts-ignore
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
//      console.log("SETTING BUFFER", r.flat())
    } else {
      console.warn(`request range of ${range} for color ${this.field} unknown`);
    }
  }
}

export const dimensions = {
  Size, Jitter_speed, Jitter_radius, Color, Filter, Filter2, X, Y, X0, Y0,
};

export class StatefulAesthetic {
  // An aesthetic that tracks two states--current and last.
  // The point is to handle transitions.
  // It might make sense to handle more than two states, but there are
  // diminishing returns.
  public states : [Aesthetic, Aesthetic];
  public current_encoding : string;
  public needs_transitions = false;
  public label : string;

  constructor(label , scatterplot, regl, tile) {
    const lower = label.toLowerCase();
    this.label = lower;
    const Factory = dimensions[label];
    // state 0
    const states = []

    states.push(new Factory(lower, scatterplot, regl, tile, 1));
    states.push(new Factory(lower, scatterplot, regl, tile, 2));

    this.states = [
      new Factory(lower, scatterplot, regl, tile, 1),
      new Factory(lower, scatterplot, regl, tile, 2)
    ]
    const [first, second] = this.states;
    first.partner = second;
    second.partner = first;

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

  update(encoding : BasicChannel | ConstantChannel) {
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
    } else {
      // Flip the current encoding to the second position.
      this.states.reverse();
      this.states[0].update(encoding);
      this.needs_transitions = true;
      this.current_encoding = stringy;
    }
  }
}


function parseLambdaString(lambdastring : string) {
  // Materialize an arrow function from its string.
  // Note that this *does* reassign 'field'.
  let [field, lambda] = lambdastring.split('=>').map((d) => d.trim());
  if (lambda === undefined) {
    throw `Couldn't parse ${lambdastring} into a function`;
  }

  if (lambda.slice(0, 1) !== '{' && lambda.slice(0, 6) !== 'return') {
    lambda = `return ${lambda}`;
  }
  const func = `${field} => ${lambda}`;
  return {
    field,
    lambda: func,
  };
}


function safe_expand(range) {
  // the range of a scale can sensibly take several different forms.

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

function op_to_function(input : OpChannel) {
  if (input.op == 'gt') {
    return (d : number) => d > input.a;
  } else if (input.op == 'lt') {
    return (d : number) => d < input.a;
  } else if (input.op == 'eq') {
    return (d : number) => d == input.a;
  } else if (input.op == 'within') {
    return (d : number) => Math.abs(d - input.a) <= input.b;
  }
}

function lambda_to_function(input : LambdaChannel) {
  if (typeof(input.lambda) === 'function') {
    throw "Must pass a string to lambda, not a function."
  }
  const {
    lambda,
    field,
  } = input;
  const cleaned = parseLambdaString(lambda).lambda
  const [arg, code] = cleaned.split('=>', 1).map((d) => d.trim());
  const func = new Function(arg, code)
  return (d) => func(d[field]);
}

