import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
const hash = (data) => createHash('sha256').update(data).digest('hex');
const asset = await readFile('build/index.asset.php', 'utf8');
if (asset.includes('react-jsx-runtime')) throw new Error('Automatic JSX runtime would break the WordPress 6.3 baseline.');
for (const dependency of ['wp-blocks', 'wp-block-editor', 'wp-element', 'wp-compose']) {
  if (!asset.includes(`'${dependency}'`)) throw new Error(`Missing editor dependency: ${dependency}`);
}
for (const [destination, original] of [
  ['build/player.js', 'node_modules/asciinema-player/dist/bundle/asciinema-player.min.js'],
  ['build/player.css', 'node_modules/asciinema-player/dist/bundle/asciinema-player.css'],
]) {
  if (hash(await readFile(destination)) !== hash(await readFile(original))) throw new Error(`Vendor file mismatch: ${destination}`);
}
const metadata = JSON.parse(await readFile('build/block.json', 'utf8'));
if (metadata.apiVersion !== 3 || metadata.name !== 'lamgc/asciiplayer') throw new Error('Unexpected block metadata.');
// Execute the emitted bundle too: source-only tests miss minifier scope errors.
// In particular, never shadow the global document used by mountPlayers' default.
const view = await readFile('build/view.js', 'utf8');
for (const readyState of ['loading', 'complete']) {
  let mounts = 0;
  let onReady;
  const container = {
    dataset: { apSrc: '/recording.cast', apOptions: '{"preload":false}' },
  };
  const document = {
    readyState,
    body: { classList: { contains: () => false } },
    querySelector: () => null,
    querySelectorAll: () => [container],
    addEventListener(event, callback) {
      assert.equal(event, 'DOMContentLoaded');
      onReady = callback;
    },
    defaultView: { AbortController, fetch() { throw new Error('Lazy playback must not fetch during boot.'); }, MutationObserver: class { observe() {} disconnect() {} }, AsciinemaPlayer: { create(source, target) {
      assert.equal(typeof source.data, 'function');
      assert.equal(target, container);
      mounts++;
      return { addEventListener() {} };
    } } },
  };
  container.ownerDocument = document;
  container.isConnected = true;
  runInNewContext(view, { document, window: { wp: { i18n: { __: (text) => text } } }, URL });
  if (readyState === 'loading') {
    assert.equal(mounts, 0);
    onReady();
    onReady(); // A repeated boot must not mount the same container twice.
  }
  assert.equal(mounts, 1, `Frontend boot failed at readyState=${readyState}`);
  assert.equal(container.dataset.apStatus, 'idle');
}
console.log('Verified WordPress 6.3 dependencies, block metadata, exact vendor files, and emitted frontend boot.');

// Physical placement and terminal direction must not be mirrored by RTLCSS.
for (const suffix of ['', '-rtl']) {
  const css = await readFile(`build/style-index${suffix}.css`, 'utf8');
  assert.match(css, /asciiplayer-align-left\{[^}]*margin-left:0!important[^}]*margin-right:auto!important/);
  assert.match(css, /asciiplayer-align-right\{[^}]*margin-left:auto!important[^}]*margin-right:0!important/);
  assert.match(css, /asciiplayer-container \.ap-wrapper\{text-align:left/);
}
