import * as Comlink from "comlink";
import { Table, Column, Vector, Utf8, Float32, Uint32, Int32, Int64, Dictionary } from 'apache-arrow';
// import ArrowTree from './ArrowTree';


function compose_functions(val) {
  if (typeof val === "string") {
    return compose_singleton_function(val)
  }
  // If passed a list of functions, treat them
  // as successive filters.

  // Note that you're best off putting the hardest function first.
  // I don't optimize for that, because I'm not a lunatic.

  const functions = val.map(compose_singleton_function)
  // Does the datum pass every function?
  const logical_test = datum => functions.every(func => func(datum))
}

function compose_singleton_function(val) {
  return Function("datum", val)
}

// Somehow have to keep these independent.

function dictVector(input, id) {
  const dictionary = Vector.from({
    values: input,
    type: new Dictionary(new Utf8(), new Uint32(), id),
    highWaterMark: 1000000
  })
  return dictionary
}

function floatVector(input) {
  return Vector.from(
  {
    values: input,
    type: new Float32(),
    highWaterMark: 1000000
  })
}

const WorkerTile = {

  fetch(url, mutations) {
    return fetch(url)
      .then(resp => resp.arrayBuffer())
      .then(response => {
        let table = Table.from(response);
        const metadata = table.schema.metadata;
        const tile = url.split("/").slice(-3).join("/")
        mutations['tile_key'] = `return "${tile}"`;

        let buffer;
        if (Object.keys(mutations).length) {
          buffer = mutate(mutations, response)
        } else {
          buffer = response
        }

        const codes = get_dictionary_codes(buffer)

        return [Comlink.transfer(buffer, [buffer]), metadata, codes]

      })

  },

  /* kdtree(table_buffer) {
    const table = Table.from(table_buffer)
    const tree = ArrowTree.from_arrow(table, "x", "y")
    return [
      Comlink.transfer(table_buffer, [table_buffer]),
      Comlink.transfer(tree.bush.data, [tree.bush.data])
    ]
  }, */



  run_transforms(map, table_buffer) {
    const buffer = mutate(map, table_buffer)
    const codes = get_dictionary_codes(buffer)
    return [Comlink.transfer(buffer, [buffer]), codes]
  }
}

function get_dictionary_codes(buffer) {
  // Too expensive to do on the client.
  const table = Table.from(buffer)

  const dicts = {}
  for (const field of table.schema.fields) {
    if (field.type.dictionary) {
      dicts[field.name] = new Map()
      const c = table.getColumn(field.name)
      const keys = c.dictionary.toArray()
      let ix = 0;
      for (let k of keys) {
        // safe to go both ways at once because one is a string and
        // the other an int.
        dicts[field.name].set(ix, k)
        ix++;
      }
    }
  }
  return dicts
}



function mutate(map, table_buffer) {
    const table = Table.from(table_buffer)

    const data = new Map()
    const funcmap = new Map()

    for (let [k, v] of Object.entries(map)) {
      data.set(k, Array(table.length))
      // Materialize the mutate functions from strings.
      funcmap.set(k, Function("datum", v))
    }

    let i = 0;
    // Set the values in the rows.
    for (let row of table) {
      for (let [k, func] of funcmap) {
        data.get(k)[i] = func(row)
      }
      i++;
    }

    const columns = {};



    // First, population the old columns
    for (let k of table.schema.fields.map(d => d.name)) {
      if (!funcmap.has(k)) {
        // Allow overwriting, so don't copy if it's there.
        const col = table.getColumn(k)
        if (k === "ix") {
          // coerce the ix field to float.
          // Ultimately, may need to
          // pack it across a few different channels.
          columns[k] = floatVector(col)//.data.values
        } else {
          columns[k] = col
        }

        // Translate to float versions here to avoid casting in the main thread.
        if (col.dictionary) {
          const float_version = new Float32Array(table.length)
          for (let i = 0; i < table.length; i++) {
            // At half precision, -2047 to 2047 is the
            // range through which integers are exactly right.
            float_version[i] = col.indices.get(i) - 2047
          }
          columns[k + "_dict_index"] = floatVector(float_version)
        }

      }
    }

    let highest_dict_id = Math.max(...table.schema.dictionaries.keys())

    // If there are no dictionaries, this returns negative infinity.
    if (highest_dict_id < 0) {highest_dict_id = -1}

    for (let [k, vector] of data) {
      let column
      if (typeof(vector[0]) == "string") {
        highest_dict_id++;
        column = dictVector(vector, highest_dict_id)
      } else {
        column = floatVector(vector)
      }
      columns[k] = column;
    }



    const return_table = Table.new(columns)

    const buffer = return_table.serialize().buffer
    return buffer
}

Comlink.expose(WorkerTile);

//Comlink.expose(TableMutator)
