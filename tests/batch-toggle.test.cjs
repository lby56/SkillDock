const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, addSkill, put } = require('./helpers.cjs');
const { fs, readText, exists, hash } = require('../src/files.cjs');

test('multi-tool batch changes only selected skills and preserves independent tool settings', () => {
  const { manager } = fixture('batch');
  for (const name of ['chosen', 'untouched']) { addSkill(manager, 'codex', name); addSkill(manager, 'claude', name); }
  put(manager.configPaths().claude, '{"env":{"KEEP":"yes"},"skillOverrides":{"existing":"off"}}');
  const group = manager.snapshot().catalog.find(group => group.name === 'chosen');
  const result = manager.setEnabledBatch({ requests: ['codex', 'claude', 'opencode'].map(provider => ({ provider, enabled: false, ids: [group.tools[provider].id] })) });
  for (const provider of ['codex', 'claude', 'opencode']) {
    assert.equal(result.snapshot.catalog.find(group => group.name === 'chosen').tools[provider].state.enabled, false);
    assert.equal(result.snapshot.catalog.find(group => group.name === 'untouched').tools[provider].state.enabled, true);
  }
  const claude = JSON.parse(readText(manager.configPaths().claude));
  assert.equal(claude.env.KEEP, 'yes'); assert.equal(claude.skillOverrides.existing, 'off');
  const codeBefore = hash(fs.readFileSync(manager.configPaths().codex));
  manager.setEnabledBatch({ requests: [{ provider: 'claude', enabled: true, ids: [group.tools.claude.id] }] });
  assert.equal(hash(fs.readFileSync(manager.configPaths().codex)), codeBefore);
  assert.equal(manager.snapshot().catalog.find(group => group.name === 'chosen').tools.opencode.state.enabled, false);
});

test('invalid later configuration is caught before writing the first provider', () => {
  const { manager } = fixture('batch-invalid');
  const codex = addSkill(manager, 'codex', 'chosen'), claude = addSkill(manager, 'claude', 'chosen');
  put(manager.configPaths().codex, '# unchanged\nmodel = "original"\n');
  put(manager.configPaths().opencode, '{ invalid json');
  const before = fs.readFileSync(manager.configPaths().codex);
  assert.throws(() => manager.setEnabledBatch({ requests: [{ provider: 'codex', ids: [codex.id], enabled: false }, { provider: 'opencode', ids: [claude.id], enabled: false }] }), /JSON/);
  assert.deepEqual(fs.readFileSync(manager.configPaths().codex), before);
});

test('failed later write rolls back a newly created first config', () => {
  const { manager } = fixture('batch-rollback');
  const codex = addSkill(manager, 'codex', 'chosen'), claude = addSkill(manager, 'claude', 'chosen');
  const write = manager.backupConfig.bind(manager);
  manager.backupConfig = (config, text, reason) => {
    if (config.provider === 'claude') throw new Error('simulated write failure');
    return write(config, text, reason);
  };
  assert.throws(() => manager.setEnabledBatch({ requests: [{ provider: 'codex', ids: [codex.id], enabled: false }, { provider: 'claude', ids: [claude.id], enabled: false }] }), /已回退/);
  assert.equal(exists(manager.configPaths().codex), false);
  assert.equal(exists(manager.configPaths().claude), false);
});

test('rollback never overwrites another program change', () => {
  const { manager } = fixture('batch-concurrent');
  const codex = addSkill(manager, 'codex', 'chosen'), claude = addSkill(manager, 'claude', 'chosen');
  const write = manager.backupConfig.bind(manager);
  manager.backupConfig = (config, text, reason) => {
    if (config.provider === 'claude') { put(manager.configPaths().codex, 'model = "external-change"\n'); throw new Error('simulated write failure'); }
    return write(config, text, reason);
  };
  assert.throws(() => manager.setEnabledBatch({ requests: [{ provider: 'codex', ids: [codex.id], enabled: false }, { provider: 'claude', ids: [claude.id], enabled: false }] }), /被其他程序改动/);
  assert.match(readText(manager.configPaths().codex), /external-change/);
});
