import { expect, test } from 'vitest';
import { tixToChildren, tixToZxy, parentTix } from '../tixrixqid';

test('basic tix operations', () => {
  expect(tixToZxy(0)).toEqual([0, 0, 0]);
  expect(tixToZxy(1)).toEqual([1, 0, 0]);
});

test('back and forth', () => {
  // Ensure the tix inversion functions work.
  for (let i = 0; i < 100; i++) {
    const children = tixToChildren(i);
    expect(children.length).toBe(4);
    for (const child of children) {
      expect(parentTix(child)).toEqual(i);
    }
  }
});
