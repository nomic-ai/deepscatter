import {
  Aesthetic,
  X,
  Y,
  Size,
  Jitter_speed,
  Jitter_radius,
  Filter,
  X0,
  Y0,
  Foreground,
} from './Aesthetic';
import { Color } from './ColorAesthetic';

export const dimensions = {
  size: Size,
  jitter_speed: Jitter_speed,
  jitter_radius: Jitter_radius,
  color: Color,
  filter: Filter,
  filter2: Filter,
  x: X,
  y: Y,
  x0: X0,
  y0: Y0,
  foreground: Foreground,
} as const;

export type ConcreteAesthetic =
  | X
  | Y
  | Size
  | Jitter_speed
  | Jitter_radius
  | Color
  | X0
  | Y0
  | Foreground
  | Filter;

import type { QuadtileSet } from './Dataset';
import type { Regl } from 'regl';
import type { TextureSet } from './AestheticSet';

export class StatefulAesthetic<T extends Aesthetic> {
  public states: [T, T];
  public dataset: QuadtileSet;
  public regl: Regl;
  public scatterplot: Plot;
  //  public current_encoding : Channel;
  public needs_transitions = false;
  public aesthetic_map: TextureSet;
  constructor(
    scatterplot: Plot,
    regl: Regl,
    dataset: QuadtileSet,
    aesthetic_map: TextureSet,
    Factory: Newable<T>
  ) {
    if (aesthetic_map === undefined) {
      throw new Error('Aesthetic map is undefined.');
    }
    this.scatterplot = scatterplot;
    this.regl = regl;
    this.dataset = dataset;
    this.aesthetic_map = aesthetic_map;
    this.states = [
      new Factory(
        this.scatterplot,
        this.regl,
        this.dataset,
        this.aesthetic_map
      ),
      new Factory(
        this.scatterplot,
        this.regl,
        this.dataset,
        this.aesthetic_map
      ),
    ] as [T, T];
  }

  get current() {
    return this.states[0];
  }

  get last() {
    return this.states[1];
  }

  update(encoding: BasicChannel | ConstantChannel) {
    const stringy = JSON.stringify(encoding);
    // Overwrite the last version.
    if (
      stringy === JSON.stringify(this.states[0].current_encoding) ||
      encoding === undefined
    ) {
      // If an undefined encoding is passed, that means
      // we've seen an update without any change.
      if (this.needs_transitions) {
        // The first one is fine, but we gotta update the *last* one.
        this.states[1].update(this.states[0].current_encoding);
      }
      // And mark not to bother animating it.
      this.needs_transitions = false;
    } else {
      // Flip the current encoding to the second position.
      this.states.reverse();
      this.states[0].update(encoding);
      this.needs_transitions = true;
      //      this.current_encoding = encoding;
    }
  }
}
