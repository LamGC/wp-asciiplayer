import { test, expect } from '@playwright/test';
import { DEFAULT_LIMITS } from '../../src/recording-loader.js';

const blockName = 'lamgc/asciiplayer';
const fixtureRoot = '/wp-content/uploads/asciiplayer-fixtures';
const messages = {
    bytes: 'This recording exceeds the file size limit.',
    markers: 'This recording contains too many markers.',
    dimensions: 'This recording requests terminal dimensions that exceed the supported limits.',
    cells: 'This recording requests too many terminal cells.',
};

async function openEditor(page) {
    await page.goto('/wp-login.php');
    await page.locator('#user_login').fill(process.env.WP_USERNAME || 'admin');
    await page.locator('#user_pass').fill(process.env.WP_PASSWORD || 'password');
    await page.locator('#wp-submit').click();
    await expect(page).toHaveURL(/\/wp-admin\//);
    await page.goto('/wp-admin/post-new.php');
    await page.waitForFunction((name) => Boolean(
        window.wp?.blocks?.getBlockType(name) &&
        window.wp?.data?.select('core/editor')?.getCurrentPostId()
    ), blockName);
    await page.evaluate(() => {
        for (const scope of ['core/edit-post', 'core/editor']) {
            window.wp.data.dispatch('core/preferences').set(scope, 'welcomeGuide', false);
        }
    });
    await expect(page.locator('iframe[name="editor-canvas"]')).toBeVisible();
}

function canvas(page) {
    return page.frameLocator('iframe[name="editor-canvas"]');
}

async function insertPlayer(page, attributes = {}) {
    const id = await page.evaluate(({ name, attrs }) => {
        const block = window.wp.blocks.createBlock(name, attrs);
        window.wp.data.dispatch('core/block-editor').insertBlocks(block);
        window.wp.data.dispatch('core/block-editor').selectBlock(block.clientId);
        return block.clientId;
    }, { name: blockName, attrs: attributes });
    return { id, block: canvas(page).locator(`[data-block="${id}"]`) };
}

async function removePlayer(page, id) {
    await page.evaluate((clientId) => window.wp.data.dispatch('core/block-editor').removeBlocks([clientId]), id);
    await expect(canvas(page).locator(`[data-block="${id}"]`)).toHaveCount(0);
}

async function changeSource(block, source) {
    await block.getByRole('textbox', { name: 'Recording URL', exact: true }).fill(source);
    await block.getByRole('button', { name: 'Apply URL', exact: true }).click();
}

async function readyPreview(block) {
    await expect(block.locator('.asciiplayer-editor__preview')).toHaveAttribute('data-preview-status', 'ready');
    await expect(block.locator('.ap-wrapper')).toHaveCount(1);
    await expect(block.locator('.ap-term')).toBeVisible();
}

async function expectGrid(block, cols, rows) {
    await expect.poll(() => block.locator('.ap-term').evaluate((terminal) => ({
        cols: Number(terminal.style.getPropertyValue('--term-cols')),
        rows: Number(terminal.style.getPropertyValue('--term-rows')),
    }))).toEqual({ cols, rows });
}

async function dimensions(page) {
    await page.evaluate(() => window.wp.data.dispatch('core/edit-post').openGeneralSidebar('edit-post/block'));
    const columns = page.getByRole('spinbutton', { name: 'Columns', exact: true });
    const rows = page.getByRole('spinbutton', { name: 'Rows', exact: true });
    if (!await columns.isVisible()) {
        await page.locator('.components-panel__body-toggle').filter({ hasText: /^Terminal size$/ }).click();
    }
    await expect(columns).toBeVisible();
    return { columns, rows };
}

async function expectNativeSize(page, cols, rows) {
    const controls = await dimensions(page);
    await expect(controls.columns).toHaveAttribute('placeholder', cols === undefined ? 'From recording' : String(cols));
    await expect(controls.rows).toHaveAttribute('placeholder', rows === undefined ? 'From recording' : String(rows));
    return controls;
}

function recording(version = 2, { cols = 64, rows = 12, label = 'bounded', events } = {}) {
    const output = (part) => `\u001b[2J\u001b[H${part} ${label}\r\n`;
    if (version === 1) {
        return JSON.stringify({ version, width: cols, height: rows, duration: 12, stdout: [
            [0, output('START')], [8, output('SEEK')], [4, output('END')],
        ] }, null, 2);
    }
    const header = version === 3 ? { version, term: { cols, rows } } : { version, width: cols, height: rows };
    const frames = events || [[0, 'o', output('START')], [8, 'o', output('SEEK')], [version === 3 ? 4 : 12, 'o', output('END')]];
    // The bundled parser permits blank/comment lines after either JSONL header.
    // Routing the original bytes tests compatibility through the real loader.
    return `${JSON.stringify(header)}\n\n# An ignored comment before output.\n${frames.map(JSON.stringify).join('\n\n# Between events.\n')}\n`;
}

async function routeRecording(page, name, body) {
    const source = new URL(`${fixtureRoot}/bounded-${name}.cast`, page.url()).href;
    let requests = 0;
    await page.route(source, async (route) => {
        requests += 1;
        await route.fulfill({ contentType: 'text/plain; charset=utf-8', body });
    });
    return { source, requests: () => requests };
}

async function playAndSeek(block, label) {
    await block.locator('.ap-overlay-start .ap-play-button').click();
    await expect(block.locator('.ap-term-text')).toContainText(`START ${label}`);
    const playback = block.locator('.ap-playback-button');
    await expect(playback).toHaveAttribute('aria-label', 'Pause');
    await playback.click();
    await expect(playback).toHaveAttribute('aria-label', 'Play');
    // The real player's numeric shortcuts seek to 80% and then back to 0%.
    // The second frame is eight seconds in, so this cannot pass by just playing.
    await block.locator('.ap-term-text').press('8');
    await expect(block.locator('.ap-term-text')).toContainText(`SEEK ${label}`);
    await expect(block.locator('.ap-term-text')).not.toContainText(`START ${label}`);
    await block.locator('.ap-term-text').press('0');
    await expect(block.locator('.ap-term-text')).toContainText(`START ${label}`);
    await expect(block.locator('.ap-term-text')).not.toContainText(`SEEK ${label}`);
}

for (const version of [1, 2, 3]) {
    test(`bounded v${version} recordings play and seek in the editor iframe, including zero header dimensions`, async ({ page }) => {
        await openEditor(page);
        for (const zero of [false, true]) {
            const label = `v${version}-${zero ? 'zero' : 'native'}`;
            const routed = await routeRecording(page, label, recording(version, {
                cols: zero ? 0 : 64, rows: zero ? 0 : 12, label,
            }));
            const { id, block } = await insertPlayer(page, { source: routed.source, controls: 'always' });
            await readyPreview(block);
            await expectGrid(block, zero ? 80 : 64, zero ? 24 : 12);
            const controls = await expectNativeSize(page, zero ? undefined : 64, zero ? undefined : 12);
            await expect(controls.columns).toHaveValue('');
            await expect(controls.rows).toHaveValue('');
            await playAndSeek(block, label);
            // Native-size hints and seeks must reuse the same validated fetch.
            expect(routed.requests()).toBe(1);
            const attributes = await page.evaluate((clientId) => window.wp.data.select('core/block-editor').getBlockAttributes(clientId), id);
            expect(attributes.cols).toBeUndefined();
            expect(attributes.rows).toBeUndefined();
            await removePlayer(page, id);
        }
    });
}

const firstUnsafeRows = Math.floor(DEFAULT_LIMITS.cells / DEFAULT_LIMITS.dimension) + 1;
const rejectedRecordings = [
    {
        name: 'actual received byte limit', code: 'bytes',
        body: () => {
            const header = `${JSON.stringify({ version: 2, width: 64, height: 12 })}\n`;
            // Keep every comment line well below the line limit and use no
            // events, isolating the total-byte cap without huge terminal output.
            const comment = `#${'x'.repeat(1022)}\n`;
            return header + comment.repeat(Math.ceil((DEFAULT_LIMITS.bytes + 1 - header.length) / comment.length));
        },
    },
    {
        name: 'marker count limit', code: 'markers',
        body: () => recording(2, { events: Array.from({ length: DEFAULT_LIMITS.markers + 1 }, (_, index) => [index / 1000, 'm', 'marker']) }),
    },
    {
        name: 'resize axis limit', code: 'dimensions',
        body: () => recording(2, { events: [[0, 'o', 'safe'], [1, 'r', `${DEFAULT_LIMITS.dimension + 1}x12`]] }),
    },
    {
        name: 'resize cell limit', code: 'cells',
        body: () => recording(3, { events: [[0, 'o', 'safe'], [1, 'r', `${DEFAULT_LIMITS.dimension}x${firstUnsafeRows}`]] }),
    },
    {
        name: 'initial terminal dimensions before player creation', code: 'cells', noFetch: true,
        attributes: { cols: DEFAULT_LIMITS.dimension, rows: firstUnsafeRows },
        body: () => recording(),
    },
    {
        name: 'effective resize dimensions with one overridden axis', code: 'cells',
        attributes: { cols: DEFAULT_LIMITS.dimension },
        body: () => recording(2, { events: [[0, 'o', 'safe'], [1, 'r', `64x${firstUnsafeRows}`]] }),
    },
];

for (const entry of rejectedRecordings) {
    test(`bounded preview rejects ${entry.name} with a useful error and recovers`, async ({ page }) => {
        await openEditor(page);
        const rejected = await routeRecording(page, `reject-${entry.code}`, entry.body());
        const valid = await routeRecording(page, 'recovery', recording(2, { label: 'recovered' }));
        const { id, block } = await insertPlayer(page, { source: rejected.source, ...entry.attributes });
        await expect(block.locator('.asciiplayer-editor__preview')).toHaveAttribute('data-preview-status', 'error');
        await expect(block.locator('.components-notice')).toContainText(messages[entry.code]);
        await expect(block.getByRole('button', { name: 'Retry preview', exact: true })).toBeVisible();
        await expectNativeSize(page);
        expect(rejected.requests()).toBe(entry.noFetch ? 0 : 1);
        if (entry.noFetch) await expect(block.locator('.ap-wrapper')).toHaveCount(0);
        // Remove intentional overrides while changing source in one store update,
        // so recovery cannot fail for the previous effective-size violation.
        await page.evaluate(({ clientId, source }) => window.wp.data.dispatch('core/block-editor').updateBlockAttributes(clientId, {
            source, cols: undefined, rows: undefined,
        }), { clientId: id, source: valid.source });
        await readyPreview(block);
        await expect(block.locator('.components-notice')).toHaveCount(0);
        await expectNativeSize(page, 64, 12);
        await expectGrid(block, 64, 12);
        await playAndSeek(block, 'recovered');
        expect(valid.requests()).toBe(1);
    });
}

test('bounded playback preserves independent dimension overrides across recorded resizes', async ({ page }) => {
    await openEditor(page);
    const routed = await routeRecording(page, 'safe-overrides', recording(2, { events: [
        [0, 'o', 'Original terminal\r\n'], [8, 'r', '100x30'], [8, 'o', 'Resized terminal\r\n'], [12, 'o', 'Finished\r\n'],
    ] }));
    for (const rows of [undefined, 20]) {
        const { id, block } = await insertPlayer(page, { source: routed.source, cols: 80, rows, controls: 'always' });
        await readyPreview(block);
        await expectGrid(block, 80, rows || 12);
        await expectNativeSize(page, 64, 12);
        await block.locator('.ap-overlay-start .ap-play-button').click();
        await expect(block.locator('.ap-term-text')).toContainText('Original terminal');
        await block.locator('.ap-playback-button').click();
        await block.locator('.ap-term-text').press('8');
        await expect(block.locator('.ap-term-text')).toContainText('Resized terminal');
        await expectGrid(block, 80, rows || 30);
        await expectNativeSize(page, 64, 12);
        await removePlayer(page, id);
    }
    expect(routed.requests()).toBe(2);
});

function deferred() {
    let release;
    const promise = new Promise((resolve) => { release = resolve; });
    return { promise, release };
}

async function observeNativeFetch(page) {
    await canvas(page).locator('body').evaluate((body) => {
        const window = body.ownerDocument.defaultView;
        const fetch = window.fetch;
        window.__boundedFetches = [];
        // Observation only: retain the actual browser fetch, Response/stream,
        // player, parser, and AbortController. No player API is mocked.
        window.fetch = function (source, options) {
            const entry = { source: String(source), aborted: Boolean(options?.signal?.aborted) };
            window.__boundedFetches.push(entry);
            options?.signal?.addEventListener('abort', () => { entry.aborted = true; }, { once: true });
            return fetch.call(this, source, options);
        };
    });
}

async function expectFetchAborted(page, source) {
    await expect.poll(() => canvas(page).locator('body').evaluate((body, url) =>
        body.ownerDocument.defaultView.__boundedFetches?.find((entry) => entry.source === url)?.aborted, source
    )).toBe(true);
}

for (const action of ['change URL', 'unmount block']) {
    test(`${action} aborts an in-flight bounded fetch and ignores its delayed result`, async ({ page }) => {
        await openEditor(page);
        await observeNativeFetch(page);
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        const oldSource = new URL(`${fixtureRoot}/bounded-delayed.cast`, page.url()).href;
        const current = await routeRecording(page, 'current', recording(2, { label: 'current' }));
        const gate = deferred();
        let requested = false;
        let settled = false;
        await page.route(oldSource, async (route) => {
            requested = true;
            await gate.promise;
            await route.fulfill({ contentType: 'text/plain', body: recording(2, { cols: 120, rows: 30, label: 'stale' }) }).catch(() => {});
            settled = true;
        });
        try {
            const old = await insertPlayer(page, { source: oldSource });
            await expect.poll(() => requested).toBe(true);
            let active = old;
            if (action === 'change URL') await changeSource(old.block, current.source);
            else {
                await removePlayer(page, old.id);
                active = await insertPlayer(page, { source: current.source });
            }
            await expectFetchAborted(page, oldSource);
            await readyPreview(active.block);
            await expectNativeSize(page, 64, 12);
            await active.block.locator('.ap-term').evaluate((terminal) => { terminal.dataset.boundedIdentity = 'current'; });
            gate.release();
            await expect.poll(() => settled).toBe(true);
            await readyPreview(active.block);
            await expect(active.block.locator('.ap-term')).toHaveAttribute('data-bounded-identity', 'current');
            await expectNativeSize(page, 64, 12);
            await expectGrid(active.block, 64, 12);
            await expect(canvas(page).locator('.ap-wrapper')).toHaveCount(1);
            await playAndSeek(active.block, 'current');
            expect(current.requests()).toBe(1);
            expect(pageErrors).toEqual([]);
        } finally {
            gate.release();
        }
    });
}

for (const action of ['change URL', 'unmount block']) {
    test(`${action} while player assets are pending never starts the stale recording fetch`, async ({ page }) => {
        await openEditor(page);
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        const old = await routeRecording(page, 'before-assets', recording(2, { cols: 120, rows: 30, label: 'stale' }));
        const current = await routeRecording(page, 'after-assets', recording(2, { label: 'current' }));
        const scriptUrl = await page.evaluate(() => window.wpAsciiplayerSettings.playerScriptUrl);
        expect(await canvas(page).locator('body').evaluate((body) => typeof body.ownerDocument.defaultView.AsciinemaPlayer)).toBe('undefined');
        const gate = deferred();
        let assetRequested = false;
        await page.route(scriptUrl, async (route) => {
            assetRequested = true;
            await gate.promise;
            // Resume the installed plugin's real local asset, not a test double.
            await route.continue().catch(() => {});
        });
        try {
            let active = await insertPlayer(page, { source: old.source });
            await expect.poll(() => assetRequested).toBe(true);
            await expect(active.block.locator('.asciiplayer-editor__preview')).toHaveAttribute('data-preview-status', 'loading');
            if (action === 'change URL') await changeSource(active.block, current.source);
            else {
                await removePlayer(page, active.id);
                active = await insertPlayer(page, { source: current.source });
            }
            expect(old.requests()).toBe(0);
            expect(current.requests()).toBe(0);
            gate.release();
            await readyPreview(active.block);
            await expectNativeSize(page, 64, 12);
            await expectGrid(active.block, 64, 12);
            await expect(canvas(page).locator('.ap-wrapper')).toHaveCount(1);
            await playAndSeek(active.block, 'current');
            expect(old.requests()).toBe(0);
            expect(current.requests()).toBe(1);
            expect(pageErrors).toEqual([]);
        } finally {
            gate.release();
        }
    });
}
