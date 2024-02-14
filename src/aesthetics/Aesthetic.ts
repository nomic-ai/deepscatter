/* eslint-disable no-underscore-dangle */
import { range as arange } from 'd3-array';
import {
  scaleLinear,
  scaleSqrt,
  scaleLog,
  scaleIdentity,
  ScaleContinuousNumeric,
  ScaleOrdinal,
  ScaleLinear,
} from 'd3-scale';
import type { Regl, Texture2D } from 'regl';
import type { TextureSet } from './AestheticSet';
import { isOpChannel, isLambdaChannel, isConstantChannel, isTransform } from '../typing';
import { Dictionary, Float32, Int16, Type, Utf8, Vector } from 'apache-arrow';
import { StructRowProxy } from 'apache-arrow/row/struct';
import { isNumber } from 'lodash';
import type * as DS from '../shared'
import {Scatterplot} from '../deepscatter';


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
  ChannelType extends DS.ChannelType,
  Input extends DS.InType = DS.NumberIn,
  Output extends DS.OutType = DS.NumberOut,
> {
  public dataset: DS.Dataset;
  public abstract default_constant: Output['rangeType'];
  public abstract default_range: [Output['rangeType'], Output['rangeType']]
  public scatterplot: Scatterplot;
  public field: string | null = null;
  public _texture_buffer: Float32Array | Uint8Array | null = null;
  public _func?: (d: Input['arrowType']) => Output['glType'];
  public aesthetic_map: TextureSet;

  // cache of the d3 scale
  public encoding : ChannelType;
  public id: string;

  constructor(
    encoding: ChannelType | null,
    scatterplot: Scatterplot,
    aesthetic_map: TextureSet,
    id: string
  ) {
    this.aesthetic_map = aesthetic_map;
    if (this.aesthetic_map === undefined) {
      throw new Error('Aesthetic map is undefined');
    }
    
    this.scatterplot = scatterplot;
    this.dataset = scatterplot.dataset;


    // A flag that will be turned on and off in AestheticSet.
    this.id = id;

    if (encoding === undefined) {
      throw new Error('Updates with undefined should be handled upstream of the aesthetic.');
    }

    if (encoding === null) {
      this.encoding = null;
      return;
    }

    if (typeof encoding === 'string') {
      encoding = this.convert_string_encoding(encoding) as ChannelType;
    }

    if (isNumber(encoding)) {
      throw new Error(`As of deepscatter 3.0, you must pass {constant: ${encoding}}, not just "${encoding}`)
    }

    this.encoding = encoding;

    if (isConstantChannel(encoding)) {
      return
    }
    
    this.field = encoding.field ?? encoding.field;

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
  }



  abstract apply(point: Datum): Output['rangeType']

  abstract toGLType(val: Output['rangeType']): Output['glType'];

  get column(): Vector<Input['arrowType']> {
    if (this.field === null) {
      throw new Error("Can't retrieve column for aesthetic without a field");
    }
    if (this.dataset?.root_tile?.record_batch) {
      const col = this.dataset.root_tile.record_batch.getChild(this.field);
      if (col === undefined || col === null) {
        throw new Error("Can't find column " + this.field);
      }
      return col as Vector<Input['arrowType']>;
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

    const domain = this.dataset.domain(this.field);
    return domain;
  }

  default_data(): Uint8Array | Float32Array | Array<number> {
    const default_value = this.toGLType(this.default_constant);
    return Array(this.aesthetic_map.texture_size).fill(
      default_value
    ) as Array<number>;
  }

  get domain() : [Input['domainType'], Input['domainType']] {
    if (this.encoding['domain']) {
      return this.encoding['domain']
    } else if (this.field === null) {
      return this.default_domain;
    } else {
      return this.dataset.domain(this.field);
    }
  }

  get range() : [Output['rangeType'], Output['rangeType']] {
    if (this.encoding['range']) {
      return this.encoding['range']
    } else if (this.field === null) {
      return this.default_domain;
    } else {
      return this.default_range
    }
  }

  
  value_for(point: Datum): Input['domainType'] | null {
    if (this.field && point[this.field]) {
      return point[this.field];
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

  arrow_column(): Vector<Input['arrowType']> | null {
    if (this.field === null || this.field === undefined) {
      return null
    }
    return this.dataset.root_tile.record_batch.getChild(this.field);
  }

  is_dictionary(): boolean {
    const t = this.arrow_column() as Vector<DS.SupportedArrowTypes> | null;
    return t ? t.type.typeId === Type.Dictionary : false;
  }

  /**
   * Returns the default value
   */
  get constant(): Output['glType'] {
    if (
      this.encoding !== null &&
      isConstantChannel(this.encoding)
    ) {
      return this.toGLType(this.encoding.constant as Output['rangeType']);
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
    func: ((d: Output['rangeType']) => GlValueType)
  ) {
    const { texture_size } = this.aesthetic_map;

    let input: (Output['rangeType'])[] = arange(texture_size);

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
      input.fill('' as Output['rangeType']);
      const dvals = column.data[0].dictionary.toArray() as string[];
      for (const [i, d] of dvals.entries()) {
        input[i] = d as Output['rangeType'];
      }
    } else {
      input = input.map((d) => this.scale(d));
    }
    const values = input.map((i) => func(i)) as number[];
    this.texture_buffer.set(values);
  }
}


type Datum = StructRowProxy | Record<string, string | number | boolean>;
