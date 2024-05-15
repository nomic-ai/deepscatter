import type { TextureSet } from './AestheticSet';
import { isConstantChannel } from '../typing';
import { Type, Vector } from 'apache-arrow';
import { StructRowProxy } from 'apache-arrow/row/struct';
import { isNumber } from 'lodash';
import type * as DS from '../shared';
import { Scatterplot } from '../scatterplot';

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
  public abstract default_constant: Output['rangeType'];
  public abstract default_range: [Output['rangeType'], Output['rangeType']];
  public scatterplot: Scatterplot;
  public field: string | null = null;
  public _texture_buffer: Float32Array | Uint8Array | null = null;
  protected abstract _func?: (d: Input['domainType']) => Output['rangeType'];
  public aesthetic_map: TextureSet;
  // TODO strict: @ts-expect-error We know this column is set to null if it doesn't exist.
  public column: Vector<Input['arrowType']> | null = null;

  // cache of the d3 scale
  public encoding: ChannelType;
  public id: string;
  constructor(
    encoding: ChannelType | null,
    scatterplot: Scatterplot,
    aesthetic_map: TextureSet,
    id: string,
  ) {
    this.aesthetic_map = aesthetic_map;
    if (this.aesthetic_map === undefined) {
      throw new Error('Aesthetic map is undefined');
    }
    if (typeof this.aesthetic_map === 'function') {
      throw new Error('WTF');
    }
    this.scatterplot = scatterplot;

    // A flag that will be turned on and off in AestheticSet.
    this.id = id;

    if (encoding === undefined) {
      throw new Error(
        'Updates with undefined should be handled upstream of the aesthetic.',
      );
    }

    if (encoding === null) {
      this.encoding = null;
      return;
    }

    if (isNumber(encoding)) {
      throw new Error(
        `As of deepscatter 3.0, you must pass {constant: ${encoding}}, not just "${encoding}`,
      );
    }

    this.encoding = encoding;

    if (isConstantChannel(encoding)) {
      this.field = null;
    } else {
      this.field = encoding.field;
    }
  }

  get deeptable() {
    return this.scatterplot.deeptable;
  }

  abstract apply(point: Datum): Output['rangeType'];

  abstract toGLType(val: Output['rangeType']): Output['glType'];

  get webGLDomain() {
    console.log('No method for webGLDomain');
    return [0, 1] as [number, number];
  }
  default_data(): Uint8Array | Float32Array | Array<number> {
    const default_value = this.toGLType(this.default_constant);
    return Array(this.aesthetic_map.texture_size).fill(
      default_value,
    ) as Array<number>;
  }

  value_for(point: Datum): Input['domainType'] | null {
    if (this.field && point[this.field]) {
      return point[this.field] as Input['domainType'];
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

  get texture_buffer(): Uint8Array {
    if (this._texture_buffer) {
      return this._texture_buffer as Uint8Array;
    }
    this._texture_buffer = new Uint8Array(this.aesthetic_map.texture_size * 4);
    // this._texture_buffer.set(this.default_data());
    return this._texture_buffer;
  }

  post_to_regl_buffer() {
    this.aesthetic_map.set_one_d(this.id, this.texture_buffer);
  }

  arrow_column(): Vector<Input['arrowType']> | null {
    if (this.column) {
      return this.column;
    }
    if (this.field === null || this.field === undefined) {
      return (this.column = null);
    }
    return (this.column = this.deeptable.root_tile.record_batch.getChild(
      this.field,
    ) as Vector<Input['arrowType']>);
  }

  is_dictionary(): boolean {
    const t = this.arrow_column() as Vector<DS.SupportedArrowTypes> | null;
    return t ? t.type.typeId === Type.Dictionary : false;
  }

  /**
   * Returns the default value
   */
  get webGLconstant(): Output['glType'] {
    if (this.encoding !== null && isConstantChannel(this.encoding)) {
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
}

export type Datum = StructRowProxy | Record<string, string | number | boolean>;
