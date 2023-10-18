import type {
  RootChannel, OpChannel, ColorChannel,
  ConstantChannel, LambdaChannel, Labelcall,
  URLLabels, Labelset, 
} from './shared.d'

export function isOpChannel(input: RootChannel): input is OpChannel {
  return (input as OpChannel).op !== undefined;
}

export function isLambdaChannel(input: RootChannel): input is LambdaChannel {
  return (input as LambdaChannel).lambda !== undefined;
}

export function isConstantChannel(
  input: RootChannel | ColorChannel
): input is ConstantChannel {
  return (input as ConstantChannel).constant !== undefined;
}

export function isURLLabels(labels: Labelcall): labels is URLLabels {
  return labels !== null && (labels as URLLabels).url !== undefined;
}

export function isLabelset(labels: Labelcall): labels is Labelset {
  return labels !== null && (labels as Labelset).labels !== undefined;
}
