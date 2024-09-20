import { dictionaryFromArrays } from 'deepscatter';

import { test } from 'uvu';
import * as assert from 'uvu/assert';

test('Dictionary from arrays uncurried', async () => {
  const vec = dictionaryFromArrays(
    ['a', 'b', 'c'],
    new Int16Array([0, 0, 0, 1]),
  );
  assert.is(vec.length, 4);
  assert.is(vec.get(0), 'a');
  assert.is(vec.get(3), 'b');
});

test('Dictionary from arrays curried', async () => {
  const dictionator = dictionaryFromArrays(['a', 'b', 'c']);
  const vec = dictionator(new Int16Array([0, 0, 0, 1]));

  const unCurriedVec = dictionaryFromArrays(
    ['a', 'b', 'c'],
    new Int16Array([0, 0, 0, 1]),
  );
  for (let i = 0; i < 4; i++) {
    assert.is(vec.get(i), unCurriedVec.get(i));
  }
});

test.run();
