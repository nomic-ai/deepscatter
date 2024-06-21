import type * as DS from '../shared';
import { Aesthetic, Datum } from './Aesthetic';
import { Scatterplot } from '../scatterplot';
import type { TextureSet } from './AestheticSet';
import { isConstantChannel, isLambdaChannel, isOpChannel } from '../typing';

abstract class BooleanAesthetic<
  ChannelType extends
    | DS.OpChannel<number | DS.IsoDateString>
    | DS.ConstantChannel<boolean>
    | DS.LambdaChannel<DS.JSValue, string | number | boolean>,
  Input extends DS.InType,
> extends Aesthetic<ChannelType, Input, DS.BoolOut> {
  protected _func: (d: Input['domainType']) => boolean;
  constructor(
    encoding: ChannelType | null,
    scatterplot: Scatterplot,
    aesthetic_map: TextureSet,
    id: string,
  ) {
    super(encoding, scatterplot, aesthetic_map, id);
    if (isLambdaChannel(encoding)) {
      this._func = encoding.lambda as (d: Input['domainType']) => boolean;
    }
  }

  toGLType(a: boolean) {
    return a ? 1 : 0;
  }

  convertOpDatesToNumbers(
    channel: DS.OpChannel<DS.IsoDateString | number>,
  ): [number, number] {
    if (typeof channel.a === 'number') {
      return [channel.a, channel['b'] === undefined ? -1 : channel['b']] as [
        number,
        number,
      ];
    }
    const vals = [+new Date(channel.a), -1] as [number, number];
    if (channel['b']) {
      vals[1] = +new Date(channel['b'] as DS.IsoDateString);
    }
    return vals;
  }

  // Operations to be applied on the GPU are referenced by passing a function
  // index in the first position, and the two permitted operatnds
  // in the second and third positions.
  ops_to_array(): [number, number, number] {
    const input = this.encoding;
    if (input === null) return [0, 0, 0];
    if (input === undefined) return [0, 0, 0];
    if (!isOpChannel(input)) {
      return [0, 0, 0];
    }
    const [a, b] = this.convertOpDatesToNumbers(input);
    if (input.op === 'within') {
      return [4, a, b];
    }
    if (input.op === 'between') {
      return [4, (b - a) / 2, (b + a) / 2];
    }
    const val = [
      // Encoding of op as number.
      [null, 'lt', 'gt', 'eq'].indexOf(input.op),
      a,
      0,
    ] as [number, number, number];
    return val;
  }

  apply(point: Datum): boolean {
    const channel = this.encoding;
    if (channel === null || channel === undefined) {
      return true;
    }
    if (isOpChannel(channel)) {
      return this.apply_op(point);
    }
    if (isConstantChannel(channel)) {
      if (channel.constant !== true && channel.constant !== false) {
        throw new Error('Constant channel must be boolean');
      }
      return channel.constant;
    }
    if (isLambdaChannel(channel)) {
      if (this._func === undefined) {
        throw new Error(
          '_func should have been bound' + JSON.stringify(this.encoding),
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

  apply_op(point: Datum): boolean {
    if (!isOpChannel(this.encoding)) {
      throw new Error('This should have been checked');
    }
    const encoding = this.encoding;
    const { op } = this.encoding;
    const [a, b] = this.convertOpDatesToNumbers(encoding);
    const p = +this.value_for(point);
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
      return Math.abs(p - b) < a;
    } else if (op === 'between') {
      const mid = (a + b) / 2;
      const diff = Math.abs(a - b) / 2;
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
export class Foreground<
  ChannelType extends DS.BooleanChannel = DS.BooleanChannel,
  Input extends DS.InType = DS.InType,
> extends BooleanAesthetic<ChannelType, Input> {
  default_constant = true;
  default_range: [false, true] = [false, true];
  get active(): boolean {
    // We need to test if the foreground aesthetic is in use.
    // because otherwise it consumes two draw calls.
    if (this.encoding === null || isConstantChannel(this.encoding)) {
      return false;
    }
    return true;
  }
}

export class Filter<
  ChannelType extends DS.BooleanChannel = DS.BooleanChannel,
  Input extends DS.InType = DS.InType,
> extends BooleanAesthetic<ChannelType, Input> {
  default_constant = true;
  default_range: [false, true] = [false, true];
}
