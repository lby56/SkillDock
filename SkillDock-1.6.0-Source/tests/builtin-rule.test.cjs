const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, addSkill, put } = require('./helpers.cjs');
const { fs, path, readText, tree, exists } = require('../src/files.cjs');
const { parseJson } = require('../src/configs.cjs');
const { SkillManager } = require('../src/manager.cjs');

// Mirrors ~/.claude/skills/synced/<account>/ as written by claude.ai, including its manifest.
function cloud(manager, skills, account = 'account') {
  const directory = path.join(manager.locations.claude, 'skills', 'synced', account);
  for (const name of Object.keys(skills)) put(path.join(directory, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} from claude.ai\n---\nBody of ${name}.\n`);
  put(path.join(directory, 'manifest.json'), JSON.stringify({ skills: Object.entries(skills).map(([name, source]) => ({ skillId: name, name, source })) }));
  return directory;
}

test('Claude Code built-ins are recognised from the claude.ai manifest', () => {
  const { manager } = fixture('builtin-detect');
  cloud(manager, { docx: 'anthropic', learn: 'anthropic-example', mine: 'user' });
  put(path.join(manager.locations.claude, 'skills/synced/other/unknown/SKILL.md'), '---\nname: unknown\ndescription: No manifest\n---\nUnknown.');
  addSkill(manager, 'claude', 'personal');
  const builtin = Object.fromEntries(manager.snapshot().skills.map(skill => [skill.name, skill.builtin]));
  assert.deepEqual(builtin, { docx: true, learn: true, mine: false, unknown: true, personal: false });
});

test('sync all keeps built-ins in Claude Code and still fills other skills', () => {
  const { manager } = fixture('builtin-sync');
  cloud(manager, { docx: 'anthropic', mine: 'user' });
  addSkill(manager, 'codex', 'research');
  let plan = manager.previewSyncAll();
  assert.deepEqual(plan.rows.map(row => `${row.name}>${row.rootId}`).sort(), ['mine>codex', 'mine>dsh', 'research>claude', 'research>dsh']);
  assert.equal(plan.excludedSkills, 1);
  manager.applySync({ token: plan.token });
  assert.equal(exists(path.join(manager.locations.codex, 'skills/docx')), false);
  assert.equal(exists(path.join(manager.locations.dsh, 'skills/docx')), false);
  const docx = manager.snapshot().catalog.find(group => group.name === 'docx');
  assert.deepEqual(docx.excluded, ['codex', 'opencode', 'dsh']);
  assert.equal(docx.complete, true);
  assert.equal(manager.previewSyncAll().rows.length, 0);
  manager.setRules({ keepClaudeBuiltins: false });
  plan = manager.previewSyncAll();
  assert.deepEqual(plan.rows.map(row => `${row.name}>${row.rootId}`).sort(), ['docx>codex', 'docx>dsh']);
  assert.equal(manager.snapshot().catalog.find(group => group.name === 'docx').complete, false);
});

test('manual sync blocks copying a built-in outside Claude Code unless the rule is off', () => {
  const { manager } = fixture('builtin-manual');
  cloud(manager, { xlsx: 'anthropic' });
  const xlsx = manager.snapshot().skills.find(skill => skill.name === 'xlsx');
  let plan = manager.previewSync({ ids: [xlsx.id], targets: ['codex', 'dsh', 'shared'] });
  assert.deepEqual(plan.rows.map(row => row.state), ['blocked', 'blocked', 'blocked']);
  assert.match(plan.rows[0].blocked, /只留在 Claude Code/);
  manager.applySync({ token: plan.token });
  assert.equal(exists(path.join(manager.locations.codex, 'skills/xlsx')), false);
  manager.setRules({ keepClaudeBuiltins: false });
  plan = manager.previewSync({ ids: [xlsx.id], targets: ['codex'] });
  assert.equal(plan.rows[0].state, 'new');
});

test('rule cleanup archives copies in other tools, disables OpenCode and leaves tool-owned versions', () => {
  const { manager } = fixture('builtin-cleanup');
  const account = cloud(manager, { docx: 'anthropic', 'skill-creator': 'anthropic-example', mine: 'user' });
  const copy = addSkill(manager, 'codex', 'docx', 'Old copy.');
  addSkill(manager, 'dsh', 'docx', 'Harness copy.');
  addSkill(manager, 'codex', 'mine');
  put(path.join(manager.locations.codex, 'skills/.system/skill-creator/SKILL.md'), '---\nname: skill-creator\ndescription: Codex native\n---\nCodex version');
  const cloudDigest = tree(path.join(account, 'docx')).digest;
  const report = manager.snapshot().builtinReport;
  assert.deepEqual(report.copies.map(item => `${item.rootId}:${item.name}`).sort(), ['codex:docx', 'dsh:docx']);
  assert.deepEqual(report.openCode.map(item => item.name).sort(), ['docx', 'skill-creator']);
  const stale = manager.previewBuiltinCleanup();
  put(path.join(copy.path, 'extra.txt'), 'changed');
  assert.throws(() => manager.applyBuiltinCleanup(stale.token), /已变化/);
  fs.unlinkSync(path.join(copy.path, 'extra.txt'));
  const result = manager.applyBuiltinCleanup(manager.previewBuiltinCleanup().token);
  assert.match(result.message, /2 个副本/);
  assert.equal(exists(copy.path), false);
  assert.equal(exists(path.join(manager.locations.dsh, 'skills/docx')), false);
  assert.equal(exists(path.join(manager.locations.codex, 'skills/mine/SKILL.md')), true);
  assert.equal(exists(path.join(manager.locations.codex, 'skills/.system/skill-creator/SKILL.md')), true);
  const permissions = parseJson(readText(manager.configPaths().opencode)).permission.skill;
  assert.equal(permissions.docx, 'deny'); assert.equal(permissions['skill-creator'], 'deny'); assert.equal(permissions.mine, undefined);
  assert.equal(exists(manager.configPaths().claude), false);
  assert.equal(tree(path.join(account, 'docx')).digest, cloudDigest);
  const after = manager.snapshot().builtinReport;
  assert.deepEqual([after.copies, after.openCode], [[], []]);
  assert.throws(() => manager.previewBuiltinCleanup(), /没有与同步规则不符/);
  const records = manager.recycleBin().filter(record => record.reason === 'rule');
  assert.equal(records.length, 2);
  manager.restore(records.find(record => record.rootId === 'codex').id);
  assert.equal(readText(path.join(copy.path, 'SKILL.md')).includes('Old copy.'), true);
});

test('the rule is on by default, persists when turned off and rejects invalid values', () => {
  const { manager, home, dataDir } = fixture('builtin-setting');
  assert.equal(manager.snapshot().rules.keepClaudeBuiltins, true);
  manager.setRules({ keepClaudeBuiltins: false });
  const reopened = new SkillManager({ home, dataDir });
  assert.equal(reopened.snapshot().rules.keepClaudeBuiltins, false);
  assert.throws(() => reopened.setRules({ keepClaudeBuiltins: 'no' }), /无效/);
  assert.throws(() => reopened.previewBuiltinCleanup(), /已关闭/);
});
