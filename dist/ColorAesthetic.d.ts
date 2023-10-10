import { Aesthetic } from './Aesthetic';
import type * as DS from './shared.d';
export declare class Color extends Aesthetic<[
    number,
    number,
    number
], string, DS.ColorChannel> {
    _constant: string;
    texture_type: string;
    default_constant: string;
    default_transform: DS.Transform;
    get default_range(): [number, number];
    current_encoding: null | DS.ColorChannel;
    default_data(): Uint8Array;
    get use_map_on_regl(): 1;
    get colorscheme_size(): number;
    get scale(): any;
    get texture_buffer(): Uint8Array | Float32Array;
    post_to_regl_buffer(): void;
    update(encoding: DS.ColorChannel): void;
    toGLType(color: string): [number, number, number];
    encode_for_textures(range: string | string[]): void;
}
//# sourceMappingURL=ColorAesthetic.d.ts.map