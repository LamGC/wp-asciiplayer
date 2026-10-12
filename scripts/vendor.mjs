import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(path.join(root, 'node_modules/asciinema-player/package.json'), 'utf8'));
if (pkg.version !== '3.17.0') throw new Error(`Unexpected player version: ${pkg.version}`);
await mkdir(path.join(root, 'build'), { recursive: true });
for (const [source, destination] of [
  ['dist/bundle/asciinema-player.min.js', 'player.js'],
  ['dist/bundle/asciinema-player.css', 'player.css'],
]) {
  await copyFile(path.join(root, 'node_modules/asciinema-player', source), path.join(root, 'build', destination));
}
await copyFile(path.join(root, 'block.json'), path.join(root, 'build/block.json'));
console.log(`Bundled local asciinema-player ${pkg.version}; no CDN is used.`);
