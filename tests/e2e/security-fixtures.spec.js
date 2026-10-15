import { test, expect } from '@playwright/test';
import { getSecurityCase, securityFixtureBuffer } from '../fixtures/security/generate.mjs';

const blockName = 'lamgc/asciiplayer';
const fixtureRoot = '/wp-content/uploads/asciiplayer-fixtures/security';
const messages = {
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
        window.wp?.apiFetch && window.wp?.blocks?.getBlockType(name) &&
        window.wp?.data?.select('core/editor')?.getCurrentPostId()
    ), blockName);
    await page.evaluate(() => {
        for (const scope of ['core/edit-post', 'core/editor']) {
            window.wp.data.dispatch('core/preferences').set(scope, 'welcomeGuide', false);
        }
    });
    await expect(page.locator('iframe[name="editor-canvas"]')).toBeVisible();
}

const canvas = (page) => page.frameLocator('iframe[name="editor-canvas"]');

async function insertPlayer(page, source) {
    const id = await page.evaluate(({ name, source }) => {
        const block = window.wp.blocks.createBlock(name, { source, controls: 'always' });
        window.wp.data.dispatch('core/block-editor').insertBlocks(block);
        window.wp.data.dispatch('core/block-editor').selectBlock(block.clientId);
        return block.clientId;
    }, { name: blockName, source });
    return { id, block: canvas(page).locator(`[data-block="${id}"]`) };
}

async function routeFixture(context, page, id) {
    const fixture = getSecurityCase(id);
    // Full 32 MiB and 100,000-event boundaries belong in Node/PHP, not a browser.
    expect(fixture.bytes).toBeLessThan(128 * 1024);
    const source = new URL(`${fixtureRoot}/${id}.cast`, page.url()).href;
    const body = securityFixtureBuffer(id);
    let requests = 0;
    await context.route(source, async (route) => {
        requests += 1;
        await route.fulfill({ contentType: 'text/plain; charset=utf-8', body });
    });
    return { source, fixture, requests: () => requests };
}

/** Observe real fetch signals and allocation-facing DOM; do not mock the player. */
function observeSecurityState() {
    if (window.__securityFixtureState) return;
    const state = window.__securityFixtureState = {
        fetches: [], maxTerms: 0, maxCols: 0, maxRows: 0, maxCells: 0,
        maxLines: 0, maxSymbolLines: 0, maxMarkers: 0,
    };
    const fetch = window.fetch;
    window.fetch = function (source, options) {
        if (String(source).includes('/asciiplayer-fixtures/security/')) {
            const entry = { source: String(source), aborted: Boolean(options?.signal?.aborted) };
            state.fetches.push(entry);
            options?.signal?.addEventListener('abort', () => { entry.aborted = true; }, { once: true });
        }
        return fetch.call(this, source, options);
    };
    const sample = () => {
        const terminals = document.querySelectorAll('.ap-term');
        state.maxTerms = Math.max(state.maxTerms, terminals.length);
        state.maxMarkers = Math.max(state.maxMarkers, document.querySelectorAll('.ap-marker').length);
        for (const terminal of terminals) {
            const cols = Number(terminal.style.getPropertyValue('--term-cols'));
            const rows = Number(terminal.style.getPropertyValue('--term-rows'));
            state.maxCols = Math.max(state.maxCols, cols);
            state.maxRows = Math.max(state.maxRows, rows);
            state.maxCells = Math.max(state.maxCells, cols * rows);
            state.maxLines = Math.max(state.maxLines, terminal.querySelectorAll('.ap-line').length);
            state.maxSymbolLines = Math.max(state.maxSymbolLines, terminal.querySelectorAll('.ap-symbol-line').length);
        }
    };
    state.sample = sample;
    new MutationObserver(sample).observe(document, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['style'],
    });
    sample();
}

async function observedState(scope) {
    return scope.locator('body').evaluate((body) => {
        const state = body.ownerDocument.defaultView.__securityFixtureState;
        state.sample();
        return { ...state, sample: undefined };
    });
}

