import wrapREGL, { Framebuffer2D, Regl, Texture2D, Buffer } from 'regl';
import Zoom from './interaction';
import { Renderer } from './rendering';
import { AestheticSet } from './AestheticSet';
import type * as DS from './shared';
import type { Tile } from './tile';
import REGL from 'regl';
import { Dataset } from './Dataset';
import Scatterplot from './deepscatter';
import { StructRowProxy } from 'apache-arrow';
export declare class ReglRenderer<T extends Tile> extends Renderer<T> {
    regl: Regl;
    aes: AestheticSet<T>;
    buffer_size: number;
    private _buffers;
    _initializations: Promise<void>[];
    tileSet: Dataset<T>;
    zoom?: Zoom<T>;
    _zoom?: Zoom<T>;
    _start: number;
    most_recent_restart?: number;
    _default_webgl_scale?: number[];
    _webgl_scale_history?: [number[], number[]];
    _renderer?: Regl;
    _use_scale_to_download_tiles: boolean;
    sprites?: d3.Selection<SVGElement, any, any, any>;
    fbos: Record<string, Framebuffer2D>;
    textures: Record<string, Texture2D>;
    _fill_buffer?: Buffer;
    contour_vals?: Uint8Array;
    tick_num?: number;
    reglframe?: REGL.FrameCallback;
    _integer_buffer?: Buffer;
    constructor(selector: any, tileSet: Dataset<T>, scatterplot: Scatterplot<T>);
    get buffers(): MultipurposeBufferSet;
    data(dataset: Dataset<T>): this | DS.Dataset<T>;
    get props(): any;
    get default_webgl_scale(): number[];
    render_points(props: any): void;
    /**
     * Actions that run on a single animation tick.
     */
    tick(): void;
    single_blur_pass(fbo1: Framebuffer2D, fbo2: Framebuffer2D, direction: [number, number]): void;
    blur(fbo1: Framebuffer2D, fbo2: Framebuffer2D, passes?: number): void;
    render_all(props: any): void;
    initialize_textures(): void;
    get_image_texture(url: string): wrapREGL.Texture2D;
    n_visible(only_color?: number): any;
    get integer_buffer(): wrapREGL.Buffer;
    color_pick(x: number, y: number): null | StructRowProxy;
    color_pick_single(x: number, y: number, field?: 'ix_in_tile' | 'ix' | 'tile_id'): number;
    get fill_buffer(): wrapREGL.Buffer;
    draw_contour_buffer(field: string, ix: number): any;
    remake_renderer(): wrapREGL.Regl;
    allocate_aesthetic_buffers(): void;
    aes_to_buffer_num?: Record<string, number>;
    variable_to_buffer_num?: Record<string, number>;
    buffer_num_to_variable?: string[];
    get discard_share(): number;
}
export declare class TileBufferManager<T extends Tile> {
    tile: T;
    regl: Regl;
    renderer: ReglRenderer<T>;
    regl_elements: Map<string, DS.BufferLocation | null>;
    constructor(regl: Regl, tile: T, renderer: ReglRenderer<T>);
    /**
     *
     * @param
     * @returns
     */
    ready(): boolean;
    /**
     * Creates a deferred call that will populate the regl buffer
     * when there's some free time.
     *
     * @param key a string representing the requested column; must either exist in the
     * record batch or have a means for creating it asynchronously in 'transformations.'
     * @returns both an instantly available object called 'ready' that says if we're ready
     * to go: and, if the tile is ready, a promise that starts the update going and resolves
     * once it's ready.
     */
    ready_or_not_here_it_comes(key: string): {
        ready: boolean;
        promise: null | Promise<void>;
    };
    /**
     *
     * @param colname the name of the column to release
     *
     * @returns Nothing, not even if the column isn't currently defined.
     */
    release(colname: string): void;
    get count(): number;
    create_buffer_data(key: string): Promise<Float32Array>;
    create_regl_buffer(key: string): Promise<void>;
}
declare class MultipurposeBufferSet {
    private regl;
    private buffers;
    buffer_size: number;
    private pointer;
    private freed_buffers;
    /**
     *
     * @param regl the Regl context we're using.
     * @param buffer_size The number of bytes on each strip of memory that we'll ask for.
     */
    constructor(regl: Regl, buffer_size: number);
    generate_new_buffer(): void;
    /**
     * Freeing a block means just adding its space back into the list of open blocks.
     * There's no need to actually zero out the memory or anything.
     *
     * @param buff The location of the buffer we're done with.
     */
    free_block(buff: DS.BufferLocation): void;
    /**
     *
     * @param items The number of datapoints in the arrow column being allocated
     * @param bytes_per_item The number of bytes per item in the arrow column being allocated
     * @returns
     */
    allocate_block(items: number, bytes_per_item: number): DS.BufferLocation;
}
export {};
//# sourceMappingURL=regl_rendering.d.ts.map