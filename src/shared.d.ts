import type { StructRowProxy, Table, Vector } from 'apache-arrow';
import type { Renderer } from './rendering';
import type { Dataset } from './Dataset';
import type { ArrowDataset } from './Dataset';
import type { ConcreteAesthetic } from './StatefulAesthetic';
import type { Tile, QuadTile, ArrowTile } from './tile';
import type Scatterplot from './deepscatter';
import type { ReglRenderer } from './regl_rendering';
import type { Regl, Buffer } from 'regl';
//import { DataSelection } from './selection';

export type {
  Renderer,
  ArrowDataset,
  Dataset,
  ConcreteAesthetic,
  Tile,
  QuadTile,
};

/**
 * Operations to be performed on the GPU taking a single argument.
 */
type OneArgumentOp = {
  op: 'gt' | 'lt' | 'eq';
  field: string;
  a: number;
};

/**
 * Operations to be performed on the GPU taking two arguments
 */

type TwoArgumentOp = {
  op: 'within' | 'between';
  field: string;
  a: number;
  b: number;
};

type Newable<T> = { new (...args: any[]): T };
export type Plot = Scatterplot<QuadTile> | Scatterplot<ArrowTile>;
export type OpChannel = OneArgumentOp | TwoArgumentOp;
interface InitializedScatterplot<T extends Tile> {
  _root: Dataset<T>;
  _renderer: ReglRenderer<T>;
}

/**
 * A proxy class that wraps around tile get calls. Used to avoid
 * putting Nomic login logic in deepscatter while fetching 
 * tiles with authentication.
 *
 */
export interface TileProxy {
  apiCall: (endpoint: string, method : "GET", d1 : unknown, d2 : unknown , options : Record<string, boolean | string | number> ) => Promise<Uint8Array>;
}

export type ScatterplotOptions = {
  tileProxy?: TileProxy;
};
export type QuadtileOptions = {
  tileProxy?: TileProxy;
};


/**
 * Interface representing the selection of a Scatter plot.
 * It holds information about the selected data points.
 *
 * @template T - A Tile set.
 */
export interface ScatterSelection<T extends Tile> {

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


  /**
   * The cursor is an index that points to the current position
   * within the selected points in the Scatter plot.
   */
  cursor: number;

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

  /**
   * The total number of points in the set. At present, always a light wrapper around
   * the total number of points in the dataset.
   */
  totalSetSize: number;

  /**
   * Has the selection run on all tiles in the dataset?
  */
  complete: boolean;

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
  union?(other: ScatterSelection<T>): ScatterSelection<T>;

  /**
   * 
   * A function that combines two selections into a third
   * selection that is the intersection of the two. Note--for more complicated
   * queries than simple intersection/union, use the (not yet defined)
   * disjunctive normal form constructor.
   */

  intersection?(other: ScatterSelection<T>): ScatterSelection<T>;

  /**
   * 
   * The deepscatter transformation that will be applied to 
   * tiles to test if they are members of the set. Transformations
   * can apply any type of function; here we assume that they are floats
   * (because WebGL 1.0 can't handle anything else)
   * and that 0 represents exclusion and 1 represents inclusion.
   * 
   * This constraint is not enforced by the type system.
   */

  transformation: Transformation<T>;

  /**
   * NOT IMPLEMENTED YET
   * 
   * A set of indexes that affects the ordering of the selection.
   * 
   */

  ordering?: number[];

  /**
   * 
  tiles: T[]; // The tiles that have been evaluated for the selection.

  /**
   * 
  * returns the ith element of the selection
   * 
   * @param i.
   */
  get(i: number) : StructRowProxy;

  /**
   * Returns a bitmask from each tile, identified by their keys.
   * Used for efficiently persisting a selection for later use.
   */
  bitmask: Record<string, Uint8Array>;
}

// TODO: implement this.
export type DNFmaker<T extends Tile> = (args: [ScatterSelection<T>[]]) => ScatterSelection<T>;


