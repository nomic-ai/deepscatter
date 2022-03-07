/* eslint-disable no-param-reassign */
import type { Regl } from 'regl';
import { dimensions as Aesthetic, 
  default_aesthetics, StatefulAesthetic 
} from './Aesthetic';
import type Scatterplot from './deepscatter';
import type RootTile from './tile';
import type { Encoding } from './types';
export const aesthetic_variables = Array.from(Object.keys(Aesthetic))
  .map((d) => d.toLowerCase());

export class AestheticSet {
  public tileSet : RootTile;
  public scatterplot : Scatterplot;
  public regl : Regl;
  public encoding : Encoding;
  public position_interpolation : boolean;
  public x : StatefulAesthetic;
  public y : StatefulAesthetic;
  public size : StatefulAesthetic
  public color : StatefulAesthetic;
  public filter : StatefulAesthetic;
  public filter2 : StatefulAesthetic;
  public jitter_speed : StatefulAesthetic;
  public jitter_radius : StatefulAesthetic;
  
  constructor(scatterplot : Scatterplot, regl : Regl, tileSet : RootTile) {
    this.scatterplot = scatterplot;
    this.regl = regl;
    this.tileSet = tileSet;
    this.position_interpolation = false;
    const rest = [scatterplot, regl, tileSet];
    this.x= new StatefulAesthetic('X', scatterplot, regl, tileSet);
    this.y = new StatefulAesthetic('Y', scatterplot, regl, tileSet);
    this.color = new StatefulAesthetic('Color', scatterplot, regl, tileSet);
    this.filter = new StatefulAesthetic('Filter', scatterplot, regl, tileSet);
    this.filter2 = new StatefulAesthetic('Filter2', scatterplot, regl, tileSet);
    this.jitter_speed = new StatefulAesthetic('Jitter_speed', scatterplot, regl, tileSet);
    this.jitter_radius = new StatefulAesthetic('Jitter_radius', scatterplot, regl, tileSet);
    this.size = new StatefulAesthetic('Size', scatterplot, regl, tileSet);
    return this
  }
  
  *[Symbol.iterator]() : Iterator<[string, StatefulAesthetic]> {
    for (let k of ['x', 'y', 'color', 'filter', 'filter2',
                   'jitter_speed', 'jitter_radius', 'size']) {
      yield [k, this[k]];
    }
  }

  interpret_position(encoding : Encoding) {
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
              field: 'x', transform: 'literal',
            };
            encoding[`y${suffix}`] = {
              field: 'y', transform: 'literal',
            };
          } else {
            const field = encoding[p];
            encoding[`x${suffix}`] = {
              field: `${field}.x`, transform: 'literal',
            };
            encoding[`y${suffix}`] = {
              field: `${field}.y`, transform: 'literal',
            };
          }
          delete encoding[p];
        }
      }
    }
    delete encoding.position;
    delete encoding.position0;
  }

  apply_encoding(encoding) {
    if (encoding === undefined) {
      // pass with nothing--this will clear out the old saved states
      // to avoid regenerating transitions if you keep replotting
      // keeping something other than the encoding.
      encoding = {};
    }

    if (encoding.filter1) {
      encoding.filter = encoding.filter1;
      delete encoding.filter1;
    }
    // Overwrite position fields.
    this.interpret_position(encoding);

    // Make believe that that the x0 and y0 values were there already.
    if (encoding.x0) {
      this.x.update(encoding.x0);
    }

    if (encoding.y0) {
      this.y.update(encoding.y0);
    }

    for (const k of aesthetic_variables) {
      if (k === 'x0' || k === 'y0') {
        continue
      }
      console.log(k)

      this[k].update(encoding[k]);
    }

  }
}
