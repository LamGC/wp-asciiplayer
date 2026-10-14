import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const blockName = 'lamgc/asciiplayer';
const fixturePath = '/wp-content/uploads/asciiplayer-fixtures/hello.cast';

async function logIn(page) {
    await page.goto('/wp-login.php');
    await page.locator('#user_login').fill(process.env.WP_USERNAME || 'admin');
    await page.locator('#user_pass').fill(process.env.WP_PASSWORD || 'password');
    await page.locator('#wp-submit').click();
    await expect(page).toHaveURL(/\/wp-admin\//);
}

async function openEditor(page, postType = 'post') {
    await page.goto(`/wp-admin/post-new.php?post_type=${postType}`);
    await page.waitForFunction((name) => Boolean(
        window.wp?.blocks?.getBlockType(name) &&
        window.wp?.data?.select('core/editor')?.getCurrentPostId()
    ), blockName);
    await page.evaluate(() => {
        for (const scope of ['core/edit-post', 'core/editor']) {
            window.wp.data.dispatch('core/preferences').set(scope, 'welcomeGuide', false);
        }
    });
    // A block-pattern picker can appear on a new Page in some core releases.
    const closeDialog = page.getByRole('dialog').getByRole('button', { name: /close/i });
    if (await closeDialog.count()) await closeDialog.first().click();
    await expect(page.locator('iframe[name="editor-canvas"]')).toBeVisible();
}

async function insertPlayer(page, attributes = {}) {
    return page.evaluate(({ name, attrs }) => {
        const block = window.wp.blocks.createBlock(name, attrs);
        window.wp.data.dispatch('core/block-editor').insertBlocks(block);
        window.wp.data.dispatch('core/block-editor').selectBlock(block.clientId);
        return block.clientId;
    }, { name: blockName, attrs: attributes });
}

function canvas(page) {
    return page.frameLocator('iframe[name="editor-canvas"]');
}

function playerBlock(page, clientId) {
    return canvas(page).locator(`[data-block="${clientId}"]`);
}

async function readyPreview(block) {
    await expect(block.locator('.asciiplayer-editor__preview')).toHaveAttribute('data-preview-status', 'ready');
    await expect(block.locator('.asciiplayer-editor__player .ap-wrapper')).toHaveCount(1);
    await expect(block.locator('.ap-wrapper')).toBeVisible();
}

async function publish(page, title) {
    return page.evaluate(async (postTitle) => {
        const editor = window.wp.data.dispatch('core/editor');
        editor.editPost({ title: postTitle, status: 'publish' });
        await editor.savePost();
        const state = window.wp.data.select('core/editor');
        if (state.didPostSaveRequestFail()) throw new Error('WordPress could not save the test post.');
        return { id: state.getCurrentPostId(), url: state.getPermalink() };
    }, title);
}

async function createContent(page, postType, content) {
    return page.evaluate(async ({ type, html }) => window.wp.apiFetch({
        path: `/wp/v2/${type === 'page' ? 'pages' : 'posts'}`,
        method: 'POST',
        data: { title: `Asciiplayer integration ${Date.now()}`, status: 'publish', content: html },
    }), { type: postType, html: content });
}

async function expectFrontendPlayer(container) {
    await expect(container.locator('.ap-wrapper')).toBeVisible();
    // This starts actual playback and checks parsed terminal output. Merely
    // finding the player's outer DOM would miss fetch/CORS/parser failures.
    const start = container.locator('.ap-overlay-start .ap-play-button');
    if (await start.isVisible()) await start.click();
    await expect(container).toContainText('Hello from wp-asciiplayer');
}

async function screenshot(page, testInfo, name) {
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach(name, { path, contentType: 'image/png' });
}

test.beforeEach(async ({ page }) => {
    await logIn(page);
});

test('real iframe preview survives edits, duplicate, delete, undo, save and reload', async ({ page }, testInfo) => {
    const cdnRequests = [];
    const pageErrors = [];
    page.on('request', (request) => {
        if (new URL(request.url()).hostname.endsWith('jsdelivr.net')) cdnRequests.push(request.url());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await openEditor(page);
    const source = new URL(fixturePath, page.url()).href;
    const id = await insertPlayer(page);
    const block = playerBlock(page, id);
    await block.getByRole('textbox', { name: 'Recording URL', exact: true }).fill(source);
    await block.getByRole('button', { name: 'Apply URL', exact: true }).click();
    await readyPreview(block);
    await block.locator('.ap-overlay-start .ap-play-button').click();
    await expect(block.locator('.ap-term-text')).toContainText('Hello from wp-asciiplayer');
    const playback = block.locator('.ap-playback-button');
    await expect(playback).toHaveAttribute('aria-label', 'Pause');
    await block.locator('.ap-term-text').press('Space');
    await expect(playback).toHaveAttribute('aria-label', 'Play');
    await block.locator('.ap-term-text').press('Space');
    await expect(playback).toHaveAttribute('aria-label', 'Pause');
    await block.locator('.ap-term-text').press('Space');
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(block.locator('.ap-wrapper')).toBeVisible();
    const canvasWidth = await page.locator('iframe[name="editor-canvas"]').evaluate((element) => element.clientWidth);
    await expect.poll(async () => (await block.locator('.ap-wrapper').boundingBox()).width).toBeLessThanOrEqual(canvasWidth);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => window.wp.data.dispatch('core/edit-post').openGeneralSidebar('edit-post/block'));

    // Exercise a real inspector input; data-store operations below cover core's
    // block lifecycle without depending on changing toolbar/menu copy.
    const speed = page.getByRole('spinbutton', { name: 'Playback speed', exact: true });
    await speed.fill('1.5');
    await speed.press('Tab');
    await expect.poll(() => page.evaluate((clientId) =>
        window.wp.data.select('core/block-editor').getBlockAttributes(clientId).speed, id
    )).toBe(1.5);
    await readyPreview(block);
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('solarized-dark');
    await readyPreview(block);
    await expect(block.locator('.ap-player')).toHaveClass(/asciinema-player-theme-solarized-dark/);

    const duplicateId = await page.evaluate(async (clientId) => {
        await window.wp.data.dispatch('core/block-editor').duplicateBlocks([clientId]);
        return window.wp.data.select('core/block-editor').getBlocks().find((entry) => entry.name === 'lamgc/asciiplayer' && entry.clientId !== clientId).clientId;
    }, id);
    await readyPreview(playerBlock(page, duplicateId));
    await expect(canvas(page).locator('.asciiplayer-editor__player .ap-wrapper')).toHaveCount(2);
    await page.evaluate((clientId) => window.wp.data.dispatch('core/block-editor').removeBlocks([clientId]), duplicateId);
    await expect(canvas(page).locator('.asciiplayer-editor__player .ap-wrapper')).toHaveCount(1);
    await page.evaluate(() => window.wp.data.dispatch('core/editor').undo());
    await readyPreview(playerBlock(page, duplicateId));
    await expect(canvas(page).locator('.asciiplayer-editor__player .ap-wrapper')).toHaveCount(2);
    await page.evaluate((clientId) => window.wp.data.dispatch('core/block-editor').removeBlocks([clientId]), duplicateId);

    const saved = await publish(page, 'Inline preview lifecycle integration');
    await screenshot(page, testInfo, 'real-wordpress-editor');
    await page.reload();
    await page.waitForFunction(() => window.wp?.data?.select('core/block-editor')?.getBlocks().length > 0);
    const reloaded = await page.evaluate(() => window.wp.data.select('core/block-editor').getBlocks().find((entry) => entry.name === 'lamgc/asciiplayer'));
    expect(reloaded.name).toBe(blockName);
    expect(reloaded.attributes).toMatchObject({ source, speed: 1.5, theme: 'solarized-dark' });
    await readyPreview(playerBlock(page, reloaded.clientId));

    await page.goto(saved.url);
    const container = page.locator('.asciiplayer-container');
    await expect(container).toHaveCount(1);
    expect(JSON.parse(await container.getAttribute('data-ap-options'))).toMatchObject({ speed: 1.5, theme: 'solarized-dark' });
    await expectFrontendPlayer(container);
    await screenshot(page, testInfo, 'real-wordpress-post');
    expect(cdnRequests, 'No plugin runtime may be loaded from jsDelivr').toEqual([]);
    expect(pageErrors).toEqual([]);
});

test('a published Page plays its block at desktop and mobile widths', async ({ page }, testInfo) => {
    await openEditor(page, 'page');
    const source = new URL(fixturePath, page.url()).href;
    const id = await insertPlayer(page, { source, controls: 'always', preload: true });
    await readyPreview(playerBlock(page, id));
    const saved = await publish(page, 'Page playback integration');
    await page.goto(saved.url);
    const container = page.locator('.asciiplayer-container');
    await expectFrontendPlayer(container);
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(container.locator('.ap-wrapper')).toBeVisible();
    const bounds = await container.locator('.ap-wrapper').boundingBox();
    expect(bounds.width).toBeLessThanOrEqual(375);
    await screenshot(page, testInfo, 'real-wordpress-page-mobile');
});

for (const postType of ['post', 'page']) {
    test(`legacy shortcodes play multiple recordings on a ${postType}`, async ({ page }) => {
        await openEditor(page, postType);
        const source = new URL(fixturePath, page.url()).href;
        const content = `[asciiplayer controls="false" autoPlay="true" startAt="0.1" idleTimeLimit="1" speed="1.5" loop="false" style="max-width: 640px;"]${source}[/asciiplayer]\n` +
            `[asciiplayer controls="true" theme="solarized-dark" preload="true"]${source}[/asciiplayer]`;
        const saved = await createContent(page, postType, content);
        await page.goto(saved.link);
        const containers = page.locator('.asciiplayer-container');
        await expect(containers).toHaveCount(2);
        const options = JSON.parse(await containers.nth(0).getAttribute('data-ap-options'));
        expect(options).toMatchObject({ autoPlay: true, startAt: 0.1, idleTimeLimit: 1, speed: 1.5, loop: false });
        expect(options.controls).toBe(false);
        const otherOptions = JSON.parse(await containers.nth(1).getAttribute('data-ap-options'));
        expect(otherOptions.controls).toBe(true);
        await expectFrontendPlayer(containers.nth(0));
        await expect(containers.nth(0).locator('.ap-control-bar')).toHaveCount(0);
        await expectFrontendPlayer(containers.nth(1));
    });
}

for (const filename of ['missing.cast', 'malformed.cast']) {
    test(`a ${filename} recording produces a recoverable inline error`, async ({ page }) => {
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await openEditor(page);
        const source = new URL(`/wp-content/uploads/asciiplayer-fixtures/${filename}`, page.url()).href;
        const id = await insertPlayer(page);
        const block = playerBlock(page, id);
        await block.getByRole('textbox', { name: 'Recording URL', exact: true }).fill(source);
        await block.getByRole('button', { name: 'Apply URL', exact: true }).click();
        await expect(block.locator('.asciiplayer-editor__preview')).toHaveAttribute('data-preview-status', 'error');
        await expect(block).toContainText('Unable to load the recording.');
        await expect(block.getByRole('button', { name: 'Retry preview', exact: true })).toBeVisible();
        await block.getByRole('textbox', { name: 'Recording URL', exact: true }).fill(new URL(fixturePath, page.url()).href);
        await block.getByRole('button', { name: 'Apply URL', exact: true }).click();
        await readyPreview(block);
        expect(pageErrors).toEqual([]);
    });
}


test('a real cross-origin server without CORS permission shows an error and recovers', async ({ page }) => {
    const recording = await readFile(new URL('../fixtures/hello.cast', import.meta.url));
    const server = createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end(recording);
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    try {
        await openEditor(page);
        const id = await insertPlayer(page);
        const block = playerBlock(page, id);
        const address = server.address();
        const crossOriginSource = `http://127.0.0.1:${address.port}/hello.cast`;
        await block.getByRole('textbox', { name: 'Recording URL', exact: true }).fill(crossOriginSource);
        await block.getByRole('button', { name: 'Apply URL', exact: true }).click();
        await expect(block.locator('.asciiplayer-editor__preview')).toHaveAttribute('data-preview-status', 'error');
        await expect(block).toContainText('CORS permissions');
        await block.getByRole('textbox', { name: 'Recording URL', exact: true }).fill(new URL(fixturePath, page.url()).href);
        await block.getByRole('button', { name: 'Apply URL', exact: true }).click();
        await readyPreview(block);
    } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
});

test('a saved Recording URL loads once without a click and never autoplays in the editor', async ({ page }) => {
    await openEditor(page);
    const source = new URL(`${fixturePath}?automatic=saved`, page.url()).href;
    const recording = await readFile(new URL('../fixtures/hello.cast', import.meta.url));
    const requests = [];
    await page.route(source, async (route) => {
        requests.push(route.request().url());
        await route.fulfill({ contentType: 'text/plain', body: recording });
    });
    const id = await insertPlayer(page, { source, autoPlay: true, preload: false });
    const block = playerBlock(page, id);
    await readyPreview(block);
    await expect(block.getByRole('button', { name: 'Load preview', exact: true })).toHaveCount(0);
    await expect(block.locator('.ap-overlay-start .ap-play-button')).toBeVisible();
    await expect(block.locator('.asciiplayer-editor__privacy')).toHaveCount(0);
    await expect(block.locator(':scope > .asciiplayer-editor__hint')).toHaveCount(0);
    await expect(block.getByRole('textbox', { name: 'Recording URL', exact: true })).toBeVisible();
    await expect(block.getByRole('button', { name: 'Choose recording', exact: true })).toBeVisible();
    await expect(block.locator('figcaption[contenteditable="true"]')).toBeVisible();
    await page.evaluate(() => window.wp.data.dispatch('core/edit-post').openGeneralSidebar('edit-post/block'));
    const helpToggle = page.locator('.components-panel__body-toggle').filter({ hasText: /^Help$/ });
    await expect(helpToggle).toHaveAttribute('aria-expanded', 'false');
    await helpToggle.click();
    const help = page.locator('.components-panel__body').filter({ has: helpToggle });
    await expect(help.locator('.asciiplayer-editor__privacy')).toContainText(/automatic/i);
    await expect(help.locator('.asciiplayer-editor__privacy')).toContainText(/server/i);
    await expect(help).toContainText('Use the player controls to play, pause, and seek.');
    await helpToggle.click();
    await expect(helpToggle).toHaveAttribute('aria-expanded', 'false');
    await page.waitForTimeout(750); // Catch a second fetch from a pending debounce.
    expect(requests).toEqual([source]);
    await expect(block.locator('.ap-overlay-start .ap-play-button')).toBeVisible();
});

test('rapid URL edits debounce to one recording fetch and Apply cancels its pending debounce', async ({ page }) => {
    await openEditor(page);
    const prefix = new URL(`${fixturePath}?automatic=`, page.url()).href;
    const recording = await readFile(new URL('../fixtures/hello.cast', import.meta.url));
    const requests = [];
    await page.route(`${prefix}*`, async (route) => {
        requests.push(route.request().url());
        await route.fulfill({ contentType: 'text/plain', body: recording });
    });
    const id = await insertPlayer(page);
    const block = playerBlock(page, id);
    const input = block.getByRole('textbox', { name: 'Recording URL', exact: true });
    await input.fill(`${prefix}first`);
    await input.fill(`${prefix}second`);
    await input.fill(`${prefix}final`);
    await readyPreview(block);
    await page.waitForTimeout(750);
    expect(requests).toEqual([`${prefix}final`]);
    await expect.poll(() => page.evaluate((clientId) =>
        window.wp.data.select('core/block-editor').getBlockAttributes(clientId).source, id
    )).toBe(`${prefix}final`);
    await input.fill(`${prefix}applied`);
    await block.getByRole('button', { name: 'Apply URL', exact: true }).click();
    await expect.poll(() => requests).toEqual([`${prefix}final`, `${prefix}applied`]);
    await readyPreview(block);
    await page.waitForTimeout(750);
    expect(requests).toEqual([`${prefix}final`, `${prefix}applied`]);
});

test('replacing a pending recording ignores its stale response', async ({ page }) => {
    await openEditor(page);
    const source = new URL(`${fixturePath}?automatic=stale`, page.url()).href;
    const latest = new URL(`${fixturePath}?automatic=latest`, page.url()).href;
    const recording = await readFile(new URL('../fixtures/hello.cast', import.meta.url), 'utf8');
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    let oldRequested = false;
    let oldResponseSettled = false;
    await page.route(source, async (route) => {
        oldRequested = true;
        await pending;
        // Aborting a replaced player may cancel this intercepted request. Both
        // cancellation and safely ignoring a late response are valid outcomes.
        await route.fulfill({ contentType: 'text/plain', body: recording.replace('"width":64', '"width":120') }).catch(() => {});
        oldResponseSettled = true;
    });
    await page.route(latest, (route) => route.fulfill({ contentType: 'text/plain', body: recording }));
    try {
        const id = await insertPlayer(page, { source });
        const block = playerBlock(page, id);
        await expect.poll(() => oldRequested).toBe(true);
        await block.getByRole('textbox', { name: 'Recording URL', exact: true }).fill(latest);
        await expect.poll(() => page.evaluate((clientId) =>
            window.wp.data.select('core/block-editor').getBlockAttributes(clientId).source, id
        )).toBe(latest);
        await readyPreview(block);
        await page.evaluate(() => window.wp.data.dispatch('core/edit-post').openGeneralSidebar('edit-post/block'));
        const columns = page.getByRole('spinbutton', { name: 'Columns', exact: true });
        const rows = page.getByRole('spinbutton', { name: 'Rows', exact: true });
        if (!await columns.isVisible()) {
            await page.locator('.components-panel__body-toggle').filter({ hasText: /^Terminal size$/ }).click();
        }
        await expect(columns).toHaveAttribute('placeholder', '64');
        await expect(rows).toHaveAttribute('placeholder', '12');
        release();
        await expect.poll(() => oldResponseSettled).toBe(true);
        await page.waitForTimeout(750);
        await readyPreview(block);
        await expect.poll(() => block.locator('.ap-term').evaluate((terminal) =>
            Number(terminal.style.getPropertyValue('--term-cols'))
        )).toBe(64);
        // A late header from the old 120-column cast must not become a hint.
        await expect(columns).toHaveAttribute('placeholder', '64');
        await expect(rows).toHaveAttribute('placeholder', '12');
        await expect(columns).toHaveValue('');
        await expect(rows).toHaveValue('');
        await expect(block.getByRole('textbox', { name: 'Recording URL', exact: true })).toHaveValue(latest);
    } finally {
        release();
    }
});

test('automatic preview errors retry the unchanged URL through Retry preview and Apply URL', async ({ page }) => {
    await openEditor(page);
    const source = new URL(`${fixturePath}?automatic=retry`, page.url()).href;
    const recording = await readFile(new URL('../fixtures/hello.cast', import.meta.url));
    let requests = 0;
    await page.route(source, async (route) => {
        requests += 1;
        await route.fulfill(requests < 3
            ? { status: 503, contentType: 'text/plain', body: 'Temporarily unavailable' }
            : { contentType: 'text/plain', body: recording });
    });
    const id = await insertPlayer(page, { source });
    const block = playerBlock(page, id);
    const preview = block.locator('.asciiplayer-editor__preview');
    await expect(preview).toHaveAttribute('data-preview-status', 'error');
    expect(requests).toBe(1);
    await block.getByRole('button', { name: 'Retry preview', exact: true }).click();
    await expect.poll(() => requests).toBe(2);
    await expect(preview).toHaveAttribute('data-preview-status', 'error');
    await block.getByRole('button', { name: 'Apply URL', exact: true }).click();
    await readyPreview(block);
    await page.waitForTimeout(750);
    expect(requests).toBe(3);
});

test('empty and invalid sources never create a preview or fetch a recording', async ({ page }) => {
    await openEditor(page);
    const requests = [];
    page.on('request', (request) => {
        if (/\.cast(?:[?#]|$)|asciinema\.org|jsdelivr\.net/.test(request.url())) requests.push(request.url());
    });
    const emptyId = await insertPlayer(page);
    const empty = playerBlock(page, emptyId);
    const invalidId = await insertPlayer(page, { source: 'javascript:alert(1)' });
    const invalid = playerBlock(page, invalidId);
    await expect(empty.getByRole('textbox', { name: 'Recording URL', exact: true })).toHaveValue('');
    await expect(invalid.getByRole('textbox', { name: 'Recording URL', exact: true })).toHaveValue('javascript:alert(1)');
    await page.waitForTimeout(750);
    await expect(empty.locator('.asciiplayer-editor__preview')).toHaveCount(0);
    await expect(invalid.locator('.asciiplayer-editor__preview')).toHaveCount(0);
    const input = empty.getByRole('textbox', { name: 'Recording URL', exact: true });
    await input.fill(new URL(fixturePath, page.url()).href);
    await input.fill('');
    await page.waitForTimeout(750);
    await expect(empty.locator('.asciiplayer-editor__preview')).toHaveCount(0);
    await input.fill('https://');
    await page.waitForTimeout(750);
    await expect(empty.locator('.asciiplayer-editor__preview')).toHaveCount(0);
    expect(requests).toEqual([]);
});

test('external source changes and undo clear an invalid draft error and restore the valid preview', async ({ page }) => {
    await openEditor(page);
    const original = new URL(`${fixturePath}?automatic=undo-original`, page.url()).href;
    const replacement = new URL(`${fixturePath}?automatic=undo-replacement`, page.url()).href;
    const id = await insertPlayer(page, { source: original });
    const block = playerBlock(page, id);
    const input = block.getByRole('textbox', { name: 'Recording URL', exact: true });
    const validation = block.locator('.asciiplayer-editor__source .components-notice');
    await readyPreview(block);
    // Save a baseline so Undo below targets the external source replacement,
    // rather than an insertion or another edit batched into the same history.
    await publish(page, 'Automatic preview source synchronization regression');
    await input.fill('https://');
    await expect(validation).toContainText('Enter an HTTP(S) recording URL');
    await expect(block.locator('.asciiplayer-editor__preview')).toHaveCount(0);
    await page.evaluate(({ clientId, source }) =>
        window.wp.data.dispatch('core/block-editor').updateBlockAttributes(clientId, { source }),
    { clientId: id, source: replacement });
    await expect(input).toHaveValue(replacement);
    await readyPreview(block);
    await expect(validation).toHaveCount(0);
    // An invalid local draft does not change the saved source or undo history.
    await input.fill('javascript:alert(1)');
    await expect(validation).toContainText('Enter an HTTP(S) recording URL');
    await expect(block.locator('.asciiplayer-editor__preview')).toHaveCount(0);
    await page.evaluate(() => window.wp.data.dispatch('core/editor').undo());
    await expect(input).toHaveValue(original);
    await readyPreview(block);
    await expect(validation).toHaveCount(0);
    await page.waitForTimeout(750); // A canceled invalid-draft timer cannot reappear.
    await expect(validation).toHaveCount(0);
    await expect.poll(() => page.evaluate((clientId) =>
        window.wp.data.select('core/block-editor').getBlockAttributes(clientId).source, id
    )).toBe(original);
});
