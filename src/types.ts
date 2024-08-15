import type {
  Dictionary,
  Float,
  Bool,
  Int,
  Int16,
  Int32,
  Int8,
  StructRowProxy,
  Table,
  Timestamp,
  Utf8,
  Vector,
} from 'apache-arrow';
import type { Renderer } from './rendering';
import type { Deeptable } from './Deeptable';
import type { ConcreteAesthetic } from './aesthetics/StatefulAesthetic';
import type { Buffer } from 'regl';
import type { DataSelection } from './selection';
import { Scatterplot } from './scatterplot';
import { ZoomTransform } from 'd3-zoom';
import { TileBufferManager } from './regl_rendering';
import type { Tile } from './tile';
import type { Rectangle } from './tile';
export type { Renderer, Deeptable, ConcreteAesthetic };

export type BufferLocation = {
  buffer: Buffer;
  offset: number;
  stride: number;
  byte_size: number; // in bytes;
};

export type Newable<T> = { new (...args: unknown[]): T };
export type PointFunction<T = number> = (p: StructRowProxy) => T;

/**
 * A proxy class that wraps around tile get calls. Used to avoid
 * putting Nomic login logic in deepscatter while fetching
 * tiles with authentication.
 *
 */
export interface TileProxy {
  apiCall: (
    endpoint: string,
    method: 'GET' | 'POST', // Generally, the HTTP method.
    parameter1: unknown, // For internal use.
    parameter2: unknown, // For internal use.
    options: Record<string, boolean | string | number>,
  ) => Promise<Uint8Array>;
}

export type ScatterplotOptions = {
  selector?: string | HTMLDivElement;
  width?: number;
  height?: number;
} & (DataSpec | Record<string, never>);

// The orientation of the deeptable. Quadtree deeptables
// allow certain optimizations.
export type TileStructure = 'quadtree' | 'other';

export type LazyTileManifest = {
  key: string;
  // The number of data points in that specific tile.
  nPoints: number;
  children: string[];
  min_ix: number;
  max_ix: number;
  extent: Rectangle;
};
export type TileManifest = {
  key: string;
  // The number of data points in that specific tile.
  nPoints: number;
  children: TileManifest[];
  min_ix: number;
  max_ix: number;
  extent: Rectangle;
};

/**
 * The arguments passed to new Deeptable().
 */
export type DeeptableCreateParams = {
  // A URL for the root of the quadtree if files are not stored locally.
  // At the present time only
  // http:// and https:// urls are allowed, but other sources can be read
  // from the
  baseUrl: string;

  // A Deepscatter Scatterplot object. If null, deeptable operations will still be
  // possible.
  plot: Scatterplot | null;

  // A TileProxy object to handle fetching tiles.
  tileProxy?: TileProxy;

  // The strategy used for creating the tree of linked tiles.
  // For quadtree data (the default) additional information
  // may be inferred.
  tileStructure?: TileStructure;

  // A manifest listing all the tiles in the deeptable.
  // Currently this must be passed as a recursive structure.
  tileManifest?: Partial<TileManifest>;

  // A URL for an arrow file manifest. The schema for this manifest
  // is not yet publically documented: I hope to bundle it into the
  // python quadfeather library in the near future.
  manifestUrl?: string;

  // The x/y extent of the data. If both a tile manifest and an extent
  // are passed, the manifest will take precedence.
  extent?: Rectangle;

  // The key to access the root tile. If not passed, will default to 0/0/0.
  // If both a manifest and a root key are passed, the root key will take
  // precedence to facilitate faster initial loading.
  rootKey?: string;
};

export interface SelectionRecord {
  selection: DataSelection | null;
  name: string;
  flushed: boolean;
}

export type BackgroundOptions = {
  // The color of background points. Hex codes or HTML
  // colors are accepted.
  color?: string;

  // A multiplier against the point's opacity otherwise.
  // A single value describes the background; an array
  // describes the foreground and background separately.
  opacity?: number | [number, number];

  /**
   * A multiplier against the point's size. Default 0.66.
   * A single value describes the background; an array
   * describes the foreground and background separately.
   */
  size?: number | [number, number];

  // Whether the background points sho`uld respond on mouseover.
  mouseover?: boolean;
};

