import type {
  RootChannel, OpChannel, ColorChannel,
  ConstantChannel, LambdaChannel, Labelcall,
  URLLabels, Labelset, 
} from './shared.d'

import type * as DS from './shared.d'

export function isOpChannel(input: DS.ChannelType): input is DS.OpChannel<any> {
  return input['op'] !== undefined;
}

export function isLambdaChannel(input: DS.ChannelType): input is DS.LambdaChannel<any> {
  return input['lambda'] !== undefined;
}

export function isConstantChannel(
  input: DS.ChannelType
): input is DS.ConstantChannel<string | number | boolean> {
  return input['constant'] !== undefined
}

export function isURLLabels(labels: Labelcall): labels is URLLabels {
  return labels !== null && (labels as URLLabels).url !== undefined;
}

export function isLabelset(labels: Labelcall): labels is Labelset {
  return labels !== null && (labels as Labelset).labels !== undefined;
}
