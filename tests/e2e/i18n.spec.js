import { test as base, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const blockName = 'lamgc/asciiplayer';
const fixturePath = '/wp-content/uploads/asciiplayer-fixtures';
const copy = {
    en_US: {
        title: 'Asciicast Player', source: 'Recording URL', apply: 'Apply URL',
        choose: 'Choose recording', dimensions: 'Terminal size', columns: 'Columns', rows: 'Rows',
        help: 'Help', retry: 'Retry preview', caption: 'Add a caption…',
        previewError: 'Unable to load the recording. Check the URL, file format, and the source server’s CORS permissions.',
        frontendError: 'Unable to load this terminal recording. The file may be unavailable, invalid, or blocked by the source server’s CORS policy.',
        uploadError: 'Upload a valid Asciicast v2/v3 JSONL or pretty-printed v1 .cast recording (up to 32 MiB; v1 up to 2 MiB, 100,000 events, 256 KiB per JSONL line, and 1,000 columns or rows).',
    },
    zh_CN: {
        title: 'Asciicast 播放器', source: '录制文件 URL', apply: '应用 URL',
        choose: '选择录制文件', dimensions: '终端尺寸', columns: '列数', rows: '行数',
        help: '帮助', retry: '重试预览', caption: '添加说明文字…',
        previewError: '无法加载录制文件。请检查 URL、文件格式及来源服务器的跨域请求（CORS）权限。',
        frontendError: '无法加载此终端录屏。文件可能无法访问、格式无效，或被来源服务器的跨域请求（CORS）策略阻止。',
        uploadError: '请上传有效的 Asciicast v2/v3 JSONL 或格式化的 v1 .cast 录制文件（最大 32 MiB；v1 最大 2 MiB；最多 100,000 个事件；每行 JSONL最大 256 KiB；列数和行数均不超过 1,000）。',
    },
};

async function login(page) {
    await page.goto('/wp-login.php');
    await page.locator('#user_login').fill(process.env.WP_USERNAME || 'admin');
    await page.locator('#user_pass').fill(process.env.WP_PASSWORD || 'password');
    await page.locator('#wp-submit').click();
    await expect(page).toHaveURL(/\/wp-admin\//);
}

async function openEditor(page) {
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

// Change actual WordPress settings, never navigator.language or wp.i18n mocks.
// Keep an authenticated control page alive so cleanup also works if a test
// finishes on the public site or fails during a player/media interaction.
const test = base.extend({
    localeSession: async ({ context }, use) => {
        const control = await context.newPage();
        await login(control);
        await control.goto('/wp-admin/profile.php');
        const language = control.locator('#locale');
        await expect(language, 'Install the zh_CN core language pack before this suite.').toBeVisible();
        await expect(language.locator('option[value="zh_CN"]')).toHaveCount(1);
        const selectedUserLocale = await language.inputValue();
        const originalUserLocale = selectedUserLocale === 'site-default' ? '' : selectedUserLocale;
        await openEditor(control);
        const originalSiteLocale = await control.evaluate(async () =>
            (await window.wp.apiFetch({ path: '/wp/v2/settings' })).language
        );
        const setLocales = async (siteLocale, userLocale) => control.evaluate(async ({ site, user }) => {
            const settings = await window.wp.apiFetch({ path: '/wp/v2/settings', method: 'POST', data: { language: site } });
            const currentUser = await window.wp.apiFetch({ path: '/wp/v2/users/me', method: 'POST', data: { locale: user } });
            return { site: settings.language || 'en_US', user: currentUser.locale };
        }, { site: siteLocale, user: userLocale });
        try {
            await use({ setLocales, control });
        } finally {
            await setLocales(originalSiteLocale, originalUserLocale);
            await control.close();
        }
    },
});

async function insertPlayer(page) {
    const id = await page.evaluate((name) => {
        const block = window.wp.blocks.createBlock(name, { controls: 'always' });
        window.wp.data.dispatch('core/block-editor').insertBlocks(block);
        window.wp.data.dispatch('core/block-editor').selectBlock(block.clientId);
        return block.clientId;
    }, blockName);
    return page.frameLocator('iframe[name="editor-canvas"]').locator(`[data-block="${id}"]`);
}

async function assertTranslatedError(locator, locale, kind) {
    // Expected strings are independent literals, never read from the loaded
    // catalog: a missing translation must fail instead of defining expectations.
    await expect(locator).toHaveText(copy[locale][kind]);
}

async function rejectInvalidUpload(page, block, locale, testInfo) {
    await block.getByRole('button', { name: copy[locale].choose, exact: true }).click();
    const dialog = page.locator('.media-modal[role="dialog"]');
    await expect(dialog).toBeVisible();
    await dialog.locator('#menu-item-upload').click();
    const input = page.locator('.moxie-shim input[type="file"]').last();
    await expect(input).toBeAttached();
    const response = page.waitForResponse((result) =>
        /\/wp-admin\/async-upload\.php(?:\?|$)/.test(result.url()) && result.request().method() === 'POST'
    );
    await input.setInputFiles({
        name: `asciiplayer-locale-invalid-${Date.now()}-${testInfo.retry}.cast`,
        mimeType: 'application/x-asciicast',
        buffer: await readFile(new URL('../fixtures/malformed.cast', import.meta.url)),
    });
    const result = await (await response).json();
    expect(result.success, JSON.stringify(result)).toBe(false);
    expect(result.data.message).toBe(copy[locale].uploadError);
    await expect(dialog).toContainText(result.data.message);
    await expect(dialog.locator('.media-button-select')).toBeDisabled();
    await dialog.locator('.media-modal-close').click();
}

async function verifyFrontend(page, url, locale) {
    await page.goto(url);
    await expect(page.locator('html')).toHaveAttribute('lang', locale.replace('_', '-'));
    const players = page.locator('.asciiplayer-container');
    await expect(players).toHaveCount(3);
    await assertTranslatedError(players.nth(1).locator('.asciiplayer-error'), locale, 'frontendError');
    for (const index of [0, 2]) {
        const player = players.nth(index);
        await expect(player.locator('.ap-wrapper')).toBeVisible();
        await player.locator('.ap-overlay-start .ap-play-button').click();
        await expect(player.locator('.ap-term-text')).toContainText('Hello from wp-asciiplayer');
    }
    await expect(page.locator('.asciiplayer-figure figcaption')).toHaveText('Author caption / 作者说明');
}

test.describe('@i18n real WordPress site and user locales', () => {
    // Locale is site-global. The repository config has one worker; do not run
    // these cases concurrently against a shared WordPress database.
    test.describe.configure({ mode: 'default' });
    for (const [siteLocale, userLocale] of [
        ['en_US', 'en_US'], ['zh_CN', 'zh_CN'],
        ['zh_CN', 'en_US'], ['en_US', 'zh_CN'],
    ]) {
        test(`site ${siteLocale}, user ${userLocale}: editor, PHP upload and public player`, async ({ page, browser, localeSession }, testInfo) => {
            test.setTimeout(150_000);
            const locales = await localeSession.setLocales(siteLocale, userLocale);
            expect(locales).toEqual({ site: siteLocale, user: userLocale });
            const ui = copy[userLocale];
            const pageErrors = [];
            page.on('pageerror', (error) => pageErrors.push(error.message));
            await openEditor(page);
            await expect(page.locator('html')).toHaveAttribute('lang', userLocale.replace('_', '-'));
            expect(await page.evaluate((name) => window.wp.blocks.getBlockType(name).title, blockName)).toBe(ui.title);
            const block = await insertPlayer(page);
            const source = block.getByRole('textbox', { name: ui.source, exact: true });
            await expect(source).toBeVisible();
            await expect(block.getByRole('button', { name: ui.apply, exact: true })).toBeVisible();
            await expect(block.getByRole('button', { name: ui.choose, exact: true })).toBeVisible();
            await expect(block.locator('figcaption[contenteditable="true"]')).toHaveAttribute('data-placeholder', ui.caption);

            await page.evaluate(() => window.wp.data.dispatch('core/edit-post').openGeneralSidebar('edit-post/block'));
            await page.locator('.components-panel__body-toggle').filter({ hasText: new RegExp(`^${ui.dimensions}$`) }).click();
            await expect(page.getByRole('spinbutton', { name: ui.columns, exact: true })).toBeVisible();
            await expect(page.getByRole('spinbutton', { name: ui.rows, exact: true })).toBeVisible();
            await expect(page.locator('.components-panel__body-toggle').filter({ hasText: new RegExp(`^${ui.help}$`) })).toBeVisible();

            const valid = new URL(`${fixturePath}/hello.cast`, page.url()).href;
            const missing = new URL(`${fixturePath}/missing-i18n.cast`, page.url()).href;
            await source.fill(missing);
            await block.getByRole('button', { name: ui.apply, exact: true }).click();
            await expect(block.locator('.asciiplayer-editor__preview')).toHaveAttribute('data-preview-status', 'error');
            await assertTranslatedError(block.locator('.components-notice__content > p'), userLocale, 'previewError');
            await expect(block.getByRole('button', { name: ui.retry, exact: true })).toBeVisible();
            await source.fill(valid);
            await block.getByRole('button', { name: ui.apply, exact: true }).click();
            await expect(block.locator('.asciiplayer-editor__preview')).toHaveAttribute('data-preview-status', 'ready');
            await block.locator('.ap-overlay-start .ap-play-button').click();
            await expect(block.locator('.ap-term-text')).toContainText('Hello from wp-asciiplayer');
            // Upstream 3.17.0 has no localization API. Its unmodified controls
            // deliberately retain their English accessibility labels in both locales.
            await expect(block.locator('.ap-playback-button')).toHaveAttribute('aria-label', 'Pause');
            await block.locator('.ap-playback-button').click();
            await expect(block.locator('.ap-playback-button')).toHaveAttribute('aria-label', 'Play');
            await rejectInvalidUpload(page, block, userLocale, testInfo);

            const editorShot = testInfo.outputPath(`editor-${siteLocale}-${userLocale}.png`);
            await page.screenshot({ path: editorShot, fullPage: true });
            await testInfo.attach('editor-locale', { path: editorShot, contentType: 'image/png' });
            const saved = await page.evaluate(async ({ name, good, bad }) => {
                const blockContent = window.wp.blocks.serialize(window.wp.blocks.createBlock(name, {
                    source: good, controls: 'always', preload: true, caption: 'Author caption / 作者说明',
                }));
                return window.wp.apiFetch({ path: '/wp/v2/posts', method: 'POST', data: {
                    title: `Asciiplayer locale integration ${Date.now()}`, status: 'publish',
                    content: `${blockContent}\n[asciiplayer preload="true"]${bad}[/asciiplayer]\n[asciiplayer preload="true"]${good}[/asciiplayer]`,
                } });
            }, { name: blockName, good: valid, bad: missing });
            // A logged-in user's language must not leak into public frontend JS.
            await verifyFrontend(page, saved.link, siteLocale);
            const anonymous = await browser.newContext();
            try {
                const visitor = await anonymous.newPage();
                visitor.on('pageerror', (error) => pageErrors.push(error.message));
                await verifyFrontend(visitor, saved.link, siteLocale);
                const frontendShot = testInfo.outputPath(`frontend-${siteLocale}-${userLocale}.png`);
                await visitor.screenshot({ path: frontendShot, fullPage: true });
                await testInfo.attach('frontend-locale', { path: frontendShot, contentType: 'image/png' });
            } finally {
                await anonymous.close();
            }
            expect(pageErrors).toEqual([]);
        });
    }

    test('a user with the site default language inherits zh_CN in the editor', async ({ page, localeSession }) => {
        expect(await localeSession.setLocales('zh_CN', '')).toEqual({ site: 'zh_CN', user: 'zh_CN' });
        await openEditor(page);
        expect(await page.evaluate((name) => window.wp.blocks.getBlockType(name).title, blockName)).toBe(copy.zh_CN.title);
        const block = await insertPlayer(page);
        await expect(block.getByRole('textbox', { name: copy.zh_CN.source, exact: true })).toBeVisible();
    });
});
