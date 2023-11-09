import Scatterplot from "./deepscatter";
import { tableFromIPC, RecordBatch, Table, tableToIPC } from "apache-arrow";
import { Dataset } from "./Dataset";
import { add_or_delete_column } from "./Dataset";
import type * as DS from './shared';


export function wrapArrowTable(tbArray: Uint8Array, plot: Scatterplot) : Dataset {
  const tb = tableFromIPC(tbArray);
  let batches = tb.batches;
  if (tb.getChild('ix') === null) {
    let rowNum = 0;
    batches = batches.map(batch => {
      const array = new Float32Array(batch.numRows);
      for (let i = 0; i < batch.numRows; i++) {
        array[i] = rowNum++;
      }
      return add_or_delete_column(batch, 'ix', array)
    })
  }

  const proxy = new ArrowProxy(batches);

  return new Dataset(`arrow://`, plot, {
    tileProxy: proxy
  })

}
class ArrowProxy implements DS.TileProxy {
  batches : RecordBatch[];

  constructor(batches: RecordBatch[]) {
    this.batches = batches;
  }

  apiCall(endpoint : string, method = "GET", d1 = undefined, d2 = undefined, options = {}) : Promise<Uint8Array> {
    const url = new URL(endpoint)
    const {protocol, pathname} = url;
    if (protocol !== 'feather:') {
      throw new Error("protocol must be spoofed as 'feather://' for loading arrow files.")
    }
    const [z, x] = pathname.replace(".feather", "").replace("//","").split("/").map(d => parseInt(d))
    const rowNum = treeToPosition(z, x);
    const tb = new Table([this.batches[rowNum]])
    const children = [];
    for (const [z_, x_] of [[z + 1, x * 2], [z + 1, x * 2 + 1]]) {
      if (treeToPosition(z_, x_) <= this.batches.length) {
        children.push([z_, x_])
      }
    }
    tb.schema.metadata.set('children', JSON.stringify(children));
    return Promise.resolve(tableToIPC(tb));
  }
}

// For a 2d tree, calculate the associated number.
function treeToPosition(z, x) {
  let rowNum = 0;
  for (let z_ = 0; z < z; z_++) {
    rowNum += Math.pow(2, z)
  }
  rowNum += x;
  return rowNum
}