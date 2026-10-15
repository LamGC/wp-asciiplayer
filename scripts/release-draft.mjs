import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseTag, compareVersions } from './release-version.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function previousRelease(releases, tag) {
  const current = parseTag(tag);
  if (!current) throw new Error('Invalid release tag.');
  return releases.filter((release) => {
    const parsed = parseTag(release.tag_name);
    return !release.draft && parsed && compareVersions(parsed, current) < 0 &&
      (current.prerelease || (!release.prerelease && !parsed.prerelease));
  }).sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0];
}

export function prepareAssets(zip, zipName = 'wp-asciiplayer.zip') {
  if (!Buffer.isBuffer(zip) || zip.length < 4 || !zip.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]))) {
    throw new Error('Expected a nonempty ZIP archive.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/.test(zipName)) throw new Error('Unsafe ZIP filename.');
  const checksum = Buffer.from(`${digest(zip)}  ${zipName}\n`);
  return [
    { name: zipName, bytes: zip, type: 'application/zip', sha256: digest(zip) },
    { name: `${zipName}.sha256`, bytes: checksum, type: 'text/plain', sha256: digest(checksum) },
  ];
}

// All writes are confined to drafts for an already-existing, verified tag.
// No module-level API calls: importing this file is safe in tests and tooling.
export async function createReleaseDraft({ repository, tag, version, commit, token, zip,
  zipName = 'wp-asciiplayer.zip', fetchImpl = globalThis.fetch }) {
  const parsed = parseTag(tag);
  if (!parsed || parsed.version !== version) throw new Error('Tag and validated version disagree.');
  if (!/^[a-f0-9]{40}$/i.test(commit ?? '')) throw new Error('Expected a full commit SHA.');
  commit = commit.toLowerCase();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) throw new Error('Invalid repository.');
  if (!token) throw new Error('GH_TOKEN is required.');
  const assets = prepareAssets(zip, zipName);
  const base = `https://api.github.com/repos/${repository}`;
  async function request(url, { method = 'GET', body, binary = false, type } = {}) {
    const result = await fetchImpl(url, {
      method, redirect: 'error', headers: {
        Authorization: `Bearer ${token}`, Accept: binary ? 'application/octet-stream' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body === undefined ? {} : { 'Content-Type': type ?? 'application/json' }),
      }, ...(body === undefined ? {} : { body: type ? body : JSON.stringify(body) }),
    });
    if (!result.ok) {
      const error = new Error(`GitHub API ${method} failed (${result.status}).`);
      error.status = result.status;
      throw error;
    }
    return binary ? Buffer.from(await result.arrayBuffer()) : result.json();
  }
  async function pages(path, query = {}) {
    const result = [];
    for (let page = 1; ; page++) {
      const params = new URLSearchParams({ ...query, per_page: '100', page: String(page) });
      const batch = await request(`${base}${path}?${params}`);
      if (!Array.isArray(batch)) throw new Error('Invalid paginated GitHub response.');
      result.push(...batch);
      if (batch.length < 100) return result;
    }
  }
  async function resolveTag(tagName) {
    const ref = await request(`${base}/git/ref/tags/${encodeURIComponent(tagName)}`);
    if (ref.ref !== `refs/tags/${tagName}`) throw new Error('Tag reference does not match.');
    let object = ref.object;
    const seen = new Set();
    while (object?.type === 'tag') {
      if (!/^[a-f0-9]{40}$/i.test(object.sha) || seen.has(object.sha) || seen.size >= 20) {
        throw new Error('Invalid annotated tag chain.');
      }
      seen.add(object.sha);
      object = (await request(`${base}/git/tags/${object.sha}`)).object;
    }
    if (object?.type !== 'commit' || !/^[a-f0-9]{40}$/i.test(object.sha)) {
      throw new Error('Tag does not resolve to a valid commit.');
    }
    return object.sha.toLowerCase();
  }
  async function verifyTag() {
    if (await resolveTag(tag) !== commit) {
      throw new Error('Tag no longer resolves to the validated commit.');
    }
  }
  const marker = `<!-- wp-asciiplayer-release ${JSON.stringify({ tag, version, commit,
    assets: assets.map(({ name, sha256 }) => ({ name, sha256 })) })} -->`;
  function validateDraft(release) {
    if (!release.draft) throw new Error('Refusing to modify a published release.');
    if (release.tag_name !== tag || release.target_commitish !== commit ||
        release.prerelease !== Boolean(parsed.prerelease) || !release.body?.split('\n').includes(marker)) {
      throw new Error('Existing draft has different or missing provenance.');
    }
  }
  function matchingDraft(releases) {
    const matches = releases.filter((r) => r.tag_name === tag);
    if (matches.length > 1) throw new Error('Multiple releases exist for this tag.');
    if (matches.length) validateDraft(matches[0]);
    return matches[0];
  }
  await verifyTag();
  let releases = await pages('/releases');
  let release = matchingDraft(releases);
  if (!release) {
    let previous;
    // A released version can live on another maintenance branch, or its tag can
    // have been deleted. Only use an extant ancestor as a notes comparison base.
    const candidates = [...releases];
    while ((previous = previousRelease(candidates, tag))) {
      try {
        const previousCommit = await resolveTag(previous.tag_name);
        const comparison = await request(`${base}/compare/${previousCommit}...${commit}`);
        if (comparison.status === 'ahead' || comparison.status === 'identical') break;
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      candidates.splice(candidates.indexOf(previous), 1);
    }
    let notes;
    if (previous) {
      notes = await request(`${base}/releases/generate-notes`, { method: 'POST', body: {
        tag_name: tag, target_commitish: commit, previous_tag_name: previous.tag_name,
      } });
    } else {
      // Omitting previous_tag_name would let GitHub choose an unsuitable base.
      // First-release notes instead enumerate commits reachable from this SHA.
      const commits = await pages('/commits', { sha: commit });
      if (!commits.length || commits[0].sha !== commit) throw new Error('Invalid first-release commit history.');
      const entries = commits.map((entry) => {
        if (!/^[a-f0-9]{40}$/i.test(entry.sha) || typeof entry.commit?.message !== 'string') {
          throw new Error('Invalid first-release commit entry.');
        }
        const subject = entry.commit.message.split(/\r?\n/)[0].replace(/[<>]/g, '').trim();
        return `- ${subject} (${entry.sha.slice(0, 12)})`;
      });
      notes = { body: `## Changes\n\nNo earlier eligible published release was found. Commits reachable from ${commit}:\n\n${entries.join('\n')}` };
    }
    if (typeof notes.body !== 'string') throw new Error('Invalid generated release notes.');
    await verifyTag();
    // Recheck after notes generation in case another run created the draft.
    release = matchingDraft(await pages('/releases'));
    if (!release) {
      try {
        release = await request(`${base}/releases`, { method: 'POST', body: {
          tag_name: tag, target_commitish: commit, name: tag, body: `${notes.body}\n\n${marker}`,
          draft: true, prerelease: Boolean(parsed.prerelease), make_latest: 'false',
        } });
      } catch (error) {
        if (error.status !== 422) throw error;
        release = matchingDraft(await pages('/releases'));
        if (!release) throw error;
      }
    }
  }
  validateDraft(release);
  const releaseId = release.id;
  if (!Number.isSafeInteger(releaseId) || releaseId <= 0) throw new Error('Invalid release ID.');
  async function verifyAsset(existing, expected) {
    if (existing.state !== 'uploaded' || existing.size !== expected.bytes.length) {
      throw new Error(`Existing asset differs: ${expected.name}`);
    }
    // GitHub supplies a server-computed digest on current assets. Older assets
    // without a digest fail closed rather than trusting a user-editable label.
    if (existing.digest !== `sha256:${expected.sha256}`) {
      throw new Error(`Existing asset digest differs or is unavailable: ${expected.name}`);
    }
  }
  for (const asset of assets) {
    await verifyTag();
    validateDraft(await request(`${base}/releases/${releaseId}`));
    let listed = await pages(`/releases/${releaseId}/assets`);
    let matches = listed.filter((a) => a.name === asset.name);
    if (matches.length > 1) throw new Error(`Duplicate asset: ${asset.name}`);
    if (matches.length) { await verifyAsset(matches[0], asset); continue; }
    const upload = new URL(`https://uploads.github.com/repos/${repository}/releases/${releaseId}/assets`);
    upload.searchParams.set('name', asset.name);
    try {
      const uploaded = await request(upload.href, { method: 'POST', body: asset.bytes, type: asset.type });
      await verifyAsset(uploaded, asset);
    } catch (error) {
      if (error.status !== 422) throw error;
      listed = await pages(`/releases/${releaseId}/assets`);
      matches = listed.filter((a) => a.name === asset.name);
      if (matches.length !== 1) throw error;
      await verifyAsset(matches[0], asset);
    }
  }
  await verifyTag();
  validateDraft(await request(`${base}/releases/${releaseId}`));
  return { id: releaseId, tag, draft: true, assets: assets.map(({ name, sha256 }) => ({ name, sha256 })) };
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const options = {};
  const allowed = new Set(['tag', 'version', 'commit', 'zip']);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    if (!args[i].startsWith('--') || !allowed.has(key) || !args[i + 1] || key in options) {
      throw new Error('Usage: release-draft.mjs [--tag TAG --version VERSION --commit SHA --zip PATH]');
    }
    options[key] = args[i + 1];
  }
  const zipPath = options.zip ?? 'dist/wp-asciiplayer.zip';
  const result = await createReleaseDraft({ repository: env.GITHUB_REPOSITORY,
    tag: options.tag ?? env.RELEASE_TAG, version: options.version ?? env.RELEASE_VERSION,
    commit: options.commit ?? env.RELEASE_COMMIT, token: env.GH_TOKEN,
    zip: await readFile(zipPath), zipName: basename(zipPath) });
  console.log(`Verified draft ${result.id} for ${result.tag} with ${result.assets.length} assets.`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
