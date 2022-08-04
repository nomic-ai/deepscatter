
type OneArgumentOp = {
  op: "gt" | "lt" | "eq"
  a : number;
  field : string;
}

type TwoArgumentOp = {
  op: "within" | "between",
  field: string,
  a: number,
  b: number;
}

export type OpChannel = OneArgumentOp | TwoArgumentOp;

export type LambdaChannel = {
  lambda : string;
  field : string;
  domain? : [number, number];
  range? : [number, number];
}

export type FunctionalChannel = LambdaChannel | OpChannel;

export type ConstantChannel = {
  constant : number;
}

export interface BasicChannel {
  /** A field present in the data. */
  field: string;
  /** A function that transforms the field. */
  transform? : "log" | "linear" | "sqrt" | "literal";
  range? : [number, number];
  domain? : [number, number];
}

export type JitterChannel = {
  method : null | "spiral" | "uniform" | "normal" | "circle" | "time"
}

export interface CategoricalChannel {
  field: string;
}

export type BasicColorChannel = BasicChannel & {
  range? : [[number, number, number], [number, number, number]] | string;
  domain? : [number, number];
}

export type CategoricalColorChannel = CategoricalChannel & {
  range? : [number, number, number][] | string;
  domain? : string[];
}

export type ConstantColorChannel = ConstantChannel & {
  constant? : [number, number, number]
}

export type ColorChannel = BasicColorChannel | CategoricalColorChannel | ConstantColorChannel;

export type Channel = BasicChannel | string | ConstantChannel | OpChannel | LambdaChannel;

export type OpArray = [
  number,
  number, 
  number
] // A description of a functional operation to be passsed to the shader.


export type Encoding = {
  x?: null | Channel;
  y?: null | Channel;
  color?: null | ColorChannel;
  size?: null | Channel;
  shape?: null | Channel;
  alpha?: null | Channel;
  filter?: null | FunctionalChannel;
  filter1?: null | FunctionalChannel;
  filter2?: null | FunctionalChannel;
  jitter_radius?: Channel;
  jitter_speed?: Channel;
  x0?: Channel;
  y0? : Channel;
  position?: string;
  position0? : string;
}

export type APICall = {

  /** The URL of the data. */
  source_url: string;
  
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

export function isOpChannel(input: Channel): input is OpChannel {
  return (input as OpChannel).op !== undefined;
}

export function isLambdaChannel(input: Channel): input is LambdaChannel {
  return (input as LambdaChannel).lambda !== undefined;
}

export function isConstantChannel(input: Channel): input is ConstantChannel {
  return (input as ConstantChannel).constant !== undefined;
}