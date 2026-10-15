import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { loadRecording, RecordingLoadError, DEFAULT_LIMITS } from '../../src/recording-loader.js';
import { securityManifest, securityCases, getSecurityCase, securityFixtureBuffer } from '../fixtures/security/generate.mjs';

test('shared security corpus pins the production policy and all six safe controls', () => {
    assert.equal(DEFAULT_LIMITS.timelineMs, 2147483647, 'the test horizon is independently pinned');
    assert.equal(securityManifest.schemaVersion, 1);
    for (const [name, value] of Object.entries(securityManifest.policy)) {
        assert.equal(DEFAULT_LIMITS[name], value, `the ${name} fixture boundary must match production`);
    }
    assert.deepEqual(securityCases.filter((entry) => entry.safePlayback).map((entry) => entry.id).sort(), [
        'official-v1', 'official-v2', 'official-v3',
        'seeded-v1-valid', 'seeded-v2-valid', 'seeded-v3-valid',
    ]);
});

/** A bounded stream, with observations rather than a replacement loader/parser. */
function streamedFixture(bytes, chunkSizes = [16 * 1024]) {
    let offset = 0;
    let reads = 0;
    const state = { fetches: 0, cancels: 0, releases: 0, eof: 0, signal: undefined };
    const fetchImpl = async (source, options) => {
        state.fetches += 1;
        assert.equal(source, '/security-fixture.cast');
        assert.equal(options.credentials, 'same-origin');
        state.signal = options.signal;
        return {
            ok: true,
            // A false advertised length must not replace measuring actual bytes.
            headers: new Headers({ 'Content-Length': '1' }),
            body: { getReader: () => ({
                read: async () => {
                    if (offset === bytes.length) {
                        state.eof += 1;
                        return { done: true };
                    }
                    const end = Math.min(offset + chunkSizes[reads++ % chunkSizes.length], bytes.length);
                    const value = bytes.subarray(offset, end);
                    offset = end;
                    return { done: false, value };
                },
                cancel: async () => { state.cancels += 1; },
                releaseLock: () => { state.releases += 1; },
            }) },
        };
    };
    return { fetchImpl, state };
}

