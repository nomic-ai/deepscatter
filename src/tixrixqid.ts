import type { Bool, Data, Field, Struct, StructRowProxy, Vector } from 'apache-arrow';

import type { Tile } from './deepscatter';
import { Bitmask, DataSelection, Deeptable } from './deepscatter';

// The type below indicates that a Qid is not valid if
// there are zero rows selected in the tile.

// A Tix is a tile index, which is an integer identifier for a tile in quadtree.
// It uses the formula (4^z - 1) / 3 + y * 2^z + x, where z is the zoom level,
// and x and y are the tile coordinates.
type Tix = number;

// An Rix is a row index, which is an integer identifier for a row in a tile.
type Rix = number;

// A Rixen is a list of row indices. It must be non-empty.
type Rixen = [Rix, ...Rix[]];

// A Qid is a pair of a Tix and a Rixen. It identifies a set of rows in a tile.
export type Qid = [Tix, Rixen];
export type QidArray = Qid[];

export function zxyToTix(z: number, x: number, y: number) {
  return (4 ** z - 1) / 3 + y * 2 ** z + x;
}

function parentTix(tix: number) {
  const [z, x, y] = tixToZxy(tix);
  return zxyToTix(z - 1, Math.floor(x / 2), Math.floor(y / 2));
}

/**
 *
 * @param tix The numeric tile index
 * @param dataset The deepscatter dataset
 * @returns The tile, if it exists.
 *
 */
export async function tixToTile(tix: Tix, dataset: Deeptable): Promise<Tile> {
  if (tix === 0) {
    return dataset.root_tile;
  }
  if (isNaN(tix)) {
    throw new Error('NaN tile index');
  }
  // We need all parents to exist to find their children. So
  // we fetch the tiles here to ensure they've loaded.
  const parent = await tixToTile(parentTix(tix), dataset);
  //
  await parent.populateManifest();
  // Now that the parents are loaded, we can find the child.
  const [z, x, y] = tixToZxy(tix);
  const key = `${z}/${x}/${y}`;
  const t = dataset
    .map((tile: Tile) => tile)
    .filter((tile: Tile) => tile.key === key);
  if (t.length) {
    return t[0];
  }
  throw new Error(`Tile ${key} not found in dataset.`);
}

/**
 *
 * @param qid a quadtree id
 * @param dataset
 * @returns
 */
export async function qidToRowProxy(qid: Qid, dataset: Deeptable) {
  const tile = await tixToTile(qid[0], dataset);
  await tile.get_column('x');
  return tile.record_batch.get(qid[1][0]);
}

export function tileKey_to_tix(key: string) {
  const [z, x, y] = key.split('/').map((d) => parseInt(d));
  return zxyToTix(z, x, y);
}

export function tixToZxy(tix: Tix): [number, number, number] {
  // This is the inverse function that goes from a quadtree tile's integer identifier 'qix' to the [z, x, y] tuple.

  // The z level is the inverse of the qix function.
  // Javascript doesn't have base-4 logarithm I guess, so we divide the natural log by the natural log of 4.
  const z = Math.floor(Math.log(tix * 3 + 1) / Math.log(4));

  // We then get the index inside the tile, which is the offset from the base sequence.
  const blockPosition = tix - (4 ** z - 1) / 3;

  // Modulo operations turn this into x and y coordinates.
  const x = blockPosition % 2 ** z;
  const y = Math.floor(blockPosition / 2 ** z);
  return [z, x, y];
}

/**
 *
 * @param row the row returned from a point event, etc.
 * @param dataset a deepscatter dataset.
 * @returns
 */
export function getQidFromRow(
  row: StructRowProxy,
  dataset: Deeptable
): [number, number] {
  const tile = getTileFromRow(row, dataset);
  const rix = row[Symbol.for('rowIndex')] as number;
  return [tileKey_to_tix(tile.key), rix] as [number, number];
}

export function getTileFromRow(row: StructRowProxy, dataset: Deeptable): Tile {

  const parent = row[Symbol.for('parent')] as Data<Struct>;
  const parentsColumns = parent.children;

  // Since columns are immutable, we can just compare the memory location of the
  // value buffers to find the tile. BUT since columns can be added, we
  // need to find the tile that matches the most columns, not assume
  // that every column matches exactly.
  let best_match: [Tile | null, number] = [null, 0];
  const parentNames : [string, Data][] = parent.type.children.map(
    (d: Field, i: number) => [d.name, parentsColumns[i]]
  );

  dataset.map((t: Tile) => {
    // @ts-expect-error NOM-1667 expose existence of record batch without generating it.
    const batch_exists = t._batch !== undefined;
    if (!batch_exists) {
      return false;
    }
    let matching_columns = 0;
    for (const [name, column] of parentNames) {
      const b = t.record_batch.getChild(name);
      if (b !== null) {
        if (b.data[0].values === column.values) {
          matching_columns++;
        }
      }
    }
    if (matching_columns > best_match[1]) {
      best_match = [t, matching_columns];
    }
  });
  if (best_match[0] === undefined) {
    throw new Error(
      'No tiles found for this row.' + JSON.stringify({ ...row })
    );
  }
  return best_match[0];
}

export function getQidArrayFromRows(
  rows: StructRowProxy[],
  dataset: Deeptable,
): QidArray {
  // TODO: this is really inefficient. We should be able to do this in one pass.
  const qids = rows.map((row) => getQidFromRow(row, dataset));
  const mapped = new Map<number, [number, ...number[]]>();
  for (const qid of qids) {
    if (mapped.has(qid[0])) {
      mapped.get(qid[0]).push(qid[1]);
    } else {
      mapped.set(qid[0], [qid[1]]);
    }
  }
  return Array.from(mapped.entries());
}

export function selectQixOnTile(tile: Tile, qidList: QidArray) {
  const mask = new Bitmask(tile.record_batch.numRows);
  const [z, x, y] = tile.key.split('/').map((d) => parseInt(d));
  const tix = zxyToTix(z, x, y);
  const rixes = qidList
    .filter((d) => d[0] === tix)
    .map((d) => d[1])
    .flat();
  for (const rix of rixes) {
    mask.set(rix);
  }
  return mask.to_arrow();
}

/**
 *
 * @param hoverDatum A struct row.
 * @param selection A DataSelection
 * @param deeptable A Deepscatter dataset
 * @returns
 */
export async function isDatumInSelection(
  hoverDatum: StructRowProxy,
  selection: DataSelection | null,
  deeptable: Deeptable,
): Promise<boolean> {
  if (!selection) return false;
  const [tix, rix] = getQidFromRow(hoverDatum, deeptable);
  const owningTile = await tixToTile(tix, deeptable);
  const array = (await owningTile.get_column(selection.name)) as Vector<Bool>;
  return !!array.get(rix);
}
