import { Dataset } from './Dataset';
import Scatterplot from './deepscatter';
import { Tile } from './tile';
import type * as DS from './shared.d';
import { StructRowProxy } from 'apache-arrow';
interface SelectParams {
    foreground?: boolean;
    batchCallback?: (t: Tile) => Promise<void>;
}
export declare const defaultSelectionParams: SelectParams;
export interface IdSelectParams extends SelectParams {
    name: string;
    ids: string[] | number[] | bigint[];
    idField: string;
}
export interface BooleanColumnParams extends SelectParams {
    name: string;
    field: string;
}
export interface FunctionSelectParams extends SelectParams {
    name: string;
    tileFunction: (t: Tile) => Promise<Float32Array> | Promise<Uint8Array>;
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
export declare class DataSelection<T extends Tile> implements DS.ScatterSelection<T> {
    dataset: Dataset<T>;
    plot: Scatterplot<T>;
    name: string;
    /**
     * Has the selection been applied to the dataset
     * (does *not* mean it has been applied to all points.)
     */
    ready: Promise<void>;
    cursor: number;
    /**
     * Has the selection completely evaluated?
     */
    complete: boolean;
    selectionSize: number;
    evaluationSetSize: number;
    tiles: T[];
    private events;
    /**
     *
     * @param event an internally dispatched event.
     * @param listener a function to call back. It takes
     * as an argument the `tile` that was just added.
     */
    on(event: string, listener: (args: any) => void): void;
    private dispatch;
    match_count: number[];
    constructor(plot: Scatterplot<T>, params: IdSelectParams | BooleanColumnParams | FunctionSelectParams);
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
    private add_or_remove_points;
    /**
     *
     * @param name the name for the column to assign in the dataset.
     * @param tileFunction The transformation to apply
     */
    add_function_column(name: string, tileFunction: (t: T) => Float32Array): Promise<void>;
    /**
     *
     * Takes a user-defined supplied transformation and adds some bookkeeping
     * for the various count variables.
     *
     * @param functionToApply the user-defined transformation
     */
    private wrapWithSelectionMetadata;
    /**
     * The total number of points in the dataset.
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
    combine(other: DataSelection<T>, operation: "AND" | "OR" | "AND NOT" | "XOR", name: string): DataSelection<T>;
    apply_to_foreground(params: DS.BackgroundOptions): Promise<void>;
}
export {};
//# sourceMappingURL=selection.d.ts.map