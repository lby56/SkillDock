const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, addSkill, put } = require('./helpers.cjs');
const { SkillManager } = require('../src/manager.cjs');
const { fs, path, exists, readText } = require('../src/files.cjs');
const { resolveRuntime, prepareRuntime } = require('../src/portable.cjs');
const P = require('../src/location-paths.cjs');

test('portable data follows an application moved across unicode/space paths, with user and machine isolation', () => {
  const f = fixture('portable-runtime');
  const first = path.join(f.directory, '解压 空格 & 第一处'), second = path.join(f.directory, '移动后 第二处');
  put(path.join(first, 'portable.json'), '{"portable":true}');
  let runtime = resolveRuntime({ packaged: true, appDir: first, home: f.home, env: {}, hostname: 'machine-one' });
  prepareRuntime(runtime);
  put(path.join(runtime.dataDir, 'kept.txt'), 'portable data');
  fs.renameSync(first, second);
  runtime = resolveRuntime({ packaged: true, appDir: second, home: f.home, env: {}, hostname: 'machine-one' });
  assert.equal(readText(path.join(runtime.dataDir, 'kept.txt')), 'portable data');
  const userTwo = resolveRuntime({ packaged: true, appDir: second, home: path.join(f.directory, '另一个用户'), env: {}, hostname: 'machine-one' });
  const machineTwo = resolveRuntime({ packaged: true, appDir: second, home: f.home, env: {}, hostname: 'machine-two' });
  assert.notEqual(runtime.dataDir, userTwo.dataDir); assert.notEqual(runtime.dataDir, machineTwo.dataDir);
  assert.equal(exists(path.join(userTwo.dataDir, 'kept.txt')), false);
});

test('relative tool roots, favorites and recycle destinations survive moving the whole portable folder', () => {
  const f = fixture('portable-move');
  const first = path.join(f.directory, '应用 A'), second = path.join(f.directory, '应用 B');
  put(path.join(first, 'portable.json'), '{}');
  let runtime = resolveRuntime({ packaged: true, appDir: first, home: f.home, env: {}, hostname: 'test' });
  let manager = new SkillManager({ home: f.home, dataDir: runtime.dataDir, runtime });
  manager.setLocations({ dsh: './工具/Harness', codex: './工具/Codex' });
  const kept = addSkill(manager, 'dsh', 'kept'), removed = addSkill(manager, 'dsh', 'removed');
  manager.favorite({ id: kept.id, value: true });
  manager.deleteSkills(manager.previewDelete([removed.id]).token);
  const recycleId = manager.recycleBin()[0].id;
  const prefs = JSON.parse(readText(manager.preferencesFile));
  assert.deepEqual(prefs.locationSpecs.dsh, { base: 'app', path: '工具/Harness' });
  assert.equal(prefs.locations, undefined);
  fs.renameSync(first, second);
  runtime = resolveRuntime({ packaged: true, appDir: second, home: f.home, env: {}, hostname: 'test' });
  manager = new SkillManager({ home: f.home, dataDir: runtime.dataDir, runtime });
  assert.equal(manager.locations.dsh, path.join(second, '工具/Harness'));
  assert.equal(manager.snapshot().skills.find(s => s.name === 'kept').favorite, true);
  manager.restore(recycleId);
  assert.equal(exists(path.join(second, '工具/Harness/skills/removed/SKILL.md')), true);
  assert.equal(exists(first), false);
});

test('automatic roots are not pinned by saving preferences; environment overrides and home tokens resolve at runtime', () => {
  const f = fixture('portable-env');
  const appDir = path.join(f.directory, '程序'); fs.mkdirSync(appDir);
  const context = { home: f.home, appDir, env: { DSH_HOME: '~/定制 Harness', CODEX_HOME: '%USERPROFILE%/定制 Codex', DSH_AGENTS_HOME: path.join(f.home, '共享兼容'), XDG_CONFIG_HOME: path.join(f.home, '配置') } };
  const manager = new SkillManager({ home: f.home, dataDir: f.dataDir, appDir, env: context.env });
  assert.equal(manager.locations.dsh, path.join(f.home, '定制 Harness'));
  assert.equal(manager.locations.codex, path.join(f.home, '定制 Codex'));
  assert.equal(manager.locations.opencode, path.join(f.home, '配置/opencode'));
  assert.equal(manager.roots().find(r => r.id === 'dsh-agents').path, path.join(f.home, '共享兼容/skills'));
  manager.savePreferences();
  assert.deepEqual(JSON.parse(readText(manager.preferencesFile)).locationSpecs, {});
  const next = new SkillManager({ home: f.home, dataDir: f.dataDir, appDir, env: { DSH_HOME: path.join(f.home, '环境已变化') } });
  assert.equal(next.locations.dsh, path.join(f.home, '环境已变化'));
  assert.equal(P.expand('%APP_DIR%/tools', context), path.join(appDir, 'tools'));
  assert.throws(() => P.expand('%NOT_SET%/tools', context), /未设置/);
  assert.throws(() => P.expand('D:relative', context), /完整盘符/);
  assert.throws(() => manager.setLocations({ codex: './same', claude: './same' }), /不能相同/);
});

test('first portable launch imports only the current user app records and does not copy browser caches', () => {
  const f = fixture('portable-migration');
  const appDir = path.join(f.directory, 'Portable'); put(path.join(appDir, 'portable.json'), '{}');
  put(path.join(f.home, '.skilldock/history.jsonl'), '{"message":"old user history"}\n');
  put(path.join(f.home, '.skilldock/electron/Cookies'), 'private browser data');
  const runtime = resolveRuntime({ packaged: true, appDir, home: f.home, env: {}, hostname: 'test' });
  prepareRuntime(runtime);
  assert.match(readText(path.join(runtime.dataDir, 'history.jsonl')), /old user history/);
  assert.equal(exists(path.join(runtime.dataDir, 'electron/Cookies')), false);
  put(path.join(runtime.dataDir, 'history.jsonl'), 'new history');
  prepareRuntime(runtime);
  assert.equal(readText(path.join(runtime.dataDir, 'history.jsonl')), 'new history');
});
