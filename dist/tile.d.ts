import { Table, Vector, RecordBatch, StructRowProxy } from 'apache-arrow';
import type { Dataset, QuadtileDataset } from './Dataset';
declare type MinMax = [number, number];
export declare type Rectangle = {
    x: MinMax;
    y: MinMax;
};
interface schema_entry {
    name: string;
    type: string;
    extent: Array<any>;
    keys?: Array<any>;
}
import type { TileBufferManager } from './regl_rendering';
/**
 * A Tile is, essentially, code to create an Arrow RecordBatch
 * and to associate metadata with it, in the context of a larger dataset.
 *
 */
export declare abstract class Tile {
    max_ix: number;
    readonly key: string;
    promise: Promise<void>;
    download_state: string;
    _batch?: RecordBatch;
    parent: this | null;
    _children: Array<this>;
    _highest_known_ix?: number;
    _min_ix?: number;
    _max_ix?: number;
    dataset: Dataset<Tile>;
    _download?: Promise<void>;
    ready: boolean;
    __schema?: schema_entry[];
    _extent?: {
        x: MinMax;
        y: MinMax;
    };
    numeric_id: number;
    _buffer_manager?: TileBufferManager<this>;
    abstract codes: [number, number, number];
    constructor(dataset: Dataset<Tile>);
    get children(): this[];
    download(): void;
    delete_column_if_exists(colname: string): void;
    get_column(colname: string): Promise<Vector>;
    private transformation_holder;
    apply_transformation(name: string): Promise<void>;
    add_column(name: string, data: Float32Array): RecordBatch<any>;
    is_visible(max_ix: number, viewport_limits: Rectangle | undefined): boolean;
    points(bounding: Rectangle | undefined, sorted?: boolean): Iterable<StructRowProxy>;
    forEach(callback: (p: StructRowProxy) => void): void;
    set highest_known_ix(val: number);
    get highest_known_ix(): number;
    get record_batch(): RecordBatch<any>;
    get min_ix(): number;
    schema(): Promise<number[] | schema_entry[]>;
    /**
     *
     * @param callback A function (possibly async) to execute before this cell is ready.
     * @returns A promise that includes the callback and all previous promises.
     */
    extend_promise(callback: () => Promise<void>): Promise<void>;
    protected get _schema(): number[] | schema_entry[];
    yielder(): Generator<StructRowProxy<any>, void, unknown>;
    get extent(): Rectangle;
    [Symbol.iterator](): IterableIterator<StructRowProxy>;
    get root_extent(): Rectangle;
}
export declare class QuadTile extends Tile {
    url: string;
    key: string;
    _children: Array<this>;
    codes: [number, number, number];
    _already_called: boolean;
    child_locations: string[];
    constructor(base_url: string, key: string, parent: QuadTile | null, dataset: QuadtileDataset);
    get extent(): Rectangle;
    download_to_depth(max_ix: number): Promise<void>;
    get_arrow(suffix?: string | undefined): Promise<RecordBatch>;
    download(): Promise<void>;
    /**
     * Sometimes it's useful to do operations on batches of tiles. This function
     * defines a grouping of tiles in the same general region to be operated on.
     * In general they will have about 80 elements (16 + 64), but the top level
     * has just 5. (4 + 1). Note a macro tile with the name [2/0/0] does not actually include
     * the tile [2/0/0] itself, but rather the tiles [4/0/0], [4/1/0], [4/0/1], [4/1/1], [5/0/0] etc.
     */
    get macrotile(): string;
    get macro_siblings(): Array<string>;
    get children(): Array<this>;
    get theoretical_extent(): Rectangle;
}
export declare class ArrowTile extends Tile {
    batch_num: number;
    full_tab: Table;
    codes: [number, number, number];
    constructor(table: Table, dataset: Dataset<ArrowTile>, batch_num: number, parent?: null | ArrowTile);
    create_children(): void;
    download(): Promise<RecordBatch>;
}
declare type Point = [number, number];
export declare function p_in_rect(p: Point, rect: Rectangle | undefined): boolean;
export {};
//# sourceMappingURL=tile.d.ts.map