import type * as DS from '../types';

import { Size, Jitter_speed, Jitter_radius, X, Y } from './ScaledAesthetic';

import { Filter, Foreground } from './BooleanAesthetic';

import { Color } from './ColorAesthetic';
import { Scatterplot } from '../scatterplot';

type AestheticConstructor<T> = new (
  ...args: [
    encoding: DS.ChannelType | null,
    scatterplot: Scatterplot,
    aesthetic_map?: TextureSet,
    id?: string,
  ]
) => T;

interface IDimensions {
  [key: string]: AestheticConstructor<ConcreteAesthetic>;
}

export const dimensions: IDimensions = {
  size: Size,
  jitter_speed: Jitter_speed,
  jitter_radius: Jitter_radius,
  color: Color,
  filter: Filter,
  filter2: Filter,
  x: X,
  y: Y,
  x0: X,
  y0: Y,
  foreground: Foreground,
} as const;

export type ConcreteAesthetic =
  | X
  | Y
  | Size
  | Jitter_speed
  | Jitter_radius
  | Color
  | Foreground
  | Filter;

export type ConcreteScaledAesthetic =
  | X
  | Y
  | Size
  | Jitter_speed
  | Jitter_radius
  | Color;

import type { Deeptable } from '../Deeptable';
import type { Regl } from 'regl';
import type { TextureSet } from './AestheticSet';
import { Some } from '../utilityFunctions';

export class StatefulAesthetic<T extends ConcreteAesthetic> {
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
  public deeptable: Deeptable;
  public regl: Regl;
  public scatterplot: Scatterplot;
  public needs_transitions = false;
  public aesthetic_map: TextureSet;
  public texture_buffers;
  public ids: [string, string];
  private factory: DS.Newable<T>;
  constructor(
    scatterplot: Scatterplot,
    regl: Regl,
    deeptable: Deeptable,
    aesthetic_map: TextureSet,
    Factory: DS.Newable<T>,
  ) {
    if (aesthetic_map === undefined) {
      throw new Error('Aesthetic map is undefined.');
    }
    this.scatterplot = scatterplot;
    this.regl = regl;
    this.deeptable = deeptable;
    this.aesthetic_map = aesthetic_map;
    this.factory = Factory;
    this.ids = [Math.random().toString(), Math.random().toString()];
    this.states = [
      new Factory(null, this.scatterplot, this.aesthetic_map, this.ids[0]),
      new Factory(null, this.scatterplot, this.aesthetic_map, this.ids[1]),
    ] as [T, T];
  }

  get neededFields(): Some<string>[] {
    return [this.current.columnKeys, this.last.columnKeys].filter(
      (f) => f !== null,
    );
  }

  get current() {
    return this.states[0];
  }

  get last() {
    return this.states[1];
  }

  update(encoding: DS.ChannelType) {
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
        this.aesthetic_map,
        this.ids[0],
      );
      this.needs_transitions = true;
    }
  }
}
