import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const job = (name) => workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z-]*:|$(?![\\s\\S]))`, 'm'))?.[1];

test('release writes are confined to a tag-only job after the full test graph', () => {
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.equal((workflow.match(/contents: write/g) || []).length, 1);
  assert.match(job('release-draft'), /if: github.event_name == 'push' && github.ref_type == 'tag'/);
  assert.match(job('release-draft'), /needs: \[release-validation, build, php-compatibility, wordpress, plugin-check\]/);
  assert.match(job('release-validation'), /git merge-base --is-ancestor HEAD origin\/main/);
  assert.match(job('release-validation'), /run: node scripts\/release-version.mjs/);
  for (const name of ['build', 'php-compatibility']) assert.match(job(name), /needs: release-validation/);
  assert.doesNotMatch(job('release-draft'), /npm (?:ci|install)|continue-on-error|pull_request_target/);
});

test('release downloads the pristine producer ID and never a consumer artifact', () => {
  const release = job('release-draft');
  assert.match(release, /artifact-ids: \$\{\{ needs.build.outputs.package-artifact-id \}\}/);
  assert.doesNotMatch(release, /pattern:|run-id:|overwrite:/);
  assert.match(job('build'), /path: dist\/wp-asciiplayer.zip/);
  for (const name of ['wordpress', 'plugin-check']) {
    const upload = job(name).split('actions/upload-artifact@')[1];
    assert.ok(upload);
    assert.doesNotMatch(upload, /dist\/|\.zip/);
  }
  assert.match(release, /persist-credentials: false/);
  assert.match(release, /--tag "\$RELEASE_TAG" --version "\$RELEASE_VERSION"/);
});

test('tag reruns serialize without cancelling an in-progress draft upload', () => {
  assert.match(workflow, /group: \$\{\{ github.workflow \}\}-\$\{\{ github.ref \}\}/);
  assert.match(workflow, /cancel-in-progress: \$\{\{ github.ref_type != 'tag' \}\}/);
  assert.match(workflow, /tags: \['\*\*'\]/);
});
