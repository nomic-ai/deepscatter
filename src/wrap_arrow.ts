import { Scatterplot } from './deepscatter';
import {
  tableFromIPC,
  RecordBatch,
  Table,
  tableToIPC,
  Type,
  vectorFromArray,
  Vector,
  Float,
} from 'apache-arrow';
import { Dataset } from './Dataset';
import { add_or_delete_column } from './Dataset';
import type * as DS from './shared';
import { extent } from 'd3-array';
import { Rectangle } from './tile';

// This function is used to wrap an arrow table into a deepscatter
// dataset so that record batches can be fetched asynchronously.
// The point display order is the same as in the original file.
// It is exposed primarily as Dataset.from
export function wrapArrowTable(
  tbArray: Uint8Array,
  plot: Scatterplot | null,
): Dataset {
  let tb = tableFromIPC(tbArray);
  let batches = tb.batches;
  if (tb.getChild('ix') === null) {
    let rowNum = 0;
    batches = batches.map((batch) => {
      if (batch.numRows > 2 ** 16) {
        throw new Error(
          'Arrow record batches temporarily limited to 2^16 rows.',
        );
      }
      const array = new Int32Array(batch.numRows);
      for (let i = 0; i < batch.numRows; i++) {
        array[i] = rowNum++;
      }
      return add_or_delete_column(batch, 'ix', vectorFromArray(array));
    });
    tb = new Table(batches);
  }

  const proxy = new ArrowProxy(batches);

  const x = tb.getChild('x') as Vector<Float>;
  const y = tb.getChild('y') as Vector<Float>;

  for (const d of [x, y]) {
    if (d === null || !d.type || d.type.typeId !== Type.Float) {
      throw new Error(
        'x and y float columns must be present in the arrow table',
      );
    }
  }
  const dataExtent = {
    x: extent([...(x as Iterable<number>)]),
    y: extent([...(y as Iterable<number>)]),
  } as Rectangle;

  return new Dataset({
    baseUrl: `feather://table`,
    plot,
    tileProxy: proxy,
    tileStructure: 'other',
    extent: dataExtent,
  });
}

class ArrowProxy implements DS.TileProxy {
  batches: RecordBatch[];

  constructor(batches: RecordBatch[]) {
    this.batches = batches;
  }

  apiCall(endpoint: string): Promise<Uint8Array> {
    const scopedEndpoint = `feather:${endpoint}`;
    const url = new URL(scopedEndpoint);
    const { protocol, pathname } = url;
    if (protocol !== 'feather:') {
      throw new Error(
        "protocol must be spoofed as 'feather://' for loading arrow files.",
      );
    }
    const [z, x] = pathname
      .replace('.feather', '')
      .replace('//', '')
      .split('/')
      .map((d) => parseInt(d))
      .filter((d) => !isNaN(d));

    const rowNum = treeToPosition(z, x);
    const tb = new Table([this.batches[rowNum]]);
    const children = [];
    for (const [z_, x_] of [
      [z + 1, x * 2],
      [z + 1, x * 2 + 1],
    ]) {
      if (treeToPosition(z_, x_) < this.batches.length) {
        children.push(`${z_}/${x_}`);
      }
    }
    tb.schema.metadata.set('children', JSON.stringify(children));
    return Promise.resolve(tableToIPC(tb));
  }
}

// For a 2d tree, calculate the associated number.
function treeToPosition(z: number, x: number) {
  let rowNum = 0;
  for (let z_ = 0; z_ < z; z_++) {
    rowNum += Math.pow(2, z_);
  }
  rowNum += x;
  return rowNum;
}
