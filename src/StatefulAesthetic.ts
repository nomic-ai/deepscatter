import type * as DS from './shared.d'
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

import type { Dataset } from './Dataset';
import type { Regl } from 'regl';
import type { TextureSet } from './AestheticSet';

export class StatefulAesthetic<T extends Aesthetic<any, any, any, any> {
  /**
   * A stateful aesthetic holds the history and associated resources for an encoding
   * channel. It holds two Aesthetic objects: the current and the previous scales. These
   * are used for things like smoothly generating interpolated paths between a previous color and a new one.
   * 
   * While Aesthetics can be created and destroyed willfully, the stateful aesthetic also holds 
   * a number of memory resources that it is important not to re-allocate willy-nilly. Each encoding
   * channel in a scatterplot has exactly on StatefulAesthetic that persists for the lifetime of the Plot.
   */
  public states: [T, T];
  public dataset: Dataset;
  public regl: Regl;
  public scatterplot: DS.Plot;
  public needs_transitions = false;
  public aesthetic_map: TextureSet;
  public texture_buffers;
  public ids: [string, string];
  private factory : DS.Newable<T>;
  constructor(
    scatterplot: DS.Plot,
    regl: Regl,
    dataset: Dataset,
    aesthetic_map: TextureSet,
    Factory: DS.Newable<T>
  ) {
    if (aesthetic_map === undefined) {
      throw new Error('Aesthetic map is undefined.');
    }
    this.scatterplot = scatterplot;
    this.regl = regl;
    this.dataset = dataset;
    this.aesthetic_map = aesthetic_map;
    this.factory = Factory;
    this.ids = [
      Math.random().toString(),
      Math.random().toString()
    ]
    this.states = [
      new Factory(
        this.scatterplot,
        this.regl,
        this.dataset,
        this.aesthetic_map,
        null
      ),
      new Factory(
        this.scatterplot,
        this.regl,
        this.dataset,
        this.aesthetic_map,
        null
      ),
    ] as [T, T];
  }

  get current() {
    return this.states[0];
  }

  get last() {
    return this.states[1];
  }

  update(encoding: DS.Channel) {
    const stringy = JSON.stringify(encoding);
    // Overwrite the last version.
    if (
      stringy === JSON.stringify(this.current.encoding) ||
      encoding === undefined
    ) {
      // If an undefined encoding is passed, that means
      // we've seen an update without any change.
      if (this.needs_transitions) {
        // The first one is fine, but we gotta update the *last* one.
        this.states[1] = this.current;
      }
      // And mark not to bother animating it.
      this.needs_transitions = false;
    } else {
      // Flip the current encoding to the second position.
      this.states.reverse();
      this.ids.reverse();
      // replace the first encoding with a new one 
      // with the same id (so it will reuse the same buffers)
      this.states[0] = new this.factory(
        encoding,
        this.scatterplot,
        this.regl,
        this.dataset,
        this.aesthetic_map,
        this.ids[0]
      )
      this.needs_transitions = true;
    }
  }
}
