import { Tile, Rectangle, QuadTile, ArrowTile } from './tile';
import type * as DS from './shared';
import { RecordBatch, StructRowProxy, Table, Schema } from 'apache-arrow';
import Scatterplot from './deepscatter';
declare type Key = string;
declare type ArrowBuildable = DS.ArrowBuildable;
declare type Transformation<T> = DS.Transformation<T>;
/**
 * A Dataset manages the production and manipulation of tiles. Each plot has a
 * single dataset; the dataset handles all transformations around data through
 * batchwise operations.
 */
export declare abstract class Dataset<T extends Tile> {
    transformations: Record<string, Transformation<T>>;
    abstract root_tile: T;
    protected plot: DS.Plot;
    abstract ready: Promise<void>;
    abstract get extent(): Rectangle;
    abstract promise: Promise<void>;
    private extents;
    _ix_seed: number;
    _schema?: Schema;
    tileProxy?: DS.TileProxy;
    /**
     * @param plot The plot to which this dataset belongs.
     **/
    constructor(plot: DS.Plot);
    /**
     * The highest known point that deepscatter has seen so far. This is used
     * to adjust opacity size.
     */
    get highest_known_ix(): number;
    /**
     * This allows creation of a new column in your chart.
     *
     * A few thngs to be aware of: the point function may be run millions of times.
     * For best performance, you should not wrap complicated
     * logic in this: instead, generate any data structures outside the function.
     *
     * name: the name to identify the new column in the data.
     * pointFunction: a function that runs on a single row of data. It accepts a single
     * argument, the data point to be transformed: technically this is a StructRowProxy
     * on the underlying Arrow frame, but for most purposes you can treat it as a dict.
     * The point is read-only--you cannot change attributes.
     *
     * For example: suppose you have a ['lat', 'long'] column in your data and want to create a
     * new set of geo coordinates for your data. You can run the following.
     * {
     * const scale = d3.geoMollweide().extent([-20, -20, 20, 20])
     * scatterplot.register_transformation('mollweide_x', datum => {
     *  return scale([datum.long, datum.lat])[0]
     * })
     * scatterplot.register_transformation('mollweide_y', datum => {
     *  return scale([datum.long, datum.lat])[1]
     * })
     * }
     *
     * Note some constraints: the scale is created *outside* the functions, to avoid the
     * overhead of instantiating it every time; and the x and y coordinates are created separately
     * with separate function calls, because it's not possible to assign to both x and y simultaneously.
     */
    register_transformation(name: string, pointFunction: DS.PointFunction, prerequisites?: string[]): void;
    download_to_depth(max_ix: number): Promise<void>;
    /**
     * Attempts to build an Arrow table from all record batches.
     * If some batches have different transformations applied,
     * this will error
     *
     **/
    get table(): Table;
    static from_quadfeather(url: string, plot: DS.Plot): QuadtileDataset;
    /**
     * Generate an ArrowDataset from a single Arrow table.
     *
     * @param table A single Arrow table
     * @param prefs The API Call to use for renering.
     * @param plot The Scatterplot to use.
     * @returns
     */
    static from_arrow_table(table: Table, plot: Scatterplot<ArrowTile>): ArrowDataset;
    abstract download_most_needed_tiles(bbox: Rectangle | undefined, max_ix: number, queue_length: number): void;
    /**
     *
     * @param name The name of the column to check for
     * @returns True if the column exists in the dataset, false otherwise.
     */
    has_column(name: string): boolean;
    delete_column_if_exists(name: string): void;
    domain(dimension: string, max_ix?: number): [number, number];
    points(bbox: Rectangle | undefined, max_ix?: number): Generator<StructRowProxy<any>, void, unknown>;
    /**
     * Map a function against all tiles.
     * It is often useful simply to invoke Dataset.map(d => d) to
     * get a list of all tiles in the dataset at any moment.
     *
     * @param callback A function to apply to each tile.
     * @param after Whether to perform the function in bottom-up order
     * @returns A list of the results of the function in an order determined by 'after.'
     */
    map<U>(callback: (tile: T) => U, after?: boolean): U[];
    /**
     * Invoke a function on all tiles in the dataset that have been downloaded.
     * The general architecture here is taken from the
     * d3 quadtree functions. That's why, for example, it doesn't
     * recurse.
  
     * @param callback The function to invoke on each tile.
     * @param after Whether to execute the visit in bottom-up order. Default false.
     * @param filter
     */
    visit(callback: (tile: T) => void, after?: boolean, filter?: (t: T) => boolean): void;
    schema(): Promise<Schema<any>>;
    /**
     *
     * @param field_name the name of the column to create
     * @param buffer An Arrow IPC Buffer that deserializes to a table with columns('data' and '_tile')
     */
    add_tiled_column(field_name: string, buffer: Uint8Array): void;
    add_sparse_identifiers(field_name: string, ids: DS.PointUpdate): void;
    /**
     *
     * @param ids A list of ids to get, keyed to the value to set them to.
     * @param field_name The name of the new field to create
     * @param key_field The column in the dataset to match them against.
     */
    add_label_identifiers(ids: Record<string, number>, field_name: string, key_field?: string): void;
    /**
     * Given an ix, apply a transformation to the point at that index and
     * return the transformed point (not just the transformation, the whole point)
     * As a side-effect, this applies the transformaation to all other
     * points in the same tile.
     *
     * @param transformation The name of the transformation to apply
     * @param ix The index of the point to transform
     */
    applyTransformationToPoint(transformation: string, ix: number): Promise<StructRowProxy<any>>;
    /**
     *
     * @param ix The index of the point to get.
     * @returns A structRowProxy for the point with the given index.
     */
    findPoint(ix: number): StructRowProxy[];
    /**
     * Finds the points and tiles that match the passed ix
     * @param ix The index of the point to get.
     * @returns A list of [tile, point] pairs that match the index.
     */
    findPointRaw(ix: number): [Tile, StructRowProxy, number][];
}
export declare class ArrowDataset extends Dataset<ArrowTile> {
    promise: Promise<void>;
    root_tile: ArrowTile;
    constructor(table: Table, plot: Scatterplot<ArrowTile>);
    get extent(): Rectangle;
    get ready(): Promise<void>;
    download_most_needed_tiles(...args: unknown[]): void;
}
export declare class QuadtileDataset extends Dataset<QuadTile> {
    protected _download_queue: Set<Key>;
    promise: Promise<void>;
    root_tile: QuadTile;
    constructor(base_url: string, plot: DS.Plot, options?: DS.QuadtileOptions);
    get ready(): Promise<void>;
    get extent(): Rectangle;
    /**
     * Ensures that all the tiles in a dataset are downloaded that include
     * datapoints of index less than or equal to max_ix.
     * @param max_ix the depth to download to.
     */
    download_to_depth(max_ix: number): Promise<void>;
    download_most_needed_tiles(bbox: Rectangle | undefined, max_ix: number, queue_length?: number): void;
    /**
     *
     * @param field_name the name of the column to create
     * @param buffer An Arrow IPC Buffer that deserializes to a table with columns('data' and '_tile')
     */
    add_macrotiled_column(field_name: string, transformation: (ids: string[]) => Promise<Uint8Array>): void;
}
/**
 *
 * @param batch the batch to delete from.
 * @param field_name the name of the field.
 * @param data the data to add OR if null, the existing column to delete.
 * @returns
 */
export declare function add_or_delete_column(batch: RecordBatch, field_name: string, data: ArrowBuildable | null): RecordBatch;
export {};
//# sourceMappingURL=Dataset.d.ts.map