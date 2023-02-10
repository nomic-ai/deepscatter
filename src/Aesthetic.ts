/* eslint-disable no-underscore-dangle */
import { range as arange, extent } from 'd3-array';
import {
  scaleLinear,
  scaleSqrt,
  scaleLog,
  scaleIdentity,
  scaleOrdinal,
} from 'd3-scale';
import type Scatterplot from './deepscatter';
import type { Regl, Texture2D } from 'regl';
import type { TextureSet } from './AestheticSet';
import { isOpChannel, isLambdaChannel, isConstantChannel } from './typing';
import type { QuadtileSet } from './Dataset';
import { Vector } from 'apache-arrow';
import { StructRowProxy } from 'apache-arrow/row/struct';
import { isNumber } from 'lodash';
export const scales = {
  sqrt: scaleSqrt,
  log: scaleLog,
  linear: scaleLinear,
  literal: scaleIdentity,
} as const;

type Transform = 'log' | 'sqrt' | 'linear' | 'literal';

// A channel is usually going to be one of these.
// Only color channels are different
type DefaultChannel =
  | BasicChannel
  | OpChannel
  | LambdaChannel
  | ConstantChannel;

export abstract class Aesthetic<
  GlValueType = number, // The type of the object passed to webgl. E.g [number, number, number] for [255, 0, 0] = red.
  JSValueType = number, // The type of the object in *javascript* which the user interacts with. E.g string for "#FF0000" = red
  ChannelType extends Channel = DefaultChannel