// i.e., signed ints.
type ArrowInt = Int8 | Int16 | Int32;

// Deepscatter does not support all Arrow types; any columns not in the following set
// cannot be rendered on the map.
export type SupportedArrowTypes =
  | Bool
  | Float
  | Int
  | Dictionary<Utf8, ArrowInt>
  | Timestamp;

// An arrow buildable vector is something returned that can be placed onto the scatterplot.
// Float32Arrays will be dropped straight onto the GPU; other types while be cast
// to Float32Array before going there.
export type ArrowBuildable =
  | Vector<SupportedArrowTypes>
  | Float32Array
  | Uint8Array;

type MaybePromise<T> = T | Promise<T>;

/**
 * A transformation is a batchwise operation that can be used to construct
 * a new column in the data table. It runs asynchronously so that it
 * can make network calls: it's defined as a recordbatch -> column operation
 * rather than a point -> value operation for speed.
 *
 * If the resulting vector or float32array is not the same length as
 * inputTile.record_batch.numRows, it will fail in an undefined way.
 * This is not a guarantee I know how to enforce in the type system.
 */
export type Transformation = (inputTile: Tile) => MaybePromise<ArrowBuildable>;

export type BoolTransformation = (
  inputTile: Tile,
) => MaybePromise<Vector<Bool>>;

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

export type WebGlValue = number | [number, number, number];

// The type in JSON. This does not include Date because only
// JSON-serializable types are allowed.
export type JSONValue = number | string | boolean;

// The type in javascript. This lets us capture that some things become dates.
export type JSValue = number | string | boolean | Date;

// export type TypeBundle<ArrowType, JSONType, DomainType, RangeType, GLType> = {
//   arrowType: ArrowType;
//   jsonType: JSONType;
//   domainType: DomainType;
//   rangeType: RangeType;
//   glType: GLType;
// };

// export type StringCategorical = TypeBundle<
//   Dictionary<Utf8, SignedInt>, // arrowType
//   string, // jsonType
//   string, // domainType
//   string, // rangeType
//   number // glType
// >;

export type NumberOut = {
  rangeType: number;
  glType: number;
};

export type ColorOut = {
  rangeType: string;
  glType: [number, number, number];
};

export type BoolOut = {
  rangeType: boolean;
  glType: 0 | 1;
};

export type CategoryIn = {
  arrowType: Dictionary<Utf8>;
  jsonType: string;
  domainType: string;
};

export type NumberIn = {
  arrowType: Float | Int;
  jsonType: number;
  domainType: number;
};

export type DateIn = {
  arrowType: Timestamp;
  jsonType: IsoDateString;
  domainType: Date;
};

export type BoolIn = {
  arrowType: Bool;
  jsonType: boolean;
  domainType: boolean;
};

export type ConstantIn = {
  arrowType: null;
  jsonType: null;
  domainType: null;
};

export type InType = DateIn | BoolIn | NumberIn | CategoryIn | ConstantIn;

export type OutType = NumberOut | ColorOut | BoolOut;

export type Transform = 'log' | 'sqrt' | 'linear' | 'literal';

export type IsoDateString =
  | `${number}-${number}-${number}`
  | `${number}-${number}-${number}T${number}:${number}:${number}.${number}Z`;

// Any valid HTML string. Hard to type check.
export type Colorstring =
  //  | `#${number}${number}${number}${number}${number}${number}`
  string;

export type NumericScaleChannel<
  DomainType extends number | IsoDateString = number,
  RangeType extends number | Colorstring = number,
> = {
  /** The name of a column in the data table to be encoded. */
  field: string;
  /**
   * A transformation to apply on the field.
   * 'literal' maps in the implied dataspace set by 'x', 'y', while
   * 'linear' transforms the data by the range and domain.
   */
  transform?: Transform;
  // The domain over which the data extends
  domain?: [DomainType, DomainType];
  // The range into which to map the data.
  range?: [RangeType, RangeType];
};

export type LambdaChannel<
  DomainType extends JSValue,
  RangeType extends boolean | number | Colorstring,
