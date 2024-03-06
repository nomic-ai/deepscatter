import type * as DS from '../shared';
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
} from 'd3-scale';
import { isConstantChannel, isTransform } from '../typing';
import { Dictionary, Int32, Type, Utf8, Vector } from 'apache-arrow';

export const scales = {
  sqrt: scaleSqrt,
  log: scaleLog,
  linear: scaleLinear,
  literal: scaleIdentity
} as const;
export abstract class ScaledAesthetic<
  ChannelType extends DS.ChannelType = DS.ChannelType,
  Input extends DS.NumberIn | DS.DateIn | DS.CategoryIn = DS.NumberIn | DS.DateIn | DS.CategoryIn,
  Output extends DS.NumberOut | DS.ColorOut = DS.NumberOut | DS.ColorOut
> extends Aesthetic<ChannelType, Input, Output> {
  protected _scale: ScaleContinuousNumeric<
    Input['domainType'],
    Output['rangeType']
  > | ScaleOrdinal<Input['domainType'], Output['rangeType']>;
  public default_transform: DS.Transform = 'linear';
  abstract default_range: [Output['rangeType'], Output['rangeType']];
  protected categorical; // Whether this is built on a dictionary variable.

  constructor(
    encoding: ChannelType | null,
    scatterplot: Scatterplot,
    aesthetic_map: TextureSet,
    id: string
  ) {
    super(encoding, scatterplot, aesthetic_map, id);
    let scaleType: DS.Transform = this.default_transform;
    if (
      encoding &&
      encoding['transform'] &&
      isTransform(encoding['transform'])
    ) {
      scaleType = encoding['transform'];
    }

    this.categorical = false;
    
    if (this.is_dictionary()) {
      this.categorical = true;
      this.populateCategoricalScale();
    } else {
      if (scaleType === 'linear') {
        this._scale = scaleLinear() as ScaleContinuousNumeric<
        Input['domainType'],
        Output['rangeType']
      >;
      } else if (scaleType === 'sqrt') {
        this._scale = scaleSqrt() as ScaleContinuousNumeric<
          Input['domainType'],
          Output['rangeType']
        >;
      } else if (scaleType === 'log') {
        this._scale = scaleLog() as ScaleContinuousNumeric<
        Input['domainType'],
        Output['rangeType']
      >;
      } else if (scaleType === 'literal') {
        this._scale = scaleLinear() as ScaleContinuousNumeric<
        Input['domainType'],
        Output['rangeType']
      >;
      }
      const domain = this.domain;
      if (typeof domain[0] !== 'number') {
        throw new Error("Domain expected to be 'number', but was" + typeof domain[0])
      }
      this._scale = (this._scale as ScaleContinuousNumeric<Input["domainType"], Output["rangeType"], never>)
        .domain(this.domain as [number, number])
    }
  }

  protected categoricalValues() : Input['domainType'][] {

    const col = this.arrow_column() as Vector<Dictionary<Utf8, Int32>>;
    let values : string[];
    if (col.type.typeId === Type.Dictionary) {
      const d = col.data[0].dictionary as Vector<Utf8>
      values = d.toArray() as unknown as string[];
    } /* else if (col.type.typeId === Type.Bool) {
      TODO: integer and bool support.      
    }*/  else {
      throw new Error("Only dictionary columns can create categorical values for now scales.");
    }
    return values as Input['domainType'][];
  }

  // TODO: this class can eventually handle integer and booleans passed as well.
  protected populateCategoricalScale() {
    console.log("Populating categorical scale")
    this._scale = (scaleOrdinal() as ScaleOrdinal<
      Input['domainType'],
      Output['rangeType']
    >).domain(this.categoricalValues()).range(this.range);
  }
  
  /**
   * Returns two numbers that indicate the extent of
   * the attribute written to webGL.
   */
  get webGLDomain(): [number, number] {
    const [min, max] = this.domain || [undefined, undefined];

    if (this.categorical) {
        return [0, this.categoricalValues().length - 1]
    }

    if (typeof min === 'number' && typeof max === 'number') {
      return [min, max];
    }
    throw new Error("Unable to generate appropriate GL Domain")
  }

  get transform(): DS.Transform {

    if (this.encoding && this.encoding['transform']) {
      return this.encoding['transform'] as DS.Transform;
    }
    return this.default_transform;
  }

  get scale() {
    if (this.categorical) {
      return this._scale as ScaleOrdinal<Input["domainType"], Output["rangeType"], never>;
    } else {
      return this._scale as ScaleContinuousNumeric<Input["domainType"], Output["rangeType"], never>;
    }
  }

  apply(point: Datum) {
    const constant = isConstantChannel(this.encoding) ? this.encoding.constant : this.default_constant
    if (this.field === null || isConstantChannel(this.encoding)) {
      return constant as Output["rangeType"];
    }
    const value = point[this.field] as Input['domainType'];
    if (value === undefined || value === null) {
      return constant as Output["rangeType"];
    }
    if (this.categorical) {
      const scale = this.scale as ScaleOrdinal<Input['domainType'], Output['rangeType']>
      return scale(value)
    } else {
      const scale = this.scale as ScaleContinuousNumeric<Input["domainType"], Output["rangeType"], never>;
      // Todo why do the types let this be a string?
      return scale(value as number | Date) ;
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

    const domain = this.dataset.domain(this.field);
    return domain;
  }

  get domain(): [Input['domainType'], Input['domainType']] {
    if (this.encoding === null || this.field === null) {
      return this.default_domain;
    } else if (this.encoding['domain']) {
      return this.encoding['domain'] as [Input['domainType'], Input['domainType']];
    } else  {
      return this.scatterplot.dataset.domain(this.field);
    }
  }

  get range(): [Output['rangeType'], Output['rangeType']] {
    if (this.encoding && this.encoding['range']) {
      return this.encoding['range'] as [Output['rangeType'], Output['rangeType']];
    } else {
      return this.default_range;
    }
  }
}

abstract class OneDAesthetic<
  ChannelType extends DS.OneDChannels = DS.OneDChannels,
  Input extends DS.NumberIn | DS.DateIn | DS.CategoryIn = DS.NumberIn
> extends ScaledAesthetic<ChannelType, Input, DS.NumberOut> {
  constructor(
    encoding: ChannelType | null,
    scatterplot: Scatterplot,
    aesthetic_map: TextureSet,
    id: string
  ) {
    super(encoding, scatterplot, aesthetic_map, id);
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
  Input extends DS.NumberIn | DS.DateIn | DS.CategoryIn = DS.NumberIn | DS.DateIn | DS.CategoryIn
  > extends OneDAesthetic<ChannelType, Input> {
  default_constant = 1.5;
  get default_range() {
    return [0, 1.5] as [number, number];
  }
  default_transform: DS.Transform = 'sqrt';
}

export class PositionalAesthetic<
  ChannelType extends DS.OneDChannels = DS.OneDChannels,
  Input extends DS.NumberIn | DS.DateIn | DS.CategoryIn = DS.NumberIn | DS.DateIn | DS.CategoryIn
  > extends OneDAesthetic<ChannelType, Input> {
  default_range: [number, number] = [-1, 1];
  default_constant = 0;
  default_transform: DS.Transform = 'literal';
  
  get range(): [number, number] {
    if (this.encoding && this.encoding['range']) {
      return this.encoding['range'] as [number, number]
    } else if (this.dataset.extent && this.field && this.dataset.extent[this.field]) {
      return this.dataset.extent[this.field as 'x' | 'y'];
    }
    return this.default_range;
  }
}

// export const X = PositionalAesthetic;

// export const X0 = X;

// export const Y = PositionalAesthetic;

// export const Y0 = PositionalAesthetic

export class Jitter_speed<
  ChannelType extends DS.OneDChannels = DS.OneDChannels,
  Input extends DS.NumberIn | DS.DateIn | DS.CategoryIn = DS.NumberIn
  > extends OneDAesthetic<ChannelType, Input> {
  default_transform: DS.Transform = 'linear';
  default_range: [number, number] = [0, 1];
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