> {
  public abstract default_range: [number, number];
  public abstract default_constant: GlValueType;
  public abstract _constant: GlValueType;
  public abstract default_transform: 'log' | 'sqrt' | 'linear' | 'literal';
  public _transform: 'log' | 'sqrt' | 'linear' | 'literal' | undefined;
  public scatterplot: Plot;
  public field: string | null = null;
  public regl: Regl;
  public _texture_buffer: Float32Array | Uint8Array | null = null;
  public _domain: [number, number];
  public _range: [number, number] | Uint8Array;
  public _func?: (d: string | number) => GlValueType;
  public dataset: QuadtileSet;
  public partner: typeof this | null = null;
  public _textures: Record<string, Texture2D> = {};
  // cache of a d3 scale
  public _scale?: (p: number | string) => JSValueType;
  public current_encoding: ChannelType | null = null;
  public aesthetic_map: TextureSet;
  public id: string;

  constructor(
    scatterplot: Plot,
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
    this.id = Math.random().toString();
  }

  apply(point: Datum): JSValueType {
    // Takes an arrow point and returns the aesthetic value.
    // Used for generating points in SVG over the scatterplot.
    return this.scale(this.value_for(point)) as JSValueType;
  }
  abstract toGLType(val: JSValueType): GlValueType;

  get transform() {
    if (this._transform) return this._transform;
    return this.default_transform;
  }

  set transform(transform) {
    this._transform = transform;
  }

  get scale() {
    if (this._scale) {
      return this._scale;
    }
    const { range } = this;

    if (this.is_dictionary()) {
      console.warn('Dictionary scales only supported for colors');
      const scale = scaleOrdinal().domain(this.domain);
      return (this._scale = scale.range(this.range));
    }
    const scale = scales[this.transform]();

    scale.domain(this.domain).range(this.range);

    return (this._scale = scale);
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

  get default_domain(): [number, number] {
    // Look at the data to determine a reasonable default domain.
    // Cached to _domains.
    if (this.field == undefined) {
      return [1, 1];
    }
    // Maybe the table is checked out right now.
    if (!this.scatterplot._root._schema) {
      return [1, 1];
    }
    const { column } = this;
    if (!column) {
      return [1, 1];
    }
    if (column.type?.dictionary !== undefined) {
      return [-2047, Math.floor(this.aesthetic_map.texture_size / 2) - 1];
    }
    const domain = this.dataset.domain(this.field);
    return this.dataset.domain(this.field);
  }

  default_data(): Uint8Array | Float32Array | Array<number> {
    return Array(this.aesthetic_map.texture_size).fill(this.default_constant);
  }

  get webGLDomain() {
    if (this.is_dictionary()) {
      return [-2047, 2047];
    }
    return this.domain;
  }

  get domain() {
    return this._domain || this.default_domain;
  }

  get range() {
    return this._range || this.default_range;
  }

  value_for(point: Datum): string | number | null {
    if (this.field && point[this.field]) {
      return point[this.field] as string | number;
    }
    // Needs a default perhaps?
    return null;
  }

  get map_position() {
    // Returns the location on the color map to use
    // for this field. Gives a column on the texture
    // that stores the values already created for this.
    if (this.use_map_on_regl === 0) {
      return 0;
    }
    //    console.log(this.aesthetic_map.get_position(this.id));
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

  reset_to_defaults() {
    this._domain = this.default_domain;
    this._range = [0, 1];
    this._transform = undefined;
    this._constant = this.default_constant;
    this.field = null;
    this.current_encoding = {
      constant: this.default_constant,
    };
    this._scale = undefined;
  }

  update(encoding: string | null | ChannelType) {
    // null handling.
    if (encoding === undefined) {
      console.warn('Should never be calling update with undefined.');
      return;
    }

    if (encoding === null || encoding === 'null') {
      this.current_encoding = {
        constant: this.default_constant,
      };
      this.reset_to_defaults();
      return;
    }

    // Reset the scale
    this._scale = undefined;
    if (typeof encoding === 'string') {
      encoding = this.convert_string_encoding(encoding) as ChannelType;
    }

    if (isNumber(encoding)) {
      const x: ConstantChannel = {
        constant: encoding,
      };
      this.current_encoding = x;
      return;
    }

    if (Object.keys(encoding).length === 0) {
      console.warn(
        "Resetting parameters with an empty object is deprecated: use 'null'"
      );
      this.reset_to_defaults();
      return;
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
    const scale = scales[this.transform]()
      .range(range)
      .domain([0, texture_size - 1]);
    for (let i = 0; i < texture_size; i += 1) {
      values[i] = scale(i);
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

  get constant(): GlValueType {
    if (
      this.current_encoding !== null &&
      isConstantChannel(this.current_encoding)
    ) {
      return this.toGLType(this.current_encoding.constant);
    }
    return this.default_constant;
  }

  get use_map_on_regl(): 1 | 0 {
    if (this.is_dictionary()) {
      return 1;
    }
    return 0;
  }

  materialize_function(
    raw_func: string | ((d: string | number) => GlValueType)
  ) {
    const func =
      typeof raw_func === 'string'
        ? lambda_to_function(parseLambdaString(raw_func))
        : raw_func;
    this._func = func;
    return func;
  }

  apply_function_for_textures(
    field: string,
    range: number[],
    raw_func: string | ((d: string | number) => GlValueType)
  ) {
    const { texture_size } = this.aesthetic_map;
    const func = this.materialize_function(raw_func);

    let input: (string | number)[] = arange(texture_size);

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

    if (column?.type?.dictionary) {
      // NB--Assumes string type for dictionaries.

      input.fill('');
      const dvals = column.data[0].dictionary!.toArray() as string[];
      for (const [i, d] of dvals.entries()) {
        input[i] = d;
      }
    } else {
      input = input.map((d) => this.scale(d));
    }
    //    console.log({ func });
    const values = input.map((i) => func(i));
    this.texture_buffer.set(values);
  }
}

abstract class OneDAesthetic extends Aesthetic {
  constructor(
    scatterplot: Plot,
    regl: Regl,
    dataset: QuadtileSet,
    aesthetic_map: TextureSet
  ) {
    super(scatterplot, regl, dataset, aesthetic_map);
    this.current_encoding = { constant: 1 };
  }

  toGLType(a: number) {
    return a;
  }
  static get default_constant() {
    return 1.5;
  }
  static get_default_domain() {
    return [0, 1] as [number, number];
  }
  get default_domain() {
    return [0, 1] as [number, number];
  }
}

export class Size extends OneDAesthetic {
  static get default_constant() {
    return 1.5;
  }
  _constant = 1;
  default_constant = 1;
  get default_range() {
    return [0, 1] as [number, number];
  }
  default_transform: Transform = 'sqrt';
}

abstract class PositionalAesthetic extends OneDAesthetic {
  constructor(
    scatterplot: Scatterplot,
    regl: Regl,
    tile: QuadtileSet,
    map: TextureSet
  ) {
    super(scatterplot, regl, tile, map);
    this._transform = 'literal';
  }
  default_range: [number, number] = [-1, 1];
  default_constant = 0;
  default_transform: Transform = 'literal';
  _constant = 0;
  get range(): [number, number] {
    if (this._range) {
      return this._range;
    }
    if (this.dataset.extent && this.field && this.dataset.extent[this.field])
      return this.dataset.extent[this.field];
    return this.default_range;
  }

  static get default_constant() {
    return 0;
  }
}

export class X extends PositionalAesthetic {
  field = 'x';
}

export class X0 extends X {}

export class Y extends PositionalAesthetic {
  field = 'y';
}

export class Y0 extends Y {}

abstract class BooleanAesthetic extends Aesthetic<
  number,
  boolean,
  BooleanChannel
> {
  constructor(
    scatterplot: Plot,
    regl: Regl,
    tile: QuadtileSet,
    map: TextureSet
  ) {
    super(scatterplot, regl, tile, map);
    //    this.current_encoding = { constant: true };
  }
  toGLType(a: boolean) {
    return a ? 1 : 0;
  }

  update(encoding: BooleanChannel | null) {
    super.update(encoding);
    if (Object.keys(this.current_encoding).length === 0) {
      this.current_encoding = { constant: true };
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

  apply(point: Datum): boolean {
    const channel = this.current_encoding;
    if (channel === null || channel === undefined) {
      return true;
    }
    if (isOpChannel(channel)) {
      return this.apply_op(point, channel);
    }
    if (isConstantChannel(channel)) {
      return channel.constant !== 0;
    }
    if (isLambdaChannel(channel)) {
      if (this._func === undefined) {
        throw new Error(
          '_func should have been bound' + JSON.stringify(this.current_encoding)
        );
      }
      const val = this.value_for(point);
      if (val === null) {
        return false;
      } else {
        return !!this._func(val);
      }
    }
    return true;
  }

  apply_op(point: Datum, channel: OpChannel): boolean {
    const { op, a } = channel;
    const p = this.value_for(point) as number;
    if (p === null) {
      return false;
    }
    if (op === 'eq') {
      return p == a;
    } else if (op === 'gt') {
      return p > a;
    } else if (op === 'lt') {
      return p < a;
    } else if (op === 'within') {
      return Math.abs(p - channel.b) < a;
    } else if (op === 'between') {
      const mid = (channel.a + channel.b) / 2;
      const diff = Math.abs(channel.a - channel.b) / 2;
      return Math.abs(p - mid) < diff;
    }
    return false;
  }
  get default_domain(): [number, number] {
    return [0, 1];
  }
}

/**
 * "Foreground" defines whether a field should be
 * plotted in the front of the screen: by default
 * background points will be plotted with much less resolution.
 */
export class Foreground extends BooleanAesthetic {
  //  public current_encoding = null;
  _constant = 1;
  default_constant = 1;
  default_range = [0, 1] as [number, number];
  default_transform: Transform = 'literal';
  get active(): boolean {
    if (
      this.current_encoding === null ||
      isConstantChannel(this.current_encoding)
    ) {
      return false;
    }
    return true;
  }
}

export class Filter extends BooleanAesthetic {
  public current_encoding = {
    constant: true,
  };
  _constant = 1;
  default_constant = 1;
  default_transform: Transform = 'literal';
  default_range: [number, number] = [0, 1];
}

export class Jitter_speed extends OneDAesthetic {
  default_transform: Transform = 'linear';
  default_range: [number, number] = [0, 1];
  public default_constant = 0.5;
  _constant = 0;
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

export class Jitter_radius extends Aesthetic<number, number, JitterChannel> {
  _constant = 0;

  toGLType(a: number) {
    return a;
  }
  public jitter_int_formatted: 0 | 1 | 2 | 3 | 4 | 5 = 0;
  get default_constant() {
    return 0;
  }
  default_transform: Transform = 'linear';

  get default_range() {
    return [0, 1] as [number, number];
  }

  public _method: JitterRadiusMethod = 'None';

  get method(): JitterRadiusMethod {
    return this.current_encoding?.method ?? 'None';
  }

  set method(value: string) {
    this._method = value;
  }

  get jitter_int_format() {
    return encode_jitter_to_int(this.method);
  }
}

function parseLambdaString(lambdastring: string) {
  // Materialize an arrow function from its string.
  // Note that this *does* reassign 'field'.
  let [field, lambda] = lambdastring.split('=>').map((d) => d.trim());
  if (lambda === undefined) {
    throw new Error(`Couldn't parse ${lambdastring} into a function`);
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
  const func: (d: any) => number = new Function(arg, code);
  return func;
}

type Datum = StructRowProxy | Record<string, string | number | boolean>;
