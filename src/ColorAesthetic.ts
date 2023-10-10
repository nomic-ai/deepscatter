import { Aesthetic, scales } from './Aesthetic';
import type * as DS from './shared.d'

import type { Regl, Texture2D } from 'regl';
import { range as arange, extent, shuffler } from 'd3-array';
import { isConstantChannel, isOpChannel } from './typing';
import {
  scaleLinear,
  scaleSqrt,
  scaleLog,
  scaleIdentity,
  scaleOrdinal,
  scaleSequential,
  scaleSequentialLog,
  scaleSequentialPow,
  scaleImplicit,
} from 'd3-scale';
import { rgb } from 'd3-color';
import * as d3Chromatic from 'd3-scale-chromatic';
const palette_size = 4096;
import { randomLcg } from 'd3-random';
import { Dictionary, Int, Int32, Utf8, Vector } from 'apache-arrow';
/*function to_buffer(data: number[] | number[][]) {
  output.set(data.flat());
  return output;
}*/

function materialize_color_interplator(
  interpolator: (t: number) => string
): Uint8Array {
  const output = new Uint8Array(4 * palette_size);
  arange(palette_size).forEach((i) => {
    const p = rgb(interpolator(i / palette_size));
    output.set([p.r, p.g, p.b, 255], i * 4);
  });
  return output;
}

const color_palettes: Record<string, Uint8Array> = {
  white: new Uint8Array(4 * palette_size).fill(255),
};

const schemes: Record<string, readonly string[]> = {};

function palette_from_color_strings(colors: readonly string[]): Uint8Array {
  // Fills a large Uint8Array by decomposing the colors and repeating over them.
  const scheme = colors.map((color) => {
    const col = rgb(color);
    return [col.r, col.g, col.b, 255];
  });
  const output = new Uint8Array(palette_size * 4);

  const repeat_each = Math.floor(palette_size / colors.length);
  for (let i = 0; i < colors.length; i++) {
    for (let j = 0; j < repeat_each && (i * repeat_each + j < palette_size); j++) {
      output.set(scheme[i], (i * repeat_each + j) * 4);
    }
//    output.set(scheme[i % colors.length], i *  4);
  }

  return output;
}

for (const schemename of [
  'schemeAccent',
  'schemeCategory10',
  'schemeDark2',
  'schemePaired',
  'schemePastel1',
  'schemePastel2',
  'schemeSet1',
  'schemeSet2',
  'schemeSet3',
  'schemeTableau10',
] as const) {
  const colors = d3Chromatic[schemename];

  const name = schemename.replace('scheme', '').toLowerCase();
  color_palettes[name] = palette_from_color_strings(colors);
  schemes[name] = colors;
}

for (const interpolator of [
  'interpolateBlues',
  'interpolateBrBG',
  'interpolateBuGn',
  'interpolateBuPu',
  'interpolateCividis',
  'interpolateCool',
  'interpolateCubehelixDefault',
  'interpolateGnBu',
  'interpolateGreens',
  'interpolateGreys',
  'interpolateInferno',
  'interpolateMagma',
  'interpolateOrRd',
  'interpolateOranges',
  'interpolatePRGn',
  'interpolatePiYG',
  'interpolatePlasma',
  'interpolatePuBu',
  'interpolatePuBuGn',
  'interpolatePuOr',
  'interpolatePuRd',
  'interpolatePurples',
  'interpolateRainbow',
  'interpolateRdBu',
  'interpolateRdGy',
  'interpolateRdPu',
  'interpolateRdYlBu',
  'interpolateRdYlGn',
  'interpolateReds',
  'interpolateSinebow',
  'interpolateSpectral',
  'interpolateTurbo',
  'interpolateViridis',
  'interpolateWarm',
  'interpolateYlGn',
  'interpolateYlGnBu',
  'interpolateYlOrBr',
  'interpolateYlOrRd',
] as const) {
  const name = interpolator.replace('interpolate', '').toLowerCase();
  const v = d3Chromatic[interpolator];
  color_palettes[name] = materialize_color_interplator(v);
  if (name === 'rainbow') {
    // Deterministic random shuffle orders
    const shuffle = shuffler(randomLcg(1));
    color_palettes.shufbow = shuffle(color_palettes[name]);
  }
}

function okabe() {
  // Okabe-Ito color scheme.
  const okabe_palette = [
    '#E69F00',
    '#CC79A7',
    '#56B4E9',
    '#009E73',
    '#0072B2',
    '#D55E00',
    '#F0E442',
  ];
  color_palettes.okabe = palette_from_color_strings(okabe_palette);
  schemes['okabe'] = okabe_palette;
}

okabe();

export class Color extends Aesthetic<
  [number, number, number],
  string,
  DS.ColorChannel
