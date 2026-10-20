// Run with NODE_PATH pointing at a Playwright installation and an installed Chrome.
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '../index.js'), 'utf8');
function extract(name) {
    const start = source.indexOf('    function ' + name + '(');
    return source.slice(start, source.indexOf('\n    function ', start + 1));
}
const helper = source.slice(source.indexOf('/* BEGIN LIBRARY ORGANIZATION */'), source.indexOf('/* END LIBRARY ORGANIZATION */'));
const styles = source.slice(source.lastIndexOf('(function (global)', source.indexOf('    ns.injectStyles = function')), source.indexOf('/* END MODULE 25/29:'));
const functions = ['sortItems', 'buildSeriesLayoutUnits', 'alignSeriesUnitsForGrid', 'buildSeriesBlockHtml', 'buildGridCardHtml', 'captureSeriesScrollPositions', 'bindSeriesRailEvents', 'normalizeGridCardSize', 'applyGridCardSize', 'getGridLayoutMetrics', 'syncSeriesCardWidth', 'cancelPendingGridRender', 'scheduleGridRenderChunk', 'gridUnitCardCount', 'buildGridUnitHtml', 'registerRenderedCards', 'finishGridRender', 'appendGridRenderChunk', 'renderGrid'].map(extract).join('\n');
(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
            const page = await browser.newPage({ viewport });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.setContent('<div class="tm-overlay tm-light"><div class="tm-box"><div class="tm-head">美化管理 v4.8.0</div><div id="tm-grid-area" class="tm-grid-area"></div></div></div>');
            await page.addScriptTag({ content: helper + styles + `
                var global = window, batchMode = false, batchSelected = new Set(), batchDeleting = false;
                var curCat = '__all__', searchQuery = '', expandedSeriesId = '', seriesScrollPositions = Object.create(null), lastSeriesColumnCount = 0;
                var locateCurrentOnRender = true, gridRenderGeneration = 0, gridRenderState = null, gridRenderFrame = null, gridImageLoader = null;
                var renderedCardsByKey = Object.create(null), renderedActiveItemKey = '', GRID_RENDER_BATCH_SIZE = 48, GRID_RENDER_FOLLOWUP_BATCH_SIZE = 96, GRID_IMAGE_EAGER_COUNT = 10;
                var themeNameConflicts = new Set(), themeListLoadError = '', data = { autoGroupMode: 'smart', sortMode: 'name', gridCardSize: 108, hideSeriesPreviews: true, themeMeta: {} };
                var view = { items: [], itemByThemeName: {}, metaByKey: {}, seriesGroups: {}, seriesMembership: {}, sortedByMode: {} };
                for (var i = 0; i < 240; i++) {
                    var name = '主题' + i, item = { name: name, key: 'theme:' + name, themeName: name, themeNames: [name], kind: 'theme' };
                    view.items.push(item); view.itemByThemeName[name] = item;
                    data.themeMeta[name] = view.metaByKey[item.key] = i >= 220 ? { author: '共同作者' } : {};
                }
                function load() { return data; }
                function buildLibraryView() { return view; }
                function getItemMeta(_, item) { return view.metaByKey[item.key]; }
                function getItemDisplayTheme(_, item) { return item.themeName; }
                function isItemActive(item, name) { return item.themeNames.indexOf(name) >= 0; }
                function getCurrentThemeName() { return '主题239'; }
                function getAmbiguousThemeNames() { return []; }
                function displayCategoryMatches(category, cat) { return cat === '__all__' || category === cat; }
                function itemMatchesSearch(_, item, query) { return !query || item.name.includes(query); }
                function isThemePageActive() { return true; }
                function bindGridDelegatedEvents() {}
                function resetGridImageLoader() {}
                function registerGridImages() {}
                function toast() {}
                function openSeriesManageSheet() {}
                function esc(s) { return String(s || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'); }
                var imageToolsApi = { resolvePreviewPresentation: function () { return { hasImage: false, view: { posX: 50, posY: 50, zoom: 1 } }; } };
                ` + functions + '\nwindow.ThemeMgrModules.injectStyles(); renderGrid();' });
            await page.waitForFunction(() => document.getElementById('tm-grid-area').dataset.tmRenderComplete === 'true');
            assert.equal(await page.locator('.tm-card').count(), 240);
            assert.equal(await page.locator('.tm-series-block.is-expanded .tm-card.on').count(), 1);
            const box = await page.locator('.tm-card.on').boundingBox();
            assert.ok(box.y >= 0 && box.y + box.height <= viewport.height, JSON.stringify(box));
            assert.ok(await page.locator('#tm-grid-area').evaluate(el => el.scrollTop > 0));
            await page.evaluate(() => { data.sortMode = 'name-desc'; renderGrid(); });
            await page.waitForFunction(() => document.getElementById('tm-grid-area').dataset.tmRenderComplete === 'true');
            assert.equal(await page.locator('.tm-series-track .tm-card-name').first().textContent(), '主题239');
            await page.evaluate(() => { data.autoGroupMode = 'none'; renderGrid(); });
            await page.waitForFunction(() => document.getElementById('tm-grid-area').dataset.tmRenderComplete === 'true');
            assert.equal(await page.locator('.tm-series-block').count(), 0);
            assert.equal(await page.locator('.tm-card').count(), 240);
            assert.deepEqual(errors, []);
            console.log('PASS browser: ' + viewport.width + 'px, 240 cards, current theme visible, series expansion, sort and grouping toggle');
            await page.close();
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
