const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, addSkill, put } = require('./helpers.cjs');
const F = require('../src/files.cjs');
const { fs, path, readText, tree, exists } = F;

test('union synchronization fills four tools without duplicate OpenCode copies, retaining every config byte', () => {
  const { manager } = fixture('union');
  const codex = addSkill(manager, 'codex', 'research', 'research', { '.hidden/a.bin': Buffer.from([0, 255, 3]) });
  addSkill(manager, 'claude', 'writing');
  addSkill(manager, 'opencode', 'code');
  manager.setEnabled({ ids: [codex.id], provider: 'codex', enabled: false });
  const files = Object.values(manager.configPaths());
  const before = files.map(file => exists(file) ? fs.readFileSync(file) : null);
  const plan = manager.previewSyncAll();
  assert.equal(plan.skillCount, 3);
  assert.equal(plan.rows.length, 7);
  manager.applySync({ token: plan.token });
  const snapshot = manager.snapshot();
  assert.ok(snapshot.catalog.every(group => group.complete));
  // Existing OpenCode-only skills must not be shadowed by the Claude copy.
  assert.ok(snapshot.skills.every(skill => skill.duplicates.length === 0));
  assert.equal(tree(path.join(manager.locations.claude, 'skills/research')).digest, tree(codex.path).digest);
  assert.deepEqual(files.map(file => exists(file) ? fs.readFileSync(file) : null), before);
  assert.equal(manager.previewSyncAll().rows.length, 0);
});

test('official native versions remain in place and cloud toggles are independent of OpenCode', () => {
  const { manager } = fixture('cloud');
  put(path.join(manager.locations.codex, 'skills/.system/skill-creator/SKILL.md'), '---\nname: skill-creator\ndescription: Codex native\n---\nCodex version');
  put(path.join(manager.locations.claude, 'skills/synced/account/skill-creator/SKILL.md'), '---\nname: skill-creator\ndescription: Claude native\n---\nClaude version');
  // The default rule keeps Claude Code's own skills in Claude Code; without it the Harness copy is the only gap.
  assert.equal(manager.previewSyncAll().rows.length, 0);
  manager.setRules({ keepClaudeBuiltins: false });
  const plan = manager.previewSyncAll();
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].rootId, 'dsh');
  const cloud = manager.snapshot().skills.find(skill => skill.originKind === 'cloud');
  const digest = tree(cloud.path).digest;
  manager.setEnabled({ ids: [cloud.id], provider: 'claude', enabled: false });
  const snapshot = manager.snapshot();
  assert.equal(snapshot.catalog[0].tools.claude.state.enabled, false);
  assert.equal(snapshot.catalog[0].tools.opencode.state.enabled, true);
  assert.equal(JSON.parse(readText(manager.configPaths().claude)).skillOverrides['anthropic-skills:skill-creator'], 'off');
  assert.equal(tree(cloud.path).digest, digest);
});

test('cross-tool normalization preserves plugin original and support files, rejecting stale plans', () => {
  const { manager } = fixture('normalize');
  const dir = path.join(manager.locations.codex, 'plugins/cache/vendor/plugin/1/skills/presentations');
  put(path.join(dir, 'SKILL.md'), '---\nname: "Presentations"\ndescription: Presentations\n---\nBody unchanged.\n');
  put(path.join(dir, 'assets/样式.bin'), Buffer.from([1, 0, 254]));
  const digest = tree(dir).digest;
  let plan = manager.previewSyncAll();
  assert.equal(plan.rows.length, 2);
  assert.match(plan.rows[0].normalizedContent, /name: presentations/);
  put(path.join(dir, 'new.txt'), 'changed');
  assert.throws(() => manager.applySync({ token: plan.token }), /来源已变化/);
  fs.unlinkSync(path.join(dir, 'new.txt'));
  plan = manager.previewSyncAll();
  manager.applySync({ token: plan.token });
  assert.equal(tree(dir).digest, digest);
  assert.match(readText(path.join(manager.locations.claude, 'skills/presentations/SKILL.md')), /name: presentations/);
  assert.deepEqual(fs.readFileSync(path.join(manager.locations.claude, 'skills/presentations/assets/样式.bin')), Buffer.from([1, 0, 254]));
  assert.equal(manager.snapshot().catalog.length, 1);
});
