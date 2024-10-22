import {
  DataSelection,
  SortedDataSelection,
  Bitmask,
} from '../dist/deepscatter.js';
import { test } from 'uvu';
import * as assert from 'uvu/assert';
import {
  createIntegerDataset,
  selectFunctionForFactorsOf,
  selectRandomRows,
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
  assert.is(selectNothing.selectionSize, 0);
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

test('Test iterated sorting of selections', async () => {
  const dataset = createIntegerDataset();
  await dataset.root_tile.preprocessRootTileInfo();
  const selectEvens = new DataSelection(dataset, {
    name: 'twos2',
    tileFunction: selectFunctionForFactorsOf(2),
  });
  const sortKey = 'random';
  await selectEvens.applyToAllTiles();
  const sorted = await SortedDataSelection.fromSelection(
    selectEvens,
    [sortKey],
    ({ random }) => random,
  );
  await sorted.applyToAllTiles();

  let size = 0;
  // Go nomral direction
  let prevValue = Number.NEGATIVE_INFINITY;
  for (const row of sorted.iterator()) {
    size++;
    // This test needs to handle that it's a structRowProxy now not a value.
    const currValue = row[sortKey];
    assert.ok(currValue >= prevValue);
    prevValue = currValue;
  }

  assert.ok(size, sorted.selectionSize);
  // Since flipped direction, your start is how many elements you will iterate

  const first = sorted.iterator(0);
  const second = sorted.iterator(10);

  let sizeFirst = 20;
  const elementsFirst = [];
  for (const row of sorted.iterator()) {
    sizeFirst--;
    if (sizeFirst === 0) {
      break;
    }
    elementsFirst.push(row[sortKey]);
  }

  // Something to test that the second iterator doesn't end up with state elements
  // from the first and that it starts from the 10th item in the first.

  // Since flipped direction, your start is how many elements you will iterate
});

test('Edge cases for iterated sorting of selections', async () => {
  const dataset = createIntegerDataset();
  await dataset.root_tile.preprocessRootTileInfo();
  const selectEvens = new DataSelection(dataset, {
    name: 'twos2',
    tileFunction: selectFunctionForFactorsOf(2),
  });
  let sortKey = 'random';
  await selectEvens.applyToAllTiles();

  // Go reverse direction
  const reverseSorted = await SortedDataSelection.fromSelection(
    selectEvens,
    [sortKey],
    ({ random }) => random,
    'descending',
  );

  await reverseSorted.applyToAllTiles();

  let size = 0;
  let prevValue = Number.POSITIVE_INFINITY;
  for (const row of reverseSorted.iterator()) {
    size++;
    const currValue = row[sortKey];
    assert.ok(currValue <= prevValue);
    prevValue = currValue;
  }
  assert.ok(size, reverseSorted.selectionSize);

  // TODO: sandwich 01111112 edge case
  const selectRandom = new DataSelection(dataset, {
    name: 'randomSelect',
    tileFunction: selectRandomRows(),
  });
  sortKey = 'sandwich';
  await selectRandom.applyToAllTiles();

  const randomSorted = await SortedDataSelection.fromSelection(
    selectRandom,
    [sortKey, 'random'],
    ({ sandwich }) => sandwich,
  );
  await randomSorted.applyToAllTiles();

  const randomVals = [];
  const sandwichVals = [];
  let count = 0;
  for (const row of randomSorted.iterator()) {
    count++;
    randomVals.push(row['random']);
    sandwichVals.push(row['sandwich']);
  }
  assert.equal(sandwichVals[0], 0);
  assert.equal(sandwichVals[sandwichVals.length - 1], 2);

  let index = 0;
  for (const row of randomSorted.iterator(10)) {
    assert.ok(
      Math.abs(row['random'] - randomVals[index + 10]) < Number.EPSILON,
    );
    index++;
  }

  for (const row of randomSorted.iterator(0, true)) {
    assert.ok(Math.abs(row['random'] - randomVals.pop()) < Number.EPSILON);
  }
});

test.run();
