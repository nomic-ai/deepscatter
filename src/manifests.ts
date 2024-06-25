type Rectangle = {
  x: [number, number];
  y: [number, number];
};

export function parseTableFormatManifest(tb: Table): TileManifest {
  const rows: RowFormatManifest[] = [...tb].map(
    ({ key, nPoints, min_ix, max_ix, extent }) => {
      return {
        key: key as string, // string
        nPoints: Number(nPoints), // Number because this can come in as a BigInt
        min_ix: Number(min_ix), // BigInt -> Number cast
        max_ix: Number(max_ix), // BigInt -> Number cast.
        extent: extent as string, // Leave as unparsed json.
      } as const;
    },
  );
  return parseManifest(rows);
}

/**
 * We receive a manifest as a list of tiles, but deepscatter wants to receive a nested tree.
 * This function converts from one to the other, using the format of the quadtree to check
 * which of all possible children exist.
 *
 * @param raw The manifest as it comes in from the
 * @returns A tree-structured manifest suitable for passing to deeptable's "tileManifest" argument.
 */
function parseManifest(rows: RowFormatManifest[]): TileManifest {
  const lookup = Object.fromEntries(rows.map((d) => [d.key, d]));

  /**
   * Given a row, finds its children and recursively
   * @param input The row to insert.
   * @returns A tree-shaped manifest.
   */
  function buildNetwork(input: RowFormatManifest): TileManifest {
    const children: TileManifest[] = [];
    const [z, x, y] = input.key.split('/').map((i) => parseInt(i));
    for (const i of [0, 1]) {
      for (const j of [0, 1]) {
        const childKey = `${z + 1}/${x * 2 + i}/${y * 2 + j}`;
        if (lookup[childKey]) {
          const manifest = buildNetwork(lookup[childKey]);
          children.push(manifest);
        }
      }
    }
    return {
      ...input,
      extent: JSON.parse(input.extent) as Rectangle,
      children,
    };
  }
  const networked = buildNetwork(lookup['0/0/0']);

  return networked;
}

import { Table } from 'apache-arrow';
import type { TileManifest } from './shared';

type RowFormatManifest = {
  key: string;
  nPoints: number;
  min_ix: number;
  max_ix: number;
  extent: string; // JSON deserializes to a rectangle.
};