async function expectFetch(scope, source, aborted) {
    await expect.poll(async () => (await observedState(scope)).fetches.filter((entry) => entry.source === source))
        .toEqual([{ source, aborted }]);
}

async function expectNativeSize(page, cols, rows) {
    await page.evaluate(() => window.wp.data.dispatch('core/edit-post').openGeneralSidebar('edit-post/block'));
    const columns = page.getByRole('spinbutton', { name: 'Columns', exact: true });
    const height = page.getByRole('spinbutton', { name: 'Rows', exact: true });
    if (!await columns.isVisible()) {
        await page.locator('.components-panel__body-toggle').filter({ hasText: /^Terminal size$/ }).click();
    }
    await expect(columns).toHaveAttribute('placeholder', cols === undefined ? 'From recording' : String(cols));
    await expect(height).toHaveAttribute('placeholder', rows === undefined ? 'From recording' : String(rows));
    await expect(columns).toHaveValue('');
    await expect(height).toHaveValue('');
}

async function expectPlayable(container, fixture) {
    const playback = fixture.playback;
    expect(fixture.safePlayback).toBe(true);
    expect(playback.seekPercent).toBe(80);
    await expect(container.locator('.ap-wrapper')).toHaveCount(1);
    await expect(container.locator('.ap-term')).toBeVisible();
    await expect.poll(() => container.locator('.ap-term').evaluate((terminal) => ({
        cols: Number(terminal.style.getPropertyValue('--term-cols')),
        rows: Number(terminal.style.getPropertyValue('--term-rows')),
    }))).toEqual({ cols: playback.cols, rows: playback.rows });
    await expect(container.locator('.ap-line')).toHaveCount(playback.rows);
    await expect(container.locator('.ap-marker')).toHaveCount(0);
    await container.locator('.ap-overlay-start .ap-play-button').click();
    const terminal = container.locator('.ap-term-text');
    await expect(terminal).toContainText(playback.startText);
    const button = container.locator('.ap-playback-button');
    await expect(button).toHaveAttribute('aria-label', 'Pause');
    await button.click();
    await expect(button).toHaveAttribute('aria-label', 'Play');
    await expect(terminal).not.toContainText(playback.seekText);
    // The real UI seeks to 80% (9.6s), beyond the seeded frame at 8s, then back.
    await terminal.press(String(playback.seekPercent / 10));
    await expect(terminal).toContainText(playback.seekText);
    await terminal.press('0');
    await expect(terminal).toContainText(playback.startText);
    await expect(terminal).not.toContainText(playback.seekText);
    await expect(container.locator('.ap-wrapper')).toHaveCount(1);
    await expect(container.locator('.ap-line')).toHaveCount(playback.rows);
}

async function expectNoUnsafeAllocation(scope, container) {
    await expect(container.locator('.ap-marker')).toHaveCount(0);
    // api.create legitimately creates an 80x24 shell before fetching. The
    // untrusted header/resizes must never expand it or create marker elements.
    expect(await container.locator('.ap-wrapper').count()).toBeLessThanOrEqual(1);
    await expect(container.locator('.ap-term-text')).toHaveText(/^\s*$/);
    const state = await observedState(scope);
    expect(state.maxTerms).toBeLessThanOrEqual(1);
    expect(state.maxCols).toBeLessThanOrEqual(80);
    expect(state.maxRows).toBeLessThanOrEqual(24);
    expect(state.maxCells).toBeLessThanOrEqual(80 * 24);
    expect(state.maxLines).toBeLessThanOrEqual(24);
    expect(state.maxSymbolLines).toBeLessThanOrEqual(24);
    expect(state.maxMarkers).toBe(0);
}

