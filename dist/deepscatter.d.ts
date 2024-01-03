import { Selection } from 'd3-selection';
import Zoom from './interaction';
import { ReglRenderer } from './regl_rendering';
import { Dataset } from './Dataset';
import { type StructRowProxy } from 'apache-arrow';
import type { FeatureCollection } from 'geojson';
import { LabelMaker } from './label_rendering';
import { Renderer } from './rendering';
import { QuadTile, Tile } from './tile';
import type { ConcreteAesthetic } from './StatefulAesthetic';
import { DataSelection } from './selection';
import type { BooleanColumnParams, CompositeSelectParams, FunctionSelectParams, IdSelectParams } from './selection';
import type * as DS from './shared.d';
declare type Hook = () => void;
/**
 * The core type of the module is a single scatterplot that manages
 * all data and renderering.
 */
declare class Scatterplot<T extends Tile> {
    _renderer?: ReglRenderer<T>;
    width: number;
    height: number;
    _root?: Dataset<T>;
    elements?: Selection<SVGElement, any, any, any>[];
    secondary_renderers: Record<string, Renderer<T>>;
    selection_history: DS.SelectionRecord<T>[];
    tileProxy?: DS.TileProxy;
    util: Record<string, (unknown: any) => unknown>;
    div: Selection<any, any, any, any>;
    bound: boolean;
    _zoom: Zoom<T>;
    private plot_queue;
    prefs: DS.CompletePrefs;
    /**
     * Has the scatterplot completed its initial load of the data?
     */
    ready: Promise<void>;
    click_handler: ClickFunction;
    private hooks;
    tooltip_handler: TooltipHTML;
    label_click_handler: LabelClick;
    handle_highlit_point_change: ChangeToHighlitPointFunction;
    on_zoom?: DS.onZoomCallback;
    private mark_ready;
    /**
     * @param selector A DOM selector for the div in which the scatterplot will live.
     * @param width The width of the scatterplot (in pixels)
     * @param height The height of the scatterplot (in pixels)
     */
    constructor(selector: string, width: number, height: number, options?: DS.ScatterplotOptions);
    /**
     * @param selector A selector for the root element of the deepscatter; must already exist.
     * @param width Width of the plot, in pixels.
     * @param height Height of the plot, in pixels.
     */
    bind(selector: string, width: number, height: number): void;
    /**
     * Creates a new selection from a set of parameters, and immediately applies it to the plot.
     * @param params A set of parameters defining a selection.
    */
    select_and_plot(params: IdSelectParams | BooleanColumnParams | FunctionSelectParams, duration?: number): Promise<DataSelection<T>>;
    /**
     *
     * @param params A set of parameters for selecting data based on ids, a boolean column, or a function.
     * @returns A DataSelection object that can be used to extend the selection.
     *
     * See `select_and_plot` for a method that will select data and plot it.
     */
    select_data(params: IdSelectParams | BooleanColumnParams | FunctionSelectParams | CompositeSelectParams<T>): Promise<DataSelection<T>>;
    /**
     *
     * @param name The name of the new column to be created. If it already exists, this will throw an error in invocation
     * @param codes The codes to be assigned labels. This can be either a list of ids (in which case all ids will have the value 1.0 assigned)
     *   **or** a keyed of values like `{'Rome': 3, 'Vienna': 13}` in which case the numeric values will be used.
     * @param key_field The field in which to look for the identifiers.
     */
    add_identifier_column(name: string, codes: string[] | bigint[] | Record<string, number>, key_field: string): void;
    add_labels_from_url(url: string, name: string, label_key: string, size_key: string | undefined, options: DS.LabelOptions): Promise<void>;
    /**
     *
     * @param features A geojson feature collection containing point labels
     * @param name A unique key to associate with this labelset. Labels can be enabled or disabled using this key.
     * @param label_key The text field in which the labels are stored in the geojson object.
     * @param size_key A field in the dataset to associate with the *size* of the labels.
     * @param label_options Additional custom passed to the labeller.
     *
     * Usage:
     *
     * To add a set of labels to your map, create a geojson array of points where
     * the 'properties' field contains a column to use for labels. E.g., each entry might look like
     * this. Each feature will be inserted into a label hierarchy to attempt to avoid inclusion.
     * If the label_key corresponds to the currently active color dimension on your map,
     * the labels will be drawn with appropriately colored outlines: otherwise, they will
     * all have a black outline.
     * **Currently it is necessary that labels be inserted in order**.
     *
     *
     */
    add_labels(features: FeatureCollection, name: string, label_key: string, size_key: string | undefined, options?: DS.LabelOptions): void;
    /**
     * An alias to avoid using the underscored method directly.
     */
    get dataset(): Dataset<T>;
    add_api_label(labelset: DS.Labelset): void;
    load_dataset(params: DS.DataSpec): Promise<DS.Dataset<T>>;
    reinitialize(): Promise<void>;
    visualize_tiles(): void;
    /**
     * Destroy the scatterplot and release all associated resources.
     * This is necessary because removing a deepscatter instance
     * will not de-allocate tables from GPU memory.
     */
    destroy(): void;
    update_prefs(prefs: DS.APICall): void;
    /**
     * Hooks provide a mechanism to run arbitrary code after call of plotAPI has resolved.
     * This is useful for--e.g.--updating a legend only when the plot changes.
     *
     * @param name The name of the hook to add.
     * @param hook A function to run after each plot command.
     */
    add_hook(name: string, hook: Hook, unsafe?: boolean): void;
    remove_hook(name: string, unsafe?: boolean): void;
    stop_labellers(): void;
    /**
     *
     *
     * @param dimension The name of the encoding dimension to access
     * information about. E.g. ("color", "x", etc.)
     * @returns
     */
    dim(dimension: string): ConcreteAesthetic;
    set tooltip_html(func: (datum: StructRowProxy<any>, plot: Scatterplot<QuadTile>) => string);
    get tooltip_html(): (datum: StructRowProxy<any>, plot: Scatterplot<QuadTile>) => string;
    set label_click(func: any);
    get label_click(): any;
    set highlit_point_change(func: any);
    get highlit_point_change(): any;
    set click_function(func: (datum: StructRowProxy<any>, plot: Scatterplot<QuadTile>) => void);
    get click_function(): (datum: StructRowProxy<any>, plot: Scatterplot<QuadTile>) => void;
    /**
     * Plots a set of prefs, and returns a promise that resolves
     * upon the completion of the plot (not including any time for transitions).
     */
    plotAPI(prefs: DS.APICall): Promise<void>;
    /**
     * Get a short head start on transformations. This prevents a flicker
     * when a new data field needs to be loaded onto the GPU.
     *
     * @param prefs The API call to prepare.
     * @param delay Delay in milliseconds to give the data to get onto the GPU.
     * 110 ms seems like a decent compromise; barely perceptible to humans as a UI response
     * time, but enough time
     * for three animation ticks to run.
     * @returns A promise that resolves immediately if there's no work to do,
     * or after the delay if there is.
     */
    start_transformations(prefs: DS.APICall, delay?: number): Promise<void>;
    /**
     * This is the main plot entry point: it's unsafe to fire multiple
     * times in parallel because the transition state can get all borked up.
     * plotAPI wraps it in an await wrapper.
     *
     * @param prefs An API call.
     */
    private unsafe_plotAPI;
    get root_batch(): import("apache-arrow").RecordBatch<any>;
    /**
     * Return the current state of the query. Can be used to save an API
     * call for use programatically.
     */
    get query(): DS.APICall;
    drawContours(contours: any, drawTo: any): void;
    sample_points(n?: number): Record<string, number | string>[];
    contours(aes: any): void;
}
export default Scatterplot;
/**
 A function that can be set by a string or directly with a function
*/
declare abstract class SettableFunction<FuncType, ArgType = StructRowProxy, Tiletype extends Tile = QuadTile> {
    _f: undefined | ((datum: ArgType, plot: Scatterplot<Tiletype>) => FuncType);
    string_rep: string;
    plot: Scatterplot<Tiletype>;
    constructor(plot: Scatterplot<Tiletype>);
    abstract default(datum: ArgType, plot: Scatterplot<Tiletype> | undefined): FuncType;
    get f(): (datum: ArgType, plot: Scatterplot<Tiletype>) => FuncType;
    set f(f: string | ((datum: ArgType, plot: Scatterplot<Tiletype>) => FuncType));
}
import type { GeoJsonProperties } from 'geojson';
declare class LabelClick extends SettableFunction<void, GeoJsonProperties> {
    default(feature: GeoJsonProperties, plot?: any, labelset?: LabelMaker | undefined): void;
}
declare class ClickFunction extends SettableFunction<void> {
    default(datum: StructRowProxy, plot?: any): void;
}
declare class ChangeToHighlitPointFunction extends SettableFunction<void, StructRowProxy[], QuadTile> {
    default(points: StructRowProxy[], plot?: any): void;
}
declare class TooltipHTML extends SettableFunction<string> {
    default(point: StructRowProxy, plot?: any): string;
}
//# sourceMappingURL=deepscatter.d.ts.map