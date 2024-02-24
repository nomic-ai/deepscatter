import type * as DS from '../shared';
import { Aesthetic, Datum } from './Aesthetic';
import { Scatterplot } from '../deepscatter';
import type { TextureSet } from './AestheticSet';

import { isConstantChannel, isTransform } from '../typing';
import { Float, Int, Timestamp } from 'apache-arrow';


abstract class BooleanAesthetic<
  ChannelType extends DS.OpChannel<Timestamp | Float | Int> | DS.ConstantChannel<boolean> | DS.LambdaChannel<string | number | boolean>,
  Input extends DS.InType
>extends Aesthetic<
    ChannelType,
    Input,
    DS.BoolOut
  > {
  constructor(
    scatterplot: Scatterplot,
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

    if (this.encoding !== null && Object.keys(this.encoding).length === 0) {
      this.encoding = null;
    }
  }

  ops_to_array(): DS.OpArray {
    const input = this.encoding;
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
    const channel = this.encoding;
    if (channel === null || channel === undefined) {
      return true;
    }
    if (isOpChannel(channel)) {
      return this.apply_op(point, channel);
    }
    if (isConstantChannel(channel)) {
      // TODO: TS
      if ((channel.constant as unknown as number) === 0) {
        console.warn(
          'Deprecated: pass `true` or `false` to boolean fields, not numbers'
        );
        return false;
      }
      if ((channel.constant as unknown as number) === 1) {
        console.warn(
          'Deprecated: pass `true` or `false` to boolean fields, not numbers'
        );
        return true;
      }
      return channel.constant;
    }
    if (isLambdaChannel(channel)) {
      if (this._func === undefined) {
        throw new Error(
          '_func should have been bound' + JSON.stringify(this.encoding)
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
  public encoding: DS.BooleanChannel = null;
  _constant = true;
  default_constant = true;
  default_range = [0, 1] as [number, number];
  default_transform: DS.Transform = 'literal';
  get active(): boolean {
    // We need to test if the foreground aesthetic is in use.
    // because otherwise it consumes two draw calls.
    if (this.encoding === null || isConstantChannel(this.encoding)) {
      return false;
    }
    return true;
  }
}

export class Filter extends BooleanAesthetic {
  public encoding = null;
  _constant = true;
  default_constant = true;
  default_transform: DS.Transform = 'literal';
  default_range: [number, number] = [0, 1];
}
