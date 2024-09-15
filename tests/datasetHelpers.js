import { Table, vectorFromArray, Utf8 } from 'apache-arrow';
import { Deeptable, Bitmask } from '../dist/deepscatter.js';

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
  let randoms = new Float32Array(length);

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
    randoms[i - start] = Math.random();
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
    random: vectorFromArray(randoms),
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
  return Deeptable.fromArrowTable(table);
}

function buildDeepManifest(
  startingKey = '0/0/0',
  depth = 8,
  // The probability of each child existing.
  prob = 0.89,
  // prob * decay is the probability of each grandchild existing.
  decay = 0.89,
  pointsPerManifest = 100,
  extent = { x: [-1, 1], y: [-1, 1] },
  startingIx = 0,
) {
  const memo = {};

  const [z, x, y] = startingKey.split('/').map(parseInt);

  const children = [];
  const splits = {
    x: [extent.x[0], (extent.x[0] + extent.x[1]) / 2, extent.x[1]],
    y: [extent.y[0], (extent.y[0] + extent.y[1]) / 2, extent.y[1]],
  };

  function tilesPerLevel(z, prob, decay = undefined) {
    if (z === 0) {
      return 1;
    }
    if (z == 1) {
      return 4 * prob + 1;
    }
    const key = `${z}-${prob}-${decay}`;
    if (memo[key]) return memo[key];
    if (decay == undefined) {
      decay = prob;
    }
    memo[key] = 4 * tilesPerLevel(z - 1, prob) * prob ** z;
    return memo[key];
  }

  function tilesThroughLevel(z, prob) {
    let v = 0;
    for (let i = 0; i <= z; i += 1) {
      v += tilesPerLevel(i, prob);
    }
    return v;
  }

  // .89 produces about 18K tiles, which is a lot--could hold a trillion points under ideal circumstances

  for (let x_ of [0, 1]) {
    for (let y_ of [0, 1]) {
      if (Math.random() < prob && depth > 0) {
        const child = buildDeepManifest(
          `${z + 1}/${2 * x + x_}/${2 * y + y_}`,
          depth - 1,
          prob * decay,
          decay,
          pointsPerManifest,
          {
            x: [splits.x[x_], splits.x[x_ + 1]],
            y: [splits.y[y_], splits.y[y_ + 1]],
          },
          startingIx,
        );
        children.push(child);
      }
    }
  }
  return {
    key,
    nPoints: pointsPerManifest,
    children,
  };
}
