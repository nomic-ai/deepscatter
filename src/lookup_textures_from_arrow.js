import { Table } from '@apache-arrow/es5-cjs';
import { range, extent } from 'd3-array';
// import { scaleLinear } from 'd3-scale';
import { encodeFloatsRGBArange } from './util';

export default class ArrowMetaTable {
  constructor(prefs, table_name) {
    this.table_name = table_name;
    this.prefs = prefs;
    this.table = undefined;

    this.textures = new Map();
  }

  load() {
    const url = `${this.prefs.source_url}/${this.table_name}.feather`;
    if (this._promise) {
      return this._promise;
    }
    this._promise = fetch(url)
      .then((response) => response.arrayBuffer())
      .then((response) => {
        const table = Table.from(response);
        this.table = table;
        return 'complete';
      });
    return this._promise;
  }

  crosstab_array(dimensions, orders = {}) {
    /* x is the rows of the texture, y the columns, and
    z a value encoded as a floating point. eg:
    const y = "date"
    const x = "country"
    const z = "delta"
    */
    const x_indices = new IncrementalDict();
    const y_indices = new IncrementalDict();
    const { x, y, z } = dimensions;

    const tab = this.table;

    // This assumes that y will be a date field, and
    // x will produce strings.
    const y_values = tab.getColumn(y).data.values;
    const x_values = tab.getColumn(x).toArray();
    const z_values = tab.getColumn(z).toArray();

    // First assign indices based on the passed parameters,
    // if present.

    if (orders.x) {
      x_indices.prepopulate(orders.x(), false);
    } else {
      x_indices.prepopulate(x_values);
    }
    if (orders.y) {
      // y (date) is sorted.
      y_indices.prepopulate(orders.y(), true);
    } else {
      y_indices.prepopulate(y_values);
    }

    // Pre-create empty arrays
    const crosstabs = range(x_indices.size)
      .map((i) => new Array(y_indices.size).fill(0));

    for (let i = 0; i < tab.length; i++) {
      const x_ = x_indices.get(x_values[i]);
      const y_ = y_indices.get(y_values[i]);
      const z_ = z_values[i];
      crosstabs[x_][y_] = z_;
    }

    return {
      crosstabs,
      shape: [x_indices.size, y_indices.size],
      // Erg. Factors are encoded 2047 down to guarantee
      // precision.
      x_domain: extent(x_indices.values()).map((d) => d - 2047),
      y_domain: extent(y_values),
    };
  }
}

class IncrementalDict extends Map {
  // Assign IDs to objects.
  get(id) {
    if (super.get(id) !== undefined) {
      return super.get(id);
    }
    if (this.fixed) {
      return super.get('Other');
    }
    super.set(id, this.size);
    return super.get(id);
  }

  prepopulate(ids, sort = true) {
    // ensures sortedness, allows forcing of non-present values.

    // If sort is false, maintains the order of the passed items. Used
    // for dictionaries elsewhere.

    // At the end, marks the dictionary as fixed which uses the
    // magic key "Other" for any remaining items.
    const vals = [...new Set(ids)];
    if (sort) {
      vals.sort();
    }
    for (const val of vals) {
      this.get(val);
    }
    this.fixed = true;
  }
}
