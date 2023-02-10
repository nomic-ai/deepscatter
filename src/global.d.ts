import type { Table } from 'apache-arrow';
import type { Renderer } from './rendering';
import type { Dataset } from './Dataset';
import type { ArrowDataset } from './Dataset';
import type { ConcreteAesthetic } from './StatefulAesthetic';
import type { Tile, QuadTile, ArrowTile } from './tile';
import Scatterplot from './deepscatter';

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

declare global {
  type Newable<T> = { new (...args: any[]): T };
  type Plot = Scatterplot<QuadTile> | Scatterplot<ArrowTile>;
  type OpChannel = OneArgumentOp | TwoArgumentOp;
  // Functions that are defined as strings and executed in JS.
  type LambdaChannel = {
    lambda: string;
    field: string;
    domain?: [number, number];
    range?: [number, number];
  };

  type FunctionalChannel = LambdaChannel | OpChannel;

  type BackgroundOptions = {
    // The color of background points. Hex codes or HTML
    // colors are accepted.
    color?: string;

    // A multiplier against the point's opacity otherwise.
    opacity?: number;

    // A multiplier against the point's size otherwise,
    size?: number;

    // Whether the points should respond on mouseover.
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
    field: string; // .
    /**
     * A transformation to apply on the field.
     * 'literal' maps in the implied dataspace set by 'x', 'y', while
     * 'linear' transforms the data by the range and domain.
     */
    transform?: 'log' | 'linear' | 'sqrt' | 'literal';
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

  export type Channel =
    | BooleanChannel
    | BasicChannel
    | string
    | OpChannel
    | ConstantColorChannel
    | ConstantChannel
    | LambdaChannel;

  export type JitterChannel = Channel & {
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
    x?: Channel;
    y?: Channel;
    color?: null | ColorChannel;
    size?: null | Channel;
    shape?: null | Channel;
    alpha?: null | Channel;
    filter?: null | FunctionalChannel;
    filter2?: null | FunctionalChannel;
    jitter_radius?: null | JitterChannel;
    jitter_speed?: null | Channel;
    x0?: null | Channel;
    y0?: null | Channel;
    position?: string;
    position0?: string;
  };

  type TileKey = `${number}/${number}/${number}`;

  export type PointUpdate = {
    column_name: string;
    values: Record<string, Record<number, number>>;
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

    background_options?: BackgroundOptions;
  };

  type InitialAPICall = APICall & {
    encoding: Encoding;
  } & DataSpec;

  export type TileType = QuadTile | ArrowTile;
}