/** Real PHP-rendered public post; retain the editor page for guaranteed cleanup. */
async function withPublicPlayer(control, context, source, run) {
    const post = await control.evaluate(async ({ name, source }) => {
        const content = window.wp.blocks.serialize([
            window.wp.blocks.createBlock(name, { source, controls: 'always' }),
        ]);
        return window.wp.apiFetch({
            path: '/wp/v2/posts', method: 'POST',
            data: { title: `Security corpus regression ${Date.now()}`, status: 'publish', content },
        });
    }, { name: blockName, source });
    const frontend = await context.newPage();
    try {
        await frontend.goto(post.link);
        const container = frontend.locator('.asciiplayer-container');
        await expect(container).toHaveCount(1);
        await run(frontend, container);
    } finally {
        await frontend.close();
        // REST's normal delete moves this isolated test post to recoverable
        // Trash. It does not force-delete data or touch pre-existing posts.
        await control.evaluate((id) => window.wp.apiFetch({
            path: `/wp/v2/posts/${id}`, method: 'DELETE',
        }), post.id);
    }
}

test.beforeEach(async ({ page, context }) => {
    await context.addInitScript(observeSecurityState);
    await openEditor(page);
    // Also cover WordPress versions that replace the iframe document in place.
    await canvas(page).locator('body').evaluate(observeSecurityState);
});

for (const version of [1, 2, 3]) {
    test(`seeded v${version} corpus plays and seeks in the actual editor and public player`, async ({ page, context }) => {
        const routed = await routeFixture(context, page, `seeded-v${version}-valid`);
        const { id, block } = await insertPlayer(page, routed.source);
        await expect(block.locator('.asciiplayer-editor__preview')).toHaveAttribute('data-preview-status', 'ready');
        await expectNativeSize(page, routed.fixture.playback.cols, routed.fixture.playback.rows);
        await expectPlayable(block, routed.fixture);
        await expectFetch(canvas(page), routed.source, false);
        expect(routed.requests()).toBe(1);
        const attributes = await page.evaluate((id) => window.wp.data.select('core/block-editor').getBlockAttributes(id), id);
        expect(attributes.cols).toBeUndefined();
        expect(attributes.rows).toBeUndefined();
        await withPublicPlayer(page, context, routed.source, async (frontend, container) => {
            await expect(container).toHaveAttribute('data-ap-status', 'ready');
            await expectPlayable(container, routed.fixture);
            await expectFetch(frontend, routed.source, false);
            expect(routed.requests()).toBe(2);
        });
    });
}

const rejectionIds = [
    'dimensions-v1-over', 'dimensions-v2-over', 'dimensions-v3-over',
    'markers-v2-over', 'markers-v3-over',
    'late-resize-v2-over', 'late-resize-v3-over',
];
for (const id of rejectionIds) {
    test(`shared ${id} is rejected before unsafe DOM allocation on both playback paths`, async ({ page, context }) => {
        const rejected = await routeFixture(context, page, id);
        const recovery = await routeFixture(context, page, `seeded-v${rejected.fixture.format}-valid`);
        const { block } = await insertPlayer(page, rejected.source);
        const message = messages[rejected.fixture.expected.jsError];
        expect(message).toBeTruthy();
        await expect(block.locator('.asciiplayer-editor__preview')).toHaveAttribute('data-preview-status', 'error');
        await expect(block.locator('.components-notice')).toContainText(message);
        await expectNativeSize(page);
        await expectFetch(canvas(page), rejected.source, true);
        await expectNoUnsafeAllocation(canvas(page), block);
        expect(rejected.requests()).toBe(1);
        await withPublicPlayer(page, context, rejected.source, async (frontend, container) => {
            await expect(container).toHaveAttribute('data-ap-status', 'error');
            await expect(container.locator('.asciiplayer-error')).toHaveText(message);
            await expectFetch(frontend, rejected.source, true);
            await expectNoUnsafeAllocation(frontend, container);
            expect(rejected.requests()).toBe(2);
        });
        // A rejected corpus member must not poison the next valid recording.
        await block.getByRole('textbox', { name: 'Recording URL', exact: true }).fill(recovery.source);
        await block.getByRole('button', { name: 'Apply URL', exact: true }).click();
        await expect(block.locator('.asciiplayer-editor__preview')).toHaveAttribute('data-preview-status', 'ready');
        await expect(block.locator('.components-notice')).toHaveCount(0);
        await expectNativeSize(page, recovery.fixture.playback.cols, recovery.fixture.playback.rows);
        await expectPlayable(block, recovery.fixture);
        await expectFetch(canvas(page), recovery.source, false);
        expect(recovery.requests()).toBe(1);
    });
}

