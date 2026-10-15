import test from 'node:test';
import assert from 'node:assert/strict';
import { createReleaseDraft, prepareAssets, previousRelease, main } from '../../scripts/release-draft.mjs';

const commit = 'a'.repeat(40);
const zip = Buffer.from('504b0304000102030405', 'hex');
const options = { repository: 'owner/repo', tag: 'v1.2.0', version: '1.2.0', commit, token: 'test-only', zip };
const release = (tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, ...extra });

function fixture({ releases = [], annotated = false, moveAt = Infinity, uploadConflict = false, comparisons = {} } = {}) {
  const calls = [];
  const assets = [];
  let refs = 0;
  let created;
  let failedUpload = false;
  const predecessorShas = new Map();
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    const body = init.headers['Content-Type'] === 'application/json' ? JSON.parse(init.body) : init.body;
    calls.push({ url, ...init, body });
    const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
    if (url.pathname.endsWith('/git/ref/tags/v1.2.0')) {
      refs++;
      return response({ ref: 'refs/tags/v1.2.0', object: { type: annotated ? 'tag' : 'commit',
        sha: refs >= moveAt ? 'b'.repeat(40) : commit } });
    }
    if (url.pathname.includes('/git/ref/tags/')) {
      const tag = decodeURIComponent(url.pathname.split('/git/ref/tags/')[1]);
      if (comparisons[tag] === 'missing') return response({}, 404);
      const sha = String(predecessorShas.size + 1).padStart(40, '0');
      predecessorShas.set(sha, tag);
      return response({ ref: `refs/tags/${tag}`, object: { type: 'commit', sha } });
    }
    if (url.pathname.includes('/git/tags/')) return response({ object: { type: 'commit', sha: commit } });
    if (url.pathname.endsWith('/commits')) return response([{ sha: commit, commit: { message: 'Initial implementation' } }]);
    if (url.pathname.includes('/compare/')) {
      const sha = url.pathname.split('/compare/')[1].split('...')[0];
      assert.match(sha, /^[a-f0-9]{40}$/);
      const tag = predecessorShas.get(sha);
      assert.ok(tag, 'comparison must use an explicitly resolved predecessor tag SHA');
      const status = comparisons[tag] ?? 'ahead';
      return status === 'missing' ? response({}, 404) : response({ status });
    }
    if (url.pathname.endsWith('/releases/generate-notes')) return response({ body: 'Generated notes' });
    if (url.pathname.endsWith('/releases') && init.method === 'GET') return response(releases);
    if (url.pathname.endsWith('/releases') && init.method === 'POST') {
      created = { id: 123, ...body };
      releases.push(created);
      return response(created, 201);
    }
    if (url.pathname.endsWith('/releases/123')) return response(created ?? releases.find((r) => r.id === 123));
    if (url.pathname.endsWith('/releases/123/assets') && init.method === 'GET') return response(assets);
    if (url.hostname === 'uploads.github.com') {
      const name = url.searchParams.get('name');
      const expected = prepareAssets(zip).find((a) => a.name === name);
      const uploaded = { name, state: 'uploaded', size: body.length, digest: `sha256:${expected.sha256}` };
      assets.push(uploaded);
      if (uploadConflict && !failedUpload) { failedUpload = true; return response({}, 422); }
      return response(uploaded, 201);
    }
    throw new Error(`Unexpected mock request: ${init.method} ${input}`);
  };
  return { fetchImpl, calls, assets, releases, get created() { return created; } };
}

test('stable notes select highest lower published stable SemVer, never drafts or prereleases', () => {
  const releases = [release('v1.1.0'), release('v1.1.9-rc.1', { prerelease: true }), release('v1.2.0'),
    release('v1.1.5', { draft: true }), release('v1.1.3'), release('bad'), release('v2.0.0')];
  assert.equal(previousRelease(releases, 'v1.2.0').tag_name, 'v1.1.3');
});

test('prerelease notes can use lower published prereleases with numeric SemVer ordering', () => {
  const releases = ['v1.2.0-rc.2', 'v1.2.0-rc.10', 'v1.1.0', 'v1.2.0'].map((tag) => release(tag));
  assert.equal(previousRelease(releases, 'v1.2.0-rc.11').tag_name, 'v1.2.0-rc.10');
  assert.equal(previousRelease([], 'v1.0.0'), undefined);
});

