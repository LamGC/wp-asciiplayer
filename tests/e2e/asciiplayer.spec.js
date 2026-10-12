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

async function loadPreview(block) {
    await expect(block).toBeVisible();
    const load = block.getByRole('button', { name: 'Load preview', exact: true });
    if (await load.count()) await load.click();
    await readyPreview(block);
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
    await loadPreview(playerBlock(page, duplicateId));
    await expect(canvas(page).locator('.asciiplayer-editor__player .ap-wrapper')).toHaveCount(2);
    await page.evaluate((clientId) => window.wp.data.dispatch('core/block-editor').removeBlocks([clientId]), duplicateId);
    await expect(canvas(page).locator('.asciiplayer-editor__player .ap-wrapper')).toHaveCount(1);
    await page.evaluate(() => window.wp.data.dispatch('core/editor').undo());
    await loadPreview(playerBlock(page, duplicateId));
    await expect(canvas(page).locator('.asciiplayer-editor__player .ap-wrapper')).toHaveCount(2);
    await page.evaluate((clientId) => window.wp.data.dispatch('core/block-editor').removeBlocks([clientId]), duplicateId);

    const saved = await publish(page, 'Inline preview lifecycle integration');
    await screenshot(page, testInfo, 'real-wordpress-editor');
    await page.reload();
    await page.waitForFunction(() => window.wp?.data?.select('core/block-editor')?.getBlocks().length > 0);
    const reloaded = await page.evaluate(() => window.wp.data.select('core/block-editor').getBlocks().find((entry) => entry.name === 'lamgc/asciiplayer'));
    expect(reloaded.name).toBe(blockName);
    expect(reloaded.attributes).toMatchObject({ source, speed: 1.5, theme: 'solarized-dark' });
    await loadPreview(playerBlock(page, reloaded.clientId));

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
    await loadPreview(playerBlock(page, id));
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
