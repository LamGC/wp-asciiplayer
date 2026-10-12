import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
console.log('Verified WordPress 6.3-compatible JSX dependencies, block metadata, and exact local vendor files.');