> = {
  lambda?: (v: DomainType) => RangeType;
  field: string;
};

/**
 * Operations to be performed on the GPU taking a single argument.
 */
type OneArgumentOp<JSONType extends number | IsoDateString> = {
  op: 'gt' | 'lt' | 'eq';
  a: JSONType;
  // This will not need to be defined and can't be overridden;
  // it just is defined implicitly because we call the function in
  // WebGL, not JS.
  // localImplementation?: (arg: JSONType) => boolean;
};

/**
 * Operations to be performed on the GPU taking two arguments
 */

type TwoArgumentOp<JSONType extends number | IsoDateString> = {
  op: 'within' | 'between';
  a: JSONType;
  b: JSONType;
  // This will not need to be defined and can't be overridden;
  // it just is defined implicitly because we call the function in
  // WebGL, not JS.
  // localImplementation?: (arg: ArrowType) => boolean;
};

export type OpChannel<JSONType extends number | IsoDateString> = {
  field: string;
} & (OneArgumentOp<JSONType> | TwoArgumentOp<JSONType>);

export type ConstantChannel<T extends boolean | number | string> = {
  constant: T;
};

export type OneDChannels =
  | ConstantChannel<number>
  | NumericScaleChannel<number | IsoDateString>;

export type JitterMethod =
  | 'None' // No jitter
  | 'spiral' // animates along a log spiral.
  | 'uniform' // static jitters around a central point.
  | 'normal' // static jitters around a central point biased towards the middle.
  | 'circle' // animates a circle around the point.
  | 'time'; // lapses the point in and out of view.

export type BooleanChannel =
  | ConstantChannel<boolean>
  | OpChannel<IsoDateString | number>
  | LambdaChannel<JSValue, boolean>;

type Colorname = string;

export type ChannelType =
  | BooleanChannel
  | OpChannel<number | IsoDateString>
  | ConstantChannel<string | number | boolean>
  | NumericScaleChannel<number | IsoDateString>
  | CategoricalColorScale;

export type CategoricalColorScale = {
  field: string;
  domain: string | [string, string, ...string[]];
  range: Colorname[];
};

export type LinearColorScale = {
  field: string;
  domain: [number, number]; // TODO: | [number, number, number]
  // TODO: implement some codegen for these values
  range: 'viridis' | 'magma' | 'ylorrd';
  transform?: 'log' | 'sqrt' | 'linear'; // TODO: | "symlog"
};

export type ColorScaleChannel =
  | ConstantChannel<Colorname>
  | LinearColorScale
  | CategoricalColorScale;

// A description of a functional operation to be passsed to the shader.
/**
 * And encoding.
 */
export type Encoding = {
  x?: null | NumericScaleChannel;
  y?: null | NumericScaleChannel;
  color?: null | ColorScaleChannel;
  size?: null | ConstantChannel<number> | LambdaChannel<JSValue, number>;
  filter?: null | BooleanChannel;
  filter2?: null | BooleanChannel;
  foreground?: null | BooleanChannel;
  jitter_radius?: null | NumericScaleChannel | ConstantChannel<number>;
  jitter_speed?: null | NumericScaleChannel;
  x0?: null | NumericScaleChannel;
  y0?: null | NumericScaleChannel;

  // The jitter method to use.
  // Only has an effect if a constant on a field is also applied to `encoding.jitter_radius`.
  jitter_method?: JitterMethod;
};

export type DimensionKeys =
  | 'size'
  | 'jitter_speed'
  | 'jitter_radius'
  | 'color'
  | 'filter'
  | 'filter2'
  | 'x'
  | 'y'
  | 'x0'
  | 'y0'
  | 'foreground';

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
// 4. A created deeptable.

/**
 * A DataSpec is a record that describes how to load data into the
 * scatterplot.
 * It can be one of four things:
 * 1. A URL to a quadtile source.
 * 2. An Arrow Table object. (Use this with care! Minor differences in JS Apache Arrow builds
 * can cause this to fail in deeply confusing ways.)
 * 3. A Uint8Array containing a serialized Arrow Table. (This is safer than passing an Arrow Table.)
 * 4. An already-created deeptable.
 *
 * It can also optionally contain a TileProxy object, which is a wrapper that overwrites
 * the http-based fetch behavior that is deepscatter's default. This provides a way to
 * add authentication, to wrap other libraries, or to perform algorithmic manipulations.
 */
