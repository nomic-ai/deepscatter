import Flatbush from 'flatbush';
import TinyQueue from 'tinyqueue';

export default class ArrowTree {

  constructor(table, x_accessor = "x", y_accessor = "y") {
    this.table = table;
    if (!table.length > 0) {
      return
    }
    console.log(table.length)
    try {
      this.bush = new Flatbush(table.length, 64, Float32Array);
    } catch(err) {
      console.warn(table.length, "Length")
      console.warn(err)
      return
    }

    for (let row of table) {
      this.bush.add(row.x, row.y, row.x, row.y)
    }

    this.bush.finish()
  }

  find(x, y, max_radius = Infinity, filter = d => true) {

    const results = this.bush.neighbors(x, y, 1, max_radius, filter)

    if (results.length) {
      return this.table.get(results[0])
    } else {
      return undefined
    }
  }
}
