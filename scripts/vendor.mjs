import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

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

// Content hashes avoid stale assets across successive builds of 1.1.0-dev.
const versions = [];
for (const file of ['player.js', 'player.css', 'style-index.css', 'index.css']) {
  const hash = createHash('sha256').update(await readFile(path.join(root, 'build', file))).digest('hex').slice(0, 16);
  versions.push(`'${file}' => '${hash}'`);
}
await writeFile(path.join(root, 'build/runtime.asset.php'), `<?php return array(${versions.join(', ')});\n`);
