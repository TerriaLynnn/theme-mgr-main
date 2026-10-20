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
    vm.runInContext(extract('buildSeriesLayoutUnits') + extract('sortItems') + extract('finishGridRender'), context);
    context.view = { seriesGroups: {}, seriesMembership: {}, metaByKey: {}, sortedByMode: {} };
    context.api = context.window.ThemeMgrModules.libraryOrganization;
    return context;
}
function item(name, kind = 'theme') {
    return { name, kind, key: (kind === 'pair' ? 'pair:' : 'theme:') + name, themeName: name, pairId: name, themeNames: [name] };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('series suffixes, explicit separators and exact authors; no arbitrary prefix grouping', () => {
    const c = setup();
    const items = ['春日 v1.0', '春日 v2.0', '月光 · 蓝', '月光 · 红', '独立甲', '独立乙', '海边', '海风'].map(n => item(n));
    const meta = { 'theme:独立甲': { author: ' Alice ' }, 'theme:独立乙': { author: 'ＡＬＩＣＥ' } };
    const groups = c.api.groupItems(items, meta, 'smart');
    assert.deepEqual(plain(groups.map(g => g.items.map(i => i.name))), [items.slice(0, 2), items.slice(2, 4), items.slice(4, 6)].map(list => list.map(i => i.name)));
    assert.equal(c.api.seriesName(item('晨曦【夜间版】'), {}), '晨曦');
    assert.equal(c.api.seriesName(item('月光-蓝'), {}), '月光');
    assert.equal(c.api.groupItems(items, meta, 'none').length, 0);
    assert.equal(c.api.groupItems(items, meta, 'author').length, 1);
    assert.equal(c.api.groupItems(items, meta, 'series').length, 2);
});

test('category boundaries, blank authors, singleton and prototype-like names are safe', () => {
    const c = setup();
    const items = ['a', 'b', 'c', 'd', 'e'].map(n => item(n));
    const meta = Object.create(null);
    items.forEach((i, index) => { meta[i.key] = { author: index < 3 ? '__proto__' : '', category: index === 2 ? 'other' : '' }; });
    const before = JSON.stringify(meta);
    const groups = c.api.groupItems(items, meta, 'smart');
    assert.deepEqual(plain(groups[0].items.map(i => i.name)), ['a', 'b']);
    assert.equal(groups.length, 1);
    assert.equal(JSON.stringify(meta), before);
});

test('manual series wins; auto grouping retains sorting, search and category filtering without mutating relations', () => {
    const c = setup(), items = ['a', 'b', 'c', 'd'].map(n => item(n));
    c.view.seriesGroups.manual = { id: 'manual', name: '手工系列', category: '手工', members: ['theme:a', 'theme:b'] };
    c.view.seriesMembership = { 'theme:a': 'manual', 'theme:b': 'manual' };
    items.forEach(i => { c.view.metaByKey[i.key] = { author: '同作者' }; });
    const before = JSON.stringify(c.view);
    const layout = c.buildSeriesLayoutUnits({ autoGroupMode: 'smart' }, items, '__all__', '', c.view);
    assert.equal(layout.units.length, 2);
    assert.equal(layout.units[0].group.id, 'manual');
    assert.deepEqual(plain(layout.units[1].items.map(i => i.name)), ['c', 'd']);
    assert.equal(JSON.stringify(c.view), before);
    assert.equal(c.buildSeriesLayoutUnits({}, items, '手工', '', c.view).displayedItems.length, 2);
    assert.equal(c.buildSeriesLayoutUnits({}, items, '__all__', '同作者', c.view).units.length, 1);
    assert.equal(c.buildSeriesLayoutUnits({ autoGroupMode: 'none' }, items, '__all__', '', c.view).units.length, 3);
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
    layout.units.forEach(unit => assert.ok(unit.items.every((i, n, list) => !n || Number(i.name.slice(2)) < Number(list[n - 1].name.slice(2)))));
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
