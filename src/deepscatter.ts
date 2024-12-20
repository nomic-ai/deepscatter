export { Scatterplot } from './scatterplot';
export { Bitmask, DataSelection, SortedDataSelection } from './selection';
export { Deeptable } from './Deeptable';
export { LabelMaker } from './label_rendering';
export { dictionaryFromArrays } from './utilityFunctions';
export { Tile } from './tile';
export { DeepGPU, ReusableWebGPUPipeline } from './webGPU/lib'
export { create_multi_hamming_transform, HammingPipeline } from './webGPU/HammingPipeline'

export type {
  APICall,
  CompletePrefs,
  Encoding,
  RowFunction,
  LabelOptions,
  Labelset,
  Labelcall,
  Label,
  DataSpec,
  Dimension,
  NumericScaleChannel,
  ColorScaleChannel,
  ConstantChannel,
  LambdaChannel,
  BooleanChannel,
  LinearColorScale,
  CategoricalColorScale,
  OpChannel,
  TileProxy,
  DeeptableCreateParams,
  Transformation
} from './types';
