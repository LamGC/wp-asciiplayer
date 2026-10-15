import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingErrorMessage } from '../../src/recording-errors.js';

// Front-end lifecycle contract with the real bounded loader and a minimal DOM.
// Actual vendor playback/iframe rendering is covered by WordPress Playwright.
globalThis.document = { readyState: 'loading', addEventListener() {} };
const { mountPlayers } = await import('../../src/view.js');
delete globalThis.document;

function setup({ preload = false, fetchImpl, options = {} } = {}) {
  const notices = [];
  const calls = [];
  let observer;
  const ownerDocument = {
    body: { classList: { contains: () => false } }, documentElement: {},
    querySelector: () => null,
    createElement: () => ({ setAttribute() {} }),
    defaultView: {
      AbortController, fetch: fetchImpl, setInterval, clearInterval,
      MutationObserver: class {
        constructor(callback) { observer = this; this.callback = callback; }
        observe() {} disconnect() { this.disconnected = true; }
      },
      AsciinemaPlayer: { create(source, container, options) {
        const listeners = {};
        const player = { dispose() { this.disposed = true; }, getDuration: () => undefined,
          addEventListener(name, callback) { listeners[name] = callback; } };
        calls.push({ source, container, options, player, listeners });
        return player;
      } },
    },
  };
  const container = { ownerDocument, isConnected: true,
    dataset: { apSrc: '/demo.cast', apOptions: JSON.stringify({ preload, ...options }) },
    querySelector: () => notices[0], appendChild: (notice) => notices.push(notice),
  };
  const root = { ownerDocument, querySelectorAll: () => [container] };
  return { root, calls, container, notices, remove() {
    container.isConnected = false;
    observer.callback([{ removedNodes: [container] }]);
    assert.equal(observer.disconnected, true);
  } };
}
const cast = '{"version":2,"width":80,"height":24}\n[0,"o","hello"]\n';

test('public preload=false stays lazy, loads parsed data once and owns one instance', async () => {
  let requests = 0;
  const fixture = setup({ fetchImpl: async (_url, options) => {
    requests++;
    assert.equal(options.credentials, 'same-origin');
    return new Response(cast);
  } });
  mountPlayers(fixture.root);
  mountPlayers(fixture.root);
  assert.equal(fixture.calls.length, 1);
  assert.equal(requests, 0);
  assert.equal(fixture.container.dataset.apStatus, 'idle');
  const data = await fixture.calls[0].source.data();
  assert.equal(requests, 1);
  assert.equal(data[0].version, 2);
  assert.equal(data[1][2], 'hello');
  fixture.calls[0].listeners.playing();
  assert.equal(fixture.container.dataset.apStatus, 'ready');
  fixture.remove();
  assert.equal(fixture.calls[0].player.disposed, true);
});

test('removing a public player aborts the in-flight fetch and keeps cancellation quiet', async () => {
  let signal;
  const fixture = setup({ fetchImpl: (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  } });
  mountPlayers(fixture.root);
  const pending = fixture.calls[0].source.data();
  await new Promise(resolve => setImmediate(resolve));
  fixture.remove();
  assert.equal(signal.aborted, true);
  await assert.rejects(pending, { code: 'aborted' });
  fixture.calls[0].listeners.error();
  assert.equal(fixture.notices.length, 0);
});

test('validation errors remain specific when the upstream player emits a generic error', async () => {
  const fixture = setup({ fetchImpl: async () => new Response('{"version":2,"width":1001,"height":24}\n') });
  mountPlayers(fixture.root);
  await assert.rejects(fixture.calls[0].source.data(), { code: 'dimensions' });
  fixture.calls[0].listeners.error();
  fixture.calls[0].listeners.playing();
  assert.equal(fixture.container.dataset.apStatus, 'error');
  assert.equal(fixture.notices.length, 1);
  assert.match(fixture.notices[0].textContent, /terminal dimensions/);
  fixture.remove();
});

test('error messages are localized fixed copy; cancellation never leaks an exception', () => {
  assert.equal(recordingErrorMessage({ code: 'aborted', message: '<secret>' }), '');
  for (const code of ['bytes', 'line', 'events', 'markers', 'dimensions', 'cells', 'complexity', 'time', 'timeout', 'network', 'stream', 'policy', 'invalid']) {
    const message = recordingErrorMessage({ code, message: '<secret>' });
    assert.ok(message.length > 10);
    assert.ok(!message.includes('<secret>'));
  }
  assert.match(recordingErrorMessage(null, { frontend: true }), /terminal recording/);
});


test('public initial terminal grid is bounded before create even with preload disabled', () => {
  for (const preload of [false, true]) {
    let requests = 0;
    const fixture = setup({ preload, options: { cols: 1000, rows: 1000 }, fetchImpl: () => { requests++; } });
    mountPlayers(fixture.root);
    assert.equal(fixture.calls.length, 0);
    assert.equal(requests, 0);
    assert.equal(fixture.container.dataset.apStatus, 'error');
    assert.match(fixture.notices[0].textContent, /terminal cells/);
  }
});
