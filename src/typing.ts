import type * as DS from './shared.d';
const transforms = new Set(['linear', 'sqrt', 'log', 'literal']);

export function isTransform(input: unknown): input is DS.Transform {
  if (typeof input === 'string' && transforms.has(input)) {
    return true;
  }
  return false;
}

export function isOpChannel(input: DS.ChannelType): input is DS.OpChannel<DS.IsoDateString | number> {
  return input['op'] !== undefined;
}

export function isLambdaChannel(
  input: DS.ChannelType
): input is DS.LambdaChannel<DS.JSONValue, string | number | boolean> {
  return input && input['lambda'] !== undefined;
}

export function isConstantChannel(
  input: DS.ChannelType
): input is DS.ConstantChannel<string | number | boolean> {
  return input['constant'] !== undefined;
}

export function isURLLabels(labels: DS.Labelcall): labels is DS.URLLabels {
  return labels !== null && (labels as DS.URLLabels).url !== undefined;
}

export function isLabelset(labels: DS.Labelcall): labels is DS.Labelset {
  return labels !== null && (labels as DS.Labelset).labels !== undefined;
}
