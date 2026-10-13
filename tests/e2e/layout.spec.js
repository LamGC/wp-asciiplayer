import { test, expect } from '@playwright/test';

const blockName = 'lamgc/asciiplayer';
const fixturePath = '/wp-content/uploads/asciiplayer-fixtures/hello.cast';

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

async function insertPlayer(page, attributes = {}) {
    const id = await page.evaluate(({ name, attrs }) => {
        const block = window.wp.blocks.createBlock(name, attrs);
        window.wp.data.dispatch('core/block-editor').insertBlocks(block);
        window.wp.data.dispatch('core/block-editor').selectBlock(block.clientId);
        return block.clientId;
    }, { name: blockName, attrs: attributes });
    return { id, block: page.frameLocator('iframe[name="editor-canvas"]').locator(`[data-block="${id}"]`) };
}

async function attributes(page, id) {
    return page.evaluate((clientId) => window.wp.data.select('core/block-editor').getBlockAttributes(clientId), id);
}

async function loadPreview(block) {
    await block.getByRole('button', { name: 'Load preview', exact: true }).click();
    await expect(block.locator('.asciiplayer-editor__preview')).toHaveAttribute('data-preview-status', 'ready');
    await expect(block.locator('.ap-wrapper')).toHaveCount(1);
}

async function openInspectorPanel(page, name, control) {
    await page.evaluate(() => window.wp.data.dispatch('core/edit-post').openGeneralSidebar('edit-post/block'));
    if (!await control.isVisible()) {
        await page.getByRole('button', { name, exact: true }).click();
    }
    await expect(control).toBeVisible();
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

async function grid(container) {
    // These are the live VT dimensions rendered by bundled asciinema-player,
    // not the WordPress attributes or an inferred CSS aspect ratio.
    return container.locator('.ap-term').evaluate((terminal) => ({
        cols: Number(terminal.style.getPropertyValue('--term-cols')),
        rows: Number(terminal.style.getPropertyValue('--term-rows')),
    }));
}

async function expectGrid(container, cols, rows) {
    await expect(container.locator('.ap-term')).toBeVisible();
    await expect.poll(() => grid(container)).toEqual({ cols, rows });
    await expect(container.locator('.ap-term-text > .ap-line')).toHaveCount(rows);
}

async function figureMetrics(figure) {
    return figure.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const parent = element.parentElement;
        const outer = parent.getBoundingClientRect();
        const style = getComputedStyle(parent);
        const left = outer.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
        const right = outer.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
        return {
            width: rect.width,
            available: right - left,
            leftGap: rect.left - left,
            rightGap: right - rect.right,
        };
    });
}

async function expectAlignment(figure, alignment, fraction = 0.5) {
    await expect.poll(async () => {
        const dimensions = await figureMetrics(figure);
        return Math.abs(dimensions.width - dimensions.available * fraction);
    }).toBeLessThan(3);
    await expect.poll(async () => {
        const { leftGap, rightGap } = await figureMetrics(figure);
        return alignment === 'center' ? Math.abs(leftGap - rightGap) : Math.abs(alignment === 'left' ? leftGap : rightGap);
    }).toBeLessThan(3);
}

