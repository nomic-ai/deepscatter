const window = {};

import { transfer, expose } from 'comlink';
import {
  Table, Vector, Utf8, Float32,
  Uint32, Int32, Int64, Dictionary,
  tableFromIPC,
  tableToIPC,
  vectorFromArray,
  tableFromArrays,
  makeBuilder,
  makeVector
} from 'apache-arrow';

// Somehow have to keep these independent.
function dictVector(input, id) {
  const dictionary = makeBuilder({
    type: new Dictionary(new Uint32(), new Utf8()),
    highWaterMark: 1000000,
  });
  input.forEach(d => dictionary.append(d));
  return dictionary.finish().toVector()
}


const WorkerTile = {

  fetch(url, mutations, requestOptions) {
    if (url.match('https://github')) {
      url += '?raw=true';
    }
    return fetch(url, requestOptions)
      .then((resp) => resp.arrayBuffer())
      .then((response) => {
        const table = tableFromIPC(response);
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
    console.log("transforming")
    const buffer = mutate(map, table_buffer);
    const codes = get_dictionary_codes(buffer);
    return [transfer(buffer, [buffer]), codes];
  },
};

function get_dictionary_codes(buffer) {
  // Too expensive to do on the client.
  const table = tableFromIPC(buffer);
  const dicts = {};
  for (const field of table.schema.fields) {
    if (field.type.dictionary) {
      dicts[field.name] = new Map();
      const c = table.getChild(field.name);
      const keys = c.data[0].dictionary.toArray();
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
  const table = tableFromIPC(table_buffer);
  const data = new Map();
  const funcmap = new Map();

  for (const [k, v] of Object.entries(map)) {
    data.set(k, Array(table.length));
    // Materialize the mutate functions from strings.
    funcmap.set(k, Function('datum', v));
  }
  let i = 0;
  // Set the values in the rows.
  for (let j = 0; j < table.numRows; j++) {
    const row = table.get(j);
    for (const [k, func] of funcmap) {
      data.get(k)[i] = func(row);
    }
    i++;
  }

  const columns = {};

  // First, populate the old columns
  for (const { name, type } of table.schema.fields) {
    if (type === undefined) {
      throw "NO SUCH TYPE"
    }
    const { typeId } = type;
    if (!funcmap.has(name)) {
      // Allow overwriting, so don't copy if it's there.
      const col = table.getChild(name);
      if (name === 'ix') { 
        // Coerce the ix field to float.
        // Ultimately, may need to
        // pack it across a few different channels.
        columns[name] = vectorFromArray([...col].map(d => Number(d)), new Float32());
      } else {
        columns[name] = col;
      }
      // Translate to float versions here to avoid casting in the main thread.
      if (type.dictionary) {
        const float_version = new Float32Array(table.data[0].length);
        for (let i = 0; i < table.data[0].length; i++) {
        // At half precision, -2047 to 2047 is the
        // range through which integers are exactly right.
          float_version[i] = col.data[0].values[i] - 2047;
        }
        columns[`${name}_float_version`] = makeVector(float_version);
      }
      if (type.typeId === 8) {
        // date
        columns[`${name}_float_version`] = vectorFromArray([...col.data[0].values].map(d => Number(d)), new Float32());
      }
    }
  }

  let highest_dict_id = Math.max(...table.schema.dictionaries.keys());

  // If there are no dictionaries, this returns negative infinity.
  if (highest_dict_id < 0) { highest_dict_id = -1; }

  for (const [k, vector] of data) {
    console.log({k})
    let column;
    if (typeof (vector[0]) === 'string') {
      highest_dict_id++;
      column = dictVector(vector);
    } else {
      column = floatVector(vector);
    }
    columns[k] = column;
  }
  const return_table = tableFromArrays(columns);
  const { buffer } = tableToIPC(return_table)
  return buffer;
}

expose(WorkerTile);