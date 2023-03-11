export function isOpChannel(input: RootChannel): input is OpChannel {
  return (input as OpChannel).op !== undefined;
}

export function isLambdaChannel(input: RootChannel): input is LambdaChannel {
  return (input as LambdaChannel).lambda !== undefined;
}

export function isDataChannel(input: RootChannel): input is DataChannel {
  return (input as DataChannel).field !== undefined;
}

export function isConstantChannel(
  input: RootChannel | ColorChannel
): input is ConstantChannel {
  return (input as ConstantChannel).constant !== undefined;
}

const isTypedArray = (function () {
  const TypedArray = Object.getPrototypeOf(Uint8Array);
  return (obj) => obj instanceof TypedArray;
})();
