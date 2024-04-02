import { Table, vectorFromArray, Utf8 } from 'apache-arrow';
import { Dataset, Bitmask } from '../dist/deepscatter.js';

// Creates a tile transformation for factors of n.
export function selectFunctionForFactorsOf(n) {
  return async (tile) => {
    const ints = await tile.get_column('integers');
    const mask = new Bitmask(tile.record_batch.numRows);
    for (let i = 0; i < tile.record_batch.numRows; i++) {
      if (ints.toArray()[i] % n === 0) {
        mask.set(i);
      }
    }
    return mask.to_arrow();
  };
}

function make_batch(start = 0, length = 65536, batch_number_here = 0) {
  let x = new Float32Array(length);
  let y = new Float32Array(length);
  let integers = new Int32Array(length);
  let ix = new Uint32Array(length);
  let batch_id = new Float32Array(length).fill(batch_number_here);
  for (let i = start; i < start + length; i++) {
    ix[i - start] = i;
    let x_ = 0;
    let y_ = 0;
    const binary = i.toString(2).split('').reverse();
    for (let j = 0; j < binary.length; j++) {
      const bit = binary[j];
      if (bit == 1) {
        if (j % 2 == 0) {
          x_ += 2 ** (j / 2);
        } else {
          y_ += 2 ** ((j - 1) / 2);
        }
      }
    }
    x[i - start] = x_;
    y[i - start] = y_;
    integers[i - start] = i;
  }

  function num_to_string(num) {
    return num.toString();
  }
  const vs = [...ix].map(num_to_string);
  return new Table({
    x: vectorFromArray(x),
    y: vectorFromArray(y),
    _id: vectorFromArray(vs, new Utf8()),
    integers: vectorFromArray(integers),
    batch_id: vectorFromArray(batch_id),
  });
}

function createTable(n_batches) {
  const batches = [];
  const SIZE = 65536 / 4 / 4;
  for (let i = 0; i < n_batches; i++) {
    const batch = make_batch(i * SIZE, SIZE, i);
    batches.push(batch);
  }
  const table = new Table([batches]);
  return table;
}

export function createIntegerDataset() {
  const num_batches = 4;
  const table = createTable(num_batches);
  return Dataset.from_arrow_table(table);
}
