export function isOpChannel(input: Channel): input is OpChannel {
  return (input as OpChannel).op !== undefined;
}

export function isLambdaChannel(input: Channel): input is LambdaChannel {
  return (input as LambdaChannel).lambda !== undefined;
}

export function isConstantChannel(
  input: Channel | ColorChannel
): input is ConstantChannel {
  return (input as ConstantChannel).constant !== undefined;
}
