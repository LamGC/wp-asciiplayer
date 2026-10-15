import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTag, compareVersions, validateReleaseVersion } from '../../scripts/release-version.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('strict SemVer accepts complete versions, optional v, prereleases and builds', () => {
  assert.deepEqual(parseTag('v1.2.3-rc.1+build.001'), {
    version: '1.2.3-rc.1+build.001', major: '1', minor: '2', patch: '3', prerelease: 'rc.1', build: 'build.001',
  });
  for (const version of ['0.0.0', '1.2.3', '1.2.3-dev', '1.2.3-0', '1.2.3-01a', '1.2.3--', '1.2.3+001', '999999999999999999999.0.0']) {
    assert.equal(parseTag(version)?.version, version);
    assert.equal(parseTag(`v${version}`)?.version, version);
  }
});

test('strict SemVer rejects malformed and output-injection tags', () => {
  for (const version of [undefined, null, 123, '', '1', '1.2', 'V1.2.3', 'vv1.2.3', '01.2.3', '1.02.3', '1.2.03',
    '1.2.3-01', '1.2.3-a.01', '1.2.3-', '1.2.3+', '1.2.3-a..b', '1.2.3+abc..def', '1.2.3+abc+def',
    '1.2.3-a_b', '1.2.3+ä', ' 1.2.3', '1.2.3 ', '1.2.3\n', '1.2.3\r', '1.2.3\nvalid=true', 'refs/tags/v1.2.3']) {
    assert.equal(parseTag(version), null, JSON.stringify(version));
  }
});

test('SemVer precedence handles numeric identifiers, releases, and large integers', () => {
  const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0'];
  for (let i = 1; i < ordered.length; i++) {
    assert.equal(compareVersions(ordered[i - 1], ordered[i]), -1);
    assert.equal(compareVersions(parseTag(ordered[i]), parseTag(ordered[i - 1])), 1);
  }
  assert.equal(compareVersions('1.2.3+aaa', 'v1.2.3+bbb'), 0);
  assert.equal(compareVersions('1.2.3-rc.1+aaa', '1.2.3-rc.1+bbb'), 0);
  assert.equal(compareVersions('9007199254740992.0.0', '9007199254740993.0.0'), -1);
  assert.equal(compareVersions('1.0.0-9007199254740992', '1.0.0-9007199254740993'), -1);
  assert.throws(() => compareVersions('nope', '1.0.0'), /invalid/);
});

async function fixture(t, version = '1.2.3') {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'release-version-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'scripts'));
  await copyFile(path.join(root, 'scripts/release-version.mjs'), path.join(dir, 'scripts/release-version.mjs'));
  await Promise.all([
    writeFile(path.join(dir, 'package.json'), JSON.stringify({ version })),
    writeFile(path.join(dir, 'package-lock.json'), JSON.stringify({ version, packages: { '': { version } } })),
    writeFile(path.join(dir, 'block.json'), JSON.stringify({ version })),
    writeFile(path.join(dir, 'asciicast-player.php'), `<?php\n/**\n * Version: ${version}\n */\nconst VERSION = '${version}';\n`),
    writeFile(path.join(dir, 'readme.txt'), `=== Plugin ===\nStable tag: ${version}\n`),
  ]);
  return dir;
}

test('metadata validation accepts exact stable and prerelease/build metadata', async (t) => {
  for (const version of ['1.2.3', '1.2.3-rc.1+build.001']) {
    const dir = await fixture(t, version);
    assert.equal((await validateReleaseVersion(`v${version}`, dir)).version, version);
  }
});

test('metadata validation accepts CRLF text files', async (t) => {
  const dir = await fixture(t);
  for (const file of ['asciicast-player.php', 'readme.txt']) {
    const source = await readFile(path.join(dir, file), 'utf8');
    await writeFile(path.join(dir, file), source.replaceAll('\n', '\r\n'));
  }
  assert.equal((await validateReleaseVersion('1.2.3', dir)).version, '1.2.3');
});

test('every release metadata surface is required and compared exactly', async (t) => {
  const mutations = [
    ['package.json', '{"version":"1.2.4"}', 'package.json version'],
    ['package-lock.json', '{"version":"1.2.4","packages":{"":{"version":"1.2.3"}}}', 'package-lock.json version'],
    ['package-lock.json', '{"version":"1.2.3","packages":{"":{"version":"1.2.4"}}}', 'packages[""] version'],
    ['package-lock.json', '{"version":"1.2.3"}', 'missing'],
    ['block.json', '{"version":"1.2.4"}', 'block.json version'],
    ['asciicast-player.php', " * Version: 1.2.4\nconst VERSION = '1.2.3';\n", 'Version header'],
    ['asciicast-player.php', " * Version: 1.2.3\nconst VERSION = '1.2.4';\n", 'VERSION constant'],
    ['readme.txt', 'Stable tag: trunk\n', 'readme.txt Stable tag'],
    ['readme.txt', 'Stable tag: v1.2.3\n', 'readme.txt Stable tag'],
    ['readme.txt', 'Stable tag: 1.2.3\nStable tag: 1.2.3\n', 'exactly one'],
    ['asciicast-player.php', ' * Version: 1.2.3\n', 'exactly one'],
  ];
  for (const [file, content, error] of mutations) {
    const dir = await fixture(t);
    await writeFile(path.join(dir, file), content);
    await assert.rejects(validateReleaseVersion('v1.2.3', dir), (e) => e.message.includes(error));
    assert.equal(await readFile(path.join(dir, file), 'utf8'), content, 'validator must not rewrite files');
  }
});

test('current development metadata cannot accidentally become a stable release', async (t) => {
  const dir = await fixture(t, '1.1.0-dev');
  await assert.rejects(validateReleaseVersion('v1.1.0', dir), /must exactly match 1.1.0/);
  assert.equal((await validateReleaseVersion('v1.1.0-dev', dir)).prerelease, 'dev');
});

test('CLI writes trusted outputs only after successful validation', async (t) => {
  const dir = await fixture(t, '1.2.3-rc.1+001');
  const output = path.join(dir, 'output');
  const run = (tag) => spawnSync(process.execPath, ['scripts/release-version.mjs'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, RELEASE_TAG: tag, GITHUB_OUTPUT: output },
  });
  const success = run('v1.2.3-rc.1+001');
  assert.equal(success.status, 0, success.stderr);
  const expected = 'valid=true\nversion=1.2.3-rc.1+001\nprerelease=true\n';
  assert.equal(await readFile(output, 'utf8'), expected);
  for (const tag of ['v1.2.3', '', 'v1.2.3\nvalid=true']) {
    const failure = run(tag);
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, /Release validation failed:/);
    assert.equal(await readFile(output, 'utf8'), expected);
  }
});
