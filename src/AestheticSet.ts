/* eslint-disable no-param-reassign */
import type { Regl, Texture2D } from 'regl';
import { dimensions } from './StatefulAesthetic';
import type Scatterplot from './deepscatter';
import type { QuadtileSet } from './Dataset';
import { StatefulAesthetic } from './StatefulAesthetic';
import { Aesthetic } from './Aesthetic';

export class AestheticSet {
  public tileSet: QuadtileSet;
  public scatterplot: Plot;
  public regl: Regl;
  public encoding: Encoding = {};
  public position_interpolation: boolean;
  private store: Record<string, StatefulAesthetic>;
  public aesthetic_map: TextureSet;
  constructor(scatterplot: Plot, regl: Regl, tileSet: QuadtileSet) {
    this.scatterplot = scatterplot;
    this.store = {};
    this.regl = regl;
    this.tileSet = tileSet;
    this.position_interpolation = false;
    this.aesthetic_map = new TextureSet(this.regl);
    return this;
  }

  public dim(aesthetic: keyof typeof dimensions) {
    // Returns the stateful aesthetic corresponding to the given aesthetic.
    if (this.store[aesthetic]) {
      return this.store[aesthetic];
    }
    if (!dimensions[aesthetic]) {
      throw new Error(`Unknown aesthetic ${aesthetic}`);
    }
    const Maker = dimensions[aesthetic];
    const p = this.scatterplot;
    const regl = this.regl;
    const map = this.aesthetic_map;
    const my_dim = new StatefulAesthetic<typeof Maker>(
      p,
      regl,
      this.tileSet,
      map,
      Maker
    );
    this.store[aesthetic] = my_dim;
    return my_dim;
  }

  *[Symbol.iterator](): Iterator<[string, StatefulAesthetic<any>]> {
    for (const [k, v] of Object.entries(this.store)) {
      yield [k, v];
    }
  }

  interpret_position(encoding: Encoding) {
    /*
      You can specify just 'position' or 'position0' as a string and it will 
      parse into 'position.x' or 'position.x0' and 'position.y' or 'position.y0'.
    */

    if (encoding) {
      // First--set position interpolation mode to
      // true if x0 or position0 has been manually passed.

      // If it hasn't, set it to false *only* if the positional
      // parameters have changed.
      if (encoding.x0 || encoding.position0) {
        this.position_interpolation = true;
      } else if (encoding.x || encoding.position) {
        this.position_interpolation = false;
      }
      for (const p of ['position', 'position0']) {
        const suffix = p.replace('position', '');
        if (encoding[p]) {
          if (encoding[p] === 'literal') {
            // A shortcut.
            encoding[`x${suffix}`] = {
              field: 'x',
              transform: 'literal',
            };
            encoding[`y${suffix}`] = {
              field: 'y',
              transform: 'literal',
            };
          } else {
            const field = encoding[p];
            encoding[`x${suffix}`] = {
              field: `${field}.x`,
              transform: 'literal',
            };
            encoding[`y${suffix}`] = {
              field: `${field}.y`,
              transform: 'literal',
            };
          }
          delete encoding[p];
        }
      }
    }
    delete encoding.position;
    delete encoding.position0;
  }

  apply_encoding(encoding: Encoding) {
    if (encoding === undefined) {
      // pass with nothing--this will clear out the old saved states
      // to avoid regenerating transitions if you keep replotting
      // keeping something other than the encoding.
      encoding = {};
    }
    if (encoding.filter1) {
      throw new Error('filter1 is not supported; just say "filter"');
    }
    // Overwrite position fields.
    this.interpret_position(encoding);
    for (const k of Object.keys(dimensions)) {
      this.dim(k).update(encoding[k]);
    }
  }
}

export class TextureSet {
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
    let offset;
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
      0
    );
  }

  public set_color(id: string, value: Uint8Array) {
    let offset;
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
      0
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
    };
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