export interface SelectionRecord<T extends Tile>  {
  selection: ScatterSelection<T> | null;
  name: string;
  flushed: boolean;
}

// Functions that are defined as strings and executed in JS.
export type LambdaChannel = {
  lambda: string;
  field: string;
  domain?: [number, number];
  range?: [number, number];
};

export type BufferLocation = {
  buffer: Buffer;
  offset: number;
  stride: number;
  byte_size: number; // in bytes;
};

type Transform = 'log' | 'sqrt' | 'linear' | 'literal';

type FunctionalChannel = LambdaChannel | OpChannel;

type BackgroundOptions = {
  // The color of background points. Hex codes or HTML
  // colors are accepted.
  color?: string;

  // A multiplier against the point's opacity otherwise.
  // A single value describes the background; an array
  // describes the foreground and background separately.
  opacity?: number | [number, number];

  // A multiplier against the point's size. Default 0.66.
  // A single value describes the background; an array
  // describes the foreground and background separately.

  size?: number | [number, number];

  // Whether the background points should respond on mouseover.
  mouseover?: boolean;
};

type ConstantBool = {
  constant: boolean;
};

export type ConstantNumber = {
  constant: number;
};

export type ConstantColorChannel = {
  constant: string;
};

export type ConstantChannel =
  | ConstantBool
  | ConstantNumber
  | ConstantColorChannel;
/**
 * A channel represents the information necessary to map a single dimension
 * (x, y, color, jitter, etc.) from dataspace to a visual encoding. It is used
 * to construct a scale and to pass any other necessary information to assist
 * in converting tabular data to visual representation. In some cases it is a scale;
 * in others it is parameters used to define a function on the GPU.
 *
 * The names and design are taken largely from channels as defined in Vega-Lite,
 * but the syntax differs for a number of operations.
 * https://vega.github.io/vega-lite/docs/encoding.html
 */
export interface BasicChannel {
  /** The name of a column in the data table to be encoded. */
  field: string;
  /**
   * A transformation to apply on the field.
   * 'literal' maps in the implied dataspace set by 'x', 'y', while
   * 'linear' transforms the data by the range and domain.
   */
  transform?: Transform;
  // The domain over which the data extends
  domain?: [number, number];
  // The range into which to map the data.
  range?: [number, number];
}

export type JitterRadiusMethod =
  | 'None'
  | 'spiral'
  | 'uniform'
  | 'normal'
  | 'circle'
  | 'time';

export interface CategoricalChannel {
  field: string;
}

export type ArrowBuildable = Vector | Float32Array;

/**
 * A transformation is a batchwise operation that can be used to construct
 * a new column in the data table. It runs asynchronously so that it
 * can make network calls: it's defined as a recordbatch -> column operation
 * rather than a point -> value operation for speed.
 * 
 * If the resulting vector or float32array is not the same length as 
 * inputTile.record_batch.numRows, it will fail catastrophically.
 * This is not a guarantee I know how to enforce in the type system.
 */
export type Transformation<T> = (inputTile: T) => ArrowBuildable | Promise<ArrowBuildable>;

export type BoolTransformation<T> = (inputTile: T) => Float32Array | Promise<Float32Array>;

export type BasicColorChannel = BasicChannel & {
  range?: string[] | string;
  domain?: [number, number];
};

export type CategoricalColorChannel = CategoricalChannel & {
  range?: string | string[];
  domain?: string[];
};

export type ColorChannel =
  | BasicColorChannel
  | CategoricalColorChannel
  | ConstantColorChannel;

export type BooleanChannel = FunctionalChannel | ConstantBool;

export type RootChannel =
  | BooleanChannel
  | BasicChannel
  | string
  | OpChannel
  | ConstantColorChannel
  | ConstantChannel
  | LambdaChannel;

