export function encodeFloatsRGBA(values, array) {
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
    const logged = Math.log(value)
    array[p + 0] = value % (1/256/256/256) * 256 * 256 * 256 * 256
    array[p + 1] = value % (1/256/256) * 256 * 256 * 256
    array[p + 2] = value % (1/256) * 256 * 256
    array[p + 3] = value % (1) * 256
    p += 4
   }
  return array
}
