/* eslint-disable no-underscore-dangle */
import { range as arange, extent, shuffler } from 'd3-array';
import { randomLcg } from 'd3-random';
import {
  scaleLinear,
  scaleSqrt,
  scaleLog,
  scaleIdentity,
  scaleOrdinal,
  scaleSequential,
  scaleSequentialLog,
  scaleSequentialPow,
  scaleImplicit,
} from 'd3-scale';
import { rgb } from 'd3-color';
import * as d3Chromatic from 'd3-scale-chromatic';
import type Scatterplot from './deepscatter';
import type { Regl, Texture2D } from 'regl';
import type { TextureSet } from './AestheticSet';
import { isOpChannel, isLambdaChannel, isConstantChannel } from './types';
import type {
  OpChannel,
  LambdaChannel,
  Channel,
  BasicChannel,
  ConstantChannel,
  ColorChannel,
  OpArray,
} from './types';
import type { Dataset, QuadtileSet } from './Dataset';
import { Vector, tableToIPC, makeVector } from 'apache-arrow';
import { StructRowProxy } from 'apache-arrow/row/struct';
import { Tile } from './tile';

const scales: Record<
  string,
  typeof scaleSqrt | typeof scaleLog | typeof scaleLinear | typeof scaleIdentity
> = {
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
function materialize_color_interplator(interpolator: (t: number) => string) {
  const rawValues = arange(palette_size).map((i) => {
    const p = rgb(interpolator(i / palette_size));
    return [p.r, p.g, p.b, 255];
  });
  return to_buffer(rawValues);
}

const color_palettes: Record<string, Uint8Array> = {
  white: to_buffer(arange(palette_size).map(() => [0.5, 0.5, 0.5, 0.5])),
};

const schemes: Record<string, (p: number) => string> = {};

for (const [k, v] of Object.entries(d3Chromatic)) {
  if (k.startsWith('scheme') && typeof v[0] === 'string') {
    const colors = Array(palette_size);
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
      // Deterministic random shuffle orders
      const shuffle = shuffler(randomLcg(1));
      color_palettes.shufbow = shuffle(color_palettes[name]);
    }
  }
}