test('creates draft only with generated notes, provenance, ZIP and checksum', async () => {
  const f = fixture({ releases: [release('v1.1.0')] });
  const result = await createReleaseDraft({ ...options, fetchImpl: f.fetchImpl });
  assert.equal(result.draft, true);
  assert.equal(f.created.draft, true);
  assert.equal(f.created.prerelease, false);
  assert.equal(f.created.make_latest, 'false');
  assert.equal(f.created.target_commitish, commit);
  assert.match(f.created.body, /Generated notes\n\n<!-- wp-asciiplayer-release/);
  const notes = f.calls.find((c) => c.url.pathname.endsWith('generate-notes'));
  assert.equal(notes.body.previous_tag_name, 'v1.1.0');
  assert.deepEqual(f.assets.map((a) => a.name), ['wp-asciiplayer.zip', 'wp-asciiplayer.zip.sha256']);
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 4);
  assert.ok(f.calls.every((c) => c.headers.Authorization === 'Bearer test-only'));
  assert.ok(f.calls.every((c) => c.redirect === 'error'));
  assert.ok(!f.calls.some((c) => /\/git\/(refs|tags)$/.test(c.url.pathname) && c.method === 'POST'));
});

test('rerun verifies provenance and bytes without changing draft or duplicating assets', async () => {
  const f = fixture();
  await createReleaseDraft({ ...options, fetchImpl: f.fetchImpl });
  const writes = f.calls.filter((c) => c.method === 'POST').length;
  await createReleaseDraft({ ...options, fetchImpl: f.fetchImpl });
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, writes);
  assert.equal(f.releases.length, 1);
  assert.equal(f.assets.length, 2);
});

test('rerun recovers missing asset after interrupted upload', async () => {
  const f = fixture();
  await createReleaseDraft({ ...options, fetchImpl: f.fetchImpl });
  f.assets.pop();
  await createReleaseDraft({ ...options, fetchImpl: f.fetchImpl });
  assert.equal(f.assets.length, 2);
  assert.equal(f.releases.length, 1);
});

test('never modifies a published release', async () => {
  const f = fixture({ releases: [release('v1.2.0')] });
  await assert.rejects(createReleaseDraft({ ...options, fetchImpl: f.fetchImpl }), /published release/);
  assert.ok(f.calls.every((c) => c.method === 'GET'));
});

test('refuses unrelated existing draft or duplicate releases', async () => {
  for (const releases of [[release('v1.2.0', { draft: true })], [release('v1.2.0'), release('v1.2.0')]]) {
    const f = fixture({ releases });
    await assert.rejects(createReleaseDraft({ ...options, fetchImpl: f.fetchImpl }), /provenance|Multiple releases/);
    assert.ok(f.calls.every((c) => c.method === 'GET'));
  }
});

test('fails closed on missing, wrong or changed asset digest without replacing anything', async () => {
  for (const digest of [undefined, `sha256:${'0'.repeat(64)}`]) {
    const f = fixture();
    await createReleaseDraft({ ...options, fetchImpl: f.fetchImpl });
    f.assets[0].digest = digest;
    const count = f.calls.length;
    await assert.rejects(createReleaseDraft({ ...options, fetchImpl: f.fetchImpl }), /digest/);
    assert.ok(f.calls.slice(count).every((c) => c.method === 'GET'));
  }
});

test('refuses changed local bytes before uploading or editing draft', async () => {
  const f = fixture();
  await createReleaseDraft({ ...options, fetchImpl: f.fetchImpl });
  await assert.rejects(createReleaseDraft({ ...options, zip: Buffer.concat([zip, Buffer.from('changed')]),
    fetchImpl: f.fetchImpl }), /provenance/);
  assert.equal(f.assets.length, 2);
});

test('peels annotated tags to commit', async () => {
  const f = fixture({ annotated: true });
  await createReleaseDraft({ ...options, fetchImpl: f.fetchImpl });
  assert.ok(f.calls.some((c) => c.url.pathname.includes('/git/tags/')));
});

test('moved tag fails before creation or upload', async () => {
  for (const moveAt of [1, 2, 3]) {
    const f = fixture({ moveAt });
    await assert.rejects(createReleaseDraft({ ...options, fetchImpl: f.fetchImpl }), /no longer resolves/);
    assert.equal(f.assets.length, 0);
    if (moveAt < 3) assert.equal(f.created, undefined);
  }
});

test('upload conflict only succeeds when concurrently uploaded asset has matching digest', async () => {
  const f = fixture({ uploadConflict: true });
  await createReleaseDraft({ ...options, fetchImpl: f.fetchImpl });
  assert.equal(f.assets.length, 2);
});