export type DataSpec = { tileProxy?: TileProxy } & (
  | {
      source_url?: never;
      arrow_table?: never;
      arrow_buffer: Uint8Array;
      deeptable?: never;
    }
  | {
      source_url: string;
      arrow_table?: never;
      arrow_buffer?: never;
      deeptable?: never;
    }
  // Pass an arrow table. This may
  | {
      source_url?: never;
      arrow_table: Table;
      arrow_buffer?: never;
      deeptable?: never;
    }
  // Pass an already instantiated deeptable.
  | {
      source_url?: never;
      arrow_table: never;
      arrow_buffer?: never;
      deeptable: Deeptable;
    }
);

/**
 * A callback provided by the consumer, enabling them to hook into
 * zoom events & recieve the zoom transform. For example, a consumer
 * might update annotations on zoom events to keep them in sync.
 */
export type onZoomCallback = (transform: d3.ZoomTransform) => null;

export type Label = {
  x: number; // in data space.
  y: number; // in data space.
  text: string; // The text to appear on the label.
  size?: number; // The size of the label (in pt)
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
export type Labelcall = Labelset | URLLabels;

// An APICall is a specification of the chart. It provides the primary way to
// alter a chart's state. Most parts are JSON serializable, but functional callbacks
// for tooltips, clicks, and changes to the highlit point are not.

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

  /** A function defind as a string that takes implied argument 'datum'
   * Every time a click happens on a point, this function will be
   * called on that point.
   */
  click_function?: RowFunction<void>;

  /** A function defined as a string that take the implied argument 'datum'.
   * Every time a mouseover happens on a point, this function will be
   * called on that point; the string that it returns will be inserted into
   * the innerHTML of the tooltip.
   */
  tooltip_html?: RowFunction<string>;

  // The color of the screen background.
  background_color?: string;

  // a set of functions by name from the existing data to a number.
  // These are used to transform the data, and can create new columns
  // in your deeptable.

  transformations?: Record<string, (d: StructRowProxy) => number>;
  encoding?: Encoding;
  labels?: Labelcall;
  background_options?: BackgroundOptions;
  zoom?: ZoomCall;
  zoom_align?: undefined | 'right' | 'left' | 'top' | 'bottom' | 'center';
};

export type InitialAPICall = APICall & {
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

// A function that can be applied to an Arrow StructRowProxy or a similar object.
// It takes the point and the full scatterplot as arguments.
export type RowFunction<T> = (
  datum: StructRowProxy,
  plot?: Scatterplot | undefined,
) => T;

// type ZoomRow = [number, number, number];
// type ZoomMatrix = [ZoomRow, ZoomRow, ZoomRow];

///////////

// Props that are needed for all the draws in a single tick.
export type GlobalDrawProps = {
  aes: { encoding: Encoding };
  colors_as_grid: 0 | 1;
  corners: Rectangle;
  zoom_balance: number;
  transform: ZoomTransform;
  max_ix: number;
  point_size: number;
  alpha: number;
  time: number;
  update_time: number;
  relative_time: number;
  background_draw_needed: [boolean, boolean];
  // string_index: number;
  prefs: APICall;
  wrap_colors_after: [number, number];
  start_time: number;
  webgl_scale: number[];
  last_webgl_scale: number[];
  use_scale_for_tiles: boolean;
  grid_mode: 1 | 0;
  buffer_num_to_variable: string[];
  aes_to_buffer_num: Record<string, number>;
  variable_to_buffer_num: Record<string, number>;
  color_picker_mode: 0 | 1 | 2 | 3;
  zoom_matrix: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  position_interpolation: boolean;
  only_color?: number;
};

// Props that are needed to draw a single tile.
export type TileDrawProps = GlobalDrawProps & {
  manager: TileBufferManager;
  number: number;
  foreground_draw_number: 1 | 0 | -1;
  tile_id: number;
};
