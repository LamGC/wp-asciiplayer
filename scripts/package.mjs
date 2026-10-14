import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, utimes } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '..');
execFileSync(process.execPath, ['scripts/i18n.mjs', '--check'], { cwd: root, stdio: 'inherit' });
const required = ['build/block.json', 'build/index.js', 'build/index.asset.php', 'build/view.js', 'build/view.asset.php', 'build/player.js', 'build/player.css', 'build/runtime.asset.php', 'languages/wp-asciiplayer-zh_CN.mo', 'languages/wp-asciiplayer-zh_CN-lamgc-asciiplayer-editor.json', 'languages/wp-asciiplayer-zh_CN-lamgc-asciiplayer-view.json'];
for (const file of required) await stat(path.join(root, file));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const php = await readFile(path.join(root, 'asciicast-player.php'), 'utf8');
const readme = await readFile(path.join(root, 'readme.txt'), 'utf8');
if (!php.includes(`Version: ${pkg.version}`) || !readme.includes(`Stable tag: ${pkg.version}`)) throw new Error('Version headers disagree.');
const temp = await mkdtemp(path.join(os.tmpdir(), 'wp-asciiplayer-package-'));
const target = path.join(temp, 'wp-asciiplayer');
const inputs = ['asciicast-player.php', 'includes', 'build', 'languages', 'LICENSE', 'licenses', 'THIRD-PARTY-NOTICES.md', 'README.md', 'README-zh.md', 'readme.txt', 'SOURCE.md', 'src', 'block.json', 'package.json', 'package-lock.json', 'webpack.config.cjs', 'babel.config.json', 'scripts'];
try {
  await mkdir(target);
  for (const file of inputs) await cp(path.join(root, file), path.join(target, file), { recursive: true });
  const files = [];
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        await utimes(full, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
        files.push(path.relative(temp, full));
      } else throw new Error(`Unexpected non-regular archive entry: ${full}`);
    }
  }
  await walk(target);
  await mkdir(path.join(root, 'dist'), { recursive: true });
  const zip = path.join(root, 'dist/wp-asciiplayer.zip');
  await rm(zip, { force: true });
  execFileSync('zip', ['-X', '-q', zip, ...files], { cwd: temp, env: { ...process.env, TZ: 'UTC' } });
  console.log(`Created ${zip} (${files.length} files), version ${pkg.version}.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
