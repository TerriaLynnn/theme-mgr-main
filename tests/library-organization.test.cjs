const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../index.js'), 'utf8');
function extract(name) {
    const start = source.indexOf('    function ' + name + '(');
    assert.ok(start >= 0, name);
    const end = source.indexOf('\n    function ', start + 1);
    return source.slice(start, end);
}
function setup() {
    const context = vm.createContext({ window: {}, console, Set, Map, CustomEvent: function () {} });
    vm.runInContext(source.slice(source.indexOf('/* BEGIN LIBRARY ORGANIZATION */'), source.indexOf('/* END LIBRARY ORGANIZATION */')), context);
    context.global = context.window;
    context.getItemMeta = (_, item) => context.view.metaByKey[item.key] || {};
    context.buildLibraryView = () => context.view;
    context.displayCategoryMatches = (category, cat) => cat === '__all__' || (cat === '__uncategorized__' ? !category : category === cat);
    context.itemMatchesSearch = (_, item, query) => item.name.includes(query);
    vm.runInContext(extract('buildSeriesLayoutUnits') + extract('sortItems') + extract('finishGridRender') + extract('applyAutomaticCategories'), context);
    context.view = { items: [], itemByKey: {}, seriesGroups: {}, seriesMembership: {}, metaByKey: {}, sortedByMode: {} };
    context.getAmbiguousThemeNames = () => [];
    context.getItemMetaForWrite = (data, item) => data.themeMeta[item.themeName];
    context.seriesApi = { setSeriesCategory(data, id, category) { data.series.groups[id].category = category; return true; } };
    context.invalidateLibraryView = () => {};
    context.api = context.window.ThemeMgrModules.libraryOrganization;
    return context;
}
function item(name, kind = 'theme') {
    return { name, kind, key: (kind === 'pair' ? 'pair:' : 'theme:') + name, themeName: name, pairId: name, themeNames: [name] };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('series and author rules produce real category assignments; unmatched themes stay uncategorized', () => {
    const c = setup();
    const items = ['春日 v1.0', '春日 v2.0', '月光 · 蓝', '月光 · 红', '独立甲', '独立乙', '海边', '海风'].map(n => item(n));
    const meta = { 'theme:独立甲': { author: ' Alice ' }, 'theme:独立乙': { author: 'ＡＬＩＣＥ' } };
    const plan = c.api.planCategories(items, meta, 'smart', {}, {});
    assert.deepEqual(plain(plan.map(entry => entry.category)), ['系列 · 春日', '系列 · 春日', '系列 · 月光', '系列 · 月光', '作者 · Alice', '作者 · Alice']);
    assert.equal(c.api.seriesName(item('晨曦【夜间版】'), {}), '晨曦');
    assert.equal(c.api.seriesName(item('月光-蓝'), {}), '月光');
    assert.equal(c.api.planCategories(items, meta, 'none', {}, {}).length, 0);
    assert.equal(c.api.planCategories(items, meta, 'author', {}, {}).length, 2);
    assert.equal(c.api.planCategories(items, meta, 'series', {}, {}).length, 4);
});

test('existing categories are preserved; blank authors, singletons and prototype-like names are safe', () => {
    const c = setup();
    const items = ['a', 'b', 'c', 'd', 'e'].map(n => item(n));
    const meta = Object.create(null);
    items.forEach((i, index) => { meta[i.key] = { author: index < 3 ? '__proto__' : '', category: index === 2 ? 'other' : '' }; });
    const before = JSON.stringify(meta);
    const plan = c.api.planCategories(items, meta, 'smart', {}, {});
    assert.deepEqual(plain(plan.map(entry => entry.key)), ['theme:a', 'theme:b']);
    assert.equal(plan[0].category, '作者 · __proto__');
    assert.equal(JSON.stringify(meta), before);
});

test('manual series retains its category and free themes remain individual cards', () => {
    const c = setup(), items = ['a', 'b', 'c', 'd'].map(n => item(n));
    c.view.seriesGroups.manual = { id: 'manual', name: '手工系列', category: '手工', members: ['theme:a', 'theme:b'] };
    c.view.seriesMembership = { 'theme:a': 'manual', 'theme:b': 'manual' };
    items.forEach(i => { c.view.metaByKey[i.key] = { author: '同作者' }; });
    const before = JSON.stringify(c.view);
    const layout = c.buildSeriesLayoutUnits({}, items, '__all__', '', c.view);
    assert.equal(layout.units.length, 3);
    assert.equal(layout.units[0].group.id, 'manual');
    assert.equal(layout.units[1].item.name, 'c');
    assert.equal(JSON.stringify(c.view), before);
    assert.equal(c.buildSeriesLayoutUnits({}, items, '手工', '', c.view).displayedItems.length, 2);
    const plan = c.api.planCategories(items, c.view.metaByKey, 'smart', c.view.seriesGroups, c.view.seriesMembership);
    assert.deepEqual(plain(plan.map(entry => entry.key)), ['theme:c', 'theme:d']);
});

test('apply persists category tabs and metadata, reuses labels and is idempotent after reload/import', () => {
    const c = setup(), items = [item('a'), item('b'), item('c', 'pair')];
    const data = { autoCategoryMode: 'smart', categories: ['手动分类'], themeMeta: { a: { author: '作者甲' }, b: { author: '作者甲' }, c: { category: '手动分类', author: '作者甲' } } };
    c.view.items = items;
    items.forEach(i => { c.view.itemByKey[i.key] = i; c.view.metaByKey[i.key] = data.themeMeta[i.themeName]; });
    assert.equal(c.applyAutomaticCategories(data), 2);
    assert.deepEqual(data.categories, ['手动分类', '作者 · 作者甲']);
    const restored = JSON.parse(JSON.stringify(data));
    assert.equal(restored.themeMeta.a.category, '作者 · 作者甲');
    assert.equal(restored.themeMeta.b.category, '作者 · 作者甲');
    assert.equal(restored.themeMeta.c.category, '手动分类');
    assert.equal(c.applyAutomaticCategories(data), 0);
    const imported = item('d'); data.themeMeta.d = { author: '作者甲' };
    c.view.items.push(imported); c.view.itemByKey[imported.key] = imported; c.view.metaByKey[imported.key] = data.themeMeta.d;
    assert.equal(c.applyAutomaticCategories(data), 1);
    assert.equal(data.themeMeta.d.category, '作者 · 作者甲');
    assert.equal(data.categories.length, 2);
});

test('uncategorized manual series gets a real series category; author-only honors matching members', () => {
    const c = setup(), items = [item('a'), item('b')];
    const data = { autoCategoryMode: 'smart', categories: [], themeMeta: {}, series: { groups: { manual: { id: 'manual', name: '春日', members: [], category: '' } } } };
    c.view.seriesGroups = data.series.groups;
    c.view.items = items;
    c.view.seriesMembership = { 'theme:a': 'manual', 'theme:b': 'manual' };
    assert.equal(c.applyAutomaticCategories(data), 1);
    assert.equal(data.series.groups.manual.category, '系列 · 春日');
    assert.deepEqual(data.categories, ['系列 · 春日']);
    assert.equal(c.applyAutomaticCategories(data), 0);
    data.series.groups.manual.category = ''; data.autoCategoryMode = 'author';
    assert.equal(c.applyAutomaticCategories(data), 0);
    items.forEach(i => { c.view.metaByKey[i.key] = { author: '作者甲' }; });
    assert.equal(c.applyAutomaticCategories(data), 1);
    assert.equal(data.series.groups.manual.category, '作者 · 作者甲');
});

test('real day/night and series module APIs persist categories to their authoritative records', () => {
    const c = setup();
    for (const number of ['09', '10']) {
        const start = source.indexOf('/* BEGIN MODULE ' + number + '/29:');
        vm.runInContext(source.slice(start, source.indexOf('/* END MODULE ' + number + '/29:', start)), c);
    }
    c.pairsApi = c.window.ThemeMgrModules.themePairs;
    c.seriesApi = c.window.ThemeMgrModules.themeSeries;
    vm.runInContext(extract('getItemMetaForWrite'), c);
    const data = { autoCategoryMode: 'smart', categories: [], themeMeta: {}, dayNight: { pairs: {
        one: { id: 'one', name: '主题甲', dayTheme: '甲日', nightTheme: '甲夜', meta: { author: '作者甲' } },
        two: { id: 'two', name: '主题乙', dayTheme: '乙日', nightTheme: '乙夜', meta: { author: '作者甲' } }
    } } };
    const rebuild = () => {
        c.view.items = c.pairsApi.buildLogicalItems(data, ['甲日', '甲夜', '乙日', '乙夜']);
        c.view.items.forEach(i => { c.view.itemByKey[i.key] = i; c.view.metaByKey[i.key] = i.meta; });
        c.view.seriesGroups = Object.fromEntries(c.seriesApi.listSeries(data).map(group => [group.id, group]));
        c.view.seriesMembership = c.seriesApi.getMembershipMap(data);
    };
    rebuild();
    assert.equal(c.applyAutomaticCategories(data), 2);
    assert.equal(data.dayNight.pairs.one.meta.category, '作者 · 作者甲');
    assert.equal(data.dayNight.pairs.two.meta.category, '作者 · 作者甲');
    rebuild();
    assert.equal(c.applyAutomaticCategories(data), 0);
    assert.equal(c.seriesApi.createSeries(data, { id: 'manual', name: '手工系列', members: [{ kind: 'day-night', pairId: 'one' }, { kind: 'day-night', pairId: 'two' }] }).ok, true);
    rebuild();
    assert.equal(c.applyAutomaticCategories(data), 1);
    assert.equal(data.series.groups.manual.category, '系列 · 手工系列');
    assert.ok(data.categories.includes('系列 · 手工系列'));
});

test('natural name order, reverse order and import order including day/night pairs and old unknown entries', () => {
    const c = setup();
    const items = [item('主题10'), item('主题2'), item('旧主题'), item('日夜', 'pair')];
    items[3].themeNames = ['日间', '夜间'];
    const data = { themeImportOrder: { '主题10': 1, '主题2': 2, '日间': 3, '夜间': 4 } };
    const asc = c.sortItems(items, 'name', data, c.view);
    assert.ok(asc.indexOf(items[1]) < asc.indexOf(items[0]));
    assert.deepEqual(plain(c.sortItems(items, 'name-desc', data, c.view)), plain(asc.slice().reverse()));
    assert.deepEqual(plain(c.sortItems(items, 'import-desc', data, c.view).map(i => i.name)), ['日夜', '主题2', '主题10', '旧主题']);
    assert.deepEqual(plain(c.sortItems(items, 'import-asc', data, c.view).map(i => i.name)), ['旧主题', '主题10', '主题2', '日夜']);
});

test('large library: all members occur once and follow selected order', () => {
    const c = setup(), items = Array.from({ length: 500 }, (_, i) => item('主题' + i));
    items.forEach((i, index) => { c.view.metaByKey[i.key] = { author: '作者' + (index % 17) }; });
    const layout = c.buildSeriesLayoutUnits({}, items.slice().reverse(), '__all__', '', c.view);
    const keys = layout.displayedItems.map(i => i.key);
    assert.equal(keys.length, 500);
    assert.equal(new Set(keys).size, 500);
    assert.deepEqual(plain(keys), items.slice().reverse().map(i => i.key));
    assert.equal(c.api.planCategories(items, c.view.metaByKey, 'smart', {}, {}).length, 500);
});

test('locate only after the active generation completes; never repeat or override user scroll', () => {
    const c = setup(), calls = [];
    c.gridRenderGeneration = 5;
    c.locateCurrentOnRender = true;
    c.renderedCardsByKey = { active: { isConnected: true, scrollIntoView: value => calls.push(value) } };
    const state = { generation: 4, locateKey: 'active', area: { dataset: {}, dispatchEvent() {} }, renderedCards: 500 };
    c.finishGridRender(state);
    assert.equal(calls.length, 0);
    state.generation = 5;
    c.finishGridRender(state);
    assert.equal(calls.length, 1);
    assert.equal(c.locateCurrentOnRender, false);
    c.finishGridRender(state);
    assert.equal(calls.length, 1);
    assert.equal(state.area.dataset.tmRenderComplete, 'true');
});

module.exports = { source, extract };
