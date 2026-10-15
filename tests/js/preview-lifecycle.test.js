import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transformSync } from '@babel/core';
import * as options from '../../src/options.js';
import * as errors from '../../src/recording-errors.js';
import * as loader from '../../src/recording-loader.js';

const compiled = transformSync(fs.readFileSync(new URL('../../src/preview.js', import.meta.url), 'utf8'), {
  configFile: false, babelrc: false,
  presets: [['@babel/preset-react', { pragma: 'element' }]],
  plugins: ['@babel/plugin-transform-modules-commonjs'],
}).code;
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness(attributes = {}) {
  let effect;
  let resolveAssets;
  const assets = new Promise(resolve => { resolveAssets = resolve; });
  const updates = [];
  const sizes = [];
  const calls = [];
  const timers = new Map();
  let nextTimer = 0;
  const window = { AbortController,
    setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout(id) { timers.delete(id); }, setInterval: () => 0, clearInterval() {},
    fetch: async () => new Response('{"version":2,"width":80,"height":24}\n[0,"o","ok"]\n'),
  };
  const container = { ownerDocument: { defaultView: window }, replaceChildren() {} };
  const api = { create(source) {
    const player = { addEventListener() {}, getDuration: () => undefined,
      dispose() { this.disposed = true; } };
    calls.push({ source, player });
    return player;
  } };
  const modules = {
    '@wordpress/components': {}, '@wordpress/compose': { useRefEffect(callback) { effect = callback; } },
    '@wordpress/element': { useRef: value => ({ current: value }), useState: value => [value, update => updates.push(update)] },
    '@wordpress/i18n': { __: value => value }, './options.js': options,
    './recording-errors.js': errors, './recording-loader.js': loader,
    './player-bridge.js': { playerAssets: () => ({}), playerForDocument: () => assets },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'element', compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected module ${name}`);
    return modules[name];
  }, module, module.exports, () => null);
  module.exports.default({ source: '/original.cast', attributes, attempt: 0, onRecordingSize: (...args) => sizes.push(args) });
  const cleanup = effect(container);
  return { cleanup, updates, sizes, calls, timers, window, resolveAssets: () => resolveAssets(api) };
}

test('unmount while player assets load never creates a player or stale state', async () => {
  const h = harness();
  h.cleanup();
  const count = h.updates.length;
  h.resolveAssets();
  await flush();
  assert.equal(h.calls.length, 0);
  assert.equal(h.updates.length, count);
  assert.equal(h.timers.size, 0);
});

test('asset startup deadline cannot create a late player after showing an error', async () => {
  const h = harness();
  [...h.timers.values()][0]();
  assert.equal(h.updates.at(-1), 'error');
  h.resolveAssets();
  await flush();
  assert.equal(h.calls.length, 0);
  h.cleanup();
});

test('unmount during a request aborts it without stale metadata or status', async () => {
  const h = harness();
  let signal;
  h.window.fetch = (_source, init) => { signal = init.signal; return new Promise(() => {}); };
  h.resolveAssets();
  await flush();
  const pending = h.calls[0].source.data();
  await flush();
  h.cleanup();
  const count = h.updates.length;
  await assert.rejects(pending, { code: 'aborted' });
  assert.equal(signal.aborted, true);
  assert.equal(h.calls[0].player.disposed, true);
  assert.deepEqual(h.sizes, [['/original.cast', null]]);
  assert.equal(h.updates.length, count);
});

test('preview reports original dimensions only after validated data finishes', async () => {
  const h = harness();
  h.resolveAssets();
  await flush();
  const data = await h.calls[0].source.data();
  assert.equal(data[0].width, 80);
  assert.deepEqual(h.sizes, [['/original.cast', null], ['/original.cast', { cols: 80, rows: 24 }]]);
  h.cleanup();
});


test('preview rejects unsafe initial options before create or recording fetch', async () => {
  for (const attributes of [{ cols: 1000, rows: 1000 }, { rows: 1000 }]) {
    const h = harness(attributes);
    let requests = 0;
    h.window.fetch = () => { requests++; };
    h.resolveAssets();
    await flush();
    assert.equal(h.calls.length, 0);
    assert.equal(requests, 0);
    assert.equal(h.updates.at(-1), 'error');
    assert.match(h.updates.at(-2), /terminal cells/);
    h.cleanup();
  }
});
