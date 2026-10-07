const { test } = require('node:test');
const assert = require('node:assert/strict');
const TOML = require('smol-toml');
const AdmZip = require('adm-zip');
const F = require('../src/files.cjs');
const C = require('../src/configs.cjs');
const { fixture, addSkill, put } = require('./helpers.cjs');
const { fs, path, tree, exists, readText } = F;

test('inventory recognizes native Codex disabled entries and shared discovery', () => {
  const { manager } = fixture('inventory');
  const skill = addSkill(manager, 'codex', 'example');
  addSkill(manager, 'claude', 'claude-example');
  addSkill(manager, 'shared', 'shared-example');
  put(manager.configPaths().codex, `# preserve me\nmodel = 'test'\n[[skills.config]]\npath = ${JSON.stringify(skill.file)}\nenabled = false\n`);
  const s = manager.snapshot();
  assert.equal(s.skills.find(x => x.id === skill.id).states.codex.enabled, false);
  assert.deepEqual(s.skills.find(x => x.name === 'claude-example').providers, ['claude', 'opencode']);
  assert.deepEqual(s.skills.find(x => x.name === 'shared-example').providers, ['codex', 'opencode', 'dsh']);
  assert.equal(s.errors.length, 0);
});

test('Codex toggles preserve unrelated config, comments, BOM, files and exact backup', () => {
  const { manager } = fixture('codex');
  const skill = addSkill(manager, 'codex', 'example');
  const old = `\uFEFF# model comment\r\nmodel = 'stay-the-same'\r\n\r\n[[skills.config]]\r\npath = ${JSON.stringify(skill.file)}\r\nenabled = false # retain this comment\r\n\r\n[features]\r\nmulti_agent = true\r\n`;
  put(manager.configPaths().codex, old);
  const original = tree(skill.path).digest;
  manager.setEnabled({ ids: [skill.id], provider: 'codex', enabled: true });
  const bytes = fs.readFileSync(manager.configPaths().codex);
  assert.deepEqual(bytes.subarray(0, 3), Buffer.from([239, 187, 191]));
  assert.match(bytes.toString(), /enabled = true # retain this comment/);
  assert.match(bytes.toString(), /model = 'stay-the-same'/);
  assert.equal(TOML.parse(readText(manager.configPaths().codex)).features.multi_agent, true);
  assert.equal(tree(skill.path).digest, original);
  const backup = manager.history()[0].backup;
  assert.equal(fs.readFileSync(path.join(backup, 'original'), 'utf8'), old);
  manager.setEnabled({ ids: [skill.id], provider: 'codex', enabled: false });
  assert.equal(manager.snapshot().skills[0].states.codex.enabled, false);
});

test('Codex appends valid entries and supports batch toggles without replacing settings', () => {
  const { manager } = fixture('codex-batch');
  const a = addSkill(manager, 'codex', 'alpha'), b = addSkill(manager, 'shared', 'beta');
  put(manager.configPaths().codex, '# hello\n[features]\nfoo = true\n');
  manager.setEnabled({ ids: [a.id, b.id], provider: 'codex', enabled: false });
  const config = TOML.parse(readText(manager.configPaths().codex));
  assert.equal(config.skills.config.length, 2);
  assert.equal(config.features.foo, true);
  assert.equal(config.skills.config.every(x => x.enabled === false), true);
});

test('Claude toggles use skillOverrides and leave SKILL.md and unrelated settings unchanged', () => {
  const { manager } = fixture('claude');
  const skill = addSkill(manager, 'claude', 'example');
  put(manager.configPaths().claude, '{\n  // keep this\n  "permissions": {"defaultMode": "auto"},\n  "skillOverrides": {"other": "user-invocable-only"}\n}\n');
  const original = tree(skill.path).digest;
  manager.setEnabled({ ids: [skill.id], provider: 'claude', enabled: false });
  const config = C.parseJson(readText(manager.configPaths().claude));
  assert.equal(config.skillOverrides.example, 'off');
  assert.equal(config.skillOverrides.other, 'user-invocable-only');
  assert.equal(config.permissions.defaultMode, 'auto');
  assert.match(readText(manager.configPaths().claude), /keep this/);
  assert.equal(tree(skill.path).digest, original);
  assert.equal(manager.snapshot().skills[0].states.opencode.enabled, true);
  manager.setEnabled({ ids: [skill.id], provider: 'claude', enabled: true });
  assert.equal(C.parseJson(readText(manager.configPaths().claude)).skillOverrides.example, 'on');
});

test('OpenCode respects ordered wildcard rules and preserves unrelated JSONC comments', () => {
  const { manager } = fixture('opencode');
  const skill = addSkill(manager, 'opencode', 'example');
  const config = path.join(manager.locations.opencode, 'opencode.jsonc');
  put(config, '{\n // header\n "permission": {\n  "skill": {"example":"deny", "*":"deny"},\n  // sensitive read policy\n  "read": {"*.pdf":"deny"},\n  "*":"ask"\n },\n "provider": {"test":{"name":"test"}}\n}\n');
  manager.setEnabled({ ids: [skill.id], provider: 'opencode', enabled: true });
  const text = readText(config), data = C.parseJson(text);
  assert.equal(C.openPermission(data, 'example'), 'allow');
  assert.equal(C.openPermission(data, 'other'), 'deny');
  assert.match(text, /sensitive read policy/);
  assert.equal(data.permission.read['*.pdf'], 'deny');
  assert.equal(data.provider.test.name, 'test');
  manager.setEnabled({ ids: [skill.id], provider: 'opencode', enabled: false });
  assert.equal(manager.snapshot().skills[0].states.opencode.enabled, false);
});

test('OpenCode scalar permissions are retained as defaults', () => {
  const { manager } = fixture('scalar');
  const skill = addSkill(manager, 'opencode', 'example');
  put(manager.configPaths().opencode, '{"permission":"ask"}');
  manager.setEnabled({ ids: [skill.id], provider: 'opencode', enabled: false });
  const data = C.parseJson(readText(manager.configPaths().opencode));
  assert.equal(data.permission['*'], 'ask');
  assert.equal(C.openPermission(data, 'example'), 'deny');
  assert.equal(C.openPermission(data, 'other'), 'ask');
});

test('invalid configuration is surfaced and is never overwritten', () => {
  const { manager } = fixture('invalid');
  const skill = addSkill(manager, 'claude', 'example');
  const original = '{"broken":';
  put(manager.configPaths().claude, original);
  const snapshot = manager.snapshot();
  assert.ok(snapshot.errors.length);
  assert.equal(snapshot.skills[0].states.claude.enabled, null);
  assert.throws(() => manager.setEnabled({ ids: [skill.id], provider: 'claude', enabled: false }));
  assert.equal(readText(manager.configPaths().claude), original);
});

test('sync copies full trees including binary resources, unicode and empty directories', () => {
  const { manager } = fixture('sync');
  const skill = addSkill(manager, 'codex', 'example', '你好，技能。', { 'references/中文.md': '中文参考', 'assets/image.bin': Buffer.from([0, 255, 7, 3]), '.hidden': 'hidden data' });
  fs.mkdirSync(path.join(skill.path, 'empty'));
  const before = tree(skill.path).digest;
  const plan = manager.previewSync({ ids: [skill.id], targets: ['claude', 'opencode'] });
  assert.deepEqual(plan.rows.map(row => row.state), ['new', 'new']);
  manager.applySync({ token: plan.token });
  for (const row of plan.rows) assert.equal(tree(row.destination).digest, before);
  const again = manager.previewSync({ ids: [skill.id], targets: ['claude'] });
  assert.equal(again.rows[0].state, 'same');
});

test('conflicts skip by default, explicit overwrite archives removed target-only files', () => {
  const { manager } = fixture('conflict');
  const source = addSkill(manager, 'codex', 'example', 'new', { 'scripts/main.py': 'print(1)' });
  const target = addSkill(manager, 'claude', 'example', 'old', { 'old-only.txt': 'preserve me' });
  const oldDigest = tree(target.path).digest;
  let plan = manager.previewSync({ ids: [source.id], targets: ['claude'] });
  assert.equal(plan.rows[0].state, 'conflict');
  assert.ok(plan.rows[0].changes.some(x => x.path === 'old-only.txt' && x.status === 'remove'));
  manager.applySync({ token: plan.token });
  assert.equal(tree(target.path).digest, oldDigest);
  plan = manager.previewSync({ ids: [source.id], targets: ['claude'] });
  manager.applySync({ token: plan.token, overwrite: true });
  assert.equal(tree(target.path).digest, tree(source.path).digest);
  const backup = manager.recycleBin()[0];
  assert.equal(backup.reason, 'sync-overwrite');
  assert.equal(tree(path.join(manager.dataDir, 'trash', backup.id, 'payload')).digest, oldDigest);
  assert.throws(() => manager.restore(backup.id), /已存在/);
  manager.deleteSkills(manager.previewDelete([target.id]).token);
  manager.restore(backup.id);
  assert.equal(tree(target.path).digest, oldDigest);
});

test('sync refuses changed source or destination after preview before writing any row', () => {
  const { manager } = fixture('stale');
  const a = addSkill(manager, 'codex', 'alpha'), b = addSkill(manager, 'codex', 'beta');
  const plan = manager.previewSync({ ids: [a.id, b.id], targets: ['claude'] });
  put(path.join(b.path, 'changed.txt'), 'changed after preview');
  assert.throws(() => manager.applySync({ token: plan.token }), /变化/);
  assert.equal(exists(plan.rows[0].destination), false);
  const next = manager.previewSync({ ids: [a.id], targets: ['claude'] });
  put(path.join(next.rows[0].destination, 'SKILL.md'), 'another application wrote this');
  assert.throws(() => manager.applySync({ token: next.token }), /目标已变化/);
  assert.equal(readText(path.join(next.rows[0].destination, 'SKILL.md')), 'another application wrote this');
});

test('delete and restore preserve every file and refuse stale confirmation', () => {
  const { manager } = fixture('restore');
  const skill = addSkill(manager, 'codex', 'example', 'local data', { 'assets/数据.bin': Buffer.from([9, 8, 7]) });
  const firstPlan = manager.previewDelete([skill.id]);
  put(path.join(skill.path, 'extra.txt'), 'new file');
  assert.throws(() => manager.deleteSkills(firstPlan.token), /变化/);
  const digest = tree(skill.path).digest;
  manager.deleteSkills(manager.previewDelete([skill.id]).token);
  assert.equal(exists(skill.path), false);
  const record = manager.recycleBin()[0];
  assert.equal(record.digest, digest);
  manager.restore(record.id);
  assert.equal(tree(skill.path).digest, digest);
  assert.equal(manager.recycleBin().length, 0);
});

test('duplicate sources targeting one name require explicit source choice', () => {
  const { manager } = fixture('duplicates');
  const a = addSkill(manager, 'codex', 'example'), b = addSkill(manager, 'claude', 'example', 'different');
  assert.throws(() => manager.previewSync({ ids: [a.id, b.id], targets: ['opencode'] }), /多个来源/);
});

test('protected skill files cannot be deleted; native toggles work except for links', () => {
  const { manager, directory } = fixture('protected');
  put(path.join(manager.locations.codex, 'skills', '.system', 'internal', 'SKILL.md'), '---\nname: internal\ndescription: Builtin\n---\nSystem.');
  put(path.join(manager.locations.claude, 'skills', 'synced', 'account', 'cloud', 'SKILL.md'), '---\nname: cloud\ndescription: Synced\n---\nCloud.');
  put(path.join(manager.locations.codex, 'plugins', 'cache', 'plugin', '1', 'skills', 'plug', 'SKILL.md'), '---\nname: plug\ndescription: Plugin\n---\nPlugin.');
  const external = path.join(directory, 'external');
  put(path.join(external, 'SKILL.md'), '---\nname: linked\ndescription: Link\n---\nExternal.');
  fs.symlinkSync(external, path.join(manager.locations.codex, 'skills', 'linked'), 'junction');
  const skills = manager.snapshot().skills;
  assert.equal(skills.length, 4);
  for (const skill of skills) {
    assert.equal(skill.locked, true);
    assert.throws(() => manager.previewDelete([skill.id]));
    const before = fs.readFileSync(skill.file);
    if (skill.name === 'linked') assert.throws(() => manager.setEnabled({ ids: [skill.id], provider: skill.providers[0], enabled: false }));
    else { manager.setEnabled({ ids: [skill.id], provider: skill.providers[0], enabled: false }); assert.equal(manager.getSkill(skill.id).states[skill.providers[0]].enabled, false); }
    assert.deepEqual(fs.readFileSync(skill.file), before);
  }
  assert.equal(exists(path.join(external, 'SKILL.md')), true);
});

test('export/import ZIP round trip retains Chinese names, hidden resources and binary bytes', () => {
  const { manager, directory } = fixture('zip');
  const skill = addSkill(manager, 'codex', 'example', '中文', { 'assets/中文.bin': Buffer.from([7, 0, 250]), '.hidden/config': 'hidden' });
  const zip = path.join(directory, 'export.zip');
  manager.exportZip([skill.id], zip);
  const imported = manager.importZip(zip);
  const plan = manager.previewSync({ ids: imported.skills.map(x => x.id), targets: ['claude'], importToken: imported.importToken });
  manager.applySync({ token: plan.token });
  assert.equal(tree(plan.rows[0].destination).digest, tree(skill.path).digest);
});

test('folder import allows selecting a subset and validates target names', () => {
  const { manager, directory } = fixture('import-subset');
  const importRoot = path.join(directory, 'import');
  for (const name of ['alpha', 'beta']) put(path.join(importRoot, name, 'SKILL.md'), `---\nname: ${name}\ndescription: Example\n---\nContent.`);
  const imported = manager.importFolder(importRoot);
  const plan = manager.previewSync({ ids: [imported.skills[0].id], targets: ['opencode'], importToken: imported.importToken });
  assert.equal(plan.rows.length, 1);
  manager.applySync({ token: plan.token });
  assert.equal(manager.snapshot().skills.length, 1);
});

test('ZIP traversal and reserved Windows names are rejected', () => {
  const { manager, directory } = fixture('bad-zip');
  // A trailing period aliases a different file on Windows and must not be extracted.
  const zip = new AdmZip(); zip.addFile('example/CON.txt', Buffer.from('bad'));
  const file = path.join(directory, 'bad.zip'); zip.writeZip(file);
  assert.throws(() => manager.importZip(file));
  assert.equal(exists(path.join(directory, 'CON.txt')), false);
});

test('native configurations are untouched by read-only inventory and details', () => {
  const { manager } = fixture('read-only');
  const skill = addSkill(manager, 'codex', 'example');
  for (const [provider, file] of Object.entries(manager.configPaths())) put(file, provider === 'codex' ? 'model = "untouched"\n' : '{ "untouched": true }\n');
  const before = Object.fromEntries(Object.entries(manager.configPaths()).map(([provider, file]) => [provider, F.hash(fs.readFileSync(file))]));
  manager.snapshot(); manager.detail(skill.id);
  const after = Object.fromEntries(Object.entries(manager.configPaths()).map(([provider, file]) => [provider, F.hash(fs.readFileSync(file))]));
  assert.deepEqual(after, before);
});
