import Flatbush from 'flatbush';


export default class ArrowTree {

  static from_buffer(buffer, table) {
    const tree = new ArrowTree()
    tree.bush = Flatbush.from(buffer);
    tree.table = table;
    return tree
  }

  static from_arrow(table, x_accessor = "x", y_accessor = "y") {
    const tree = new ArrowTree()

    tree.table = table;
    try {
      tree.bush = new Flatbush(table.length, 64, Float32Array);
    } catch(err) {
      console.warn(table.length, "Length")
      console.warn(err)
      return
    }

    for (let row of table) {
      tree.bush.add(row[x_accessor], row[y_accessor], row[x_accessor], row[y_accessor])
    }

    tree.bush.finish()
    return tree
  }

  find(x, y, max_radius = Infinity, filter = d => true) {
    if (this.bush === undefined) {return undefined}
    const results = this.bush.neighbors(x, y, 1, max_radius, filter)

    if (results.length) {
      return this.table.get(results[0])
    } else {
      return undefined
    }
  }
}