> {
  _constant = '#CC5500';
  public texture_type = 'uint8';
  public default_constant = '#CC5500';
  default_transform: DS.Transform = 'linear';
  get default_range(): [number, number] {
    return [0, 1];
  }
  current_encoding: null | DS.ColorChannel = null;
  default_data(): Uint8Array {
    return color_palettes.viridis;
  }
  get use_map_on_regl() {
    // Always use a map for colors.
    return 1 as const;
  }

  get colorscheme_size() : number {
    if (this.is_dictionary()) {
      return (this.scale.range().length as unknown as number);
    }
    return -1;
  }

  get scale() {
    if (this._scale) {
      return this._scale;
    }

    const range = this.range;

    function capitalize(r: string) {
      // TODO: this can't be right for RdBu, etc. and
      // aso for ylorrd.
      if (r === 'ylorrd') {
        return 'YlOrRd';
      }
      return r.charAt(0).toUpperCase() + r.slice(1);
    }

    if (this.is_dictionary()) {
      const scale = scaleOrdinal().domain(this.domain);
      if (typeof range === 'string' && schemes[range]) {
        const dictionary = this.column.data[0].dictionary as Vector<Utf8>;
        if (dictionary === null) {
          throw new Error('Dictionary is null');
        }
        const keys = dictionary.toArray() as unknown as string[];
        return (this._scale = scaleOrdinal()
          .range(schemes[range])
          .domain(keys));
      } else {
        return (this._scale = scale.range(this.range));
      }
    }

    // If not a dictionary, it's a different type.
    if (typeof range == 'string') {
      // Convert range from 'viridis' to InterpolateViridis.

      const interpolator = d3Chromatic['interpolate' + capitalize(range)];
      if (interpolator !== undefined) {
        // linear maps to nothing, but.
        // scaleLinear, and scaleLog but
        // scaleSequential and scaleSequentialLog.
        if (this.transform === 'sqrt') {
          return (this._scale = scaleSequentialPow(interpolator)
            .exponent(0.5)
            .domain(this.domain));
        } else if (this.transform === 'log') {
          return (this._scale = scaleSequentialLog(interpolator).domain(
            this.domain
          ));
        } else {
          return (this._scale = scaleSequential(interpolator).domain(
            this.domain
          ));
        }
      }
    }
  }

  get texture_buffer() {
    if (this._texture_buffer) {
      return this._texture_buffer;
    }
    this._texture_buffer = new Uint8Array(this.aesthetic_map.texture_size * 4);
    this._texture_buffer.set(this.default_data());
    return this._texture_buffer;
  }

  post_to_regl_buffer() {
    this.aesthetic_map.set_color(this.id, this.texture_buffer);
  }

  update(encoding: DS.ColorChannel) {
    super.update(encoding);
    this.current_encoding = encoding;
    if (encoding === null) {
      encoding = {
        constant: this.default_constant,
      };
    }
    if (!isConstantChannel(encoding)) {
      if (encoding.range && typeof encoding.range[0] === 'string') {
        this.encode_for_textures(encoding.range);
        this.post_to_regl_buffer();
      } else if (encoding.range) {
        this.post_to_regl_buffer();
      }
    }
  }

  toGLType(color: string) {
    const { r, g, b } = rgb(color);
    return [r / 255, g / 255, b / 255] as [number, number, number];
  }

  encode_for_textures(range: string | string[]): void {
    if (Array.isArray(range)) {
      const key = range.join('/');
      if (color_palettes[key]) {
        this.texture_buffer.set(color_palettes[key]);
        return;
      } else {
        let palette: Uint8Array;
        if (!this.is_dictionary()) {          
          palette = palette_from_color_strings(range);
        } else {
          // We need to find the integer identifiers for each of
          // the values in the domain.
          const data_values = this.column.data[0].dictionary!.toArray();
          const dict_values = Object.fromEntries(
            data_values.map((val: string, i: Number) => [val, i])
          );
          const colors: string[] = [];
          for (let i = 0; i < this.domain.length; i++) {
            const label = this.domain[i];
            const color = range[i];
            if (dict_values[label] !== undefined) {
              colors[dict_values[label]] = color;
            }
          }
          for (let i = 0; i < data_values.length; i++) {
            if (colors[i] === undefined) {
              colors[i] = 'gray';
            }
          }
          palette = palette_from_color_strings(colors);
        }
        this.texture_buffer.set(palette);
        return;
      }
    }
    if (color_palettes[range]) {
      this.texture_buffer.set(color_palettes[range]);
      return;
    }
    if (range.length === this.aesthetic_map.texture_size * 4) {
      throw new Error('SETTING FULL RANGE IS DEPRECATED')
    }
    console.error(`request range of ${range} for color ${this.field} unknown`);
  }
}
