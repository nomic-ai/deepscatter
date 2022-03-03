export type Channel = {
  /** A field present in the data. */
  op?: "gt" | "lt" | "eq" | "within";
  a? : string | number;
  field: string;
  /** A function that transforms the field. */
  lambda?: string;
  transform : "log" | "linear" | "sqrt" | "literal";

}

export type OpArray = [
  0 | 1 | 2 | 3 | 4,
  number, 
  number
]

export interface Encoding {
  x?: Channel;
  y?: Channel;
  color?: Channel;
  size?: Channel;
  shape?: Channel;
  alpha?: Channel;
}

export interface APICall {
  /** The magnification coefficient for a zooming item */
  zoom_balance: number;

  /** The length of time to take for the transition to this state. */
  duration: number;

  /** The base point size for aes is modified */
  point_size: number;
  max_points : number;
  /** Overall screen saturation target at average point density */
  alpha: number;

  /** A function defind as a string that takes implied argument 'datum' */
  click_function : string;

  encoding: Encoding
}
