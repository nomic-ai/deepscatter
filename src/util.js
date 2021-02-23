import { extent, sum } from 'd3-array'

export function encodeFloatsRGBArange(values, array) {
  // Rescale a number into the range [0, 1e32]
  // so that it can be passed to the four components of a texture.
  values = values.flat()

  const [min, max] = extent(values)

  if (array == undefined) {
    array = new Uint32Array(values.length)
  }

  const scale_size = (2**32)/(max - min);

  let i = 0;

  for (let value of values) {
    array[i] = (value - min)*scale_size
    i += 1
  }

  console.log(sum(values), max, min, (values[100] - min)*scale_size)

  return {
    extent: [min, max],
    array: new Uint8Array(array.buffer)
  }

}

export function fencodeFloatsRGBA(values, array) {
  if (array == undefined) {
    array = new Uint8Array(values.length * 4)
  }
  if (typeof(values[0])=="boolean") {
    // true, false --> 1, 0
    values = values.map(d => +d)
  }
  let p = 0
  for (let value of values) {
    if (value >= 1) {value -= 1/(2**32)}
    if (value < 0) {value = 0}
    array[p + 0] = value % (1/256/256/256) * 256 * 256 * 256 * 256
    array[p + 1] = value % (1/256/256) * 256 * 256 * 256
    array[p + 2] = value % (1/256) * 256 * 256
    array[p + 3] = value % (1) * 256
    p += 4
   }
   return array
  return {
    array,
    extent
  }
}
