import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// SemVer 2.0.0: numeric prerelease identifiers cannot have leading zeroes.
const numeric = '(?:0|[1-9][0-9]*)';
const identifier = `(?:${numeric}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const semver = new RegExp(`^v?(${numeric})\\.(${numeric})\\.(${numeric})(?:-(${identifier}(?:\\.${identifier})*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$`);

/** Parse a bare SemVer or lowercase-v tag. Numeric fields remain lossless strings. */
export function parseTag(tag) {
  if (typeof tag !== 'string' || /[\r\n]/.test(tag)) return null;
  const match = semver.exec(tag);
  if (!match) return null;
  const [, major, minor, patch, prerelease = '', build = ''] = match;
  return { version: `${major}.${minor}.${patch}${prerelease ? `-${prerelease}` : ''}${build ? `+${build}` : ''}`, major, minor, patch, prerelease, build };
}

function compareNumeric(a, b) {
  return a.length !== b.length ? Math.sign(a.length - b.length) : a === b ? 0 : a < b ? -1 : 1;
}

/** Compare SemVer precedence (build metadata does not affect ordering). */
export function compareVersions(left, right) {
  const a = parseTag(typeof left === 'string' ? left : left?.version);
  const b = parseTag(typeof right === 'string' ? right : right?.version);
  if (!a || !b) throw new Error('Cannot compare invalid semantic versions.');
  for (const field of ['major', 'minor', 'patch']) {
    const difference = compareNumeric(a[field], b[field]);
    if (difference) return difference;
  }
  if (!a.prerelease || !b.prerelease) return a.prerelease === b.prerelease ? 0 : a.prerelease ? -1 : 1;
  const aa = a.prerelease.split('.');
  const bb = b.prerelease.split('.');
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    if (aa[i] === undefined) return -1;
    if (bb[i] === undefined) return 1;
    if (aa[i] === bb[i]) continue;
    const an = /^[0-9]+$/.test(aa[i]);
    const bn = /^[0-9]+$/.test(bb[i]);
    if (an && bn) return compareNumeric(aa[i], bb[i]);
    if (an !== bn) return an ? -1 : 1;
    return aa[i] < bb[i] ? -1 : 1;
  }
  return 0;
}

function uniqueValue(text, pattern, label) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`Expected exactly one ${label}; found ${matches.length}.`);
  return matches[0][1].trim();
}

/** Verify the tagged checkout without changing any metadata. */
export async function validateReleaseVersion(tag, root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))) {
  const parsed = parseTag(tag);
  if (!parsed) throw new Error('RELEASE_TAG must be a full SemVer tag, optionally prefixed with lowercase v.');
  const read = (file) => readFile(path.join(root, file), 'utf8');
  const [pkg, lock, block, php, readme] = await Promise.all([
    read('package.json').then(JSON.parse), read('package-lock.json').then(JSON.parse),
    read('block.json').then(JSON.parse), read('asciicast-player.php'), read('readme.txt'),
  ]);
  const versions = [
    ['package.json version', pkg.version],
    ['package-lock.json version', lock.version],
    ['package-lock.json packages[""] version', lock.packages?.['']?.version],
    ['block.json version', block.version],
    ['asciicast-player.php Version header', uniqueValue(php, /^[ \t]*\*[ \t]*Version:[ \t]*([^\r\n]*)\r?$/gm, 'PHP Version header')],
    ['asciicast-player.php VERSION constant', uniqueValue(php, /^[ \t]*const[ \t]+VERSION[ \t]*=[ \t]*['"]([^'"\r\n]*)['"][ \t]*;[ \t]*\r?$/gm, 'PHP VERSION constant')],
    ['readme.txt Stable tag', uniqueValue(readme, /^Stable tag:[ \t]*([^\r\n]*)\r?$/gm, 'readme Stable tag')],
  ];
  const mismatches = versions.filter(([, version]) => version !== parsed.version);
  if (mismatches.length) {
    throw new Error(`Release metadata must exactly match ${parsed.version}:\n${mismatches.map(([label, version]) => `- ${label}: ${JSON.stringify(version) ?? 'missing'}`).join('\n')}\nUpdate the metadata before creating the tag; this validator never rewrites it.`);
  }
  return parsed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const release = await validateReleaseVersion(process.env.RELEASE_TAG);
    // Only validated SemVer and literal booleans enter GitHub's line-oriented output.
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `valid=true\nversion=${release.version}\nprerelease=${Boolean(release.prerelease)}\n`);
    console.log(`Validated release version ${release.version}.`);
  } catch (error) {
    console.error(`Release validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