async function openMedia(page, block) {
    await block.getByRole('button', { name: 'Choose recording', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose an Asciicast recording', exact: true });
    await expect(dialog).toBeVisible();
    return dialog;
}

async function uploadCorpusFixture(page, dialog, id, unique) {
    const fixture = getSecurityCase(id);
    expect(fixture.bytes).toBeLessThan(32 * 1024);
    await dialog.getByRole('tab', { name: 'Upload files', exact: true }).click();
    // The real WordPress Plupload input can live outside the media modal.
    // Observe the actual upload endpoint rather than substituting its response.
    const input = page.locator('.moxie-shim input[type="file"]').last();
    await expect(input).toBeAttached();
    const response = page.waitForResponse((result) =>
        /\/wp-admin\/async-upload\.php(?:\?|$)/.test(result.url()) && result.request().method() === 'POST'
    );
    await input.setInputFiles({
        name: `security-${id}-${unique}.cast`, mimeType: 'application/x-asciicast',
        buffer: securityFixtureBuffer(id),
    });
    return (await response).json();
}

test('real WordPress uploads reject shared marker/cell fixtures and accept a seeded recording', async ({ page }, testInfo) => {
    const { id, block } = await insertPlayer(page, '');
    const unique = `${Date.now()}-${testInfo.retry}`;
    const validationMessage = 'Upload a valid Asciicast v2/v3 JSONL or v1 .cast recording (up to 32 MiB; v1 up to 2 MiB, 100,000 events, 256 KiB per JSONL line, 1,000 markers, 1,000 columns or rows, 40,000 terminal cells, and bounded JSON structure).';
    for (const fixtureId of ['markers-v2-over', 'cells-v1-over']) {
        const dialog = await openMedia(page, block);
        const result = await uploadCorpusFixture(page, dialog, fixtureId, unique);
        expect(result.success, JSON.stringify(result)).toBe(false);
        // Exact plugin copy distinguishes registered resource validation from
        // MIME, filesystem, transport, or unrelated WordPress upload failures.
        expect(result.data.message).toBe(validationMessage);
        await expect(dialog).toContainText(validationMessage);
        await expect(dialog.locator('.media-button-select')).toBeDisabled();
        await dialog.locator('.media-modal-close').click();
        await expect(block.getByRole('textbox', { name: 'Recording URL', exact: true })).toHaveValue('');
        expect(await page.evaluate((id) => window.wp.data.select('core/block-editor').getBlockAttributes(id).source, id)).toBe('');
        await expect(block.locator('.asciiplayer-editor__preview')).toHaveCount(0);
    }
    const fixture = getSecurityCase('seeded-v3-valid');
    const dialog = await openMedia(page, block);
    const accepted = await uploadCorpusFixture(page, dialog, fixture.id, unique);
    expect(accepted.success, JSON.stringify(accepted)).toBe(true);
    expect(accepted.data.mime).toBe('application/x-asciicast');
    await dialog.getByRole('tab', { name: 'Media Library', exact: true }).click();
    const attachment = dialog.locator(`.attachment[data-id="${accepted.data.id}"]`);
    await expect(attachment).toBeVisible();
    if (!await attachment.evaluate((element) => element.classList.contains('selected'))) await attachment.click();
    await expect(dialog.locator('.media-button-select')).toBeEnabled();
    await dialog.locator('.media-button-select').click();
    await expect(dialog).toBeHidden();
    await expect(block.getByRole('textbox', { name: 'Recording URL', exact: true })).toHaveValue(accepted.data.url);
    await expect(block.locator('.asciiplayer-editor__preview')).toHaveAttribute('data-preview-status', 'ready');
    await expectNativeSize(page, fixture.playback.cols, fixture.playback.rows);
    // This fetches the file WordPress actually saved, without a route mock.
    await expectPlayable(block, fixture);
});
