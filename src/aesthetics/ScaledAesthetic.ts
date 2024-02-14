
import type * as DS from '../shared'
import { Aesthetic } from './Aesthetic';
import Scatterplot from '../deepscatter';
abstract class ScaledAesthetic<
    ChannelType extends DS.ChannelType = DS.ConstantChannel<number>,
    Input extends DS.NumberIn | DS.DateIn | DS.CategoryIn = DS.NumberIn,
    Output extends DS.OutType = DS.NumberOut | DS.ColorOut
  > extends Aesthetic<
    ChannelType, Input, Output
  > {
    protected _scale: ScaleContinuousNumeric<Input['domainType'], Output['rangeType']>
    public default_transform : DS.Transform = 'linear';
    abstract default_range: [Output['rangeType'], Output['rangeType']] 
    constructor(
      encoding: ChannelType | null,
      scatterplot: Scatterplot,
      aesthetic_map: TextureSet,
      id: string
    ) {
      super(encoding, scatterplot, aesthetic_map, id);
      let scaleType : DS.Transform = this.default_transform;
      if (encoding && encoding['transform'] && isTransform(encoding['transform'])) {
        scaleType = encoding['transform']
      }

      if (scaleType === 'linear') {
        this._scale = scaleLinear()
      } else if (
        scaleType === 'sqrt'
      ) {
        this._scale = scaleSqrt()
      } else if (
        scaleType === 'log'
      ) {
        this._scale = scaleLog()
      } else if (
        scaleType === 'literal'
      ) {
        this._scale = scaleLinear()
      }
    }
    /**
     * Returns two numbers that indicate the extent of 
     * the attribute written to webGL.
     */
    get GLDomain() : [number, number] {
      const [min, max] = this.domain || [undefined, undefined];

      if (typeof(min) === "number" && typeof(max) === "number") {
        return [min, max]
      }

      if (typeof(min) === "Date") {
        
      }

    }
    get transform() : DS.Transform  {
      if (this.encoding['transform']) {
        return this.encoding['transform'] as DS.Transform
      }
      return this.default_transform;
    }

    get scale(): {  
      this._scale = this._scale.domain(this.domain)
      return this._scale;
    }
  
}

abstract class OneDAesthetic<
  ChannelType extends DS.OneDChannels = DS.OneDChannels,
  Input extends DS.NumberIn | DS.DateIn | DS.CategoryIn = DS.NumberIn,
> extends ScaledAesthetic<ChannelType, Input, DS.NumberOut> {

  public _range: [Input['jsonType'], Input['jsonType']];
  constructor(
    encoding: ChannelType | null,
    scatterplot: Scatterplot,
    aesthetic_map: TextureSet,
    id: string
  ) {
    
    super(encoding, scatterplot, aesthetic_map, id);

    if (isConstantChannel(encoding)) {
      return
    }
    if (encoding.domain === undefined) {
      encoding.domain = this.default_domain;
    }
    
    if (encoding.range !== undefined) {
      this._domain = encoding.domain;
      this._range = encoding.range;
    }
    this.encoding = null;
  }

  toGLType(a: number) {
    return a;
  }

  get default_domain() {
    return [0, 1] as [number, number];
  }
}

export class Size extends OneDAesthetic {
  field = 'size'
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
    encoding: DS.OneDChannels,
    scatterplot: Scatterplot,
    regl: Regl,
    dataset: DS.Dataset,
  ) {
    super(encoding, scatterplot, regl, dataset);
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
    return this.encoding?.method ?? 'None';
  }

  set method(value: DS.JitterRadiusMethod) {
    this._method = value;
  }

  get jitter_int_format() {
    return encode_jitter_to_int(this.method);
  }
}
