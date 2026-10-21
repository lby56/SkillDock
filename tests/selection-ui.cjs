const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { fixture, addSkill, put } = require('./helpers.cjs');
const { fs, path, tree, readText } = require('../src/files.cjs');
(async () => {
  const f = fixture('selection-ui');
  for (const name of ['alpha', 'beta', 'delta', 'gamma', 'cloud-skill', ...Array.from({ length: 16 }, (_, i) => `sample-${String(i + 1).padStart(2, '0')}`)]) {
    addSkill(f.manager, 'codex', name);
    addSkill(f.manager, 'dsh', name);
    if (name !== 'cloud-skill') addSkill(f.manager, 'claude', name);
  }
  put(path.join(f.manager.locations.codex, 'skills/.system/internal/SKILL.md'), '---\nname: internal\ndescription: System\n---\nProtected.');
  addSkill(f.manager, 'claude', 'internal');
  const cloudDir = path.join(f.manager.locations.claude, 'skills/synced/account/cloud-skill');
  put(path.join(cloudDir, 'SKILL.md'), '---\nname: cloud-skill\ndescription: Cloud\n---\nProtected cloud.');
  const linkedDir = path.join(f.directory, 'external');
  put(path.join(linkedDir, 'SKILL.md'), '---\nname: zz-linked\ndescription: Linked\n---\nMust remain unchanged.');
  fs.symlinkSync(linkedDir, path.join(f.manager.locations.codex, 'skills/zz-linked'), 'junction');
  const findSkill = (name, root) => f.manager.snapshot().skills.find(skill => skill.name === name && skill.rootId === root);
  f.manager.favorite({ id: findSkill('alpha', 'codex').id, value: true });
  f.manager.favorite({ id: findSkill('beta', 'claude').id, value: true });
  const cloudDigest = tree(cloudDir).digest;
  const env = { ...process.env, SKILLDOCK_HOME: f.home, SKILLDOCK_DATA: f.dataDir }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: process.env.SKILLDOCK_TEST_EXE || require('electron'), args: process.env.SKILLDOCK_TEST_EXE ? [] : [path.join(__dirname, '..')], env });
  const page = await app.firstWindow(), errors = [], checks = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const row = name => page.locator(`[data-overview-skill="${name}"]`);
  const selected = () => page.locator('.overview-row[aria-selected="true"]').evaluateAll(rows => rows.map(row => row.dataset.overviewSkill));
  const enabled = (name, provider) => f.manager.snapshot().catalog.find(group => group.name === name).tools[provider]?.state.enabled;
  const menu = page.locator('#skill-context-menu');
  const clickAction = async (scope, value) => {
    await menu.locator(`[data-bulk-scope="${scope}"][data-bulk-enabled="${value}"]`).click();
    await page.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
  };
  const pass = message => { checks.push(message); console.log(`PASS ${message}`); };
  try {
    await page.waitForSelector('[data-overview-skill="alpha"]');
    await row('alpha').locator('[data-row-select]').click();
    await row('gamma').locator('.overview-name p').click({ modifiers: ['Control'] });
    assert.deepEqual(await selected(), ['alpha', 'gamma']);
    await row('alpha').click({ button: 'right' });
    assert.match(await menu.innerText(), /选中的 2 项/);
    await clickAction('codex', false);
    assert.equal(enabled('alpha', 'codex'), false); assert.equal(enabled('gamma', 'codex'), false);
    assert.equal(enabled('beta', 'codex'), true); assert.equal(enabled('alpha', 'claude'), true); assert.equal(enabled('gamma', 'opencode'), true);
    pass('Ctrl selection and right-click preserve the selected set; provider action affects only that tool');

    await row('beta').click({ button: 'right' });
    assert.deepEqual(await selected(), ['beta']);
    await page.keyboard.press('Escape');
    assert.equal(await menu.isVisible(), false); assert.deepEqual(await selected(), ['beta']);
    await row('alpha').locator('.overview-name p').click();
    await row('delta').locator('[data-row-select]').click({ modifiers: ['Shift'] });
    assert.deepEqual(await selected(), ['alpha', 'beta', 'cloud-skill', 'delta']);
    await page.keyboard.press('Control+a');
    assert.equal((await selected()).length, f.manager.snapshot().catalog.length);
    await page.keyboard.press('Escape'); assert.deepEqual(await selected(), []);
    await page.locator('#overview-select-all').click();
    assert.equal((await selected()).length, f.manager.snapshot().catalog.length);
    await page.locator('#overview-select-all').click(); assert.deepEqual(await selected(), []);
    pass('right-click unselected row, Shift range, Ctrl+A, select-all checkbox and Escape use desktop selection rules');

    await row('alpha').locator('[data-row-select]').click();
    await row('beta').locator('[data-row-select]').click();
    await row('alpha').click({ button: 'right' });
    await clickAction('all', false);
    for (const name of ['alpha', 'beta']) for (const provider of ['codex', 'claude', 'opencode', 'dsh']) assert.equal(enabled(name, provider), false);
    assert.equal(enabled('delta', 'codex'), true); assert.equal(enabled('gamma', 'claude'), true);
    await page.locator('#batch-scope').selectOption('claude');
    await page.locator('#overview-selection-bar [data-bulk-enabled="true"]').click();
    await page.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
    assert.equal(enabled('alpha', 'claude'), true); assert.equal(enabled('beta', 'claude'), true);
    assert.equal(enabled('alpha', 'opencode'), false); assert.equal(enabled('beta', 'codex'), false);
    pass('four-tool batch and selection toolbar preserve other tool choices and unselected skills');

    await page.locator('#search').fill('gamma'); assert.deepEqual(await selected(), []);
    await page.keyboard.press('Control+a'); assert.deepEqual(await selected(), []);
    await row('gamma').locator('.overview-name p').click();
    await page.keyboard.press('Control+a'); assert.deepEqual(await selected(), ['gamma']);
    await page.keyboard.press('Escape');
    await page.locator('#search').fill(''); assert.deepEqual(await selected(), []);
    pass('search drops hidden selections; Ctrl+A in a text field keeps its normal meaning');

    await row('zz-linked').click({ button: 'right' });
    assert.equal(await menu.locator('[data-bulk-scope="codex"][data-bulk-enabled="false"]').isDisabled(), true);
    const bounds = await menu.boundingBox(), viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    pass('protected links cannot be toggled; context menu stays inside the window');

    await row('cloud-skill').locator('[data-row-select]').click();
    await row('internal').locator('[data-row-select]').click();
    await row('internal').click({ button: 'right' }); await clickAction('all', false);
    assert.equal(enabled('internal', 'codex'), false); assert.equal(enabled('cloud-skill', 'claude'), false);
    assert.equal(JSON.parse(readText(f.manager.configPaths().claude)).skillOverrides['anthropic-skills:cloud-skill'], 'off');
    assert.equal(tree(cloudDir).digest, cloudDigest);
    pass('system and cloud skills support native bulk switches without changing their content');

    await page.locator('[data-route="library"][data-provider="codex"]').click();
    const libraryRow = name => page.locator(`.skill-row[data-skill="${name}"]`);
    await libraryRow('alpha').locator('[data-row-select]').click();
    await libraryRow('beta').locator('.skill-desc').click({ modifiers: ['Control'] });
    await libraryRow('alpha').click({ button: 'right' });
    assert.equal(await menu.locator('.context-tool-row').count(), 1);
    await clickAction('codex', true);
    assert.equal(enabled('alpha', 'codex'), true); assert.equal(enabled('beta', 'codex'), true); assert.equal(enabled('beta', 'opencode'), false);
    pass('tool-specific library has multiselect and limits quick actions to the current provider');

    await page.locator('[data-route="favorites"]').click();
    await page.locator('h1').click(); await page.keyboard.press('Control+a');
    assert.equal(await page.locator('.skill-row[aria-selected="true"]').count(), 2);
    await libraryRow('alpha').click({ button: 'right' }); await clickAction('all', true);
    assert.equal(enabled('beta', 'opencode'), true); assert.equal(enabled('gamma', 'codex'), false);
    pass('favorites reuse selection and bulk actions without expanding to other skills');

    await page.locator('#navigation [data-route="sync"]').click();
    const sourceRow = name => page.locator(`.sync-source-list [data-selection-key="${findSkill(name, 'codex').id}"]`);
    await sourceRow('alpha').locator('[data-row-select]').click();
    await sourceRow('gamma').click({ modifiers: ['Control'] });
    await sourceRow('gamma').click({ button: 'right' }); await clickAction('codex', true);
    assert.equal(enabled('gamma', 'codex'), true);
    assert.equal(await page.locator('.sync-source-list [aria-selected="true"]').count(), 2);
    pass('sync source list also supports Ctrl selection and context switches');

    await page.locator('[data-route="overview"]').click();
    await row('sample-14').locator('[data-row-select]').click();
    await row('sample-15').locator('[data-row-select]').click();
    const scrollBefore = await page.locator('#overview-rows').evaluate(element => element.scrollTop);
    await row('sample-15').click({ button: 'right' }); await clickAction('codex', false);
    assert.equal(await page.locator('#overview-rows').evaluate(element => element.scrollTop), scrollBefore);
    assert.deepEqual(await selected(), ['sample-14', 'sample-15']);
    await row('sample-15').focus(); await page.keyboard.press('Shift+F10');
    assert.equal(await menu.isVisible(), true);
    await page.keyboard.press('ArrowDown'); assert.equal(await page.locator('#skill-context-menu button:focus').count(), 1);
    await page.screenshot({ path: path.join(__dirname, '../qa/06-multiselect-menu.png') });
    await page.keyboard.press('Escape');
    pass('bulk changes preserve list position and selection; keyboard context menu works');

    await row('sample-16').scrollIntoViewIfNeeded();
    const listTop = await page.locator('#overview-rows').evaluate(element => element.scrollTop);
    assert.ok(listTop > 0);
    await row('sample-16').locator('[data-provider="codex"]').click();
    await page.waitForFunction(() => document.querySelector('[data-overview-skill="sample-16"] [data-provider="codex"]').getAttribute('aria-checked') === 'false');
    assert.equal(enabled('sample-16', 'codex'), false);
    assert.equal(await page.locator('#overview-rows').evaluate(element => element.scrollTop), listTop);
    assert.deepEqual(await selected(), ['sample-14', 'sample-15']);
    pass('a single switch keeps the scrolled list in place');

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1080, 720));
    await row('sample-15').click({ button: 'right' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    await page.screenshot({ path: path.join(__dirname, '../qa/07-multiselect-compact.png') });
    assert.deepEqual(errors, []);
    const report = { passed: true, at: new Date().toISOString(), packaged: !!process.env.SKILLDOCK_TEST_EXE, checks, rendererErrors: errors, fixture: f.directory };
    fs.writeFileSync(path.join(__dirname, '../qa/selection-ui-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) {
    await page.screenshot({ path: path.join(__dirname, '../qa/selection-failure.png') }).catch(() => {});
    throw error;
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
