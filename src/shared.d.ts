import type { Dictionary, Float, Float32, Bool, Int, Int16, Int32, Int8, StructRowProxy, Table, Timestamp, Utf8, Vector } from 'apache-arrow';
import type { Renderer } from './rendering';
import type { Dataset } from './Dataset';
import type { ConcreteAesthetic } from './StatefulAesthetic';
import type { Tile, QuadTile } from './tile';
import type Scatterplot from './deepscatter';
import type { ReglRenderer } from './regl_rendering';
import type { Regl, Buffer } from 'regl';
import type { DataSelection } from './selection';
//import { DataSelection } from './selection';

export type {
  Renderer,
  Dataset,
  ConcreteAesthetic,
  Tile,
  QuadTile,
};


export type BufferLocation = {
  buffer: Buffer;
  offset: number;
  stride: number;
  byte_size: number; // in bytes;
};

export type Newable<T> = { new (...args: any[]): T };
export type PointFunction = (p : StructRowProxy) => number
export type Plot = Scatterplot | Scatterplot;

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
  dataset?: DataSpec;
};

export type DatasetOptions = {
  tileProxy?: TileProxy;
};

export interface SelectionRecord  {
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
export type SupportedArrowTypes = Bool | Float | Int | Dictionary<Utf8, ArrowInt> | Timestamp

// An arrow buildable vector is something returned that can be placed onto the scatterplot.
// Float32Arrays will be dropped straight onto the GPU; other types while be cast
// to Float32Array before going there.
export type ArrowBuildable = Vector<SupportedArrowTypes> | Float32Array | Uint8Array;

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
export type Transformation = (inputTile: Tile) => ArrowBuildable | Promise<ArrowBuildable>;

export type BoolTransformation = (inputTile: Tile) => 
 Promise<Float32Array> | Uint8Array | Promise<Uint8Array> | Vector<Bool> | Promise<Vector<Bool>>

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


type SignedInt = Int8 | Int16 | Int32
export type WebGlValue = number | [number, number, number];

// The type in JSON. This does not include Date because only 
// JSON-serializable types are allowed. 
export type JSONValue = number | string | boolean;

// The type in javascript. This lets us capture that some things become dates.
export type JSValue = number | string | boolean | Date;
export type DomainType = null | ArrowBuildable;

export type TypeBundle<ArrowType, JSONType, DomainType, RangeType, GLType> = {
  arrowType: ArrowType,
  jsonType: JSONType,
  domainType: DomainType,
  rangeType: RangeType,
  glType: GLType
};

export type StringCategorical = TypeBundle<
  Dictionary<Utf8, SignedInt>, // arrowType
  string, // jsonType
  string, // domainType
  string, // rangeType
  number // glType
>;


type NumberOut = {
  rangeType: number,
  glType: number
}

type ColorOut = {
  rangeType: string,
  glType: [number, number, number]
}

type BoolOut = {
  rangeType: boolean,
  glType: 0 | 1
}



type CategoryIn = {
  arrowType: Dictionary<Utf8>,
  jsonType: string,
  domainType: string,
}

type NumberIn = {
  arrowType: Float | Int,
  jsonType: number,
  domainType: number
}

type DateIn = {
  arrowType: Timestamp,
  jsonType: string,
  domainType: Date
}

type BoolIn = {
  arrowType: Bool,
  jsonType: boolean,
  domainType: boolean
}


export type OutType = NumberOut | ColorOut | BoolOut
export type InType = DateIn | BoolIn | NumberIn | CategoryIn

export type Transform = 'log' | 'sqrt' | 'linear' | 'literal';

export type ScaleChannel<
  DomainType extends JSValue,
  RangeType extends JSValue
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
  domain?: [DomainType, DomainType, ...DomainType[]];
  // The range into which to map the data.
  range?: [RangeType, RangeType, ...RangeType[]];
}

