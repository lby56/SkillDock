// Read-only verification against the actual user's skill roots.
// Only the manager's own window data and this QA report are written.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { fs, path, hash, exists } = require('../src/files.cjs');
const { SkillManager } = require('../src/manager.cjs');
(async () => {
  const manager = new SkillManager(), snapshot = manager.snapshot();
  const configHashes = () => Object.fromEntries(Object.entries(manager.configPaths()).map(([provider, file]) => [provider, exists(file) ? hash(fs.readFileSync(file)) : null]));
  const before = configHashes();
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.SKILLDOCK_HOME; delete env.SKILLDOCK_DATA;
  const app = await electron.launch({ executablePath: path.join(__dirname, '..', 'dist', 'SkillDock-win32-x64', 'SkillDock.exe'), env });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.waitForSelector('.skill-row');
    assert.equal(await page.locator('.skill-row').count(), snapshot.skills.filter(skill => !skill.locked).length);
    const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => ({ visible: win.isVisible(), title: win.getTitle(), bounds: win.getBounds() })));
    assert.equal(visible[0].visible, true);
    await page.screenshot({ path: path.join(__dirname, '..', 'qa', 'real-library.png') });
    await page.locator('[data-route="library"][data-provider="codex"]').click();
    await page.locator('#status-filter').selectOption('off');
    assert.equal(await page.locator('.skill-row').count(), snapshot.skills.filter(skill => skill.states.codex?.enabled === false).length);
    await page.screenshot({ path: path.join(__dirname, '..', 'qa', 'real-codex-disabled.png') });
    await page.locator('[data-route="library"][data-provider="all"]').click();
    await page.locator('#status-filter').selectOption('managed');
    assert.equal(await page.locator('.skill-row').count(), snapshot.skills.filter(skill => skill.locked).length);
    assert.equal(await page.locator('#detail-panel [data-action="delete-one"]').isDisabled(), true);
    // Check the smallest supported window for horizontal clipping.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1080, 720));
    await page.locator('#status-filter').selectOption('local');
    const overflowing = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || document.querySelector('main').scrollWidth > document.querySelector('main').clientWidth);
    assert.equal(overflowing, false);
    await page.screenshot({ path: path.join(__dirname, '..', 'qa', 'real-compact.png') });
    assert.deepEqual(configHashes(), before);
    assert.deepEqual(errors, []);
    const result = { passed: true, counts: { personal: snapshot.skills.filter(skill => !skill.locked).length, managed: snapshot.skills.filter(skill => skill.locked).length, codexDisabled: snapshot.skills.filter(skill => skill.states.codex?.enabled === false).length }, originalConfigsUnchanged: true, visibleWindows: visible, rendererErrors: errors, at: new Date().toISOString() };
    fs.writeFileSync(path.join(__dirname, '..', 'qa', 'real-preview-report.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
