import {
  Deeptable,
  DataSelection,
  SortedDataSelection,
  Bitmask,
} from '../dist/deepscatter.js';
import { Table, vectorFromArray, Utf8 } from 'apache-arrow';
import { test } from 'uvu';
import * as assert from 'uvu/assert';
import {
  createIntegerDataset,
  selectFunctionForFactorsOf,
} from './datasetHelpers.js';

test('Dataset can be created', async () => {
  const dataset = createIntegerDataset();
  const x = await dataset.root_tile.get_column('x');
  assert.is(x.length, 4096);
  const integers = await dataset.root_tile.get_column('integers');
  assert.is(integers.toArray()[10], 10);
});

test('Columns can be deleted and replaced', async () => {
  const dataset = createIntegerDataset();
  const x = await dataset.root_tile.get_column('x');
  assert.is(x.length, 4096);
  const integers = await dataset.root_tile.get_column('integers');
  assert.is(integers.toArray()[10], 10);

  dataset.transformations['integers'] = async function (tile) {
    await tile.populateManifest();
    return new Float32Array(tile.manifest.nPoints);
  };

  dataset.deleteColumn('integers');

  const newX = await dataset.root_tile.get_column('integers');
  assert.is(newX.toArray()[10], 0);
});

test('Test composition of selections', async () => {
  const dataset = createIntegerDataset();
  await dataset.root_tile.preprocessRootTileInfo();
  const selectEvens = new DataSelection(dataset, {
    name: 'twos',
    tileFunction: selectFunctionForFactorsOf(2),
  });

  await selectEvens.ready;
  await selectEvens.applyToAllTiles();

  const selectThree = new DataSelection(dataset, {
    name: 'threes',
    tileFunction: selectFunctionForFactorsOf(3),
  });

  const selectSix = new DataSelection(dataset, {
    name: 'six',
    composition: ['ALL', selectThree, selectEvens],
  });

  await selectSix.ready;
  await selectSix.applyToAllTiles();

  assert.ok(
    Math.abs(
      Math.log(selectSix.selectionSize / (selectEvens.selectionSize / 3)),
    ) < 0.01,
    'sixes are the same size as evens over three',
  );

  const selectTwoThree = new DataSelection(dataset, {
    name: 'sixTwo',
    composition: ['ANY', selectThree, selectEvens],
  });
  await selectTwoThree.ready;
  await selectTwoThree.applyToAllLoadedTiles();

  assert.ok(
    Math.abs(
      Math.log(selectTwoThree.selectionSize / (selectSix.selectionSize * 4)),
    ) < 0.01,
    'sixes are 4x as big as twos over threes',
  );

  // test null selections work.
  const emptySelection = new DataSelection(dataset, {
    name: 'empty',
    tileFunction: async (t) => new Bitmask(t.record_batch.numRows).to_arrow(),
  });

  const selectNothing = new DataSelection(dataset, {
    name: 'nothing and something is nothing',
    composition: ['AND', selectThree, emptySelection],
  });

  await selectNothing.applyToAllLoadedTiles();
  const v = selectNothing.get();
  console.log(v);
});

test('Test sorting of selections', async () => {
  const dataset = createIntegerDataset();
  await dataset.root_tile.preprocessRootTileInfo();
  const selectEvens = new DataSelection(dataset, {
    name: 'twos2',
    tileFunction: selectFunctionForFactorsOf(2),
  });
  await selectEvens.applyToAllTiles();
  const sorted = await SortedDataSelection.fromSelection(
    selectEvens,
    ['random'],
    ({ random }) => random,
  );
  await sorted.applyToAllTiles();
  // This should be 8192.
  const bottom = sorted.get(0);
  assert.ok(bottom.random < 0.01);

  const foo = sorted.get(sorted.selectionSize - 1);
  assert.ok(foo.random > 0.99);

  const mid = sorted.get(Math.floor(sorted.selectionSize / 2));
  assert.ok(mid.random > 0.45);
  assert.ok(mid.random < 0.55);
});

test.run();
