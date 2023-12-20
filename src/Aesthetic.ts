/* eslint-disable no-underscore-dangle */
import { range as arange } from 'd3-array';
import {
  scaleLinear,
  scaleSqrt,
  scaleLog,
  scaleIdentity,
  ScaleLinear,
  ScaleContinuousNumeric,
  ScaleOrdinal,
} from 'd3-scale';
import type { Regl, Texture2D } from 'regl';
import type { TextureSet } from './AestheticSet';
import { isOpChannel, isLambdaChannel, isConstantChannel } from './typing';
import { Dictionary, Int16, Type, Utf8, Vector } from 'apache-arrow';
import { StructRowProxy } from 'apache-arrow/row/struct';
import { isNumber } from 'lodash';
import type * as DS from './shared.d'


export const scales = {
  sqrt: scaleSqrt,
  log: scaleLog,
  linear: scaleLinear,
  literal: scaleIdentity,
} as const;

// d3 scales are quite powerful, but we only use a limited subset of their features.

/**
 * An Aesthetic bundles all operations in mapping from user dataspace to webGL based aesthetics.
 * 
 * It is a generic type that needs to be subclassed. The GLType represents the convention that we
 * use on the GPU for representing it: in every case except for colors, data is represented as an
 * indeterminate precision float. Colors are represented as a three-tuple.
 * 
 * The JSValue type represents how the user expects to interact with these in the setting of 
 * ranges. Again, these are generally numbers, but they can be strings for special instructions,
 * especially for colors.
 */
export abstract class Aesthetic<
  // The type of the object passed to webgl. E.g [number, number, number] for [255, 0, 0] = red.
  GlValueType extends DS.WebGlValue, 
  // The type of the object in *javascript* which the user interacts with. E.g string for "#FF0000" = red  
  JSValueType extends DS.JSValue,
  DomainType extends DS.JSValue,
  ScaleType extends ScaleContinuousNumeric<JSValueType, JSValueType> 
  | ScaleOrdinal<DomainType, JSValueType>
  | ScaleOrdinal<DomainType, JSValueType>
