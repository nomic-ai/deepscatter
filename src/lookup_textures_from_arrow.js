import {Table} from 'apache-arrow';

export class ArrowMetaTable {
  constructor(prefs, table_name) {
    this.table_name = table_name
    this.prefs = prefs
    this.table = undefined
  }

  load() {
    const url = `${this.prefs.source_url}/${this.table_name}.feather`
    if (this._promise) {
      return this._promise
    }
    this._promise = fetch(url)
          .then(response => response.arrayBuffer())
          .then(response => {
            let table = Table.from(response);
            this.table = table
            return "complete"
          })
    return this._promise
  }

  crosstab_array(dimensions, orders = {}) {
    /* x is the rows of the texture, y the columns, and
    z a value encoded as a floating point. eg:
    const y = "date"
    const x = "country"
    const z = "delta"
    */
    const x_indices = new IncrementalDict()
    const y_indices = new IncrementalDict()
    const {x, y, z} = dimensions

    // This assumes that y will be a date field, and
    // x will produce strings.
    const y_values = tab.getColumn(y).data.values
    const x_values = tab.getColumn(x).toArray()
    const z_values = tab.getColumn(z).toArray()


    // First assign indices based on the passed parameters,
    // if present.

    if (orders.x) {
      x_indices.prepopulate(orders.x, false)
    }
    if (orders.y) {
      y_indices.prepopulate(orders.y, false)
    }
    x_indices.prepopulate(x_values)
    y_indices.prepopulate(y_values)

    const crosstabs = []

    for (let i = 0; i < tab.length; i++) {
      const x_ = x_indices.get(x_values[i])
      const y_ = y_indices.get(y_values[i])
      const z_ = z_values[i]
      if (Math.random() < .0001) {console.log(x_, y_, z_)}
      crosstabs[x_ + y_*y_indices.size] = z_
    }

    return crosstabs
  }


}



class IncrementalDict extends Map {
  // Assign IDs to objects.
  get(id) {
    if (super.get(id) !== undefined) {
      return super.get(id)
    } else {
      super.set(id, this.size)
      return super.get(id)
    }
  }

  prepopulate(ids, sort=true) {
   // ensures sortedness, allows forcing of non-present values.

   // If sort is false, maintains the order of the passed items. Used
   // for dictionaries elsewhere.
   const vals = [...new Set(ids)]
   if (sort) {
    vals.sort()
   }
   for (let val of vals) {
     this.get(val)
   }
  }
}
