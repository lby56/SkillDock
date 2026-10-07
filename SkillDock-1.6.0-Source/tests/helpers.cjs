const { fs, path } = require('../src/files.cjs');
const { SkillManager } = require('../src/manager.cjs');
function fixture(label = 'test') {
  const qa = path.join(__dirname, '..', 'qa', 'fixtures');
  fs.mkdirSync(qa, { recursive: true });
  const directory = fs.mkdtempSync(path.join(qa, `${label}-`));
  const home = path.join(directory, 'home'), dataDir = path.join(directory, 'data');
  fs.mkdirSync(home);
  const manager = new SkillManager({ home, dataDir });
  return { directory, home, dataDir, manager };
}
function put(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
function addSkill(manager, rootId, name, body = 'A local test skill.', extras = {}) {
  const root = manager.roots().find(root => root.id === rootId);
  const directory = path.join(root.path, name);
  put(path.join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: A useful skill for testing.\n---\n\n${body}\n`);
  for (const [file, content] of Object.entries(extras)) put(path.join(directory, file), content);
  return manager.snapshot().skills.find(skill => skill.path === directory);
}
module.exports = { fixture, addSkill, put };
