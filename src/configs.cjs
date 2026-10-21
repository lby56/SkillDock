const { fs, path, hash, key, exists, readText, atomicWrite } = require('./files.cjs');
const TOML = require('smol-toml');
const JSONC = require('jsonc-parser');

function parseJson(text) {
  const errors = [];
  const parsed = JSONC.parse(text || '{}', errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('配置文件不是有效 JSON / JSONC，请修复后重试。');
  return parsed;
}
function jsonEdit(text, keys, value) {
  return JSONC.applyEdits(text, JSONC.modify(text, keys, value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: text.includes('\r\n') ? '\r\n' : '\n' } }));
}
function wildcard(pattern, value) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.');
  return new RegExp(`^${escaped}$`).test(value);
}
function openPermission(config, name) {
  const permissions = config.permission;
  let current = typeof permissions === 'string' ? permissions : 'allow';
  if (permissions && typeof permissions === 'object') {
    for (const [tool, rule] of Object.entries(permissions)) {
      if (!wildcard(tool, 'skill')) continue;
      if (typeof rule === 'string') current = rule;
      else if (rule && typeof rule === 'object') {
        for (const [pattern, state] of Object.entries(rule)) if (wildcard(pattern, name)) current = state;
      }
    }
  }
  if (config.tools?.skill === false) return 'tool-off';
  return current;
}
function loadConfig(provider, file) {
  const raw = exists(file) ? fs.readFileSync(file) : Buffer.alloc(0);
  const text = raw.toString('utf8').replace(/^\uFEFF/, '') || (provider === 'codex' ? '' : '{}\n');
  const data = provider === 'codex' ? TOML.parse(text) : parseJson(text);
  return { provider, file, raw, text, data, digest: hash(raw) };
}
function status(config, skill) {
  if (config.error) return { enabled: null, mode: 'unknown', reason: config.error };
  if (config.provider === 'codex') {
    const rows = config.data.skills?.config || [];
    if (!Array.isArray(rows)) throw new Error('skills.config 不是数组。');
    const matches = rows.filter(row => row.path && [key(skill.file), key(skill.path)].includes(key(path.resolve(path.dirname(config.file), row.path))));
    return { enabled: matches.at(-1)?.enabled !== false, mode: matches.at(-1)?.enabled === false ? 'off' : 'on' };
  }
  if (config.provider === 'claude') {
    const mode = config.data.skillOverrides?.[skill.commandName] ?? (skill.originKind === 'cloud' ? config.data.skillOverrides?.[skill.directoryName] : undefined) ?? 'on';
    return { enabled: mode !== 'off' && mode !== false, mode: String(mode), reason: skill.manualOnly ? 'SKILL.md 限制了自动调用，启用后仍需手动调用。' : '' };
  }
  const mode = openPermission(config.data, skill.name);
  return { enabled: !['deny', 'tool-off'].includes(mode), mode, reason: mode === 'tool-off' ? 'OpenCode 的 skill 工具被整体关闭，请先在配置中开启。' : '' };
}
function editCodex(config, file, enabled) {
  const parsed = config.data;
  const relative = path.relative(path.dirname(config.file), file);
  const storedPath = path.isAbsolute(relative) ? file : relative.replaceAll('\\', '/');
  if (parsed.skills?.config && !Array.isArray(parsed.skills.config)) throw new Error('无法识别 Codex skills.config。');
  const targets = new Set([key(file), key(path.dirname(file))]);
  let matched = false;
  const headers = [...config.text.matchAll(/^[ \t]*\[\[skills\.config\]\][^\r\n]*(?:\r?\n|$)/gm)];
  let result = config.text;
  for (const header of headers.reverse()) {
    const start = header.index;
    const tail = config.text.slice(start + header[0].length);
    const next = tail.search(/^[ \t]*\[/m);
    const end = next < 0 ? config.text.length : start + header[0].length + next;
    const block = config.text.slice(start, end);
    const row = TOML.parse(block).skills.config[0];
    if (!row.path || !targets.has(key(path.resolve(path.dirname(config.file), row.path)))) continue;
    matched = true;
    let updated = /^\s*enabled\s*=/m.test(block)
      ? block.replace(/^(\s*enabled\s*=\s*)(?:true|false)([^\r\n]*)/m, `$1${enabled}$2`)
      : `${block.trimEnd()}\nenabled = ${enabled}\n\n`;
    if (row.path !== storedPath) updated = updated.replace(/^([ \t]*path[ \t]*=[ \t]*)(?:"(?:\\.|[^"\\])*"|'[^']*')/m, (_, prefix) => prefix + JSON.stringify(storedPath));
    result = result.slice(0, start) + updated + result.slice(end);
  }
  if (!matched) {
    const existing = parsed.skills?.config || [];
    if (existing.some(row => row.path && targets.has(key(path.resolve(path.dirname(config.file), row.path))))) throw new Error('此 Codex 配置使用了内联 skills.config；请改为 [[skills.config]] 后再操作。');
    if (existing.length && !headers.length) throw new Error('不支持内联 skills.config 格式，未修改配置。');
    result = `${result.trimEnd()}\n\n[[skills.config]]\npath = ${JSON.stringify(storedPath)}\nenabled = ${enabled}\n`;
  }
  const expected = structuredClone(config.data);
  expected.skills ||= {};
  expected.skills.config ||= [];
  let existingMatch = false;
  for (const row of expected.skills.config) {
    if (row.path && targets.has(key(path.resolve(path.dirname(config.file), row.path)))) { row.enabled = enabled; row.path = storedPath; existingMatch = true; }
  }
  if (!existingMatch) expected.skills.config.push({ path: storedPath, enabled });
  const verified = TOML.parse(result);
  if (!require('node:util').isDeepStrictEqual(verified, expected)) throw new Error('无法在保留其他配置的情况下修改开关，未写入文件。');
  if (status({ ...config, data: verified }, { file, path: path.dirname(file) }).enabled !== enabled) throw new Error('Codex 配置验证失败。');
  return result;
}
function toggleText(config, skill, enabled) {
  if (typeof enabled !== 'boolean') throw new Error('启用状态必须为布尔值。');
  if (config.provider === 'codex') return editCodex(config, skill.file, enabled);
  if (config.provider === 'claude') return jsonEdit(config.text, ['skillOverrides', skill.commandName], enabled ? 'on' : 'off');
  if (config.data.tools?.skill === false && enabled) throw new Error('OpenCode 的 skill 工具被整体关闭。请先在 OpenCode 配置中开启该工具。');
  let text = config.text;
  if (typeof config.data.permission === 'string') text = jsonEdit(text, ['permission'], { '*': config.data.permission });
  const permission = parseJson(text).permission;
  const rule = permission?.skill;
  const rules = typeof rule === 'string' ? { '*': rule } : { ...(rule || {}) };
  delete rules[skill.name];
  rules[skill.name] = enabled ? 'allow' : 'deny';
  // Move the skill tool rule last: OpenCode uses the last matching rule.
  if (!parseJson(text).permission) text = jsonEdit(text, ['permission'], {});
  text = require('./json-last.cjs').setLast(text, ['permission'], 'skill', rules);
  parseJson(text);
  return text;
}
module.exports = { parseJson, jsonEdit, loadConfig, status, toggleText, wildcard, openPermission };