export type LambdaChannel<DomainType extends JSValue, RangeType extends JSValue> = {
  lambda?: (v: DomainType) => RangeType;
  field: string;
}

/**
 * Operations to be performed on the GPU taking a single argument.
 */
type OneArgumentOp<ArrowType extends Timestamp | Float | Int> = {
  op: 'gt' | 'lt' | 'eq';
  a: number;
  // This will not need to be defined and can't be overridden;
  // it just is defined implicitly because we call the function in 
  // WebGL, not JS.
  localImplementation?: (arg: ArrowType) => boolean; 
};

/**
 * Operations to be performed on the GPU taking two arguments
 */

type TwoArgumentOp<ArrowType extends Timestamp | Float | Int> = {
  op: 'within' | 'between';
  a: number;
  b: number;
  // This will not need to be defined and can't be overridden;
  // it just is defined implicitly because we call the function in 
  // WebGL, not JS.
  localImplementation?: (arg: ArrowType) => boolean; 
};

export type OpChannel<ArrowType extends Timestamp | Float | Int> = {
  field: string;
} & ( OneArgumentOp<ArrowType> | TwoArgumentOp<ArrowType> );

export type ConstantNumber = {
  constant: number;
};

export type ConstantString = {
  constant: string;
};

export type ConstantChannel<T extends boolean | number | string> =
  {constant : T}

export type JitterRadiusMethod =
  | 'None' // No jitter
  | 'spiral' // animates along a log spiral.
  | 'uniform' // static jitters around a central point.
  | 'normal' // static jitters around a central point biased towards the middle.
  | 'circle' // animates a circle around the point.
  | 'time'; // lapses the point in and out of view.
  
export type JitterChannel<DomainType extends JSValue, RangeType extends number> = ScaleChannel<DomainType, RangeType> & {
  method: JitterRadiusMethod;
} | ConstantChannel<RangeType>;

type BooleanChannel = 
  | ConstantChannel<boolean>
  | OpChannel<Timestamp | Float | Int> 
  | LambdaChannel<JSValue, boolean>
// A description of a functional operation to be passsed to the shader.
/**
 * And encoding.
 */
export type Encoding = {
  x?: ScaleChannel<number, number>;
  y?: ScaleChannel<number, number>;
  color?: null | ScaleChannel<JSValue, string> | ConstantChannel<string> | LambdaChannel<JSValue, string>;
  size?: null | ScaleChannel<number, number> | ConstantChannel<number> | LambdaChannel<JSValue, number>
  filter?: null | BooleanChannel;
  filter2?: null | BooleanChannel;
  foreground?: null | BooleanChannel;
  jitter_radius?: null | JitterChannel<JSValue, number>;
  jitter_speed?: null | ScaleChannel<number, number>;
  x0?: null | ScaleChannel<number, number>;
  y0?: null | ScaleChannel<number, number>;
};

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

/**
 * A DataSpec is a record that describes how to load data into the
 * scatterplot. It can be one of three things:
 * 1. A URL to a quadtile source.
 * 2. An Arrow Table object. (Use this with care! Minor differences in JS Apache Arrow builds 
 * can cause this to fail in deeply confusing ways.)
 * 3. A Uint8Array containing a serialized Arrow Table. (This is safer than passing an Arrow Table.)
 */
export type DataSpec = Record<string, never> &
  (
    | { source_url?: never; arrow_table?: never; arrow_buffer: Uint8Array }
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

  /** A function defind as a string that takes implied argument 'datum'
   * Every time a mouseover happens on a point, this function will be
   * called on that point.
  */
  click_function?: string;

  /** A function defined as a string that take the implied argument 'datum'.
   * Every time a mouseover happens on a point, this function will be
   * called on that point; the string that it returns will be inserted into
   * the innerHTML of the tooltip.
   */
  tooltip_html?: string;

  // The color of the screen background.
  background_color?: string;

  // 
  transformations?: Record<string, string>;
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