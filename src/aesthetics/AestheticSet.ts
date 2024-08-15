/* eslint-disable no-param-reassign */
import type { Regl, Texture2D } from 'regl';
import { dimensions } from './StatefulAesthetic';
import type { Scatterplot } from '../scatterplot';
import type { Deeptable } from '../Deeptable';
import { StatefulAesthetic } from './StatefulAesthetic';
import type { Encoding } from '../types';
import type * as DS from '../types';

type AesMap = {
  [K in keyof typeof dimensions]: StatefulAesthetic<
    InstanceType<(typeof dimensions)[K]>
  >;
};

type StateList<T> = {
  current: T;
  last: T;
};

export class AestheticSet {
  public tileSet: Deeptable;
  public scatterplot: Scatterplot;
  public regl: Regl;
  public encoding: Encoding = {};
  public position_interpolation: boolean;
  public readonly store: AesMap = {};
  public aesthetic_map: TextureSet;
  public options: {
    jitter_method: StateList<DS.JitterMethod>;
  } = {
    jitter_method: { current: 'None', last: 'None' },
  };
  constructor(scatterplot: Scatterplot, regl: Regl, tileSet: Deeptable) {
    this.scatterplot = scatterplot;
    this.regl = regl;
    this.tileSet = tileSet;
    this.position_interpolation = false;
    this.aesthetic_map = new TextureSet(this.regl);
    for (const [name, Maker] of Object.entries(dimensions)) {
      this.store[name] = new StatefulAesthetic<InstanceType<typeof Maker>>(
        scatterplot,
        regl,
        tileSet,
        this.aesthetic_map,
        Maker,
      );
    }
    return this;
  }

  public dim<T extends keyof AesMap>(aesthetic: T) {
    // Returns the stateful aesthetic corresponding to the given aesthetic.
    // Used for things like 'what color would this point be?'

    if (this.store[aesthetic]) {
      const v = this.store[aesthetic]
      return v;
    }
    if (!dimensions[aesthetic]) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      throw new Error(`Unknown aesthetic ${aesthetic}`);
    }
  }

  *[Symbol.iterator](): Generator<number> {
    throw new Error('DEPRECATED');
    yield 3;
  }

  interpret_position(encoding: Encoding) {
    if (encoding) {
      // First--set position interpolation mode to
      // true if x0 or position0 has been manually passed.

      // If it hasn't, set it to false *only* if the positional
      // parameters have changed.
      if (encoding.x0) {
        this.position_interpolation = true;
      } else if (encoding.x) {
        this.position_interpolation = false;
      }
    }
  }

  apply_encoding(encoding: Encoding) {
    if (
      encoding['jitter_radius'] &&
      encoding['jitter_radius']['jitter_method']
    ) {
      console.warn(
        'jitter_radius.jitter_method is deprecated. Use jitter_method instead.',
      );
      encoding['jitter_method'] = encoding['jitter_radius'][
        'jitter_method'
      ] as DS.JitterMethod;
      delete encoding['jitter_radius']['jitter_method'];
    }
    if (encoding === undefined) {
      // pass with nothing--this will clear out the old saved states
      // to avoid regenerating transitions if you keep replotting
      // keeping something other than the encoding.
      encoding = {};
    }
    this.interpret_position(encoding);
    for (const k in dimensions) {
      this.dim(k).update(encoding[k] as DS.ChannelType | null);
    }

    // Apply settings that are not full-on aesthetics.
    for (const setting of ['jitter_method'] as const) {
      this.options[setting].last = this.options[setting].current;
      if (encoding[setting]) {
        this.options[setting].current = encoding[setting];
      } else {
        this.options[setting].current = this.options[setting].last;
      }
    }
  }

  jitter_int_format(time: 'last' | 'current'): 0 | 1 | 2 | 3 | 4 | 5 {
    return encode_jitter_to_int(this.options.jitter_method[time]);
  }
}

export class TextureSet {
  /**
   * A texture set manages memory allocation for scales. It's mostly 
  used for handling color aesthetics (through the set_color function)

   */
  private _one_d_texture?: Texture2D;
  private _color_texture?: Texture2D;
  public texture_size: number;
  public regl: Regl;
  public id_locs: Record<string, number> = {};
  public texture_widths: number;
  private offsets: Record<string, number> = {};
  private _one_d_position: number;
  private _color_position: number;
  constructor(regl: Regl, texture_size = 4096) {
    this.texture_size = texture_size;
    this.texture_widths = 32; // Relied on general.vert for offsets
    this.regl = regl;
    this._one_d_position = 1;
    this._color_position = -1;
  }

  public get_position(id: string) {
    return this.offsets[id] || 0;
  }

  public set_one_d(id: string, value: number[] | Uint8Array | Float32Array) {
    // id: a unique identifier for the specific aesthetic.
    // value: the array to stash onto the texture.
    let offset: number;
    const { offsets } = this;

    if (offsets[id]) {
      offset = offsets[id];
    } else {
      offset = this._one_d_position++;
      offsets[id] = offset;
    }
    // Draw a stripe with the data of a single pixel width,
    // going down.
    this.one_d_texture.subimage(
      {
        data: value,
        width: 1,
        height: this.texture_size,
      },
      offset,
      0,
    );
  }

  public set_color(id: string, value: Uint8Array) {
    let offset: number;
    const { offsets } = this;
    if (offsets[id]) {
      offset = offsets[id];
    } else {
      offset = this._color_position--;
      offsets[id] = offset;
    }
    this.color_texture.subimage(
      {
        data: value,
        width: 1,
        height: this.texture_size,
      },
      -offset - 1,
      0,
    );
    // -offset because we're coding the color buffer
    // on the negative side of the number line.
  }

  get one_d_texture() {
    if (this._one_d_texture) {
      return this._one_d_texture;
    }
    const texture_type = this.regl.hasExtension('OES_texture_float')
      ? 'float'
      : this.regl.hasExtension('OES_texture_half_float')
        ? 'half float'
        : 'uint8';

    const format = texture_type === 'uint8' ? 'rgba' : 'alpha';

    const params = {
      width: this.texture_widths,
      height: this.texture_size,
      type: texture_type,
      format,
    } as const;
    // Store the current and the last values for transitions.
    this._one_d_texture = this.regl.texture(params);
    return this._one_d_texture;
  }

  get color_texture() {
    if (this._color_texture) {
      return this._color_texture;
    }
    this._color_texture = this.regl.texture({
      width: this.texture_widths,
      height: this.texture_size,
      type: 'uint8',
      format: 'rgba',
    });
    return this._color_texture;
  }
}

// Encode a jitter method for use on the shaders.

function encode_jitter_to_int(jitter: DS.JitterMethod): 0 | 1 | 2 | 3 | 4 | 5 {
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
