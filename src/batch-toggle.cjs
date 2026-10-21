const F = require('./files.cjs');
const C = require('./configs.cjs');
const TOML = require('smol-toml');
const { fs, hash, exists, assertNoLinks, atomicWrite } = F;
const names = require('./providers.cjs');
const DSH = require('./dsh.cjs');
function setEnabledBatch(manager, input) {
  const requests = input?.requests;
  if (!Array.isArray(requests) || !requests.length || requests.length > Object.keys(names).length) throw new Error('批量开关请求无效。');
  const snapshot = manager.snapshot(), providers = new Set();
  const prepared = requests.map(({ provider, ids, enabled }) => {
    if (!Object.hasOwn(names, provider) || providers.has(provider) || !Array.isArray(ids) || !ids.length || typeof enabled !== 'boolean') throw new Error('批量开关请求无效。');
    providers.add(provider);
    const skills = [...new Set(ids)].map(id => {
      const skill = snapshot.skills.find(item => item.id === id);
      if (!skill || !skill.providers.includes(provider) || !skill.states[provider]?.canToggle) throw new Error('所选技能已变化或不支持此工具的开关，请刷新后重试。');
      assertNoLinks(skill.path);
      return skill;
    });
    if (provider === 'dsh') return skills.map(skill => {
      const config = DSH.load(skill.file), text = DSH.toggleText(config.text, enabled);
      const bom = config.raw.subarray(0, 3).equals(Buffer.from([239, 187, 191])) ? '\uFEFF' : '';
      return { provider, skills: [skill], enabled, config, text, existed: true, writtenDigest: hash(bom + text) };
    });
    const config = C.loadConfig(provider, manager.configPaths()[provider]);
    let text = config.text;
    for (const skill of skills) text = C.toggleText({ ...config, text, data: provider === 'codex' ? TOML.parse(text) : C.parseJson(text) }, skill, enabled);
    const bom = config.raw.subarray(0, 3).equals(Buffer.from([239, 187, 191])) ? '\uFEFF' : '';
    return { provider, skills, enabled, config, text, existed: exists(config.file), writtenDigest: hash(bom + text) };
  }).flat();
  // Validate every config before the first write; stale writes are rejected again by atomicWrite.
  for (const item of prepared) if (hash(exists(item.config.file) ? fs.readFileSync(item.config.file) : '') !== item.config.digest) throw new Error('配置已被其他程序修改，请刷新后重试。');
  const completed = [];
  try {
    for (const item of prepared) {
      item.backup = manager.backupConfig(item.config, item.text, 'batch-toggle');
      completed.push(item);
    }
  } catch (error) {
    const unrestored = [];
    for (const item of [...completed].reverse()) {
      try {
        if (hash(exists(item.config.file) ? fs.readFileSync(item.config.file) : '') !== item.writtenDigest) throw new Error('配置已有其他改动');
        if (item.existed) atomicWrite(item.config.file, item.config.raw, item.writtenDigest);
        else { assertNoLinks(item.config.file); fs.unlinkSync(item.config.file); }
      } catch { unrestored.push(names[item.provider]); }
    }
    throw new Error(`批量开关未完成：${error.message}${unrestored.length ? `；${unrestored.join('、')} 配置已被其他程序改动，请刷新检查。` : '；本次已写入的配置已回退。'}`);
  }
  const changed = requests.map(request => ({ provider: request.provider, count: prepared.filter(item => item.provider === request.provider).reduce((sum, item) => sum + item.skills.length, 0), enabled: request.enabled }));
  const summary = changed.map(item => `${names[item.provider]} ${item.enabled ? '启用' : '禁用'} ${item.count} 项`).join('；');
  manager.log('batch-toggle', summary, { backups: prepared.map(item => item.backup) });
  return { changed, message: `${summary}。${providers.has('codex') ? 'Codex 重启后读取新配置。' : '请在新会话中确认加载状态。'}`, snapshot: manager.snapshot() };
}
module.exports = { setEnabledBatch };
