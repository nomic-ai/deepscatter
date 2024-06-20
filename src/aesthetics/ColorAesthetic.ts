import type * as DS from '../shared';

import { range as arange, shuffler } from 'd3-array';
import { isConstantChannel } from '../typing';
import { rgb } from 'd3-color';
import * as d3Chromatic from 'd3-scale-chromatic';
const PALETTE_SIZE = 4096;
import { randomLcg } from 'd3-random';
import { Dictionary, Int32, Utf8, Vector } from 'apache-arrow';
import { ScaledAesthetic } from './ScaledAesthetic';
import { Scatterplot } from '../scatterplot';
import { TextureSet } from './AestheticSet';
import { Datum } from './Aesthetic';
import {
  ScaleOrdinal,
  scaleSequentialLog,
  scaleSequentialSqrt,
  scaleSequential,
} from 'd3-scale';
import { interpolateHsl } from 'd3-interpolate';

function materialize_color_interpolator(
  interpolator: (t: number) => string,
): Uint8Array {
  const output = new Uint8Array(4 * PALETTE_SIZE);
  arange(PALETTE_SIZE).forEach((i) => {
    const p = rgb(interpolator(i / PALETTE_SIZE));
    output.set([p.r, p.g, p.b, 255], i * 4);
  });
  return output;
}

const color_palettes: Record<string, Uint8Array> = {
  white: new Uint8Array(4 * PALETTE_SIZE).fill(255),
};

const schemes: Record<string, readonly string[]> = {};
const interpolators: Record<string, typeof d3Chromatic.interpolateViridis> = {};

