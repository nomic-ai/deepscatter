import { Dataset } from './Dataset';
import Scatterplot from './deepscatter';
import { Tile } from './tile';
import type * as DS from './shared.d';
import { Bool, StructRowProxy, Vector } from 'apache-arrow';
interface SelectParams {
    name: string;
    useNameCache?: boolean;
    foreground?: boolean;
    batchCallback?: (t: Tile) => Promise<void>;
}
export declare const defaultSelectionParams: SelectParams;
export interface IdSelectParams extends SelectParams {
    ids: string[] | number[] | bigint[];
    idField: string;
}
export interface BooleanColumnParams extends SelectParams {
    field: string;
}
export interface CompositionSelectParams<T extends Tile> extends SelectParams {
    composition: Composition<T>;
}
/**
[
  "AND"
  selection1,
  [
    "OR",
    selection2,
    [
      "NOT",
      selection3
    ]
  ]
]
*/
declare type PluralOperation = "ANY" | "ALL" | "NONE";
declare type BinaryOperation = "AND" | "OR" | "XOR";
declare type UnaryOperation = "NOT";
declare type CompArgs<T extends Tile> = DataSelection<T> | Composition<T>;
declare type Composition<T extends Tile> = [UnaryOperation, CompArgs<T>] | [BinaryOperation, CompArgs<T>, CompArgs<T>] | [
    PluralOperation,
    CompArgs<T>,
    CompArgs<T>?,
    CompArgs<T>?,
    CompArgs<T>?
];
export interface CompositeSelectParams<T extends Tile> extends SelectParams {
    composition: Composition<T>;
}
export interface FunctionSelectParams extends SelectParams {
    name: string;
    tileFunction: (t: Tile) => Promise<Vector<Bool>> | Promise<Uint8Array>;
}
declare type IdentifierOptions = {
    plot_after?: boolean;
};
/**
 * A DataSelection is a set of data that the user is working with.
 * It is copied into the underlying Arrow files and available to the GPU,
 * so it should not be abused; as a rule of thumb, it's OK to create
 * these in response to user interactions but it shouldn't be done
 * more than once a second or so.
 */
