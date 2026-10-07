const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, addSkill } = require('./helpers.cjs');
const { exists } = require('../src/files.cjs');
test('consolidating shared skills preserves Codex disabled state after its path changes', () => {
  const { manager } = fixture('shared-state');
  const original = addSkill(manager, 'shared', 'shared-workflow');
  manager.setEnabled({ ids: [original.id], provider: 'codex', enabled: false });
  const plan = manager.previewSyncAll();
  assert.equal(plan.rows.length, 3);
  assert.equal(plan.stateTransfers.length, 1);
  manager.applySync({ token: plan.token });
  const result = manager.snapshot();
  assert.equal(result.catalog[0].tools.codex.state.enabled, false);
  assert.equal(result.catalog[0].tools.opencode.state.enabled, true);
  assert.ok(result.skills.every(skill => !skill.duplicates.length));
  assert.equal(exists(original.path), false);
});