function palette_from_color_strings(colors: readonly string[]): Uint8Array {
  // Fills a large Uint8Array by decomposing the colors and repeating over them.
  const scheme = colors.map((color) => {
    const col = rgb(color);
    return [col.r, col.g, col.b, 255];
  });
  const output = new Uint8Array(PALETTE_SIZE * 4);

  const repeat_each = Math.floor(PALETTE_SIZE / colors.length);
  for (let i = 0; i < colors.length; i++) {
    for (
      let j = 0;
      j < repeat_each && i * repeat_each + j < PALETTE_SIZE;
      j++
    ) {
      output.set(scheme[i], (i * repeat_each + j) * 4);
    }
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
  color_palettes['okabe'] = palette_from_color_strings(okabe_palette);
  schemes['okabe'] = okabe_palette;
}

const d3Interpolators = [
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
] as const;

for (const interpolator of d3Interpolators) {
  const nickname = interpolator.replace('interpolate', '');

  const v = d3Chromatic[interpolator];

  // First store the d3 type for scale-building in javascript.
  interpolators[nickname] = v;
  interpolators[nickname.toLowerCase()] = v;
  interpolators[nickname.toLowerCase()[0] + nickname.slice(1)] = v;

  // Then store an underlying block of colors for webGL work.
  const materialized = materialize_color_interpolator(v);
  color_palettes[nickname] = materialized;
  color_palettes[nickname.toLowerCase()] = materialized;
  color_palettes[nickname.toLowerCase()[0] + nickname.slice(1)] = materialized;

  if (nickname === 'Rainbow') {
    // Deterministic random shuffle orders
    const shuffle = shuffler(randomLcg(1));
    color_palettes.shufbow = shuffle(color_palettes[nickname]);
  }
}

function getSequentialScale(
  range: string | [string, string],
  transform: DS.Transform,
) {
  let interpolator: typeof d3Chromatic.interpolateViridis;
  if (typeof range === 'string') {
    // So we have to write `puOr`, `viridis`, etc. instead of `PuOr`, `Viridis`
    interpolator = interpolators[range];
    if (interpolator === undefined) {
      throw new Error(`Unknown interpolator ${range}`);
    }
  } else {
    interpolator = interpolateHsl(...range);
  }
  // Try it in lowercase too

  if (transform === 'sqrt') {
    return scaleSequentialSqrt(interpolator);
  } else if (transform === 'log') {
    return scaleSequentialLog(interpolator);
  } else {
    return scaleSequential(interpolator);
  }
}

export class Color<
  ChannelType extends DS.ColorScaleChannel = DS.ColorScaleChannel,
  Input extends DS.NumberIn | DS.DateIn | DS.CategoryIn =
    | DS.NumberIn
    | DS.DateIn
    | DS.CategoryIn,
> extends ScaledAesthetic<ChannelType, Input, DS.ColorOut> {
  protected _func?: (d: Input['domainType']) => string;
  public _texture_buffer: Uint8Array | null = null;
  public texture_type = 'uint8';
  public default_constant = '#CC5500';
  default_transform: DS.Transform = 'linear';

  constructor(
    encoding: ChannelType | null,
    scatterplot: Scatterplot,
    map: TextureSet,
    id: string,
  ) {
    super(encoding, scatterplot, map, id);

    if (this.categorical) {
      this.populateCategoricalScale();
    } else {
      this._scale = getSequentialScale(this.range, this.transform);
      this._scale.domain(this.domain as [number, number] | [Date, Date]);
    }

    this.encoding = encoding;
    if (encoding) {
      if (isConstantChannel(encoding)) {
        return;
      }
      if (encoding['range']) {
        this.encode_for_textures(encoding['range']);
        this.post_to_regl_buffer();
      } else {
        throw new Error(
          'Unexpected color encoding -- must have range.' +
            JSON.stringify(encoding),
        );
      }
    }
    if (this.scale.range().length === 0) {
      throw new Error('Color scale has no range.');
    }
  }

  get default_range(): [string, string] {
    return ['white', 'blue'];
  }

  protected categoricalRange(): string[] {
    if (this.encoding && this.encoding['range']) {
      if (typeof this.encoding['range'] === 'string') {
        return [...schemes[this.encoding['range']]];
      }
    }
    return this.encoding['range'] as string[];
  }

  post_to_regl_buffer() {
    const color = this.texture_buffer;
    this.aesthetic_map.set_color(this.id, color);
  }

  default_data(): Uint8Array {
    return color_palettes.viridis;
  }

  get range(): string | [string, string] {
    if (this.encoding && this.encoding['range']) {
      return this.encoding['range'] as [string, string] | string;
    } else {
      return this.default_range;
    }
  }

  get use_map_on_regl() {
    // Always use a map for colors.
    return 1 as const;
  }

  get colorscheme_size(): number {
    if (this.categorical) {
      const scale = this.scale;
      return scale.range().length;
    }
  }

  apply(v: Datum): string {
    if (this.encoding === null) {
      return this.default_constant;
    }

    if (isConstantChannel(this.encoding)) {
      return this.encoding.constant;
    }
    const scale = this.scale as ScaleOrdinal<Input['domainType'], string>;
    return scale(v[this.field] as Input['domainType']);
  }

  toGLType(color: string) {
    const { r, g, b } = rgb(color);
    return [r / 255, g / 255, b / 255] as [number, number, number];
  }

  encode_for_textures(range: string | [string, string] | string[]): void {
    if (Array.isArray(range)) {
      const key = range.join('/');
      if (color_palettes[key]) {
        this.texture_buffer.set(color_palettes[key]);
        return;
      }
      let palette: Uint8Array;
      if (!this.is_dictionary()) {
        palette = palette_from_color_strings(range);
      } else {
        // We need to find the integer identifiers for each of
        // the values in the domain.
        const vec = (this.column as Vector<Dictionary<Utf8, Int32>>).data[0];
        const data_values = (
          vec.dictionary as Vector<Utf8>
        ).toArray() as unknown as Input['domainType'][];
        const dict_values: Map<Input['domainType'], number> = new Map();
        let i = 0;
        for (const val of data_values) {
          dict_values.set(val, i++);
        }
        const colors: string[] = [];
        for (let i = 0; i < this.domain.length; i++) {
          const label = this.domain[i];
          const color = range[i];
          if (dict_values.get(label) !== undefined) {
            colors[dict_values.get(label)] = color;
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
    if (color_palettes[range]) {
      this.texture_buffer.set(color_palettes[range]);
      return;
    }
    throw new Error(
      `request range of ${range} for color ${this.field} unknown`,
    );
  }
}
