import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const blockName = 'lamgc/asciiplayer';
const fixtures = '/wp-content/uploads/asciiplayer-fixtures';

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

function playerBlock(page, id) {
    return page.frameLocator('iframe[name="editor-canvas"]').locator(`[data-block="${id}"]`);
}

async function insertPlayer(page, attributes = {}) {
    const id = await page.evaluate(({ name, attrs }) => {
        const block = window.wp.blocks.createBlock(name, attrs);
        window.wp.data.dispatch('core/block-editor').insertBlocks(block);
        window.wp.data.dispatch('core/block-editor').selectBlock(block.clientId);
        return block.clientId;
    }, { name: blockName, attrs: attributes });
    return { id, block: playerBlock(page, id) };
}

async function attributes(page, id) {
    return page.evaluate((clientId) => window.wp.data.select('core/block-editor').getBlockAttributes(clientId), id);
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

async function openDimensions(page) {
    await page.evaluate(() => window.wp.data.dispatch('core/edit-post').openGeneralSidebar('edit-post/block'));
    const columns = page.getByRole('spinbutton', { name: 'Columns', exact: true });
    const rows = page.getByRole('spinbutton', { name: 'Rows', exact: true });
    if (!await columns.isVisible()) {
        await page.locator('.components-panel__body-toggle').filter({ hasText: /^Terminal size$/ }).click();
    }
    await expect(columns).toBeVisible();
    return { columns, rows };
}

async function expectNativeSize(controls, cols, rows) {
    await expect(controls.columns).toHaveAttribute('placeholder', cols === undefined ? 'From recording' : String(cols));
    await expect(controls.rows).toHaveAttribute('placeholder', rows === undefined ? 'From recording' : String(rows));
}

async function openMedia(page, block) {
    await block.getByRole('button', { name: 'Choose recording', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose an Asciicast recording', exact: true });
    await expect(dialog).toBeVisible();
    return dialog;
}

async function uploadRecording(page, dialog, name, buffer) {
    await dialog.getByRole('tab', { name: 'Upload files', exact: true }).click();
    // Native WP media uses Plupload. Its file input is intentionally hidden and
    // may live outside the modal; setInputFiles exercises the actual uploader.
    const input = page.locator('.moxie-shim input[type="file"]').last();
    await expect(input).toBeAttached();
    const response = page.waitForResponse((result) =>
        /\/wp-admin\/async-upload\.php(?:\?|$)/.test(result.url()) && result.request().method() === 'POST'
    );
    await input.setInputFiles({ name, mimeType: 'application/x-asciicast', buffer });
    return (await response).json();
}

async function selectAttachment(dialog, id) {
    await dialog.getByRole('tab', { name: 'Media Library', exact: true }).click();
    const attachment = dialog.locator(`.attachment[data-id="${id}"]`);
    await expect(attachment).toBeVisible();
    // Newly uploaded files are already selected; clicking them again deselects.
    if (!await attachment.evaluate((element) => element.classList.contains('selected'))) await attachment.click();
    const confirm = dialog.locator('.media-button-select');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toBeHidden();
}

test('recording metadata follows URL changes, clears while loading or invalid, and never replaces explicit dimensions', async ({ page }) => {
    await openEditor(page);
    const original = new URL(`${fixtures}/hello.cast`, page.url()).href;
    const replacement = new URL(`${fixtures}/replacement.cast?metadata=delayed`, page.url()).href;
    const unavailable = new URL(`${fixtures}/missing.cast?metadata=error`, page.url()).href;
    const malformed = new URL(`${fixtures}/malformed.cast?metadata=valid-header`, page.url()).href;
    const recording = await readFile(new URL('../fixtures/replacement.cast', import.meta.url));
    let release;
    let requested = false;
    const pending = new Promise((resolve) => { release = resolve; });
    await page.route(replacement, async (route) => {
        requested = true;
        await pending;
        await route.fulfill({ contentType: 'text/plain', body: recording }).catch(() => {});
    });
    await page.route(unavailable, (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'Unavailable' }));
    await page.route(malformed, (route) => route.fulfill({
        contentType: 'text/plain', body: '{"version":2,"width":101,"height":31}\n[invalid event]\n',
    }));
    try {
        const { id, block } = await insertPlayer(page, { source: original });
        await readyPreview(block);
        const dimensions = await openDimensions(page);
        await expectNativeSize(dimensions, 64, 12);
        await expect(dimensions.columns).toHaveValue('');
        await expect(dimensions.rows).toHaveValue('');
        expect((await attributes(page, id)).cols).toBeUndefined();
        expect((await attributes(page, id)).rows).toBeUndefined();
        await dimensions.columns.fill('80');
        await dimensions.rows.fill('20');
        await dimensions.rows.press('Tab');
        await readyPreview(block);
        await expectGrid(block, 80, 20);
        await expectNativeSize(dimensions, 64, 12);

        const input = block.getByRole('textbox', { name: 'Recording URL', exact: true });
        await input.fill(replacement);
        await expectNativeSize(dimensions);
        await expect.poll(() => requested).toBe(true);
        await expectNativeSize(dimensions);
        await expect(dimensions.columns).toHaveValue('80');
        await expect(dimensions.rows).toHaveValue('20');
        release();
        await readyPreview(block);
        await expectNativeSize(dimensions, 100, 30);
        await expectGrid(block, 80, 20);
        expect(await attributes(page, id)).toMatchObject({ source: replacement, cols: 80, rows: 20 });

        await input.fill('javascript:alert(1)');
        await expect(block.locator('.asciiplayer-editor__preview')).toHaveCount(0);
        await expectNativeSize(dimensions);
        // Invalid drafts do not overwrite the last valid saved URL or overrides.
        expect(await attributes(page, id)).toMatchObject({ source: replacement, cols: 80, rows: 20 });
        await input.fill(original);
        await block.getByRole('button', { name: 'Apply URL', exact: true }).click();
        await readyPreview(block);
        await expectNativeSize(dimensions, 64, 12);
        for (const failingSource of [unavailable, malformed]) {
            await input.fill(failingSource);
            await expect(block.locator('.asciiplayer-editor__preview')).toHaveAttribute('data-preview-status', 'error');
            // Even a readable header must be discarded if the player fails.
            await expectNativeSize(dimensions);
            expect(await attributes(page, id)).toMatchObject({ source: failingSource, cols: 80, rows: 20 });
        }
        await input.fill('');
        await expect.poll(async () => (await attributes(page, id)).source).toBe('');
        await expectNativeSize(dimensions);
        expect(await attributes(page, id)).toMatchObject({ cols: 80, rows: 20 });
    } finally {
        release();
    }
});

test('pretty v1 and commented v3 recordings play with native header dimensions', async ({ page }) => {
    await openEditor(page);
    // Fixtures follow the official formats, including v1's multiline JSON and
    // v3's comments after its single-line header and relative event timestamps:
    // https://docs.asciinema.org/manual/asciicast/v1/
    // https://docs.asciinema.org/manual/asciicast/v3/
    const cases = [
        { filename: 'v1-pretty.cast', cols: 72, rows: 18, output: 'Pretty v1 recording' },
        { filename: 'v3-comments.cast', cols: 92, rows: 22, output: 'Commented v3 recording' },
    ];
    for (const entry of cases) {
        const source = new URL(`${fixtures}/${entry.filename}`, page.url()).href;
        const { id, block } = await insertPlayer(page, { source });
        await readyPreview(block);
        await expectGrid(block, entry.cols, entry.rows);
        const dimensions = await openDimensions(page);
        await expectNativeSize(dimensions, entry.cols, entry.rows);
        await expect(dimensions.columns).toHaveValue('');
        await expect(dimensions.rows).toHaveValue('');
        expect((await attributes(page, id)).cols).toBeUndefined();
        expect((await attributes(page, id)).rows).toBeUndefined();
        await block.locator('.ap-overlay-start .ap-play-button').click();
        await expect(block.locator('.ap-term-text')).toContainText(entry.output);
    }
});

test('native Media Library uploads, selects and replaces a cast while cancel leaves the current recording intact', async ({ page }, testInfo) => {
    await openEditor(page);
    const { id, block } = await insertPlayer(page);
    const firstCast = await readFile(new URL('../fixtures/hello.cast', import.meta.url));
    const secondCast = await readFile(new URL('../fixtures/replacement.cast', import.meta.url));
    const unique = `${Date.now()}-${testInfo.retry}`;
    let dialog = await openMedia(page, block);
    const first = await uploadRecording(page, dialog, `asciiplayer-original-${unique}.cast`, firstCast);
    expect(first.success, JSON.stringify(first)).toBe(true);
    expect(first.data.mime).toBe('application/x-asciicast');
    await selectAttachment(dialog, first.data.id);
    const input = block.getByRole('textbox', { name: 'Recording URL', exact: true });
    await expect(input).toHaveValue(first.data.url);
    // Selecting in the native media frame applies and autoloads, with no Apply URL click.
    await readyPreview(block);
    await expectGrid(block, 64, 12);
    let dimensions = await openDimensions(page);
    await expectNativeSize(dimensions, 64, 12);
    expect(await attributes(page, id)).toMatchObject({ source: first.data.url });
    expect((await attributes(page, id)).cols).toBeUndefined();
    expect((await attributes(page, id)).rows).toBeUndefined();
    await block.locator('.ap-term').evaluate((element) => { element.dataset.mediaIdentity = 'original'; });

    dialog = await openMedia(page, block);
    const second = await uploadRecording(page, dialog, `asciiplayer-replacement-${unique}.cast`, secondCast);
    expect(second.success, JSON.stringify(second)).toBe(true);
    await dialog.locator('.media-modal-close').click();
    await expect(dialog).toBeHidden();
    await expect(input).toHaveValue(first.data.url);
    expect((await attributes(page, id)).source).toBe(first.data.url);
    await expectNativeSize(dimensions, 64, 12);
    await expect(block.locator('.ap-term')).toHaveAttribute('data-media-identity', 'original');

    // The upload above is now an existing media item. Reopen the real frame and
    // select its tile rather than changing block attributes through the store.
    dialog = await openMedia(page, block);
    await selectAttachment(dialog, second.data.id);
    await expect(input).toHaveValue(second.data.url);
    await readyPreview(block);
    await expectGrid(block, 100, 30);
    await expectNativeSize(dimensions, 100, 30);
    await block.locator('.ap-overlay-start .ap-play-button').click();
    await expect(block.locator('.ap-term-text')).toContainText('Replacement recording');
    expect((await attributes(page, id)).source).toBe(second.data.url);
    expect((await attributes(page, id)).cols).toBeUndefined();
    expect((await attributes(page, id)).rows).toBeUndefined();
    const path = testInfo.outputPath('media-library-selected-recording.png');
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach('media-library-selected-recording', { path, contentType: 'image/png' });
    await page.evaluate(async () => {
        const editor = window.wp.data.dispatch('core/editor');
        editor.editPost({ title: 'Native media recording selection regression' });
        await editor.savePost();
        if (window.wp.data.select('core/editor').didPostSaveRequestFail()) throw new Error('WordPress could not save the test post.');
    });
    await page.reload();
    await page.waitForFunction((name) => window.wp?.data?.select('core/block-editor')?.getBlocks().some((entry) => entry.name === name), blockName);
    const reloaded = await page.evaluate((name) => {
        const block = window.wp.data.select('core/block-editor').getBlocks().find((entry) => entry.name === name);
        window.wp.data.dispatch('core/block-editor').selectBlock(block.clientId);
        return block;
    }, blockName);
    expect(reloaded.attributes.source).toBe(second.data.url);
    expect(reloaded.attributes.cols).toBeUndefined();
    expect(reloaded.attributes.rows).toBeUndefined();
    await readyPreview(playerBlock(page, reloaded.clientId));
    dimensions = await openDimensions(page);
    await expectNativeSize(dimensions, 100, 30);
});

test('native Media Library rejects an invalid cast upload without applying a source', async ({ page }, testInfo) => {
    await openEditor(page);
    const { id, block } = await insertPlayer(page);
    const dialog = await openMedia(page, block);
    const malformed = await readFile(new URL('../fixtures/malformed.cast', import.meta.url));
    const result = await uploadRecording(page, dialog, `asciiplayer-invalid-${Date.now()}-${testInfo.retry}.cast`, malformed);
    expect(result.success, JSON.stringify(result)).toBe(false);
    const validationMessage = 'Upload a valid Asciicast v2/v3 JSONL or pretty-printed v1 .cast recording (up to 32 MiB; v1 up to 2 MiB, 100,000 events, 256 KiB per JSONL line, and 1,000 columns or rows).';
    // A filesystem/permission failure is not evidence of content validation.
    expect(result.data.message).toBe(validationMessage);
    await expect(dialog).toContainText(validationMessage);
    await expect(dialog.locator('.media-button-select')).toBeDisabled();
    await dialog.locator('.media-modal-close').click();
    await expect(block.getByRole('textbox', { name: 'Recording URL', exact: true })).toHaveValue('');
    expect((await attributes(page, id)).source).toBe('');
    await expect(block.locator('.asciiplayer-editor__preview')).toHaveCount(0);
});