export type JitterChannel = RootChannel & {
  /**
   * Jitter channels have a method.
   * 'spiral' animates along a log spiral.
   * 'uniform' jitters around a central point.
   * 'normal' jitters around a central point biased towards the middle.
   * 'circle' animates a circle around the point.
   * 'time' lapses the point in and out of view.
   */
  method: JitterRadiusMethod;
};

// A description of a functional operation to be passsed to the shader.
export type OpArray = [op: number, a: number, b: number];
/**
 * And encoding.
 */
export type Encoding = {
  x?: RootChannel;
  y?: RootChannel;
  color?: null | ColorChannel;
  size?: null | RootChannel;
  shape?: null | RootChannel;
  filter?: null | FunctionalChannel;
  filter2?: null | FunctionalChannel;
  jitter_radius?: null | JitterChannel;
  jitter_speed?: null | RootChannel;
  x0?: null | RootChannel;
  y0?: null | RootChannel;
  position?: string;
  position0?: string;
  foreground?: null | FunctionalChannel;
};

type ColumnTimeLookups = Record<string, Date>;
type TileKey = `${number}/${number}/${number}`;

export type PointUpdate = {
  column_name: string;
  values: Record<string, Record<number, number>>;
};

type ZoomCall = {
  bbox: {
    x: [number, number];
    y: [number, number];
  };
};

export type Dimension = keyof Encoding;

// Data can be passed in three ways:
// 1. A Table object.
// 2. A URL to a Quadtile source.
// 3. An array buffer that contains a serialized Table.

type DataSpec = Record<string, never> &
  (
    | { source_url?: never; arrow_table?: never; arrow_buffer: ArrayBuffer }
    | { source_url: string; arrow_table?: never; arrow_buffer?: never }
    | { source_url?: never; arrow_table: Table; arrow_buffer?: never }
  );

/**
 * A callback provided by the consumer, enabling them to hook into
 * zoom events & recieve the zoom transform. For example, a consumer
 * might update annotations on zoom events to keep them in sync.
 */
export type onZoomCallback = (transform: d3.ZoomTransform) => null;

export type Label = {
  x: number;
  y: number;
  text: string;
};
export type URLLabels = {
  url: string;
  options: LabelOptions;
  label_field: string;
  size_field: string;
};
export type LabelOptions = {
  useColorScale?: boolean; // Whether the colors of text should inherit from the active color scale.
  margin?: number; // The number of pixels around each box. Default 30.
  draggable_labels?: boolean; // Should labels be draggable in place?
};

export type Labelset = {
  labels: Label[];
  name: string;
  options?: LabelOptions;
};
export type Labelcall = Labelset | URLLabels | null;

// An APICall is a JSON-serializable specification of the chart.
export type APICall = {
  /** The magnification coefficient for a zooming item */
  zoom_balance?: number;

  /** The length of time to take for the transition to this state. */
  duration?: number;

  /** The base point size for aes is modified */
  point_size?: number;

  /** The maximum number of points to load */
  max_points?: number;

  /** Overall screen saturation target at average point density */
  alpha?: number;

  /** A function defind as a string that takes implied argument 'datum' */
  click_function?: string;

  //
  encoding?: Encoding;
  labels?: Labelcall;
  background_options?: BackgroundOptions;
  zoom?: ZoomCall;
  zoom_align?: undefined | 'right' | 'left' | 'top' | 'bottom' | 'center';
};

type InitialAPICall = APICall & {
  encoding: Encoding;
} & DataSpec;

// A full API call includes all of these.
// Encoding settings are not described here.
export type CompletePrefs = APICall & {
  background_options: {
    color: string;
    opacity: [number, number];
    size: [number, number];
    mouseover: boolean;
  };
  alpha: number;
  point_size: number;
  duration: number;
  zoom_balance: number;
  max_points: number;
};

type RenderPrefs = CompletePrefs & {
  arrow_table?: Table;
  arrow_buffer?: Buffer;
};
export type TileType = QuadTile | ArrowTile;
