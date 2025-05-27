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
  tableFromArrays,
  Utf8,
} from 'apache-arrow';
import { Deeptable } from './Deeptable';
import { add_or_delete_column } from './Deeptable';
import type * as DS from './types';
import { extent, extent, range } from 'd3-array';
import { Rectangle } from './tile';
import { tixToZxy } from './tixrixqid';

/**
 * This function is used to wrap an arrow table into a
 * deeptable so that record batches can be fetched asynchronously.
 * The point display order is the same as in the original file.
 * It is exposed primarily as Deeptable.fromArrowTable
 * @param tbArray a Uint8 Array that deserializes to an Arrow table. incompatibility between Arrow
 * versions makes it easier to simple force this transformation.
 * @param plot Optionally, a Scatterplot.
 * @returns
 */
export function wrapArrowTable(
  tbArray: Uint8Array,
  plot: Scatterplot | null,
): Deeptable {
  let tb = tableFromIPC(tbArray);
  let batches = tb.batches;
  const minIx = []
  const maxIx = []
  // Extents of each tile, as JSON.
  const extents : string[] = []
  if (tb.getChild('ix') === null) {
    let rowNum = 0;
    batches = batches.map((batch) => {
      if (batch.numRows > 2 ** 16) {
        throw new Error(
          'Arrow record batches limited to 2^16 rows.',
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
  for (const batch of batches) {
    minIx.push(batch.get(0)['ix'])
    maxIx.push(batch.get(batch.numRows - 1)['ix'])
    extents.push(
      JSON.stringify({
        x: extent(batch.getChild('x')),
        y: extent(batch.getChild('y'))
      })
    )
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


  const tileManifest = tableFromArrays({
    // @ts-expect-error missing types for tableFromArrays in arrow js
    key: vectorFromArray(range(batches.length).map(t => tixToZxy(t).join('/')), new Utf8()),
    min_ix: minIx,
    max_ix: maxIx,
    nPoints: batches.map(d => d.numRows),
    // @ts-expect-error missing types for tableFromArrays in arrow js
    extent: vectorFromArray(extents, new Utf8())
  })

  return new Deeptable({
    baseUrl: `feather://table`,
    plot,
    tileProxy: proxy,
    tileStructure: 'other',
    extent: dataExtent,
    // @ts-expect-error missing types for tableFromArrays in arrow js
    tileManifest
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
