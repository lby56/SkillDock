const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { fixture, put } = require('./helpers.cjs');
const { fs, path, assertWithin, assertNoLinks, readText } = require('../src/files.cjs');
const { listNativeCodex } = require('./codex-native-helper.cjs');

(async () => {
  const qa = path.resolve(__dirname, '../qa');
  const original = path.resolve(process.env.SKILLDOCK_PORTABLE_DIR || 'missing-portable-directory');
  assertWithin(qa, original); assertNoLinks(original);
  assert.ok(fs.existsSync(path.join(original, 'SkillDock.exe')));
  assert.equal(fs.existsSync(path.join(original, 'data')), false, 'The shared release must be clean.');
  const f = fixture('portable-release-ui');
  const firstHome = path.join(f.directory, '模拟用户 甲'), secondHome = path.join(f.directory, '模拟用户 乙');
  const unrelatedCwd = path.join(f.directory, '完全无关的启动目录');
  for (const directory of [firstHome, secondHome, unrelatedCwd]) fs.mkdirSync(directory);
  const moved = path.join(f.directory, '移动后 中文 & space');
  const checks = [], errors = [];
  let app, page;
  const pass = message => { checks.push(message); console.log(`PASS ${message}`); };
  const snapshot = () => page.evaluate(() => window.skilldock.call('snapshot'));
  const launch = async (directory, home) => {
    const env = { ...process.env, SKILLDOCK_HOME: home };
    delete env.SKILLDOCK_DATA; delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath: path.join(directory, 'SkillDock.exe'), args: [], env, cwd: unrelatedCwd });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('#navigation [data-provider="dsh"]');
  };
  const close = async () => { if (app) { await app.close(); app = null; } };
  const row = name => page.locator(`[data-overview-skill="${name}"]`);
  const idle = () => page.waitForFunction(() => !document.body.hasAttribute('aria-busy'));
  try {
    await launch(original, firstHome);
    let data = await snapshot();
    assert.equal(data.version, require('../package.json').version); assert.equal(data.portable, true);
    assert.equal(data.skills.length, 0); assert.deepEqual(data.errors, []);
    assertWithin(original, data.dataDir);
    assert.equal(data.locations.dsh, path.join(firstHome, '.dsh'));
    assert.equal(fs.existsSync(path.join(firstHome, '.codex')), false);
    pass('clean extracted package opens from an unrelated working directory for a fresh user without installed tools');

    await page.locator('#navigation [data-route="settings"]').click();
    await page.locator('#location-codex').fill('./工具 目录/Codex');
    await page.locator('#location-dsh').fill('%APP_DIR%/工具 目录/Harness');
    await page.locator('[data-action="save-settings"]').click(); await idle();
    data = await snapshot();
    assert.equal(data.locations.dsh, path.join(original, '工具 目录/Harness'));
    assert.equal(data.locations.codex, path.join(original, '工具 目录/Codex'));
    const firstDataRelative = path.relative(original, data.dataDir);
    for (const name of ['portable-alpha', 'portable-beta']) {
      put(path.join(data.locations.codex, `skills/${name}/SKILL.md`), `---\nname: ${name}\ndescription: Portable skill with relative resources\n---\nRead assets/资源.txt.\n`);
      put(path.join(data.locations.codex, `skills/${name}/assets/资源.txt`), 'Relative resource survives moving.');
    }
    await page.locator('#refresh').click(); await idle();
    await page.locator('#navigation [data-route="overview"]').click();
    await page.locator('[data-action="sync-all"]').click();
    await page.waitForSelector('[data-action="apply-sync"]');
    assert.equal(await page.locator('.plan-row').count(), 4);
    await page.locator('[data-action="apply-sync"]').click(); await idle();
    assert.equal(await page.locator('.overview-cell.missing').count(), 0);
    data = await snapshot();
    assert.ok(data.catalog.every(group => group.complete));
    pass('relative settings and four-provider synchronization operate on the current portable and user roots');

    await row('portable-alpha').locator('[data-row-select]').click();
    await row('portable-beta').locator('[data-row-select]').click();
    await row('portable-alpha').click({ button: 'right' });
    const menu = page.locator('#skill-context-menu');
    assert.equal(await menu.locator('.context-tool-row').count(), 5);
    await menu.locator('[data-bulk-scope="all"][data-bulk-enabled="false"]').click(); await idle();
    data = await snapshot();
    assert.ok(data.catalog.every(group => Object.values(group.tools).every(tool => tool.state.enabled === false)));
    const toml = require('smol-toml').parse(readText(data.configPaths.codex));
    assert.ok(toml.skills.config.every(item => !path.isAbsolute(item.path)));
    await row('portable-alpha').click({ button: 'right' });
    await page.screenshot({ path: path.join(qa, '08-four-tools-portable.png') });
    await page.keyboard.press('Escape');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1080, 720));
    await row('portable-alpha').click({ button: 'right' });
    const menuBounds = await menu.boundingBox(), viewport = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.equal(viewport.overflow, false);
    assert.ok(menuBounds.x + menuBounds.width <= viewport.w && menuBounds.y + menuBounds.height <= viewport.h);
    await page.screenshot({ path: path.join(qa, '09-four-tools-compact.png') });
    await page.keyboard.press('Escape');
    pass('four-tool right-click batch disables actual settings; menu and four columns fit the minimum desktop window');

    await page.locator('#navigation [data-route="library"][data-provider="dsh"]').click();
    await page.locator('[data-skill="portable-alpha"] .skill-desc').click();
    await page.locator('#detail-panel [data-action="favorite"]').click(); await idle();
    await page.locator('[data-skill="portable-beta"] .skill-desc').click();
    await page.locator('#detail-panel [data-action="delete-one"]').click();
    await page.waitForSelector('[data-action="confirm-delete"]');
    await page.locator('[data-action="confirm-delete"]').click(); await idle();
    assert.equal((await snapshot()).recycleCount, 1);
    await close();

    assertWithin(qa, original); assertWithin(qa, moved); assertNoLinks(original); assertNoLinks(moved);
    fs.renameSync(original, moved);
    await launch(moved, firstHome);
    data = await snapshot();
    assert.equal(data.dataDir, path.join(moved, firstDataRelative));
    assert.equal(data.locations.codex, path.join(moved, '工具 目录/Codex'));
    assert.equal(data.locations.dsh, path.join(moved, '工具 目录/Harness'));
    assert.equal(data.catalog.find(group => group.name === 'portable-alpha').tools.codex.state.enabled, false);
    assert.equal(data.catalog.find(group => group.name === 'portable-alpha').tools.dsh.state.enabled, false);
    await page.locator('#navigation [data-route="favorites"]').click();
    assert.equal(await page.locator('[data-skill="portable-alpha"]').count(), 1);
    await page.locator('#navigation [data-route="trash"]').click();
    await page.waitForSelector('[data-action="restore"]');
    await page.locator('[data-action="restore"]').click(); await idle();
    data = await snapshot();
    assert.equal(data.recycleCount, 0);
    assert.ok(data.catalog.every(group => group.complete));
    assert.equal(fs.existsSync(original), false);
    pass('moving the whole folder retains custom roots, disabled states, favorites and restoration into the new location');

    const native = await listNativeCodex(data.locations.codex, unrelatedCwd);
    const actual = native.data.flatMap(item => item.skills || []).filter(skill => skill.name.startsWith('portable-'));
    assert.equal(actual.length, 2); assert.ok(actual.every(skill => skill.enabled === false));
    const dshModule = require.resolve('@deepseek-ai/dsh-skill-filesystem', { paths: [path.join(process.env.APPDATA, 'npm/node_modules/@deepseek-ai/dsh')] });
    const { FileSystemSkillProvider } = await import(pathToFileURL(dshModule).href);
    const provider = new FileSystemSkillProvider({ get: () => undefined, logger: { warn: message => { throw new Error(message); } } }, { signal: new AbortController().signal, invalidate() {} }, { dshHome: data.locations.dsh, agentsHome: data.locations.dshAgents, watch: false });
    try {
      const candidates = await provider.list({});
      assert.equal(candidates.length, 2);
      assert.ok(candidates.every(skill => !skill.invocation.modelInvocable && !skill.invocation.userInvocable));
      const definition = await provider.get(candidates[0], {});
      assert.equal(readText(path.join(definition.resourceBase.path, 'assets/资源.txt')), 'Relative resource survives moving.');
    } finally { await provider.dispose(); }
    pass('native Codex and Harness loaders still resolve disabled skills and relative resources after the move');
    await close();

    await launch(moved, secondHome);
    const second = await snapshot();
    assert.equal(second.locations.codex, path.join(secondHome, '.codex'));
    assert.equal(second.locations.dsh, path.join(secondHome, '.dsh'));
    assert.notEqual(second.dataDir, data.dataDir);
    assert.equal(second.skills.length, 0); assert.equal(second.recycleCount, 0);
    assert.deepEqual(second.errors, []); assert.deepEqual(errors, []);
    pass('a different user receives a fresh profile and automatic local paths rather than the sender settings');
    await close();
    const report = { passed: true, version: require('../package.json').version, at: new Date().toISOString(), checks, rendererErrors: errors, fixture: f.directory, extractedAndMoved: moved };
    fs.writeFileSync(path.join(qa, 'portable-release-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) {
    if (page && app) await page.screenshot({ path: path.join(qa, 'portable-ui-failure.png') }).catch(() => {});
    throw error;
  } finally { await close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
