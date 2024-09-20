import type * as DS from '../types';
import { Aesthetic, Datum } from './Aesthetic';
import { Scatterplot } from '../scatterplot';
import type { TextureSet } from './AestheticSet';

import {
  scaleLinear,
  scaleSqrt,
  scaleLog,
  scaleIdentity,
  ScaleContinuousNumeric,
  scaleOrdinal,
  ScaleOrdinal,
  scaleBand,
  ScaleSequential,
} from 'd3-scale';
import { isConstantChannel } from '../typing';
import { Dictionary, Int32, Type, Utf8, Vector } from 'apache-arrow';

export const scales = {
  sqrt: scaleSqrt,
  log: scaleLog,
  linear: scaleLinear,
  literal: scaleIdentity,
} as const;
export abstract class ScaledAesthetic<
  ChannelType extends DS.ChannelType = DS.ChannelType,
  Input extends DS.NumberIn | DS.DateIn | DS.CategoryIn =
    | DS.NumberIn
    | DS.DateIn
    | DS.CategoryIn,
  Output extends DS.NumberOut | DS.ColorOut = DS.NumberOut | DS.ColorOut,
> extends Aesthetic<ChannelType, Input, Output> {
  protected _scale:
    | ScaleContinuousNumeric<Input['domainType'], Output['rangeType']>
    | ScaleOrdinal<Input['domainType'], Output['rangeType']>
    | ScaleSequential<Output['rangeType']>
    | null = null;
  public default_transform: DS.Transform = 'linear';
  abstract default_range: [Output['rangeType'], Output['rangeType']];
  protected categorical; // Whether this is built on a dictionary variable.

  constructor(
    encoding: ChannelType | null,
    scatterplot: Scatterplot,
    aesthetic_map: TextureSet,
    id: string,
  ) {
    super(encoding, scatterplot, aesthetic_map, id);
    this.categorical = this.is_dictionary();
  }

  protected categoricalRange(): Output['rangeType'][] {
    if (this.encoding && this.encoding['range']) {
      if (typeof this.encoding['range'] === 'string') {
        throw new Error(
          'Categorical range must be an array of strings except for color fields.',
        );
      }
    }
    const vals = this.categoricalValues().map((d) => d.toString());

    const bands = scaleBand()
      .domain(vals)
      .range(this.deeptable.extent.x)
      .padding(0.1)
      .round(true)
      .align(0.5);
    return vals.map((d) => bands(d));
  }

  protected categoricalValues(): Input['domainType'][] {
    const col = this.arrow_column() as Vector<Dictionary<Utf8, Int32>>;
    let values: string[];
    if (col.type.typeId === Type.Dictionary) {
      const d = col.data[0].dictionary as Vector<Utf8>;
      values = d.toArray() as unknown as string[];
    } /* else if (col.type.typeId === Type.Bool) {
      TODO: integer and bool support.      
    }*/ else {
      throw new Error(
        'Only dictionary columns can create categorical values for new scales.',
      );
    }
    return values as Input['domainType'][];
  }

  // TODO: this class can eventually handle integer and booleans passed as well.
  protected populateCategoricalScale() {
    this._scale = (
      scaleOrdinal() as ScaleOrdinal<Input['domainType'], Output['rangeType']>
    )
      .domain(this.categoricalDomain)
      .range(this.categoricalRange());
  }

  private _webGLDomain: [number, number] | undefined;
  /**
   * Returns two numbers that indicate the extent of
   * the attribute written to webGL.
   */
  get webGLDomain(): [number, number] {
    if (this._webGLDomain) {
      return this._webGLDomain;
    }
    if (this.categorical) {
      return (this._webGLDomain = [0, this.categoricalDomain.length - 1]);
    }
    const [min, max] = this.domain || [undefined, undefined];

    if (typeof min === 'number' && typeof max === 'number') {
      return (this._webGLDomain = [min, max]);
    }
    throw new Error('Unable to generate appropriate GL Domain');
  }

  get transform(): DS.Transform {
    if (this.encoding && this.encoding['transform']) {
      return this.encoding['transform'] as DS.Transform;
    }
    return this.default_transform;
  }

  get scale():
    | ScaleOrdinal<Input['domainType'], Output['rangeType']>
    | ScaleContinuousNumeric<Input['domainType'], Output['rangeType']> {
    if (this.categorical) {
      return this._scale as ScaleOrdinal<
        Input['domainType'],
        Output['rangeType'],
        never
      >;
    } else {
      return this._scale as ScaleContinuousNumeric<
        Input['domainType'],
        Output['rangeType'],
        never
      >;
    }
  }

  apply(point: Datum) {
    const constant = isConstantChannel(this.encoding)
      ? this.encoding.constant
      : this.default_constant;
    if (this.field === null || isConstantChannel(this.encoding)) {
      return constant as Output['rangeType'];
    }
    const value = point[this.field] as Input['domainType'];
    if (value === undefined || value === null) {
      return constant as Output['rangeType'];
    }
    if (this.categorical) {
      const scale = this.scale as ScaleOrdinal<
        Input['domainType'],
        Output['rangeType']
      >;
      return scale(value);
    } else {
      const scale = this.scale as ScaleContinuousNumeric<
        Input['domainType'],
        Output['rangeType'],
        never
      >;
      // Todo why do the types let this be a string?
      const v = scale(value as number | Date);
      return v;
    }
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

    if (!this.arrow_column()) {
      return [1, 1];
    }

    const domain = this.deeptable.domain(this.field);
    return domain;
  }

  get categoricalDomain(): Input['domainType'][] {
    if (this.encoding['domain']) {
      return this.encoding['domain'] as Input['domainType'][];
    }
    return this.categoricalValues();
  }

  get domain(): [Input['domainType'], Input['domainType']] {
    if (this.encoding === null || this.field === null) {
      return this.default_domain;
    } else if (this.encoding['domain']) {
      return this.encoding['domain'] as [
        Input['domainType'],
        Input['domainType'],
      ];
    } else {
      return this.scatterplot.deeptable.domain(this.field);
    }
  }

  /**
   * Returns either the inner, outer bounds OR (for color scales only) a string represented the scheme.
   */
  get range(): [Output['rangeType'], Output['rangeType']] | string {
    if (this.encoding && this.encoding['range']) {
      return this.encoding['range'] as [
        Output['rangeType'],
        Output['rangeType'],
      ];
    } else {
      return this.default_range;
    }
  }
}

