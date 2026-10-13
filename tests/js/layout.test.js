import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDisplayAlign, normalizePlayerOptions, terminalDimension, normalizeWidth } from '../../src/options.js';
test('display placement and scaling never create terminal grid overrides', () => {
  for (const width of ['25%', '480px', '100%']) {
    const options = normalizePlayerOptions({ width, displayAlign: 'right', caption: 'Demo' });
    assert.equal(options.cols, undefined);
    assert.equal(options.rows, undefined);
    assert.equal(options.width, undefined);
    assert.equal(options.caption, undefined);
  }
  assert.equal(normalizeDisplayAlign('right'), 'right');
  assert.equal(normalizeDisplayAlign('unsafe'), 'center');
  assert.equal(normalizeWidth('480px'), '480px');
  assert.equal(normalizeWidth('480px;display:none'), '100%');
});
test('terminal overrides are optional bounded integers', () => {
  for (const value of ['', '0', '-1', '2.5', '1001', 'Infinity', null]) assert.equal(terminalDimension(value), undefined);
  assert.equal(terminalDimension('120'), 120);
  assert.equal(terminalDimension(1), 1);
  const options = normalizePlayerOptions({ cols: terminalDimension('120'), rows: terminalDimension('') });
  assert.equal(options.cols, 120);
  assert.equal(options.rows, undefined);
});
