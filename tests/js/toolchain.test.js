import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SimpleGit = require('simple-git');
const requireFromGit = createRequire(require.resolve('simple-git'));
const { vulnerabilityCheck } = requireFromGit('@simple-git/argv-parser');

test('wp-env CommonJS simple-git API remains callable with the scoped parser update', async () => {
  assert.equal(typeof SimpleGit, 'function');
  const git = SimpleGit({ baseDir: process.cwd() });
  assert.equal(await git.checkIsRepo(), true);
  assert.equal((await git.raw(['rev-parse', '--is-inside-work-tree'])).trim(), 'true');
});

test('git argument parser rejects unsafe editor and configuration inputs without executing them', () => {
  assert.deepEqual(vulnerabilityCheck(['status'], {}), []);
  for (const [args, env, category] of [
    [['commit'], { VISUAL: 'untrusted-editor' }, 'allowUnsafeEditor'],
    [['-c', 'trailer.test.cmd=untrusted-command', 'log'], {}, 'allowUnsafeCommandBinaries'],
    [['-c', 'include.path=/untrusted/config', 'status'], {}, 'allowUnsafeInclude'],
  ]) {
    assert.ok(vulnerabilityCheck(args, env).some((finding) => finding.category === category));
  }
});

test('git argument parser accepts wp-env download command shapes', () => {
  // Validate parser inputs only; these commands are never executed by this test.
  for (const args of [
    ['clone', 'https://github.com/WordPress/wordpress-develop.git', '/tmp/wp-example', '--depth', '1', '--filter', 'blob:none', '--no-checkout'],
    ['fetch', 'origin', 'trunk', '--depth', '1'],
    ['checkout', 'trunk'],
    ['reset', '--hard', 'FETCH_HEAD'],
    ['sparse-checkout', 'set', '--cone', 'tests/phpunit'],
  ]) assert.deepEqual(vulnerabilityCheck(args, {}), []);
});