abstract class OneDAesthetic<
  ChannelType extends DS.OneDChannels = DS.OneDChannels,
  Input extends DS.NumberIn | DS.DateIn | DS.CategoryIn = DS.NumberIn,
> extends ScaledAesthetic<ChannelType, Input, DS.NumberOut> {
  constructor(
    encoding: ChannelType | null,
    scatterplot: Scatterplot,
    aesthetic_map: TextureSet,
    id: string,
  ) {
    super(encoding, scatterplot, aesthetic_map, id);
    const scaleType = this.transform;
    if (this.categorical) {
      this.populateCategoricalScale();
    } else {
      if (scaleType === 'linear') {
        this._scale = scaleLinear() as ScaleContinuousNumeric<
          Input['domainType'],
          number
        >;
      } else if (scaleType === 'sqrt') {
        this._scale = scaleSqrt() as ScaleContinuousNumeric<
          Input['domainType'],
          number
        >;
      } else if (scaleType === 'log') {
        this._scale = scaleLog() as ScaleContinuousNumeric<
          Input['domainType'],
          number
        >;
      } else if (scaleType === 'literal') {
        this._scale = scaleIdentity() as unknown as ScaleContinuousNumeric<
          Input['domainType'],
          number
        >;
      }
      const domain = this.domain;
      if (typeof domain[0] !== 'number') {
        throw new Error(
          "Domain expected to be 'number', but was" + typeof domain[0],
        );
      }

      this._scale = (
        this._scale as ScaleContinuousNumeric<
          Input['domainType'],
          number,
          never
        >
      )
        .domain(this.domain as [number, number])
        .range(this.range);
    }
  }

  protected _func?: (d: Input['domainType']) => number;

  toGLType(a: number) {
    return a;
  }

  get default_domain() {
    return [0, 1] as [number, number];
  }
}

export class Size<
  ChannelType extends DS.OneDChannels = DS.OneDChannels,
  Input extends DS.NumberIn | DS.DateIn | DS.CategoryIn =
    | DS.NumberIn
    | DS.DateIn
    | DS.CategoryIn,
> extends OneDAesthetic<ChannelType, Input> {
  default_constant = 1.5;
  get default_range() {
    return [0, 1.5] as [number, number];
  }
  default_transform: DS.Transform = 'sqrt';
}

export abstract class PositionalAesthetic<
  ChannelType extends DS.OneDChannels = DS.OneDChannels,
  Input extends DS.NumberIn | DS.DateIn | DS.CategoryIn =
    | DS.NumberIn
    | DS.DateIn
    | DS.CategoryIn,
> extends OneDAesthetic<ChannelType, Input> {
  // default_range: [number, number] = [-1, 1];
  default_constant = 0;
  default_transform: DS.Transform = 'literal';
  abstract axis: 'x' | 'y';
  get range(): [number, number] {
    if (this.encoding && this.encoding['range']) {
      return this.encoding['range'] as [number, number];
    }
    return this.default_range;
  }
  get default_range(): [number, number] {
    if (
      this.deeptable.extent &&
      this.axis &&
      this.deeptable.extent[this.axis]
    ) {
      return this.deeptable.extent[this.axis];
    }
    return [-1, 1];
  }
}

export class X<
  ChannelType extends DS.OneDChannels = DS.OneDChannels,
  Input extends DS.NumberIn | DS.DateIn | DS.CategoryIn =
    | DS.NumberIn
    | DS.DateIn
    | DS.CategoryIn,
> extends PositionalAesthetic<ChannelType, Input> {
  axis = 'x' as const;
}

export class Y<
  ChannelType extends DS.OneDChannels = DS.OneDChannels,
  Input extends DS.NumberIn | DS.DateIn | DS.CategoryIn =
    | DS.NumberIn
    | DS.DateIn
    | DS.CategoryIn,
> extends PositionalAesthetic<ChannelType, Input> {
  axis = 'y' as const;
}

export class Jitter_speed<
  ChannelType extends DS.OneDChannels = DS.OneDChannels,
  Input extends DS.NumberIn | DS.DateIn | DS.CategoryIn = DS.NumberIn,
> extends OneDAesthetic<ChannelType, Input> {
  default_transform: DS.Transform = 'linear';
  get default_range(): [number, number] {
    return [0, 1];
  }
  public default_constant = 0.5;
  _constant = 0;
}

export class Jitter_radius extends OneDAesthetic {
  _constant = 0;

  toGLType(a: number) {
    return a;
  }
  get default_constant() {
    return 0;
  }

  default_transform: DS.Transform = 'linear';

  get default_range() {
    return [0, 1] as [number, number];
  }
}
