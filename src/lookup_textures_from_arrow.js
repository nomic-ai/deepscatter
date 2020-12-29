import {Table} from 'apache-arrow';
import {range, extent} from 'd3-array';

export default class ArrowMetaTable {
  constructor(prefs, table_name) {
    this.table_name = table_name
    this.prefs = prefs
    this.table = undefined

    this.textures = new Map()
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

  get_cached_crosstab_texture(dimensions, orders, regl) {
    const {x, y, z} = dimensions;
    const id = `${x}-${y}-${z}`
    if (this.textures.get(id)) {
      return this.textures.get(id)
    }

    const {
      crosstabs, y_domain, x_domain, shape
    } = this.crosstab_array(dimensions, orders)

    console.log({shape, crosstabs})
    this.textures[id] = {
      texture: regl.texture(
      {
        type: 'float',
        format: 'alpha',
        width: shape[0],
        height: shape[1],
        data: crosstabs
      }),
      x_domain,
      y_domain,
      shape
    }

    return this.textures[id]


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

    const tab = this.table;

    // This assumes that y will be a date field, and
    // x will produce strings.
    console.log(x, y, z)
    console.log(tab.schema.fields.map(d => d.name))
    const y_values = tab.getColumn(y).data.values
    const x_values = tab.getColumn(x).toArray()
    const z_values = tab.getColumn(z).toArray()


    // First assign indices based on the passed parameters,
    // if present.

    if (orders.x) {
      x_indices.prepopulate(orders.x(), false)
    }
    if (orders.y) {
      y_indices.prepopulate(orders.y(), false)
    }
    x_indices.prepopulate(x_values)
    y_indices.prepopulate(y_values)

    // Pre-create empty arrays
    const crosstabs = range(x_indices.size)
       .map(i => new Array(y_indices.size).fill(0))

    for (let i = 0; i < tab.length; i++) {
      const x_ = x_indices.get(x_values[i])
      const y_ = y_indices.get(y_values[i])
      const z_ = z_values[i]
      if (Math.random() < .00001) {console.log(x_, y_, z_)}
      crosstabs[x_][y_] = z_
    }

    return {
      crosstabs,
      shape: [x_indices.size, y_indices.size],
      x_domain: extent(x_values),
      y_domain: extent(y_values)
    }
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
