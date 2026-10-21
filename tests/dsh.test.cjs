const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { fixture, addSkill, put } = require('./helpers.cjs');
const F = require('../src/files.cjs');
const DSH = require('../src/dsh.cjs');
const { fs, path, readText, tree, hash } = F;

test('Harness reads only native global depth and restores manual-only invocation without touching body or resources', () => {
  const { manager } = fixture('dsh-native');
  const s = addSkill(manager, 'dsh', 'manual-helper', '请读取 references/说明.txt。\r\n', { 'references/说明.txt': '资源不变' });
  put(s.file, '\uFEFF---\r\nname: manual-helper\r\ndescription: "Test skill" # retained\r\ndisable-model-invocation: true\r\nmetadata:\r\n  custom: yes\r\n---\r\n\r\n正文完全保留。\r\n');
  put(path.join(manager.locations.dsh, 'skills/nested/ignored/SKILL.md'), '---\nname: ignored\ndescription: nested\n---\nBody');
  put(path.join(manager.locations.dsh, 'skills/.system/builtin/SKILL.md'), '---\nname: builtin\ndescription: protected\n---\nBody');
  const resource = hash(fs.readFileSync(path.join(s.path, 'references/说明.txt')));
  const body = DSH.parse(readText(s.file)).match[4];
  assert.equal(manager.snapshot().skills.length, 1);
  assert.equal(manager.getSkill(s.id).states.dsh.mode, 'manual');
  manager.setEnabled({ ids: [s.id], provider: 'dsh', enabled: false });
  assert.equal(manager.getSkill(s.id).states.dsh.enabled, false);
  assert.deepEqual([DSH.parse(readText(s.file)).model, DSH.parse(readText(s.file)).user], [false, false]);
  const disabled = fs.readFileSync(s.file);
  manager.setEnabled({ ids: [s.id], provider: 'dsh', enabled: false });
  assert.deepEqual(fs.readFileSync(s.file), disabled);
  manager.setEnabled({ ids: [s.id], provider: 'dsh', enabled: true });
  const restored = DSH.parse(readText(s.file));
  assert.deepEqual([restored.model, restored.user], [false, true]);
  assert.equal(restored.match[4], body);
  assert.equal(restored.data.metadata.custom, 'yes');
  assert.match(readText(s.file), /# retained/);
  assert.equal(readText(s.file).includes('skilldock-original-invocation'), false);
  assert.equal(fs.readFileSync(s.file).subarray(0, 3).toString('hex'), 'efbbbf');
  assert.equal(hash(fs.readFileSync(path.join(s.path, 'references/说明.txt'))), resource);
});

test('four-provider transaction rolls back Harness skill files and earlier config when a later file fails', () => {
  const { manager } = fixture('dsh-rollback');
  const codex = addSkill(manager, 'codex', 'alpha'), first = addSkill(manager, 'dsh', 'alpha'), second = addSkill(manager, 'dsh', 'beta');
  const before = fs.readFileSync(first.file);
  const write = manager.backupConfig.bind(manager);
  manager.backupConfig = (config, text, reason) => {
    if (config.file === second.file) throw new Error('simulated failure');
    return write(config, text, reason);
  };
  assert.throws(() => manager.setEnabledBatch({ requests: [{ provider: 'codex', ids: [codex.id], enabled: false }, { provider: 'dsh', ids: [first.id, second.id], enabled: false }] }), /回退/);
  assert.deepEqual(fs.readFileSync(first.file), before);
  assert.equal(fs.existsSync(manager.configPaths().codex), false);
});

test('shared Harness skills stay read-only until dedicated synchronization, with independent switches', () => {
  const { manager } = fixture('dsh-shared');
  const shared = addSkill(manager, 'shared', 'common-helper');
  const before = tree(shared.path).digest;
  assert.equal(shared.states.dsh.canToggle, false);
  assert.throws(() => manager.setEnabled({ ids: [shared.id], provider: 'dsh', enabled: false }));
  const plan = manager.previewSync({ ids: [shared.id], targets: ['dsh'] });
  manager.applySync({ token: plan.token });
  const dedicated = manager.snapshot().catalog[0].tools.dsh;
  assert.equal(dedicated.rootId, 'dsh');
  manager.setEnabled({ ids: [dedicated.id], provider: 'dsh', enabled: false });
  assert.equal(manager.snapshot().catalog[0].tools.dsh.state.enabled, false);
  assert.equal(manager.getSkill(shared.id).states.codex.enabled, true);
  assert.equal(tree(shared.path).digest, before);
});

test('Harness disable state is local: export and cross-tool sync restore source invocation, overwrite retains target disabled state', () => {
  const { manager, directory } = fixture('dsh-transfer');
  const dsh = addSkill(manager, 'dsh', 'portable-helper', 'Body one.', { 'assets/a.bin': Buffer.from([1, 2, 255]) });
  manager.setEnabled({ ids: [dsh.id], provider: 'dsh', enabled: false });
  const disabledDigest = tree(dsh.path).digest;
  let plan = manager.previewSync({ ids: [dsh.id], targets: ['claude'] });
  manager.applySync({ token: plan.token });
  const claude = manager.snapshot().skills.find(skill => skill.rootId === 'claude');
  assert.equal(DSH.parse(readText(claude.file)).model, true);
  assert.equal(tree(dsh.path).digest, disabledDigest);
  plan = manager.previewSync({ ids: [dsh.id], targets: ['claude'] });
  assert.equal(plan.rows[0].state, 'same');
  const zip = path.join(directory, 'export.zip');
  manager.exportZip([dsh.id], zip);
  const imported = manager.importZip(zip);
  assert.equal(DSH.parse(readText(imported.skills[0].file)).model, true);
  put(claude.file, readText(claude.file).replace('Body one.', 'Body two.'));
  plan = manager.previewSync({ ids: [claude.id], targets: ['dsh'] });
  manager.applySync({ token: plan.token, overwrite: true });
  assert.equal(manager.getSkill(dsh.id).states.dsh.enabled, false);
  assert.match(readText(dsh.file), /Body two/);
  manager.setEnabled({ ids: [dsh.id], provider: 'dsh', enabled: true });
  assert.equal(manager.getSkill(dsh.id).states.dsh.enabled, true);
});

test('flat Harness Markdown supports toggling, export, deletion and restoration while sibling files survive', () => {
  const { manager, directory } = fixture('dsh-flat');
  const file = path.join(manager.locations.dsh, 'skills/flat-helper.md');
  put(file, '---\nname: flat-helper\ndescription: Flat helper\n---\nFlat body.');
  put(path.join(path.dirname(file), 'unrelated.txt'), 'Keep');
  const skill = manager.snapshot().skills[0];
  assert.equal(skill.layout, 'file');
  manager.setEnabled({ ids: [skill.id], provider: 'dsh', enabled: false });
  const before = fs.readFileSync(file);
  const zip = path.join(directory, 'flat.zip'); manager.exportZip([skill.id], zip);
  assert.equal(manager.importZip(zip).skills[0].name, 'flat-helper');
  const plan = manager.previewDelete([skill.id]); manager.deleteSkills(plan.token);
  assert.equal(fs.existsSync(file), false);
  assert.equal(readText(path.join(path.dirname(file), 'unrelated.txt')), 'Keep');
  manager.restore(manager.recycleBin()[0].id);
  assert.deepEqual(fs.readFileSync(file), before);
});

test('installed Harness provider observes the real invocation policy and resolves resource directories', async t => {
  const globalDsh = path.join(process.env.APPDATA || '', 'npm/node_modules/@deepseek-ai/dsh');
  let entry;
  try { entry = require.resolve('@deepseek-ai/dsh-skill-filesystem', { paths: [globalDsh] }); }
  catch { return t.skip('Harness package is not installed on this test machine.'); }
  const { FileSystemSkillProvider } = await import(pathToFileURL(entry).href);
  const { manager } = fixture('dsh-actual-loader');
  const s = addSkill(manager, 'dsh', 'actual-helper', 'Use assets/data.txt.', { 'assets/data.txt': 'Native resource' });
  const provider = new FileSystemSkillProvider({ get: () => undefined, logger: { warn: message => { throw new Error(message); } } }, { signal: new AbortController().signal, invalidate() {} }, { dshHome: manager.locations.dsh, agentsHome: manager.locations.dshAgents, watch: false });
  try {
    let candidates = await provider.list({});
    assert.equal(candidates.length, 1);
    assert.deepEqual(candidates[0].invocation, { modelInvocable: true, userInvocable: true });
    manager.setEnabled({ ids: [s.id], provider: 'dsh', enabled: false });
    candidates = await provider.list({});
    assert.deepEqual(candidates[0].invocation, { modelInvocable: false, userInvocable: false });
    manager.setEnabled({ ids: [s.id], provider: 'dsh', enabled: true });
    candidates = await provider.list({});
    assert.deepEqual(candidates[0].invocation, { modelInvocable: true, userInvocable: true });
    const definition = await provider.get(candidates[0], {});
    assert.equal(readText(path.join(definition.resourceBase.path, 'assets/data.txt')), 'Native resource');
  } finally { await provider.dispose(); }
});
