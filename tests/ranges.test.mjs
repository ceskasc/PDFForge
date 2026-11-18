import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePageGroups, safeBaseName, normalizeRotation, formatSize } from '../src/ranges.js';

test('semicolon separates output documents; commas combine selected pages', () => {
  assert.deepEqual(parsePageGroups('1-3, 5; 6-7', 8), [[0,1,2,4], [5,6]]);
  assert.deepEqual(parsePageGroups(' 3, 1-2, 1 ', 4), [[2,0,1]]);
});
test('ranges fail closed on malformed, empty, and impossible selectors', () => {
  for (const expression of ['', '1-0', '0', '7', '1,,2', '1-7', '1;', ';1', '1-2-3', 'abc', '-1']) {
    assert.throws(() => parsePageGroups(expression, 6), { name: 'Error' }, expression);
  }
});
test('filenames and rotations normalize safely', () => {
  assert.equal(safeBaseName('My CV 2026.pdf'), 'My-CV-2026');
  assert.equal(safeBaseName('../.pdf'), 'document');
  assert.equal(normalizeRotation(-90), 270);
  assert.equal(normalizeRotation(450), 90);
  assert.equal(formatSize(1048576), '1.0 MB');
});
