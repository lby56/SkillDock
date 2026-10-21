const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setLast } = require('../src/json-last.cjs');
const { parseJson } = require('../src/configs.cjs');
const { fixture, addSkill, put } = require('./helpers.cjs');
const { fs, path, exists, tree } = require('../src/files.cjs');
const AdmZip = require('adm-zip');

test('ordered JSONC edits handle trailing commas, inline objects, comments and empty objects', () => {
  for (const content of [
    '{"permission":{"skill":{"*":"deny"},}}',
    '{"permission":{"skill":{"*":"deny"}}}',
    '{"permission":{}}',
    '{"permission":{"read":"ask", "skill":"deny",}}',
    '{"permission":{ "skill":"deny", // keep\n "read":"ask"}}',
    '{"permission":{ "read":"ask", // keep\n "skill":"deny" // end\n }}'
  ]) {
    const output = setLast(content, ['permission'], 'skill', { '*': 'deny', example: 'allow' });
    const data = parseJson(output);
    assert.deepEqual(data.permission.skill, { '*': 'deny', example: 'allow' });
    if (content.includes('// keep')) assert.match(output, /\/\/ keep/);
    assert.equal(Object.keys(data.permission).at(-1), 'skill');
  }
});

test('raw ZIP parent traversal fails before extracting files', () => {
  const { manager, directory } = fixture('traversal');
  const zip = new AdmZip(); zip.addFile('aa/escape.txt', Buffer.from('do not extract'));
  const bytes = zip.toBuffer();
  const original = Buffer.from('aa/escape.txt');
  let index = bytes.indexOf(original);
  while (index !== -1) { bytes.write('../escape.txt', index, 'utf8'); index = bytes.indexOf(original, index + original.length); }
  const file = path.join(directory, 'traversal.zip'); fs.writeFileSync(file, bytes);
  assert.throws(() => manager.importZip(file), /不安全路径/);
  assert.equal(exists(path.join(manager.dataDir, 'imports', 'escape.txt')), false);
});

test('exporting duplicate versions preserves leaf directory names for re-import', () => {
  const { manager, directory } = fixture('duplicate-export');
  const a = addSkill(manager, 'codex', 'example'), b = addSkill(manager, 'claude', 'example', 'other version');
  const file = path.join(directory, 'both.zip');
  manager.exportZip([a.id, b.id], file);
  const imported = manager.importZip(file);
  assert.equal(imported.skills.length, 2);
  assert.equal(imported.skills.every(skill => skill.directoryName === skill.name), true);
  const selected = imported.skills.find(skill => tree(skill.path).digest === tree(b.path).digest);
  const plan = manager.previewSync({ ids: [selected.id], targets: ['opencode'], importToken: imported.importToken });
  assert.equal(plan.rows[0].state, 'new');
});

test('nested symlinks are never followed during sync or export', () => {
  const { manager, directory } = fixture('nested-link');
  const skill = addSkill(manager, 'codex', 'example');
  const external = path.join(directory, 'external');
  put(path.join(external, 'private.txt'), 'outside skill');
  fs.symlinkSync(external, path.join(skill.path, 'linked'), 'junction');
  assert.throws(() => manager.previewSync({ ids: [skill.id], targets: ['claude'] }), /链接/);
  assert.throws(() => manager.exportZip([skill.id], path.join(directory, 'bad.zip')), /链接/);
  assert.equal(exists(path.join(external, 'private.txt')), true);
});