test('validates every input before API access', async () => {
  const fetchImpl = () => { throw new Error('Unexpected network access'); };
  for (const patch of [{ tag: 'main' }, { version: '9.9.9' }, { commit: 'short' },
    { repository: '../owner/repo' }, { token: '' }, { zip: Buffer.from('not zip') }, { zipName: '../bad.zip' }]) {
    await assert.rejects(createReleaseDraft({ ...options, ...patch, fetchImpl }),
      (error) => !error.message.includes('Unexpected network'));
  }
});

test('checksum is deterministic and CLI rejects unknown and duplicate flags', async () => {
  const assets = prepareAssets(zip);
  assert.equal(assets[1].bytes.toString(), `${assets[0].sha256}  wp-asciiplayer.zip\n`);
  await assert.rejects(main(['--publish', 'true'], {}), /Usage/);
  await assert.rejects(main(['--tag', 'a', '--tag', 'b'], {}), /Usage/);
});

test('notes skip missing tags and unrelated branches in favor of a lower released ancestor', async () => {
  const f = fixture({ releases: ['v1.1.9', 'v1.1.8', 'v1.1.7'].map((tag) => release(tag)),
    comparisons: { 'v1.1.9': 'missing', 'v1.1.8': 'diverged' } });
  await createReleaseDraft({ ...options, fetchImpl: f.fetchImpl });
  assert.equal(f.calls.find((c) => c.url.pathname.endsWith('generate-notes')).body.previous_tag_name, 'v1.1.7');
});

test('no eligible predecessor uses explicit commit history instead of GitHub auto-selection', async () => {
  const f = fixture({ releases: [release('v1.1.0-rc.1', { prerelease: true })] });
  await createReleaseDraft({ ...options, fetchImpl: f.fetchImpl });
  assert.ok(!f.calls.some((c) => c.url.pathname.endsWith('generate-notes')));
  assert.match(f.created.body, /Initial implementation/);
  assert.match(f.created.body, /No earlier eligible published release/);
  assert.equal(f.calls.find((c) => c.url.pathname.endsWith('/commits')).url.searchParams.get('sha'), commit);
});

test('prerelease drafts set prerelease flag while remaining unpublished', async () => {
  const f = fixture();
  const tag = 'v1.2.0-rc.1';
  const fetchImpl = (input, init) => {
    if (input.includes('/git/ref/tags/')) {
      return Promise.resolve({ ok: true, status: 200,
        json: async () => ({ ref: `refs/tags/${tag}`, object: { type: 'commit', sha: commit } }) });
    }
    return f.fetchImpl(input, init);
  };
  await createReleaseDraft({ ...options, tag, version: '1.2.0-rc.1', fetchImpl });
  assert.equal(f.created.draft, true);
  assert.equal(f.created.prerelease, true);
});

test('release and first-release history pagination includes later pages', async () => {
  const f = fixture();
  const fetchImpl = (input, init) => {
    const url = new URL(input);
    if (init.method === 'GET' && url.pathname.endsWith('/releases')) {
      const filler = Array.from({ length: 100 }, (_, i) => release(`v0.0.${i}`, { draft: true }));
      const page = url.searchParams.get('page');
      return Promise.resolve({ ok: true, status: 200,
        json: async () => page === '1' ? filler : f.releases });
    }
    if (url.pathname.endsWith('/commits')) {
      const page = url.searchParams.get('page');
      return Promise.resolve({ ok: true, status: 200, json: async () => page === '1'
        ? Array.from({ length: 100 }, () => ({ sha: commit, commit: { message: 'Earlier change' } }))
        : [{ sha: 'b'.repeat(40), commit: { message: 'Oldest change on second page' } }] });
    }
    return f.fetchImpl(input, init);
  };
  await createReleaseDraft({ ...options, fetchImpl });
  assert.match(f.created.body, /Oldest change on second page/);
  await createReleaseDraft({ ...options, fetchImpl });
  assert.equal(f.releases.length, 1);
});

test('deleted predecessor tag cannot resolve a same-named branch through compare API', async () => {
  const f = fixture({ releases: [release('v1.1.0')], comparisons: { 'v1.1.0': 'missing' } });
  await createReleaseDraft({ ...options, fetchImpl: f.fetchImpl });
  assert.ok(f.calls.some((c) => c.url.pathname.endsWith('/git/ref/tags/v1.1.0')));
  assert.ok(!f.calls.some((c) => c.url.pathname.includes('/compare/')));
  assert.ok(!f.calls.some((c) => c.url.pathname.endsWith('generate-notes')));
});