export declare class Bitmask {
    mask: Uint8Array;
    length: number;
    constructor(length: number, mask?: Uint8Array);
    static from_arrow(vector: Vector<Bool>): Bitmask;
    to_arrow(): Vector<Bool>;
    set(i: number): void;
    and(other: Bitmask): Bitmask;
    or(other: Bitmask): Bitmask;
    xor(other: Bitmask): Bitmask;
    not(): Bitmask;
}
export declare class DataSelection<T extends Tile> {
    dataset: Dataset<T>;
    plot: Scatterplot<T>;
    match_count: number[];
    /**
     * name: The name of the selection. This will be used as the colun
     * name in the Arrow record batches and are necessary for users
     * to define so that they can use the selection in subsequent
     * plotAPI calls to apply aesthetics to the selection.
     *
     * They must be globally unique in the session.
     *
     * e.g. 'search: fish', '54-abcdf', 'selection at 07:34:12',
     * 'selección compuesta número 1'
     *
     */
    name: string;
    /**
     * Has the selection been applied to the dataset
     * (does *not* mean it has been applied to all points.)
     */
    ready: Promise<void>;
    /**
     * The cursor is an index that points to the current position
     * within the selected points in the Scatter plot.
     */
    cursor: number;
    /**
     * Has the selection run on all tiles in the dataset?
    */
    complete: boolean;
    /**
     * The total number of points in the selection.
     * It is used to know the size of the selected data.
     */
    selectionSize: number;
    /**
     * The total number of points that have been evaluated for the selection.
     *
     * This is supplied because deepscatter doesn't evaluate functions on tiles
     * untile they are loaded.
     */
    evaluationSetSize: number;
    tiles: T[];
    /**
     * Optionally, a user-defined for defining.
     *
     * If you're using this, I recommend defining your own application
     * schema but I'm not going to force you throw type hints right now
     * because, you know. I'm not a monster.
     *
     * e.g.: ['search', 'lasso', 'random', 'cherry-pick']
     *
     */
    type?: string;
    composition: null | Composition<T>;
    private events;
    constructor(plot: Scatterplot<T>, params: IdSelectParams | BooleanColumnParams | FunctionSelectParams | CompositeSelectParams<T>);
    /**
     *
     * @param event an internally dispatched event.
     * @param listener a function to call back. It takes
     * as an argument the `tile` that was just added.
     */
    on(event: string, listener: (args: any) => void): void;
    private dispatch;
    /**
     *
     * Ensures that the selection has been evaluated on all
     * tiles loaded in the dataset. This is useful if, for example,
     * your selection represents a search, and you are zoomed in on
     * one portion of the map; this will immediately execute the search
     * (subject to delays to avoid blocking the main thread) on all tiles
     * that have been fetched even if out of the viewport.
     *
     * Resolves upon completion.
    */
    applyToAllLoadedTiles(): Promise<void>;
    /**
     *
     * Downloads all unloaded tiles in the dataset and applies the
     * transformation to them. Use with care! For > 10,000,000 point
     * datasets, if called from Europe this may cause the transatlantic fiber-optic internet backbone
     * cables to melt.
     */
    applyToAllTiles(): Promise<void>;
    /**
     *
     * A function that combines two selections into a third
     * selection that is the union of the two.
     */
    union(other: DataSelection<T>, name: string | undefined): DataSelection<T>;
    /**
     *
     * A function that combines two selections into a third
     * selection that is the intersection of the two. Note--for more complicated
     * queries than simple intersection/union, use the (not yet defined)
     * disjunctive normal form constructor.
     */
    intersection(other: DataSelection<T>, name: string | undefined): DataSelection<T>;
    /**
     * Advances the cursor (the currently selected point) by a given number of rows.
     * steps forward or backward. Wraps from the beginning to the end.
     *
     * @param by the number of rows to move the cursor by
     *
     * @returns the selection, for chaining
     */
    moveCursor(by: number): this;
    removePoints(name: any, ixes: BigInt[]): Promise<DataSelection<T>>;
    addPoints(name: any, ixes: BigInt[]): Promise<DataSelection<T>>;
    /**
     * Returns all the data points in the selection, limited to
     * data currently on the screen.
     *
     * @param fields A list of fields in the data to export.
     */
    export(fields: string[], format?: "json"): Promise<{
        [k: string]: any[];
    }>;
    moveCursorToPoint(point: StructRowProxy | Record<"ix", BigInt | Number>): any;
    private add_or_remove_points;
    get ordering(): void;
    /**
     *
     * @param name the name for the column to assign in the dataset.
     * @param tileFunction The transformation to apply
     */
    add_function_column(name: string, tileFunction: DS.BoolTransformation<T>): Promise<void>;
    /**
     *
     * Takes a user-defined supplied transformation and adds some bookkeeping
     * for the various count variables.
     *
     * @param functionToApply the user-defined transformation
     */
    private wrapWithSelectionMetadata;
    /**
     * The total number of points in the set. At present, always a light wrapper around
     * the total number of points in the dataset.
     */
    get totalSetSize(): number;
    /**
     *
     * Returns the nth element in the selection. This is a bit tricky because
     * the selection is stored as a list of tiles, each of which has a list of
     * matches. So we have to iterate through the tiles until we find the one
     * that contains the nth match, then iterate through the matches in that
     * tile until we find the nth match.
     *
     * @param i the index of the row to get
     */
    get(i: number | undefined): StructRowProxy;
    [Symbol.iterator](): Generator<StructRowProxy<any>, void, unknown>;
    add_identifier_column(name: string, codes: string[] | bigint[] | number[], key_field: string, options?: IdentifierOptions): Promise<void>;
    add_boolean_column(name: string, field: string): Promise<void>;
    apply_to_foreground(params: DS.BackgroundOptions): Promise<void>;
}
export {};
//# sourceMappingURL=selection.d.ts.map