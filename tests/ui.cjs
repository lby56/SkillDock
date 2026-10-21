const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { fixture, addSkill, put } = require('./helpers.cjs');
const { fs, path, readText, tree, exists } = require('../src/files.cjs');
const { parseJson } = require('../src/configs.cjs');
const TOML = require('smol-toml');

(async () => {
  const f = fixture('ui');
  const a = addSkill(f.manager, 'codex', 'research-helper', 'Read sources and build reproducible research.', { 'references/中文.md': '参考材料', 'scripts/run.py': 'print("hello")' });
  const w = addSkill(f.manager, 'codex', 'writing-assistant', 'Write clear, structured documents.');
  fs.utimesSync(w.file, 0, 0);
  addSkill(f.manager, 'claude', 'code-review', 'Review code for correctness and clarity.');
  addSkill(f.manager, 'shared', 'shared-workflow', 'A shared workflow across tools.');
  const exe = process.env.SKILLDOCK_TEST_EXE || require('electron');
  const launchEnv = { ...process.env, SKILLDOCK_HOME: f.home, SKILLDOCK_DATA: f.dataDir };
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: exe, args: process.env.SKILLDOCK_TEST_EXE ? [] : [path.join(__dirname, '..')], env: launchEnv });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const screenshots = path.join(__dirname, '..', 'qa'); fs.mkdirSync(screenshots, { recursive: true });
  const step = async (label, action) => { await action(); console.log(`PASS ${label}`); };
  try {
    await page.waitForSelector('[data-overview-skill="research-helper"]');
    await page.locator('[data-route="library"][data-provider="all"]').click();
    await page.waitForSelector('[data-skill="research-helper"]');
    await step('library shows discovered skills', async () => {
      assert.equal(await page.locator('.skill-row').count(), 4);
      await page.screenshot({ path: path.join(screenshots, '01-library.png') });
    });
    await step('search and keyboard focus', async () => {
      await page.keyboard.press('Control+k');
      await page.locator('#search').fill('research');
      assert.equal(await page.locator('.skill-row').count(), 1);
      await page.locator('#search').fill('');
    });
    await step('detail panel shows unknown time for epoch timestamps', async () => {
      await page.locator('[data-skill="writing-assistant"] .skill-desc').click();
      await page.waitForFunction(() => document.querySelector('#detail-panel h2')?.textContent === 'writing-assistant');
      assert.match(await page.locator('#detail-panel .detail-meta').innerText(), /更新时间\s*未知/);
    });
    await step('Codex native toggle off and on', async () => {
      await page.locator('[data-route="library"][data-provider="codex"]').click();
      const toggle = page.locator('[data-skill="research-helper"] [data-action="toggle"]');
      await toggle.click();
      await page.waitForFunction(() => document.querySelector('[data-skill="research-helper"] [data-action="toggle"]').getAttribute('aria-checked') === 'false');
      assert.equal(TOML.parse(readText(f.manager.configPaths().codex)).skills.config[0].enabled, false);
      await toggle.click();
      await page.waitForFunction(() => document.querySelector('[data-skill="research-helper"] [data-action="toggle"]').getAttribute('aria-checked') === 'true');
    });
    await step('skill content and support files preview', async () => {
      await page.locator('[data-skill="research-helper"]').click();
      await page.locator('[data-action="preview-content"]').click();
      await page.waitForSelector('.source-preview');
      assert.match(await page.locator('.source-preview').innerText(), /reproducible/);
      await page.locator('[data-tab="files"]').click();
      assert.equal(await page.locator('.file-row').count(), 3);
      await page.locator('.modal-header [data-action="close-modal"]').click();
    });
    await step('sync preview and copy via visible UI', async () => {
      await page.locator('[data-action="sync-one"]').click();
      await page.locator('[data-quick-target="opencode"]').uncheck();
      await page.locator('[data-action="quick-preview-sync"]').click();
      await page.waitForSelector('[data-action="apply-sync"]');
      await page.screenshot({ path: path.join(screenshots, '02-sync-preview.png') });
      await page.locator('[data-action="apply-sync"]').click();
      await page.waitForFunction(() => !document.querySelector('#modal').open);
      const target = path.join(f.manager.locations.claude, 'skills', 'research-helper');
      assert.equal(tree(target).digest, tree(a.path).digest);
    });
    await step('delete and restore through recycle bin', async () => {
      await page.locator('[data-skill="research-helper"]').click();
      await page.locator('[data-action="delete-one"]').click();
      await page.locator('[data-action="confirm-delete"]').click();
      await page.waitForFunction(() => !document.querySelector('#modal').open);
      assert.equal(exists(a.path), false);
      await page.locator('[data-route="trash"]').click();
      await page.waitForSelector('[data-action="restore"]');
      await page.screenshot({ path: path.join(screenshots, '03-recycle-bin.png') });
      await page.locator('[data-action="restore"]').click();
      await page.waitForSelector('#records .empty');
      assert.equal(exists(a.path), true);
    });
    await step('Claude and OpenCode settings remain independent', async () => {
      await page.locator('[data-route="library"][data-provider="claude"]').click();
      await page.locator('[data-skill="code-review"] [data-action="toggle"]').click();
      await page.waitForFunction(() => document.querySelector('[data-skill="code-review"] [data-action="toggle"]').getAttribute('aria-checked') === 'false');
      assert.equal(parseJson(readText(f.manager.configPaths().claude)).skillOverrides['code-review'], 'off');
      assert.equal(exists(f.manager.configPaths().opencode), false);
    });
    await step('favorites and navigation', async () => {
      await page.locator('[data-route="library"][data-provider="all"]').click();
      await page.locator('[data-skill="research-helper"]').first().locator('[data-action="favorite"]').click();
      await page.locator('[data-route="favorites"]').click();
      await page.waitForSelector('.skill-row');
      assert.equal(await page.locator('.skill-row').count(), 1);
      await page.locator('[data-route="settings"]').click();
      assert.equal(await page.locator('#location-codex').inputValue(), '');
      assert.ok((await page.locator('#location-codex').getAttribute('placeholder')).includes(f.manager.locations.codex));
      await page.screenshot({ path: path.join(screenshots, '04-settings.png') });
      await page.locator('[data-route="history"]').click();
      await page.waitForSelector('.list-record');
      assert.ok(await page.locator('.list-record').count() >= 5);
    });
    assert.deepEqual(errors, []);
    const report = { passed: true, fixture: f.directory, executable: exe, checks: 9, rendererErrors: errors, at: new Date().toISOString() };
    fs.writeFileSync(path.join(screenshots, process.env.SKILLDOCK_TEST_EXE ? 'packaged-ui-report.json' : 'ui-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
