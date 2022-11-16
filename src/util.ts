import { extent } from 'd3-array';

// eslint-disable-next-line import/prefer-default-export
export function encodeFloatsRGBArange(values, array) {
  // Rescale a number into the range [0, 1e32]
  // so that it can be passed to the four components of a texture.
  values = values.flat();

  const [min, max] = extent(values);

  if (array === undefined) {
    array = new Uint32Array(values.length);
  }

  const scale_size = 2 ** 32 / (max - min);

  let i = 0;

  for (const value of values) {
    array[i] = (value - min) * scale_size;
    i += 1;
  }

  return {
    extent: [min, max],
    array: new Uint8Array(array.buffer),
  };
}