> {
  public abstract default_range: [number, number];
  public abstract default_constant: JSValueType;
  public _constant?: JSValueType;
  public abstract default_transform: DS.Transform;
  public _transform: DS.Transform = 'linear';
  public scatterplot: DS.Plot;
  public field: string | null = null;
  public regl: Regl;
  public _texture_buffer: Float32Array | Uint8Array | null = null;
  public aesthetic_map: TextureSet;
  public _domain?: [DomainType, DomainType];
  public _range?: [JSValueType, JSValueType];
  public _func?: (d: JSValueType) => GlValueType;
  public dataset: DS.Dataset;
  // cache of a d3 scale
  public _scale? : ScaleType
  public current_encoding: DS.Channel | null = null;
  public id: string;

  constructor(
    encoding: DS.Channel | null,
    scatterplot: DS.Plot,
    regl: Regl,
    dataset: DS.Dataset,
    aesthetic_map: TextureSet,
    id: string
  ) {
    this.aesthetic_map = aesthetic_map;
    if (this.aesthetic_map === undefined) {
      throw new Error('Aesthetic map is undefined');
    }
    this.scatterplot = scatterplot;
    this.regl = regl;
    this.dataset = dataset;
    // A flag that will be turned on and off in AestheticSet.
    this.id = id;
  }

  update(encoding: string | null | ChannelType) {
    // null handling.
    if (encoding === undefined) {
      console.warn('Updates with undefined should be handled upstream of the aesthetic.');
      return;
    }
    if (encoding === 'null') {
      throw new Error("Setting encoding with string 'null' is no longer supported. Pass a true null value.")
    }
    if (encoding === null) {
      this.current_encoding = null;
      this.reset_to_defaults();
      return;
    }

    // Reset the scale
    this._scale = undefined;
    if (typeof encoding === 'string') {
      encoding = this.convert_string_encoding(encoding) as ChannelType;
    }

    if (isNumber(encoding)) {
      const x: ChannelType = {
        constant: encoding,
      } as unknown as ChannelType;
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
    const e = encoding as DS.Channel;

    if (encoding['domain'] === undefined) {
      encoding['domain'] = this.default_domain;
    }
    if (encoding['range']) {
      this._domain = e.domain;
      this._range = e.range;
    }

    this._transform = e.transform ?? undefined;
  }

  apply(point: Datum): JSValueType {
    // Takes an arrow point and returns the aesthetic value.
    // Used, e.g., for generating points in SVG over the scatterplot.
    if (this.scale === undefined) {
      return this.default_constant;
    }
    return this.scale(this.value_for(point));
  }

  abstract toGLType(val: JSValueType): GlValueType;

  get transform() {
    if (this._transform) return this._transform;
    return this.default_transform;
  }

  set transform(transform) {
    this._transform = transform;
  }

  get scale(): (arg0: unknown) => JSValueType {
    if (this._scale) {
      return this._scale;
    }

    if (this.is_dictionary()) {
      throw new Error('Dictionary scales only supported for colors');
    }

    const scaleMaker = scales[this.transform];
    const scale = scaleMaker();
    // TODO CONSTRUCTION
    scale.domain(this.domain).range(this.range);

    return (this._scale = scale);
  }

  get column(): Vector<DS.SupportedArrowTypes> {
    if (this.field === null) {
      throw new Error("Can't retrieve column for aesthetic without a field");
    }
    if (this.dataset?.root_tile?.record_batch) {
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
    // Not sure why this was here.
    // if (column.type.typeId === Type.Dictionary) {
    //   return [0, this.aesthetic_map.texture_size];
    // }
    const domain = this.dataset.domain(this.field);
    return this.dataset.domain(this.field);
  }

  default_data(): Uint8Array | Float32Array | Array<number> {
    const default_value = this.toGLType(this.default_constant);
    return Array(this.aesthetic_map.texture_size).fill(
      default_value
    ) as Array<number>;
  }

  get webGLDomain() {
    if (this.is_dictionary()) {
      return [0, 4096];
    }
    return this.domain;
  }

  get domain() {
    if (this._domain === undefined) {
      this._domain = this.default_domain;
    }
    return this._domain || this.default_domain;
  }

  get range() {
    return this._range || this.default_range;
  }

  value_for(point: Datum): JSValueType | null {
    if (this.field && point[this.field]) {
      return point[this.field] as JSValueType;
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

  convert_string_encoding(channel: string): DS.Channel {
    const v: DS.Channel = {
      field: channel,
      domain: this.default_domain,
      range: this.default_range,
    };
    return v;
  }

  complete_domain(encoding: DS.Channel) {
    encoding.domain = encoding.domain || this.default_domain;
    return encoding;
  }

  reset_to_defaults() {
    this._domain = this.default_domain;
    this._range = [0, 1];
    this._transform = undefined;
    this._constant = this.default_constant;
    this.field = null;
    this.current_encoding = null;
    this._scale = undefined;
  }



  encode_for_textures(range: [number, number]) {
    const { texture_size } = this.aesthetic_map;
    const values = Array<number>(texture_size);
    const scale = scales[this.transform]()
      .range(range)
      .domain([0, texture_size - 1]);
    for (let i = 0; i < texture_size; i += 1) {
      values[i] = scale(i) as number;
    }
  }

  arrow_column(): Vector | null {
    if (this.field === null || this.field === undefined) {
      return null
    }
    return this.dataset.root_tile.record_batch.getChild(this.field);
  }

  is_dictionary(): boolean {
    const t = this.arrow_column() as Vector<DS.SupportedArrowTypes> | null;
    return t ? t.type.typeId === Type.Dictionary : false;
  }

  get constant(): GlValueType {
    if (
      this.current_encoding !== null &&
      isConstantChannel(this.current_encoding)
    ) {
      return this.toGLType(this.current_encoding.constant as JSValueType);
    }
    return this.toGLType(this.default_constant);
  }

  get use_map_on_regl(): 1 | 0 {
    // Do we need to use the dictionary map in regl?
    if (this.is_dictionary()) {
      return 1;
    }
    return 0;
  }

  apply_function_for_textures(
    field: string,
    range: number[],
    func: ((d: JSValueType) => GlValueType)
  ) {
    const { texture_size } = this.aesthetic_map;

    let input: (JSValueType)[] = arange(texture_size);

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
    const column = this.arrow_column();

    if (!column) {
      throw new Error(`Column ${field} does not exist on table.`);
    }

    if (this.is_dictionary()) {
      // NB--Assumes string type for dictionaries.
      input.fill('' as JSValueType);
      const dvals = column.data[0].dictionary.toArray() as string[];
      for (const [i, d] of dvals.entries()) {
        input[i] = d as JSValueType;
      }
    } else {
      input = input.map((d) => this.scale(d));
    }
    const values = input.map((i) => func(i)) as number[];
    this.texture_buffer.set(values);
  }
}


abstract class OneDAesthetic extends Aesthetic {
  public _range: [number, number];
  constructor(
    scatterplot: DS.Plot,
    regl: Regl,
    dataset: DS.Dataset,
    aesthetic_map: TextureSet
  ) {
    super(scatterplot, regl, dataset, aesthetic_map);
    this.current_encoding = null;
  }

  toGLType(a: number) {
    return a;
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
  default_transform: DS.Transform = 'sqrt';
}

export abstract class PositionalAesthetic extends OneDAesthetic {
  field: 'x' | 'y' | 'x0' | 'y0'
  constructor(
    scatterplot: DS.Plot,
    regl: Regl,
    dataset: DS.Dataset,
    map: TextureSet
  ) {
    super(scatterplot, regl, dataset, map);
    this._transform = 'literal';
  }
  default_range: [number, number] = [-1, 1];
  default_constant = 0;
  default_transform: DS.Transform = 'literal';
  _constant = 0;
  get range(): [number, number] {
    if (this._range) {
      return this._range;
    }
    if (this.dataset.extent && this.field && this.dataset.extent[this.field]) {
      return this.dataset.extent[this.field as 'x' | 'y'];
    }
    return this.default_range;
  }

  static get default_constant() {
    return 0;
  }
}

export class X extends PositionalAesthetic {
  field = 'x' as const;
}

export class X0 extends X {}

export class Y extends PositionalAesthetic {
  field = 'y' as const;
}

export class Y0 extends Y {}

abstract class BooleanAesthetic extends Aesthetic<
  0 | 1,
  boolean,
  DS.BooleanChannel
> {
  constructor(
    scatterplot: DS.Plot,
    regl: Regl,
    tile: DS.Dataset,
    map: TextureSet
  ) {
    super(scatterplot, regl, tile, map);
  }
  toGLType(a: boolean) {
    return a ? 1 : 0;
  }

  update(encoding: DS.BooleanChannel | null) {
    super.update(encoding);

    if (
      this.current_encoding !== null &&
      Object.keys(this.current_encoding).length === 0
    ) {
      this.current_encoding = null;
    }
  }

  ops_to_array(): DS.OpArray {
    const input = this.current_encoding;
    if (input === null) return [0, 0, 0];
    if (input === undefined) return [0, 0, 0];
    if (!isOpChannel(input)) {
      return [0, 0, 0];
    }
    if (input.op === 'within') {
      return [4, input.a, input.b];
    }
    if (input.op === 'between') {
      return [4, (input.b - input.a) / 2, (input.b + input.a) / 2];
    }
    const val: DS.OpArray = [
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
      // TODO: TS
      if (channel.constant as unknown as number === 0) {
        console.warn("Deprecated: pass `true` or `false` to boolean fields, not numbers")
        return false
      }
      if (channel.constant as unknown as number === 1) {
        console.warn("Deprecated: pass `true` or `false` to boolean fields, not numbers")
        return true
      }
      return channel.constant;
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

  apply_op(point: Datum, channel: DS.OpChannel): boolean {
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
  public current_encoding : DS.BooleanChannel = null;
  _constant = true;
  default_constant = true;
  default_range = [0, 1] as [number, number];
  default_transform: DS.Transform = 'literal';
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
  public current_encoding = null;
  _constant = true;
  default_constant = true;
  default_transform: DS.Transform = 'literal';
  default_range: [number, number] = [0, 1];
}

export class Jitter_speed extends OneDAesthetic {
  default_transform: DS.Transform = 'linear';
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

export class Jitter_radius extends Aesthetic<number, number, DS.JitterChannel> {
  _constant = 0;

  toGLType(a: number) {
    return a;
  }
  public jitter_int_formatted: 0 | 1 | 2 | 3 | 4 | 5 = 0;
  get default_constant() {
    return 0;
  }
  default_transform: DS.Transform = 'linear';

  get default_range() {
    return [0, 1] as [number, number];
  }

  public _method: DS.JitterRadiusMethod = 'None';

  get method(): DS.JitterRadiusMethod {
    return this.current_encoding?.method ?? 'None';
  }

  set method(value: DS.JitterRadiusMethod) {
    this._method = value;
  }

  get jitter_int_format() {
    return encode_jitter_to_int(this.method);
  }
}

type Datum = StructRowProxy | Record<string, string | number | boolean>;
