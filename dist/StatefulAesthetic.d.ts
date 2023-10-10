import type * as DS from './shared.d';
import { Aesthetic, X, Y, Size, Jitter_speed, Jitter_radius, Filter, X0, Y0, Foreground } from './Aesthetic';
import { Color } from './ColorAesthetic';
export declare const dimensions: {
    readonly size: typeof Size;
    readonly jitter_speed: typeof Jitter_speed;
    readonly jitter_radius: typeof Jitter_radius;
    readonly color: typeof Color;
    readonly filter: typeof Filter;
    readonly filter2: typeof Filter;
    readonly x: typeof X;
    readonly y: typeof Y;
    readonly x0: typeof X0;
    readonly y0: typeof Y0;
    readonly foreground: typeof Foreground;
};
export declare type ConcreteAesthetic = X | Y | Size | Jitter_speed | Jitter_radius | Color | X0 | Y0 | Foreground | Filter;
import type { QuadtileDataset } from './Dataset';
import type { Regl } from 'regl';
import type { TextureSet } from './AestheticSet';
export declare class StatefulAesthetic<T extends Aesthetic> {
    states: [T, T];
    dataset: QuadtileDataset;
    regl: Regl;
    scatterplot: DS.Plot;
    needs_transitions: boolean;
    aesthetic_map: TextureSet;
    constructor(scatterplot: DS.Plot, regl: Regl, dataset: QuadtileDataset, aesthetic_map: TextureSet, Factory: DS.Newable<T>);
    get current(): T;
    get last(): T;
    update(encoding: DS.BasicChannel | DS.ConstantChannel): void;
}
//# sourceMappingURL=StatefulAesthetic.d.ts.map