async function screenshot(page, testInfo, name) {
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('display width, alignment and caption survive editor save/reload without changing the recording grid', async ({ page }, testInfo) => {
    await openEditor(page);
    const source = new URL(fixturePath, page.url()).href;
    const { id, block } = await insertPlayer(page, { source, controls: 'always' });
    await loadPreview(block);
    await expectGrid(block, 64, 12);
    expect((await attributes(page, id)).cols).toBeUndefined();
    expect((await attributes(page, id)).rows).toBeUndefined();
    const figure = block.locator('.asciiplayer-figure');
    const width = page.getByRole('combobox', { name: 'Player width', exact: true });
    await openInspectorPanel(page, 'Display', width);
    // Keep a marker on the actual terminal: display-only changes must neither
    // reconstruct it nor alter rows/columns, so playback position is preserved.
    await block.locator('.ap-term').evaluate((element) => { element.dataset.layoutIdentity = 'unchanged'; });
    await width.selectOption('50%');
    const alignment = page.getByRole('combobox', { name: 'Display alignment', exact: true });
    for (const value of ['left', 'center', 'right']) {
        await alignment.selectOption(value);
        await expectAlignment(figure, value);
        await expectGrid(block, 64, 12);
        await expect(block.locator('.ap-term')).toHaveAttribute('data-layout-identity', 'unchanged');
    }
    await width.selectOption('custom');
    const customWidth = page.getByRole('textbox', { name: 'Custom width', exact: true });
    await customWidth.fill('240px');
    await customWidth.press('Tab');
    await expect.poll(async () => Math.abs((await figure.boundingBox()).width - 240)).toBeLessThan(2);
    await customWidth.fill('calc(100% - 20px)');
    await customWidth.press('Tab');
    await expect(customWidth).toHaveAttribute('aria-invalid', 'true');
    expect((await attributes(page, id)).width).toBe('240px');
    await width.selectOption('50%');
    const caption = figure.locator('figcaption[contenteditable="true"]');
    await caption.fill('Example terminal session');
    await caption.press('Tab');
    await expect.poll(async () => (await attributes(page, id)).caption).toContain('Example terminal session');
    const saved = await publish(page, 'Player display layout regression');
    await screenshot(page, testInfo, 'layout-editor-desktop');
    await page.reload();
    await page.waitForFunction((name) => window.wp?.data?.select('core/block-editor')?.getBlocks().some((block) => block.name === name), blockName);
    const reloaded = await page.evaluate((name) => window.wp.data.select('core/block-editor').getBlocks().find((block) => block.name === name), blockName);
    expect(reloaded.attributes).toMatchObject({ source, width: '50%', displayAlign: 'right', caption: 'Example terminal session' });
    expect(reloaded.attributes.cols).toBeUndefined();
    expect(reloaded.attributes.rows).toBeUndefined();
    const reloadedBlock = page.frameLocator('iframe[name="editor-canvas"]').locator(`[data-block="${reloaded.clientId}"]`);
    await loadPreview(reloadedBlock);
    await expectGrid(reloadedBlock, 64, 12);
    await expectAlignment(reloadedBlock.locator('.asciiplayer-figure'), 'right');
    await page.setViewportSize({ width: 390, height: 844 });
    await expectGrid(reloadedBlock, 64, 12);
    const editorCanvasWidth = await page.locator('iframe[name="editor-canvas"]').evaluate((element) => element.clientWidth);
    await expect.poll(async () => (await reloadedBlock.locator('.ap-wrapper').boundingBox()).width).toBeLessThanOrEqual(editorCanvasWidth);
    await screenshot(page, testInfo, 'layout-editor-mobile');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(saved.url);
    const frontend = page.locator('.asciiplayer-container');
    const frontendFigure = page.locator('.asciiplayer-figure');
    await expectGrid(frontend, 64, 12);
    await expect(frontendFigure.locator('figcaption')).toHaveText('Example terminal session');
    await expectAlignment(frontendFigure, 'right');
    const options = JSON.parse(await frontend.getAttribute('data-ap-options'));
    expect(options).not.toHaveProperty('cols');
    expect(options).not.toHaveProperty('rows');
    expect(options).not.toHaveProperty('width');
    expect(options).not.toHaveProperty('caption');
    await page.setViewportSize({ width: 390, height: 844 });
    await expectGrid(frontend, 64, 12);
    await expectAlignment(frontendFigure, 'right');
    const bounds = await frontendFigure.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
    await screenshot(page, testInfo, 'layout-frontend-mobile');
});

test('optional columns and rows override the grid and clearing or resetting restores recording metadata', async ({ page }) => {
    await openEditor(page);
    const source = new URL(fixturePath, page.url()).href;
    const { id, block } = await insertPlayer(page, { source });
    await loadPreview(block);
    const columns = page.getByRole('spinbutton', { name: 'Columns', exact: true });
    const rows = page.getByRole('spinbutton', { name: 'Rows', exact: true });
    await openInspectorPanel(page, 'Terminal size', columns);
    await expect(columns).toHaveValue('');
    await expect(rows).toHaveValue('');
    await columns.fill('88');
    await columns.press('Tab');
    await rows.fill('16');
    await rows.press('Tab');
    await expectGrid(block, 88, 16);
    await columns.fill('');
    await columns.press('Tab');
    await expectGrid(block, 64, 16);
    expect((await attributes(page, id)).cols).toBeUndefined();
    await columns.fill('88');
    await columns.press('Tab');
    await expectGrid(block, 88, 16);
    await page.getByRole('button', { name: 'Use recording size', exact: true }).click();
    await expectGrid(block, 64, 12);
    await expect(columns).toHaveValue('');
    await expect(rows).toHaveValue('');
    expect((await attributes(page, id)).cols).toBeUndefined();
    expect((await attributes(page, id)).rows).toBeUndefined();
    const saved = await publish(page, 'Reset terminal dimensions regression');
    await page.goto(saved.url);
    const frontend = page.locator('.asciiplayer-container');
    await expectGrid(frontend, 64, 12);
    const options = JSON.parse(await frontend.getAttribute('data-ap-options'));
    expect(options).not.toHaveProperty('cols');
    expect(options).not.toHaveProperty('rows');
});

test('recorded resize events remain authoritative except on explicitly overridden axes', async ({ page }) => {
    await openEditor(page);
    const source = new URL('/wp-content/uploads/asciiplayer-fixtures/resize.cast', page.url()).href;
    const cases = [
        { overrides: {}, cols: 96, rows: 18 },
        { overrides: { cols: 80 }, cols: 80, rows: 18 },
        { overrides: { rows: 24 }, cols: 96, rows: 24 },
        { overrides: { cols: 80, rows: 24 }, cols: 80, rows: 24 },
    ];
    for (const entry of cases) {
        const { block } = await insertPlayer(page, { source, startAt: 2, ...entry.overrides });
        await loadPreview(block);
        await expectGrid(block, entry.overrides.cols ?? 64, entry.overrides.rows ?? 12);
        await block.locator('.ap-overlay-start .ap-play-button').click();
        await expectGrid(block, entry.cols, entry.rows);
    }
    const saved = await publish(page, 'Recording resize and explicit axes regression');
    await page.goto(saved.url);
    const players = page.locator('.asciiplayer-container');
    await expect(players).toHaveCount(cases.length);
    for (const [index, entry] of cases.entries()) {
        await expectGrid(players.nth(index), entry.overrides.cols ?? 64, entry.overrides.rows ?? 12);
        await players.nth(index).locator('.ap-overlay-start .ap-play-button').click();
        await expectGrid(players.nth(index), entry.cols, entry.rows);
        await expect(players.nth(index).locator('.ap-term-text')).toContainText('Resized recording grid');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [index, entry] of cases.entries()) await expectGrid(players.nth(index), entry.cols, entry.rows);
});

test('published figures preserve all alignments, safe captions and terminal typography under theme CSS', async ({ page }, testInfo) => {
    await openEditor(page);
    const source = new URL(fixturePath, page.url()).href;
    const caption = 'Safe caption<br>with a second line &amp; literal text';
    for (const displayAlign of ['left', 'center', 'right']) {
        await insertPlayer(page, { source, width: '50%', displayAlign, caption });
    }
    // Raw block attributes can come from REST/imported post content, bypassing
    // RichText's editor filtering. The server must sanitize them independently.
    await insertPlayer(page, {
        source,
        caption: '<script>window.__captionXss = true</script><img src="x" onerror="window.__captionXss = true"><a href="javascript:window.__captionXss=true">unsafe link</a><strong>Still safe</strong>',
    });
    const saved = await publish(page, 'Frontend figure and caption sanitization regression');
    await page.addInitScript((content) => {
        const install = () => {
            if (!document.documentElement) return false;
            const stylesheet = document.createElement('style');
            stylesheet.textContent = content;
            document.documentElement.appendChild(stylesheet);
            return true;
        };
        if (!install()) {
            const observer = new MutationObserver(() => { if (install()) observer.disconnect(); });
            observer.observe(document, { childList: true, subtree: true });
        }
    }, `
        body { letter-spacing: 1.5px; line-height: 2; text-align: center; }
        figure { margin: 2em 40px; }
        pre { padding: 24px !important; margin: 24px !important; font-family: serif !important; font-size: 24px !important; line-height: 2 !important; white-space: pre-wrap !important; border: 2px solid red !important; box-shadow: 0 0 0 3px red !important; }
        pre span { font-family: serif !important; font-size: 24px !important; line-height: 2 !important; letter-spacing: 2px !important; }
        button { border: 2px solid red !important; box-shadow: 0 0 0 3px red !important; }
    `);
    await page.goto(saved.url);
    const figures = page.locator('.asciiplayer-figure');
    const desktopFontSizes = [];
    await expect(figures).toHaveCount(4);
    for (const [index, displayAlign] of ['left', 'center', 'right'].entries()) {
        const figure = figures.nth(index);
        await expectAlignment(figure, displayAlign);
        await expectGrid(figure, 64, 12);
        await figure.locator('.ap-overlay-start .ap-play-button').click();
        await expect(figure.locator('.ap-term-text')).toContainText('Hello from wp-asciiplayer');
        await expect(figure.locator('figcaption')).toHaveText('Safe captionwith a second line & literal text');
        await expect(figure.locator('figcaption br')).toHaveCount(1);
        const typography = await figure.locator('.ap-term-text').evaluate((element) => {
            const style = getComputedStyle(element);
            const parent = getComputedStyle(element.parentElement);
            return {
                padding: style.padding,
                margin: style.margin,
                whiteSpace: style.whiteSpace,
                borderWidth: style.borderWidth,
                boxShadow: style.boxShadow,
                familyMatches: style.fontFamily === parent.fontFamily,
                fontSizeMatches: style.fontSize === parent.fontSize,
                textAlign: style.textAlign,
            };
        });
        expect(typography).toEqual({ padding: '0px', margin: '0px', whiteSpace: 'pre', borderWidth: '0px', boxShadow: 'none', familyMatches: true, fontSizeMatches: true, textAlign: 'left' });
        desktopFontSizes.push(await figure.locator('.ap-term').evaluate((element) => parseFloat(getComputedStyle(element).fontSize)));
        const rowTypography = await figure.locator('.ap-term-text .ap-line').first().evaluate((element) => {
            const style = getComputedStyle(element);
            const terminal = getComputedStyle(element.closest('.ap-term'));
            return { fontSizeMatches: style.fontSize === terminal.fontSize, familyMatches: style.fontFamily === terminal.fontFamily };
        });
        expect(rowTypography).toEqual({ fontSizeMatches: true, familyMatches: true });
        const spanTypography = await figure.locator('.ap-term-text .ap-line span').first().evaluate((element) => {
            const style = getComputedStyle(element);
            const terminal = getComputedStyle(element.closest('.ap-term'));
            return { fontSizeMatches: style.fontSize === terminal.fontSize, familyMatches: style.fontFamily === terminal.fontFamily, letterSpacing: style.letterSpacing };
        });
        expect(spanTypography).toEqual({ fontSizeMatches: true, familyMatches: true, letterSpacing: 'normal' });
        const controls = await figure.locator('.ap-control-bar button.ap-button').first().evaluate((element) => {
            const style = getComputedStyle(element);
            return { borderWidth: style.borderWidth, boxShadow: style.boxShadow };
        });
        expect(controls).toEqual({ borderWidth: '0px', boxShadow: 'none' });
    }
    const unsafeCaption = figures.nth(3).locator('figcaption');
    await expect(unsafeCaption).toContainText('Still safe');
    await expect(unsafeCaption.locator('script, img, iframe, a, strong, [onerror], [onclick]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__captionXss)).toBeUndefined();
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [index, displayAlign] of ['left', 'center', 'right'].entries()) {
        await expectAlignment(figures.nth(index), displayAlign);
        await expectGrid(figures.nth(index), 64, 12);
        await expect.poll(() => figures.nth(index).locator('.ap-term').evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeLessThan(desktopFontSizes[index]);
        const scaledTypography = await figures.nth(index).locator('.ap-term').evaluate((terminal) => {
            const expected = getComputedStyle(terminal);
            return [...terminal.querySelectorAll('.ap-term-text, .ap-line, .ap-line span')].every((element) => {
                const style = getComputedStyle(element);
                return style.fontSize === expected.fontSize && style.fontFamily === expected.fontFamily;
            });
        });
        expect(scaledTypography).toBe(true);
    }
    await screenshot(page, testInfo, 'layout-theme-css-mobile');
    // Physical left/right placement must remain the same inside RTL content.
    // This covers direction inheritance at runtime; generated RTL stylesheets
    // are independently protected by the source's rtlcss ignore directive.
    await page.evaluate(() => {
        document.documentElement.dir = 'rtl';
        for (const figure of document.querySelectorAll('.asciiplayer-figure')) {
            figure.parentElement.dir = 'rtl';
        }
    });
    for (const [index, displayAlign] of ['left', 'center', 'right'].entries()) {
        await expectAlignment(figures.nth(index), displayAlign);
        await expectGrid(figures.nth(index), 64, 12);
    }
    await screenshot(page, testInfo, 'layout-theme-css-mobile-rtl');
});

test('the inserter example is a local static preview and makes no recording request', async ({ page }, testInfo) => {
    await openEditor(page);
    const example = await page.evaluate((name) => window.wp.blocks.getBlockType(name).example, blockName);
    expect(example).toMatchObject({ attributes: { isExample: true } });
    const recordingRequests = [];
    page.on('request', (request) => {
        if (/\.cast(?:[?#]|$)|asciinema\.org|jsdelivr\.net/.test(request.url())) recordingRequests.push(request.url());
    });
    const { block } = await insertPlayer(page, example.attributes);
    await expect(block.locator('.asciiplayer-example')).toContainText('Hello, terminal!');
    await expect(block.getByRole('textbox', { name: 'Recording URL', exact: true })).toHaveCount(0);
    await expect(block.locator('.ap-wrapper')).toHaveCount(0);
    await screenshot(page, testInfo, 'static-inserter-example');
    expect(recordingRequests).toEqual([]);
});
