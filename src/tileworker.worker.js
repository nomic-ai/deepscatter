const window = {};

import { transfer, expose } from 'comlink';
import {
  Table, Column, Vector, Utf8, Float32,
  Uint32, Int32, Int64, Dictionary,
} from '@apache-arrow/es5-cjs';

function compose_functions(val) {
  
  function compose_singleton_function(val) {
    return Function('datum', val);
  }

  if (typeof val === 'string') {
    return compose_singleton_function(val);
  }
  // If passed a list of functions, treat them
  // as successive filters.

  // Note that you're best off putting the hardest function first.
  // I don't optimize for that, because I'm not a lunatic.

  const functions = val.map(compose_singleton_function);
  // Does the datum pass every function?
  const logical_test = (datum) => functions.every((func) => func(datum));
}

// Somehow have to keep these independent.
function dictVector(input, id) {
  const dictionary = Vector.from({
    values: input,
    type: new Dictionary(new Utf8(), new Uint32(), id),
    highWaterMark: 1000000,
  });
  return dictionary;
}

function floatVector(input) {
  return Vector.from(
    {
      values: input,
      type: new Float32(),
      highWaterMark: 1000000,
    },
  );
}

const WorkerTile = {

  fetch(url, mutations) {
    if (url.match('https://github')) {
      url += '?raw=true';
    }
    return fetch(url)
      .then((resp) => resp.arrayBuffer())
      .then((response) => {
        const table = Table.from(response);
        const { metadata } = table.schema;

        let buffer;
        // For now, always mutate to ensure dict indexes are cast.
        if (Object.keys(mutations).length || true) {
          buffer = mutate(mutations, response, metadata);
        } else {
          buffer = response;
        }

        const codes = get_dictionary_codes(buffer);

        return [transfer(buffer, [buffer]), metadata, codes];
      });
  },
  run_transforms(map, table_buffer) {
    const buffer = mutate(map, table_buffer);
    const codes = get_dictionary_codes(buffer);
    return [transfer(buffer, [buffer]), codes];
  },
};

function get_dictionary_codes(buffer) {
  // Too expensive to do on the client.
  const table = Table.from(buffer);
  const dicts = {};
  for (const field of table.schema.fields) {
    //    console.log({name: field.name, field})
    if (field.type.dictionary) {
      dicts[field.name] = new Map();
      const c = table.getColumn(field.name);
      const keys = c.dictionary.toArray();
      let ix = 0;
      for (const k of keys) {
        // safe to go both ways at once because one is a string and
        // the other an int.
        dicts[field.name].set(ix, k);
        ix++;
      }
    }
  }
  return dicts;
}

function mutate(map, table_buffer, metadata) {
  const table = Table.from(table_buffer);
  const data = new Map();
  const funcmap = new Map();

  for (const [k, v] of Object.entries(map)) {
    data.set(k, Array(table.length));
    // Materialize the mutate functions from strings.
    funcmap.set(k, Function('datum', v));
  }

  let i = 0;
  // Set the values in the rows.
  for (const row of table) {
    for (const [k, func] of funcmap) {
      data.get(k)[i] = func(row);
    }
    i++;
  }

  const columns = {};

  // First, populate the old columns
  for (const { name, typeId } of table.schema.fields) {
    if (!funcmap.has(name)) {
      // Allow overwriting, so don't copy if it's there.
      const col = table.getColumn(name);
      if (name === 'ix') { // coerce the ix field to float. Ultimately, may need to
        // pack it across a few different channels.
        columns[name] = floatVector(col);
      } else if ((name === 'x' || name === 'y') && typeId !== 3) {
        const float_version = new Float32Array(table.length);
        const [min, max] = JSON.parse(metadata.get('extent'))[name];
        const diff = max - min;
        for (let i = 0; i < table.length; i++) {
          float_version[i] = col.get(i) / (2 ** 16) * diff + min;
        }
        columns[name] = floatVector(float_version);
      } else {
        columns[name] = col;
      }
      // Translate to float versions here to avoid casting in the main thread.
      if (col.dictionary) {
        const float_version = new Float32Array(table.length);
        for (let i = 0; i < table.length; i++) {
        // At half precision, -2047 to 2047 is the
        // range through which integers are exactly right.
          float_version[i] = col.indices.get(i) - 2047;
        }
        columns[`${name}_dict_index`] = floatVector(float_version);
      }
    }
  }

  let highest_dict_id = Math.max(...table.schema.dictionaries.keys());

  // If there are no dictionaries, this returns negative infinity.
  if (highest_dict_id < 0) { highest_dict_id = -1; }

  for (const [k, vector] of data) {
    let column;
    if (typeof (vector[0]) === 'string') {
      highest_dict_id++;
      column = dictVector(vector, highest_dict_id);
    } else {
      column = floatVector(vector);
    }
    columns[k] = column;
  }
  const return_table = Table.new(columns);
  const { buffer } = return_table.serialize();
  return buffer;
}

expose(WorkerTile);