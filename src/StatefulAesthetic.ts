import {
  X,
  Y,
  Size,
  Jitter_speed,
  Jitter_radius,
  Filter,
  X0,
  Y0,
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
} as const;

export type ConcreteAesthetic =
  | X
  | Y
  | Size
  | Jitter_speed
  | Jitter_radius
  | Color
  | Filter;

import type Scatterplot from './deepscatter';
import type { QuadtileSet } from './Dataset';
import type { Regl } from 'regl';
import type { TextureSet } from './AestheticSet';

export abstract class StatefulAesthetic<T extends ConcreteAesthetic> {
  // An aesthetic that tracks two states--current and last.
  // The point is to handle transitions.
  // It might make sense to handle more than two states, but there are
  // diminishing returns.
  abstract Factory: new (a, b, c, d) => T;
  public _states: [T, T] | undefined;
  public dataset: QuadtileSet;
  public regl: Regl;
  public scatterplot: Scatterplot;
  //  public current_encoding : Channel;
  public needs_transitions = false;
  public aesthetic_map: TextureSet;
  constructor(
    scatterplot: Scatterplot,
    regl: Regl,
    dataset: QuadtileSet,
    aesthetic_map: TextureSet
  ) {
    if (aesthetic_map === undefined) {
      throw new Error('Aesthetic map is undefined.');
    }
    this.scatterplot = scatterplot;
    this.regl = regl;
    this.dataset = dataset;
    this.aesthetic_map = aesthetic_map;
    this.aesthetic_map = aesthetic_map;
  }

  get current() {
    return this.states[0];
  }

  get last() {
    return this.states[1];
  }

  get states(): [T, T] {
    // The two states of this--current and last.
    // Reused to save buffers.

    if (this._states !== undefined) {
      return this._states;
    }
    this._states = [
      new this.Factory(
        this.scatterplot,
        this.regl,
        this.dataset,
        this.aesthetic_map
      ),
      new this.Factory(
        this.scatterplot,
        this.regl,
        this.dataset,
        this.aesthetic_map
      ),
    ];
    return this._states;
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

// Clearly something is wrong here. There must be a way
// to just defin this.

class StatefulX extends StatefulAesthetic<X> {
  get Factory() {
    return X;
  }
}
class StatefulX0 extends StatefulAesthetic<X0> {
  get Factory() {
    return X0;
  }
}
class StatefulY extends StatefulAesthetic<Y> {
  get Factory() {
    return Y;
  }
}
class StatefulY0 extends StatefulAesthetic<Y0> {
  get Factory() {
    return Y0;
  }
}
class StatefulSize extends StatefulAesthetic<Size> {
  get Factory() {
    return Size;
  }
}

class StatefulJitter_speed extends StatefulAesthetic<Jitter_speed> {
  get Factory() {
    return Jitter_speed;
  }
}
class StatefulJitter_radius extends StatefulAesthetic<Jitter_radius> {
  get Factory() {
    return Jitter_radius;
  }
}
class StatefulColor extends StatefulAesthetic<Color> {
  get Factory() {
    return Color;
  }
}
class StatefulFilter extends StatefulAesthetic<Filter> {
  get Factory() {
    return Filter;
  }
}
class StatefulFilter2 extends StatefulAesthetic<Filter> {
  get Factory() {
    return Filter;
  }
}

export const stateful_aesthetics = {
  x: StatefulX,
  x0: StatefulX0,
  y: StatefulY,
  y0: StatefulY0,
  size: StatefulSize,
  jitter_speed: StatefulJitter_speed,
  jitter_radius: StatefulJitter_radius,
  color: StatefulColor,
  filter: StatefulFilter,
  filter2: StatefulFilter2,
} as const;