for (const entry of securityCases) {
    test(`shared security corpus: ${entry.id}`, async (t) => {
        const bytes = await securityFixtureBuffer(entry.id);
        assert.equal(bytes.length, entry.bytes, 'fixture byte length is reproducible');
        assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, 'fixture bytes match the cross-language manifest');
        const input = streamedFixture(bytes);
        const metadata = [];
        let largestParsedTree = 0;
        const parse = JSON.parse;
        t.after(() => { JSON.parse = parse; });
        JSON.parse = (text, ...args) => {
            // Version-sniffing parses short scalar keys. Only full JSON trees
            // allocate the arrays/objects that the structural guard must bound.
            if (/^\s*[\[{]/.test(text)) largestParsedTree = Math.max(largestParsedTree, Buffer.byteLength(text));
            return parse(text, ...args);
        };
        const pending = loadRecording('/security-fixture.cast', {
            fetchImpl: input.fetchImpl,
            onMetadata: (value) => metadata.push(value),
        });
        if (entry.expected.accepted) {
            const result = await pending;
            const header = entry.format === 1 ? result : result[0];
            assert.equal(header.version, entry.format);
            const cols = entry.format === 3 ? header.term.cols : header.width;
            const rows = entry.format === 3 ? header.term.rows : header.height;
            assert.deepEqual(metadata, [cols > 0 && rows > 0 ? { cols, rows } : null], 'metadata is emitted exactly once, only after complete validation');
            assert.equal(input.state.eof, 1, 'an accepted recording is validated through EOF');
            assert.equal(input.state.cancels, 0);
            assert.equal(input.state.signal.aborted, false);
        } else {
            await assert.rejects(pending, (error) => error instanceof RecordingLoadError && error.code === entry.expected.jsError,
                `expected the production ${entry.expected.jsError} guard`);
            assert.deepEqual(metadata, [], 'rejected content must not leak native-size metadata');
            assert.equal(input.state.cancels, 1, 'the rejected body reader is canceled once');
            assert.equal(input.state.signal.aborted, true, 'the rejected fetch is aborted');
            const threshold = entry.expected.noDecodeAtOrAboveBytes;
            if (threshold !== undefined) {
                assert.ok(largestParsedTree < threshold,
                    `unsafe JSON at/above ${threshold} bytes reached JSON.parse: ${largestParsedTree}`);
            }
        }
        assert.equal(input.state.fetches, 1, 'validation and metadata share a single fetch');
        assert.equal(input.state.releases, 1, 'the body reader lock is released exactly once');
    });
}

for (const version of [1, 2, 3]) {
    test(`seeded v${version} corpus survives byte and JSON token stream boundaries`, async () => {
        const entry = getSecurityCase(`seeded-v${version}-valid`);
        const bytes = await securityFixtureBuffer(entry.id);
        const fragmented = streamedFixture(bytes, [1, 2, 3, 5, 13]);
        const contiguous = streamedFixture(bytes, [bytes.length]);
        const metadata = [];
        const actual = await loadRecording('/security-fixture.cast', {
            fetchImpl: fragmented.fetchImpl, onMetadata: (value) => metadata.push(value),
        });
        assert.deepEqual(actual, await loadRecording('/security-fixture.cast', { fetchImpl: contiguous.fetchImpl }));
        assert.equal(metadata.length, 1);
        assert.equal(fragmented.state.fetches, 1);
        assert.equal(fragmented.state.cancels, 0);
        assert.equal(fragmented.state.releases, 1);
    });
}

/**
 * Exercise the actual pinned player parser/recording driver without importing
 * its DOM UI. Discover Core through the package's own entrypoint import, rather
 * than hard-coding a generated chunk hash or copying upstream parser code.
 * A package layout/version change deliberately fails this compatibility check.
 */
async function playerCore() {
    const entrypoint = new URL(import.meta.resolve('asciinema-player'));
    const manifest = JSON.parse(await readFile(new URL('../package.json', entrypoint), 'utf8'));
    assert.equal(manifest.version, '3.17.0');
    const source = await readFile(entrypoint, 'utf8');
    const imported = /import \{ (\w+) as Core \} from ['"]([^'"]+)['"]/.exec(source);
    assert.ok(imported, 'the pinned player entrypoint must expose its Core import for compatibility tests');
    const module = await import(new URL(imported[2], entrypoint));
    assert.equal(typeof module[imported[1]], 'function');
    return module[imported[1]];
}

function expectedPlayback(data) {
    const header = Array.isArray(data) ? data[0] : data;
    let time = 0;
    const frames = header.version === 1 ? data.stdout.map(([delta, text]) => [delta, 'o', text]) : data.slice(1);
    const absolute = frames.map(([timestamp, type, text]) => {
        time = header.version === 2 ? timestamp : time + timestamp;
        return [time, type, text];
    });
    return {
        cols: (header.version === 3 ? header.term.cols : header.width) || 80,
        rows: (header.version === 3 ? header.term.rows : header.height) || 24,
        duration: time,
        events: absolute,
        output: absolute.filter((event) => event[1] === 'o').map((event) => event[2]).join(''),
        markers: absolute.filter((event) => event[1] === 'm').map((event) => [event[0], event[2]]),
    };
}

async function inspectPlayer(data) {
    const Core = await playerCore();
    const events = { metadata: [], reset: [], output: [], error: [] };
    const core = new Core({ data }, {
        preload: true, speed: 1,
        logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    for (const [name, values] of Object.entries(events)) core.addEventListener(name, (value) => values.push(value));
    try {
        core.terminalReady();
        await core.init();
        const duration = core.getDuration();
        assert.ok(Number.isFinite(duration));
        assert.ok(Number.isFinite(core.getCurrentTime()));
        await core.seek('100%');
        assert.ok(Number.isFinite(core.getCurrentTime()), 'the actual seek destination remains finite');
        assert.ok(Number.isFinite(core.getProgress()), 'the actual progress calculation remains finite');
        const output = events.output.flat().join('');
        await core.seek('0%');
        assert.equal(core.getCurrentTime(), 0, 'the real driver can seek back to the start');
        assert.deepEqual(events.error, []);
        assert.equal(events.metadata.length, 1);
        return { duration, output, metadata: events.metadata[0], reset: events.reset[0] };
    } finally {
        await core.stop();
    }
}

// Only known-small, accepted controls reach the real upstream parser/driver here.
// The tiny numeric witnesses below run separately with captured timers and a hard
// child-process deadline; no oversized payload reaches the real player.
const playableCases = securityCases.filter((entry) => entry.safePlayback === true);
for (const entry of playableCases) {
    test(`pinned player 3.17 parses and seeks validated ${entry.id}`, async () => {
        assert.equal(entry.expected.accepted, true);
        assert.ok(entry.bytes < 128 * 1024, 'actual-player controls must remain small');
        const bytes = await securityFixtureBuffer(entry.id);
        const data = await loadRecording('/security-fixture.cast', { fetchImpl: streamedFixture(bytes).fetchImpl });
        const text = bytes.toString('utf8');
        const original = entry.format === 1 ? JSON.parse(text) : text.split('\n')
            .filter((line, index) => index === 0 || line.startsWith('[')).map((line) => JSON.parse(line));
        assert.deepEqual(data, original, 'the guard preserves every original header and event');
        const expected = expectedPlayback(original);
        const actual = await inspectPlayer(data);
        assert.ok(Math.abs(actual.duration - expected.duration) < 1e-8);
        assert.deepEqual(actual.reset.size, { cols: expected.cols, rows: expected.rows });
        assert.equal(actual.output, expected.output, 'the real parser preserves complete terminal output');
        assert.deepEqual(actual.metadata.markers, expected.markers);
        // Independently prove both official captures and seeded mutations also
        // work through upstream's original raw-input path before our adapter.
        const raw = await inspectPlayer(new Response(bytes));
        assert.deepEqual(raw, actual);
    });
}


test('official outputs and seeded playback timelines are equivalent across all three formats', async () => {
    const controls = { official: [], seeded: [] };
    for (const version of [1, 2, 3]) {
        for (const kind of ['official', 'seeded']) {
            const id = kind === 'official' ? `official-v${version}` : `seeded-v${version}-valid`;
            const bytes = securityFixtureBuffer(id);
            const text = bytes.toString('utf8');
            const data = version === 1 ? JSON.parse(text) : text.trimEnd().split('\n').map(JSON.parse);
            controls[kind].push(expectedPlayback(data));
        }
    }
    assert.equal(controls.official[0].output, controls.official[1].output);
    assert.equal(controls.official[0].output, controls.official[2].output);
    assert.deepEqual(controls.seeded[0], controls.seeded[1]);
    assert.deepEqual(controls.seeded[0], controls.seeded[2]);
    assert.deepEqual(controls.seeded[0].events.map((event) => event[0]), [0, 1, 8, 12]);
    assert.ok(controls.seeded[0].output.includes(controls.official[0].output), 'seeded mutations retain the official captured output');
});


/**
 * Actual upstream Core witness, isolated from the main runner. All timers are
 * captured, never scheduled; at most three callbacks are invoked per witness.
 * The parent also kills this child after 10 seconds if an upstream change causes
 * an unexpected synchronous loop. No browser, terminal, real playback delay, or
 * large payload is involved. The arithmetic checks above are not a Core double.
 */
async function timestampCoreRegression() {
    const Core = await playerCore();
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const timers = new Map();
    let timerId = 0;
    globalThis.setTimeout = (callback, delay) => {
        const id = ++timerId;
        timers.set(id, { callback, delay });
        return id;
    };
    globalThis.clearTimeout = (id) => { timers.delete(id); };
    const parseFixture = (id) => {
        const entry = getSecurityCase(id);
        assert.ok(entry.bytes < 256, 'only pinned tiny witnesses may enter this child');
        const text = securityFixtureBuffer(id).toString('utf8');
        return entry.format === 1 ? JSON.parse(text) : text.trimEnd().split('\n').map(JSON.parse);
    };
    const createCore = (data) => {
        const core = new Core({ data }, {
            preload: true, speed: 1,
            logger: { debug() {}, info() {}, warn() {}, error() {} },
        });
        const events = { output: [], error: [], ended: [] };
        for (const [name, values] of Object.entries(events)) core.addEventListener(name, (value) => values.push(value));
        core.terminalReady();
        return { core, events };
    };
    const takeTimer = () => {
        assert.equal(timers.size, 1, 'exactly one recording callback is pending');
        const [id, timer] = timers.entries().next().value;
        timers.delete(id);
        return timer;
    };
    try {
        // Deliberately bypass the guard ONLY for this fixed tiny upstream bug
        // witness. A premature timer call safely exposes non-progress without
        // waiting for 1e23 ms or advancing the clock into a synchronous loop.
        const stalled = createCore(parseFixture('time-v2-output-nonprogress'));
        try {
            await stalled.core.init();
            assert.ok(Number.isFinite(stalled.core.getDuration()));
            assert.equal(timers.size, 0, 'initial loading timeout was cleared');
            await stalled.core.play();
            let previousCallback;
            for (let n = 0; n < 3; n++) {
                const timer = takeTimer();
                assert.equal(timer.delay, 1e23, 'the unsafe upstream delay exceeds signed 32-bit timer range');
                if (previousCallback) assert.equal(timer.callback, previousCallback, 'the same unconsumed event is rescheduled');
                previousCallback = timer.callback;
                timer.callback();
                await Promise.resolve();
                assert.deepEqual(stalled.events.output, Array.from({ length: n + 1 }, () => []), 'batching emits empty output without consuming x');
                assert.deepEqual(stalled.events.ended, []);
            }
            assert.deepEqual(stalled.events.error, []);
            process.stdout.write('v2 non-progress reproduced with three captured callbacks\n');
        } finally {
            await stalled.core.stop();
            assert.equal(timers.size, 0, 'stopping removes the captured non-progress callback');
        }
        for (const version of [1, 3]) {
            const overflow = createCore(parseFixture(`time-v${version}-ms-sum-overflow`));
            try {
                await overflow.core.init();
                assert.equal(overflow.core.getDuration(), Infinity, 'real upstream interval arithmetic overflows although converted seconds sum is finite');
                await overflow.core.seek('100%');
                assert.equal(overflow.core.getCurrentTime(), Infinity);
                assert.ok(Number.isNaN(overflow.core.getProgress()), 'real upstream progress is corrupted');
                assert.deepEqual(overflow.events.error, []);
                process.stdout.write(`v${version} infinite duration/seek reproduced\n`);
            } finally {
                await overflow.core.stop();
                assert.equal(timers.size, 0);
            }
        }
        // The production loader must reject all five pinned numerical attacks
        // before their data can be handed to Core, including rounding-order bugs.
        let coreHandoffs = 0;
        for (const id of [
            'time-v2-output-nonprogress',
            'time-v1-ms-sum-overflow', 'time-v3-ms-sum-overflow',
            'time-v1-ms-rounding-over', 'time-v3-ms-rounding-over',
        ]) {
            assert.equal(getSecurityCase(id).expected.jsError, 'time');
            const stream = streamedFixture(securityFixtureBuffer(id));
            const handoff = async () => {
                const data = await loadRecording('/security-fixture.cast', { fetchImpl: stream.fetchImpl });
                coreHandoffs++;
                return createCore(data);
            };
            await assert.rejects(handoff(), (error) => error instanceof RecordingLoadError && error.code === 'time');
            assert.equal(coreHandoffs, 0, 'rejected data never reaches the actual Core constructor');
            assert.equal(stream.state.cancels, 1);
            assert.equal(stream.state.signal.aborted, true);
            assert.equal(timers.size, 0, 'rejected loader leaves no captured timeouts');
            process.stdout.write(`${id} rejected before Core handoff\n`);
        }
        // Accepted exact-boundary fixtures survive actual parser preparation,
        // duration/progress arithmetic, end/start seeking and output batching.
        for (const id of [
            'timeline-v1-at', 'timeline-v2-at', 'timeline-v3-at',
            'interval-timeline-v1-at', 'interval-timeline-v3-at',
        ]) {
            const bytes = securityFixtureBuffer(id);
            const data = await loadRecording('/security-fixture.cast', { fetchImpl: streamedFixture(bytes).fetchImpl });
            assert.deepEqual(data, parseFixture(id), 'near-bound timestamps are preserved without clamping');
            const expectedOutput = id.startsWith('interval-') ? 'xend' : 'x';
            const inspected = await inspectPlayer(data);
            assert.equal(inspected.duration, 2147483.647);
            assert.equal(inspected.output, expectedOutput);
            assert.equal(timers.size, 0);
            const playback = createCore(data);
            try {
                await playback.core.init();
                await playback.core.play();
                for (let n = 0; n < (id.startsWith('interval-') ? 2 : 1); n++) {
                    const timer = takeTimer();
                    assert.ok(Number.isFinite(timer.delay) && timer.delay >= 0 && timer.delay <= 2147483647);
                    timer.callback();
                    await Promise.resolve();
                }
                assert.equal(playback.events.output.flat().join(''), expectedOutput, 'accepted boundary output always advances');
                assert.equal(playback.events.ended.length, 1);
                assert.ok(Number.isFinite(playback.core.getDuration()));
                assert.ok(Number.isFinite(playback.core.getCurrentTime()));
                assert.ok(Number.isFinite(playback.core.getProgress()));
                assert.deepEqual(playback.events.error, []);
                assert.equal(timers.size, 0, 'accepted output does not reschedule a consumed event');
                process.stdout.write(`${id} actual Core init/seek/playback is finite and advances\n`);
            } finally { await playback.core.stop(); }
        }
    } finally {
        globalThis.setTimeout = realSetTimeout;
        globalThis.clearTimeout = realClearTimeout;
    }
}

test('actual 3.17 Core timestamp regressions are bounded and blocked before handoff', () => {
    const script = `
        import assert from 'node:assert/strict';
        import { readFile } from 'node:fs/promises';
        import { loadRecording, RecordingLoadError } from ${JSON.stringify(new URL('../../src/recording-loader.js', import.meta.url).href)};
        import { getSecurityCase, securityFixtureBuffer } from ${JSON.stringify(new URL('../fixtures/security/generate.mjs', import.meta.url).href)};
        ${playerCore.toString()}
        ${streamedFixture.toString()}
        ${inspectPlayer.toString()}
        await (${timestampCoreRegression.toString()})();
        process.stdout.write('bounded actual-Core timestamp witnesses passed\\n');
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
        cwd: new URL('../../', import.meta.url), timeout: 10000, maxBuffer: 64 * 1024,
        encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' },
    });
    const diagnostics = `stdout:\n${child.stdout}\nstderr:\n${child.stderr}`;
    assert.equal(child.error, undefined, `the bounded Core witness must finish: ${child.error?.message}\n${diagnostics}`);
    assert.equal(child.signal, null, `the bounded Core witness was killed\n${diagnostics}`);
    assert.equal(child.status, 0, diagnostics);
    assert.match(child.stdout, /bounded actual-Core timestamp witnesses passed/);
});
