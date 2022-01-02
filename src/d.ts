export interface Channel {
  /** A field present in the data. */
  field: string;

  /** A function that transforms the field. */
  lambda?: string;
}

export interface Encoding {
  x?: Channel;
  y?: Channel
}

export interface APICall {
  /** The magnification coefficient for a zooming item */
  zoom_balance: number;

  /** The length of time to take for the transition to this state. */
  duration: number;

  /** The base point size for aes is modified */
  point_size: number;

  /** Overall screen saturation target at average point density */
  alpha: number;

  /** A function defind as a string that takes implied argument 'datum' */
  click_function : string;

  encoding: Encoding
}