function okabe() {
  // Okabe-Ito color scheme.
  const okabe_palette = [
    '#E69F00',
    '#CC79A7',
    '#56B4E9',
    '#009E73',
    '#0072B2',
    '#D55E00',
    '#F0E442',
  ];
  const colors = Array.from({ length: palette_size });
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

type Transform = 'log' | 'sqrt' | 'linear' | 'literal';

abstract class Aesthetic {
  public abstract default_range: [number, number];
  public abstract default_constant: number | [number, number, number];
  public abstract default_transform: 'log' | 'sqrt' | 'linear' | 'literal';
  public scatterplot: Scatterplot;
  public field: string | null = null;
  public regl: Regl;
  public _texture_buffer: Float32Array | Uint8Array | null = null;
  public _domain: [number, number];
  public _range: [number, number] | Uint8Array;
  public _transform: 'log' | 'sqrt' | 'linear' | 'literal' | undefined;
  public dataset: QuadtileSet;
  public partner: typeof this | null = null;
  public _textures: Record<string, Texture2D> = {};
  public _constant: any;
  public _scale: (p: number | string) => number | [number, number, number] = (
    p
  ) => 1;
  public current_encoding:
    | BasicChannel
    | OpChannel
    | LambdaChannel
    | ConstantChannel;
  //  public scaleFunc : (x : number | string) => number;
  public aesthetic_map: TextureSet;
  public id: string;

  constructor(
    scatterplot: Scatterplot,
    regl: Regl,
    dataset: QuadtileSet,
    aesthetic_map: TextureSet
  ) {
    this.aesthetic_map = aesthetic_map;
    if (this.aesthetic_map === undefined) {
      throw new Error('Aesthetic map is undefined');
    }
    this.scatterplot = scatterplot;
    this.regl = regl;
    this._domain = this.default_domain;
    this._range = [0, 1];
    this.dataset = dataset;
    // A flag that will be turned on and off in AestheticSet.
    this._domains = {};
    this.id = '' + Math.random();
    this.current_encoding = { constant: 1 };
  }

  apply(point: StructRowProxy) {
    // Takes an arrow point and returns the aesthetic value.
    // Used for generating points in SVG over the scatterplot.
    return this.scale(this.value_for(point));
  }

  get transform() {
    if (this._transform) return this._transform;
    return this.default_transform;
  }

  set transform(transform) {
    this._transform = transform;
  }

  get scale() {
    function capitalize(r: string) {
      if (r === 'ylorrd') {
        return 'YlOrRd';
      }
      return r.charAt(0).toUpperCase() + r.slice(1);
    }
    let scale = scales[this.transform]().domain(this.domain).range(this.range);

    const range = this.range;

    // color_specific stuff doesn't belong here.
    if (typeof range == 'string') {
      // Convert range from 'viridis' to InterpolateViridis.

      const interpolator = d3Chromatic['interpolate' + capitalize(range)];
      if (interpolator !== undefined) {
        // linear maps to nothing, but.
        // scaleLinear, and scaleLog but
        // scaleSequential and scaleSequentialLog.
        if (this.transform === 'sqrt') {
          return (
            scaleSequentialPow(interpolator)
              //@ts-ignore
              .exponent(0.5)
              .domain(this.domain)
          );
        } else if (this.transform === 'log') {
          return scaleSequentialLog(interpolator).domain(this.domain);
        } else {
          return scaleSequential(interpolator).domain(this.domain);
        }
      }
    }

    if (this.is_dictionary()) {
      scale = scaleOrdinal().domain(this.domain);
      if (typeof range === 'string' && schemes[range]) {
        if (this.column.data[0].dictionary === null) {
          throw new Error('Dictionary is null');
        }
        scale
          .range(schemes[range])
          .domain(this.column.data[0].dictionary.toArray());
      } else {
        scale.range(this.range);
      }
    }
    return scale;
  }

  get column(): Vector {
    if (this.field === null) {
      throw new Error("Can't retrieve column for aesthetic without a field");
    }
    if (this.dataset.root_tile.record_batch) {
      const col = this.dataset.root_tile.record_batch.getChild(this.field);
      if (col === undefined || col === null) {
        throw new Error("Can't find column " + this.field);
      }
      return col;
    }
    throw new Error('Table is null');
  }

  _domains: {
    [key: string]: [number, number];
  };

  get default_domain(): [number, number] {
    // Look at the data to determine a reasonable default domain.
    // Cached to _domains.
    if (this.field == undefined) {
      return [1, 1];
    }
    if (this._domains[this.field]) {
      return this._domains[this.field];
    }
    // Maybe the table is checked out
    if (!this.dataset.ready) {
      return [1, 1];
    }
    const { column } = this;
    if (!column) {
      return [1, 1];
    }
    if (column.type.dictionary) {
      this._domains[this.field] = [0, this.aesthetic_map.texture_size - 1];
    } else {
      this._domains[this.field] = extent(column.toArray());
    }
    console.log(
      'Inferring range of ' + this.field + ' to be ' + this._domains[this.field]
    );
    return this._domains[this.field];
  }

  default_data(): Uint8Array | Float32Array | Array<number> {
    return Array(this.aesthetic_map.texture_size).fill(this.default_constant);
  }

  get domain() {
    return this._domain || this.default_domain;
  }

  get range() {
    return this._range || this.default_range;
  }

  value_for(point: StructRowProxy) {
    if (this.field === null) {
      return this.default_constant;
    }
    return point[this.field];
  }

  get map_position() {
    // Returns the location on the color map to use
    // for this field. Gives a column on the texture
    // that stores the values already created for this.
    if (this.use_map_on_regl === 0) {
      return 0;
    }
    return this.aesthetic_map.get_position(this.id);
  }

  get texture_buffer() {
    if (this._texture_buffer) {
      return this._texture_buffer;
    }
    this._texture_buffer = new Float32Array(this.aesthetic_map.texture_size);
    this._texture_buffer.set(this.default_data());
    return this._texture_buffer;
  }

  /* Delete?
  key() {
    return this.field + this.domain + this.range + this.transform;
  }
  */

  post_to_regl_buffer() {
    this.aesthetic_map.set_one_d(this.id, this.texture_buffer);
  }

  convert_string_encoding(channel: string): BasicChannel {
    const v: BasicChannel = {
      field: channel,
      domain: this.default_domain,
      range: this.default_range,
    };
    return v;
  }

  complete_domain(encoding: BasicChannel) {
    encoding.domain = encoding.domain || this.default_domain;
    return encoding;
  }

  custom(values) {
    // Custom color values
    const custom_palette = values;
    const colors = new Array(palette_size);
    const scheme = custom_palette.map((v) => {
      const col = rgb(v);
      return [col.r, col.g, col.b, 255];
    });
    for (const i of arange(palette_size)) {
      colors[i] = scheme[i % custom_palette.length];
    }
    color_palettes.custom = to_buffer(colors);
    schemes['custom'] = custom_palette;
  }

  reset_to_defaults() {
    this._domain = this.default_domain;
    this._range = [0, 1];
    this._transform = undefined;
    this._constant = this.default_constant;
    this.field = null;
    this.current_encoding = {
      constant: this.default_constant,
    };
  }
  update(
    encoding:
      | string
      | BasicChannel
      | null
      | ConstantChannel
      | LambdaChannel
      | OpChannel
  ) {
    if (encoding === 'null') {
      encoding = null;
    }

    if (encoding === null) {
      this.current_encoding = {
        constant: this.default_constant,
      };
      this.reset_to_defaults();
      return;
    }

    if (encoding === undefined) {
      return;
    }
    if (typeof encoding === 'string') {
      encoding = this.convert_string_encoding(encoding);
    }

    if (typeof encoding !== 'object') {
      const x: ConstantChannel = {
        constant: encoding,
      };
      this.current_encoding = x;
      return;
    }

    if (Object.keys(encoding).length === 0) {
      this.reset_to_defaults();
      return;
    }

    if (
      encoding['domain'] &&
      typeof encoding['domain'] === 'string' &&
      encoding['domain'] === 'progressive'
    ) {
      const all_tiles = [this.dataset.root_tile];
      let current_tiles = [...all_tiles];
      if (this.dataset.root_tile.children.length > 0) {
        while (true) {
          if (current_tiles.length === 0) {
            break;
          }
          const children_tiles = [];
          current_tiles.map(function (tile, idx) {
            if (tile.children.length > 0) {
              all_tiles.push.apply(all_tiles, tile.children);
              children_tiles.push.apply(children_tiles, tile.children);
            }
          });
          current_tiles = children_tiles;
        }
        var min2 = all_tiles[0].record_batch.getChild(encoding['field']).data[0]
          .values[0];
        var max2 = min2;
        all_tiles.forEach(function (tile, idx) {
          tile.record_batch
            .getChild(encoding['field'])
            .data[0].values.forEach(function (val, idx2) {
              if (val < min2) {
                min2 = val;
              }
              if (val > max2) {
                max2 = val;
              }
            });
        });
        console.warn('deprecated code');
        encoding['domain'] = [min2, max2];
      }
    }
    this.current_encoding = encoding;
    if (isConstantChannel(encoding)) {
      return;
    }
    this.field = encoding.field;

    if (isOpChannel(encoding)) {
      return;
    }
    if (isLambdaChannel(encoding)) {
      const { lambda, field } = encoding;
      if (lambda) {
        this.apply_function_for_textures(field, this.domain, lambda);
        this.post_to_regl_buffer();
      } else if (encoding.range) {
        this.encode_for_textures(this.range);
        this.post_to_regl_buffer();
      }
      return;
    }
    if (encoding['domain'] === undefined) {
      encoding['domain'] = this.default_domain;
    }
    if (encoding['range']) {
      this._domain = encoding.domain;
      this._range = encoding.range;
    }

    this._transform = encoding.transform || undefined;
  }

  encode_for_textures(range: [number, number]) {
    const { texture_size } = this.aesthetic_map;
    const values = Array(texture_size);
    this.scaleFunc = scales[this.transform]()
      .range(range)
      .domain([0, texture_size - 1]);
    for (let i = 0; i < texture_size; i += 1) {
      values[i] = this.scaleFunc(i);
    }
  }

  arrow_column(): Vector {
    if (this.field === null) {
      throw new Error("Can't retrieve column for aesthetic without a field");
    }
    const c = this.dataset.root_tile.record_batch.getChild(this.field);
    if (c === null) {
      throw `No column ${this.field} on arrow table for aesthetic`;
    }
    return c;
  }

  is_dictionary(): boolean {
    if (this.field === null || this.field === undefined) {
      return false;
    }
    return this.arrow_column().type.dictionary !== undefined;
  }

  get constant(): number | [number, number, number] {
    if (isConstantChannel(this.current_encoding)) {
      return this.current_encoding.constant;
    }
    return this.default_constant;
  }

  get use_map_on_regl(): 1 | 0 {
    if (
      this.is_dictionary() &&
      this.domain[0] === -2047 &&
      this.domain[1] == 2047
    ) {
      return 1;
    }
    return 0;
  }

  apply_function_for_textures(
    field: string,
    range: number[],
    raw_func: Function | string
  ) {
    const { texture_size } = this.aesthetic_map;
    let func: Function;
    func =
      typeof raw_func === 'string'
        ? lambda_to_function(parseLambdaString(raw_func))
        : raw_func;
    //@ts-ignore TEMPORARY XXX
    this.scaleFunc = scaleLinear()
      .range(range)
      .domain([0, texture_size - 1]);

    let input: any[] = arange(texture_size);

    if (
      field === undefined ||
      this.dataset.root_tile.record_batch === undefined
    ) {
      if (field === undefined) {
        console.warn('SETTING EMPTY FIELD');
      }
      if (this.dataset.root_tile.record_batch === undefined) {
        console.warn('SETTING EMPTY TABLE');
      }
      this.texture_buffer.set(arange(texture_size).map((i) => 1));
      //      this.texture_buffer.set(encodeFloatsRGBA(arange(this.texture_size).map(i => 1)))
      return;
    }
    const { column } = this;

    if (!column) {
      throw new Error(`Column ${field} does not exist on table.`);
    }

    if (column.type.dictionary) {
      // NB--Assumes string type for dictionaries.
      input.fill();
      const dvals = column.data[0].dictionary.toArray();
      for (const [i, d] of dvals.entries()) {
        input[i] = d;
      }
    } else {
      input = input.map((d) => this.scale(d));
    }
    const values = input.map((i) => func(i));
    this.texture_buffer.set(values);
  }
}

abstract class OneDAesthetic extends Aesthetic {
  static get default_constant() {
    return 1.5;
  }
  static get_default_domain() {
    return [0, 1];
  }
  get default_domain() {
    return [0, 1];
  }
}

abstract class BooleanAesthetic extends Aesthetic {}

class Size extends OneDAesthetic {
  static get default_constant() {
    return 1.5;
  }
  static get_default_domain() {
    return [0, 10];
  }
  get default_domain() {
    return [0, 10];
  }
  default_constant = 1;
  get default_range(): [number, number] {
    return [0, 1];
  }
  default_transform: Transform = 'sqrt';
}

abstract class PositionalAesthetic extends OneDAesthetic {
  constructor(
    scatterplot: Scatterplot,
    regl: Regl,
    tile: QuadtreeRoot,
    map: TextureSet
  ) {
    super(scatterplot, regl, tile, map);
    this._transform = 'literal';
  }
  default_range: [number, number] = [-1, 1];
  default_constant = 0;
  default_transform: Transform = 'literal';

  get range(): [number, number] {
    if (this._range) {
      return this._range;
    }
    if (this.dataset.extent && this.dataset.extent[this.field])
      return this.dataset.extent[this.field];
    this.default_range;
  }

  static get default_constant() {
    return 0;
  }
}

class X extends PositionalAesthetic {
  field = 'x';
}

class X0 extends X {}

class Y extends PositionalAesthetic {
  field = 'y';
}

class Y0 extends Y {}

abstract class AbstractFilter extends BooleanAesthetic {
  public current_encoding: LambdaChannel | OpChannel | ConstantChannel;

  constructor(
    scatterplot: Scatterplot,
    regl: Regl,
    tile: QuadtileSet,
    map: TextureSet
  ) {
    super(scatterplot, regl, tile, map);
    this.current_encoding = { constant: 1 };
  }

  default_transform: Transform = 'literal';
  default_constant = 1;
  get default_domain(): [number, number] {
    return [0, 1];
  }
  default_range: [number, number] = [0, 1];

  update(encoding: LambdaChannel | OpChannel | ConstantChannel) {
    super.update(encoding);
    if (Object.keys(this.current_encoding).length === 0) {
      this.current_encoding = { constant: 1 };
    }
  }
  ops_to_array(): OpArray {
    const input = this.current_encoding;
    if (input === null) return [0, 0, 0];
    if (input === undefined) return [0, 0, 0];
    if (!isOpChannel(input)) {
      return [0, 0, 0];
    }
    if (input.op === 'within') {
      return [4, input.a, input.b];
    }
    const val: OpArray = [
      // Encoding of op as number.
      [null, 'lt', 'gt', 'eq'].indexOf(input.op),
      input.a,
      0,
    ];
    return val;
  }
}

class Filter extends AbstractFilter {}

class Jitter_speed extends Aesthetic {
  default_transform: Transform = 'linear';
  get default_domain() {
    return [0, 1];
  }
  default_range: [number, number] = [0, 1];
  public default_constant = 0.5;
}

function encode_jitter_to_int(jitter: string) {
  if (jitter === 'spiral') {
    // animated in a logarithmic spiral.
    return 1;
  }
  if (jitter === 'uniform') {
    // Static jitter inside a circle
    return 2;
  }
  if (jitter === 'normal') {
    // Static, normally distributed, standard deviation 1.
    return 3;
  }
  if (jitter === 'circle') {
    // animated, evenly distributed in a circle with radius 1.
    return 4;
  }
  if (jitter === 'time') {
    // Cycle in and out.
    return 5;
  }
  return 0;
}

class Jitter_radius extends Aesthetic {
  public jitter_int_formatted: 0 | 1 | 2 | 3 | 4 | 5 = 0;
  get default_constant() {
    return 0;
  }
  default_transform: Transform = 'linear';
  get default_domain() {
    return [0, 1];
  }
  get default_range(): [number, number] {
    return [0, 1];
  }
  public _method = 'None';

  get method() {
    return this.current_encoding && this.current_encoding.method
      ? this.current_encoding.method
      : 'None';
  }

  set method(value: string) {
    this._method = value;
  }

  get jitter_int_format() {
    return encode_jitter_to_int(this.method);
  }
}

const default_color: [number, number, number] = [0.7, 0, 0.5];

class Color extends Aesthetic {
  public texture_type: 'uint8' = 'uint8';
  public default_constant: [number, number, number] = [0.7, 0, 0.5];
  default_transform: Transform = 'linear';
  get default_range(): [number, number] {
    return [0, 1];
  }
  current_encoding: ColorChannel = {
    constant: default_color,
  };
  default_data(): Uint8Array {
    return color_palettes.viridis;
  }
  get use_map_on_regl() {
    // Always use a map for colors.
    return 1;
  }

  get texture_buffer() {
    if (this._texture_buffer) {
      return this._texture_buffer;
    }

    this._texture_buffer = new Uint8Array(this.aesthetic_map.texture_size * 4);
    this._texture_buffer.set(this.default_data());
    return this._texture_buffer;
  }

  static convert_color(color: string) {
    // Convert from string to RGB space (0-1).
    const { r, g, b } = rgb(color);
    return [r / 255, g / 255, b / 255];
  }

  /*get_hex_values(field) {
    var all_tiles = [this.tileSet];
    var current_tiles = [this.tileSet];

    //  TBD this seems to be calculating an input domain???
    if (this.tileSet.children.length > 0) {
      while (true) {
        if (current_tiles.length == 0) {
          break;
        }
        var children_tiles = [];
        current_tiles.map(function(tile, idx) {
          if (tile.children.length > 0) {
            all_tiles.push.apply(all_tiles, tile.children);
            children_tiles.push.apply(children_tiles, tile.children);
          }
        });
        current_tiles = children_tiles;
      }
      var min2 = all_tiles[0].table.getChild(field).data[0].values[0];
      var max2 = min2;
      all_tiles.forEach(function(tile, idx) {
        tile.table.getChild(field).data[0].values.forEach(function(val, idx2) {
          if (val < min2) {
            min2 = val;
          }
          if (val > max2) {
            max2 = val;
          }
        });
      });
      if(typeof min2 == "bigint" || typeof max2 == "bigint"){
        min2 = Number(min2);
        max2 = Number(max2);
      }
      var hex_vals = {};
      for (var i = 0; i < this._texture_buffer.length; i += 4*512){
        hex_vals[((Math.abs(max2-min2)/7)*(i/(4*512))+min2).toString()] = ("#" + this._texture_buffer[i].toString(16) + this._texture_buffer[i + 1].toString(16) + this._texture_buffer[i + 2].toString(16));
      }
      return hex_vals;
    }
  }

  get_hex_order() {
    var hex_vals = {};
    var ldl = this.scatterplot['_root']['local_dictionary_lookups'];
    var dict = ldl[this.field];
    var new_buffer = [];
    for(var i = 0; i < dict.size*4; i += 4){
      if(i >= 16384){
        var color_by_index = 16380;
      }else{
        var color_by_index = i;
      }
      hex_vals[dict.get(i/4)] = ("#"+this._texture_buffer[color_by_index].toString(16)+this._texture_buffer[color_by_index+1].toString(16)+this._texture_buffer[color_by_index+2].toString(16));
    }
    return hex_vals;
  }*/

  post_to_regl_buffer() {
    this.aesthetic_map.set_color(this.id, this.texture_buffer);
  }

  update(encoding: ColorChannel) {
    console.log('UPDATING COLOR');
    if (isConstantChannel(encoding) && typeof encoding.constant === 'string') {
      encoding.constant = Color.convert_color(encoding.constant);
    }
    super.update(encoding);
    this.current_encoding = encoding;
    if (encoding.range && typeof encoding.range[0] === 'string') {
      console.log('encoding to buffer');
      this.encode_for_textures(encoding.range);
      this.post_to_regl_buffer();
    } else if (encoding.range) {
      this.post_to_regl_buffer();
    }
  }

  encode_for_textures(range: string | number[] | Array<Array<number>>) {
    if (color_palettes[range]) {
      this.texture_buffer.set(color_palettes[range]);
    } else if (range.length === this.aesthetic_map.texture_size * 4) {
      this.texture_buffer.set(range);
    } else if (
      range.length > 0 &&
      range[0].length > 0 &&
      range[0].length === 3
    ) {
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
  size: Size,
  jitter_speed: Jitter_speed,
  jitter_radius: Jitter_radius,
  color: Color,
  filter: Filter,
  filter2: Filter,
  x: X,
  y: Y,
};

type concrete_aesthetics =
  | X
  | Y
  | Size
  | Jitter_speed
  | Jitter_radius
  | Color
  | Filter;

export abstract class StatefulAesthetic<T extends concrete_aesthetics> {
  // An aesthetic that tracks two states--current and last.
  // The point is to handle transitions.
  // It might make sense to handle more than two states, but there are
  // diminishing returns.
  abstract Factory: new (a, b, c, d) => T;
  public _states: [T, T] | undefined;
  public dataset: QuadtileSet;
  public regl: Regl;
  public scatterplot: Scatterplot;
  //  public current_encoding : Channel;
  public needs_transitions = false;
  public aesthetic_map: TextureSet;
  constructor(
    scatterplot: Scatterplot,
    regl: Regl,
    dataset: QuadtileSet,
    aesthetic_map: TextureSet
  ) {
    if (aesthetic_map === undefined) {
      throw new Error('Aesthetic map is undefined.');
    }
    this.scatterplot = scatterplot;
    this.regl = regl;
    this.dataset = dataset;
    this.aesthetic_map = aesthetic_map;
    this.aesthetic_map = aesthetic_map;
  }

  get current() {
    return this.states[0];
  }

  get last() {
    return this.states[1];
  }

  get states(): [T, T] {
    if (this._states !== undefined) {
      return this._states;
    }
    this._states = [
      new this.Factory(
        this.scatterplot,
        this.regl,
        this.dataset,
        this.aesthetic_map
      ),
      new this.Factory(
        this.scatterplot,
        this.regl,
        this.dataset,
        this.aesthetic_map
      ),
    ];
    return this._states;
  }

  update(encoding: BasicChannel | ConstantChannel) {
    const stringy = JSON.stringify(encoding);
    // Overwrite the last version.
    if (
      stringy == JSON.stringify(this.states[0].current_encoding) ||
      encoding === undefined
    ) {
      // If an undefined encoding is passed, that means
      // we've seen an update without any change.
      if (this.needs_transitions) {
        // The first one is fine, but we gotta update the *last* one.
        this.states[1].update(this.states[0].current_encoding);
      }
      this.needs_transitions = false;
    } else {
      // Flip the current encoding to the second position.
      this.states.reverse();
      this.states[0].update(encoding);
      this.needs_transitions = true;
      //      this.current_encoding = encoding;
    }
  }
}

class StatefulX extends StatefulAesthetic<X> {
  get Factory() {
    return X;
  }
}
class StatefulX0 extends StatefulAesthetic<X0> {
  get Factory() {
    return X0;
  }
}
class StatefulY extends StatefulAesthetic<Y> {
  get Factory() {
    return Y;
  }
}
class StatefulY0 extends StatefulAesthetic<Y0> {
  get Factory() {
    return Y0;
  }
}
class StatefulSize extends StatefulAesthetic<Size> {
  get Factory() {
    return Size;
  }
}
class StatefulJitter_speed extends StatefulAesthetic<Jitter_speed> {
  get Factory() {
    return Jitter_speed;
  }
}
class StatefulJitter_radius extends StatefulAesthetic<Jitter_radius> {
  get Factory() {
    return Jitter_radius;
  }
}
class StatefulColor extends StatefulAesthetic<Color> {
  get Factory() {
    return Color;
  }
}
class StatefulFilter extends StatefulAesthetic<Filter> {
  get Factory() {
    return Filter;
  }
}
class StatefulFilter2 extends StatefulAesthetic<Filter> {
  get Factory() {
    return Filter;
  }
}

export const stateful_aesthetics: Record<
  string,
  StatefulAesthetic<typeof Aesthetic>
> = {
  x: StatefulX,
  x0: StatefulX0,
  y: StatefulY,
  y0: StatefulY0,
  size: StatefulSize,
  jitter_speed: StatefulJitter_speed,
  jitter_radius: StatefulJitter_radius,
  color: StatefulColor,
  filter: StatefulFilter,
  filter2: StatefulFilter2,
};

function parseLambdaString(lambdastring: string) {
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
/*
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
*/

function op_to_function(input: OpChannel): (d: number) => boolean {
  if (input.op == 'gt') {
    return (d: number) => d > input.a;
  } else if (input.op == 'lt') {
    return (d: number) => d < input.a;
  } else if (input.op == 'eq') {
    return (d: number) => d == input.a;
  } else if (input.op == 'within') {
    return (d: number) => Math.abs(d - input.a) <= input.b;
  }
  throw new Error(`Unknown op ${input.op}`);
}

function lambda_to_function(input: LambdaChannel): (d: any) => number {
  if (typeof input.lambda === 'function') {
    throw 'Must pass a string to lambda, not a function.';
  }
  const { lambda, field } = input;
  if (field === undefined) {
    throw 'Must pass a field to lambda.';
  }
  const cleaned = parseLambdaString(lambda).lambda;
  const [arg, code] = cleaned.split('=>', 2).map((d) => d.trim());
  //@ts-ignore
  const func: (d: any) => number = new Function(arg, code);
  return func;
}
