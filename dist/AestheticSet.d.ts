import type { Regl, Texture2D } from 'regl';
import { dimensions } from './StatefulAesthetic';
import type Scatterplot from './deepscatter';
import type { Dataset } from './Dataset';
import { StatefulAesthetic } from './StatefulAesthetic';
import type { Tile } from './tile';
import type { Encoding } from './shared.d';
export declare class AestheticSet<TileType extends Tile> {
    tileSet: Dataset<TileType>;
    scatterplot: Scatterplot<TileType>;
    regl: Regl;
    encoding: Encoding;
    position_interpolation: boolean;
    private store;
    aesthetic_map: TextureSet;
    constructor(scatterplot: Scatterplot<TileType>, regl: Regl, tileSet: Dataset<TileType>);
    dim(aesthetic: keyof typeof dimensions): StatefulAesthetic<any>;
    [Symbol.iterator](): Iterator<[string, StatefulAesthetic<any>]>;
    interpret_position(encoding: Encoding): void;
    apply_encoding(encoding: Encoding): void;
}
export declare class TextureSet {
    private _one_d_texture?;
    private _color_texture?;
    texture_size: number;
    regl: Regl;
    id_locs: Record<string, number>;
    texture_widths: number;
    private offsets;
    private _one_d_position;
    private _color_position;
    constructor(regl: Regl, texture_size?: number);
    get_position(id: string): number;
    set_one_d(id: string, value: number[] | Uint8Array | Float32Array): void;
    set_color(id: string, value: Uint8Array): void;
    get one_d_texture(): Texture2D;
    get color_texture(): Texture2D;
}
//# sourceMappingURL=AestheticSet.d.ts.map