const YAML = require('yaml');
const { fs, hash, readText } = require('./files.cjs');
const fields = ['disable-model-invocation', 'user-invocable'];
const marker = /^# skilldock-original-invocation: ([A-Za-z0-9+/=]+)\r?\n/gm;
function boolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (['true', 'yes', 'on', '1'].includes(String(value).toLowerCase())) return true;
  if (['false', 'no', 'off', '0'].includes(String(value).toLowerCase())) return false;
  throw new Error('Harness 调用开关必须是布尔值。');
}
function parse(text) {
  const match = /^(---[^\S\r\n]*\r?\n)([\s\S]*?)(^---[^\S\r\n]*(?:\r?\n|$))([\s\S]*)$/m.exec(text);
  if (!match || match.index !== 0) throw new Error('Harness 技能缺少有效的 YAML 元信息。');
  const saved = [...match[2].matchAll(marker)];
  if (saved.length > 1) throw new Error('Harness 开关恢复记录重复，请检查 SKILL.md。');
  let original = null;
  if (saved.length) {
    try { original = JSON.parse(Buffer.from(saved[0][1], 'base64').toString('utf8')); } catch { throw new Error('Harness 开关恢复记录无效。'); }
    if (original.version !== 1 || fields.some(field => typeof original.fields?.[field]?.present !== 'boolean')) throw new Error('Harness 开关恢复记录无效。');
    for (const field of fields) if (original.fields[field].present) boolean(original.fields[field].value);
  }
  const header = match[2].replace(marker, '');
  const document = YAML.parseDocument(header);
  if (document.errors.length) throw new Error(`Harness 元信息无效：${document.errors[0].message.split('\n')[0]}`);
  const data = document.toJS({ maxAliasCount: 30 });
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.name) || typeof data.description !== 'string' || !data.description.trim()) throw new Error('Harness 要求有效的 kebab-case name 和非空 description。');
  if ('disableModelInvocation' in data || 'modelInvocable' in data || 'userInvocable' in data) throw new Error('Harness 调用字段必须使用带连字符的名称。');
  const model = !boolean(data[fields[0]], false), user = boolean(data[fields[1]], true);
  return { match, document, data, original, model, user, eol: text.includes('\r\n') ? '\r\n' : '\n' };
}
function status(skill) {
  try {
    const result = parse(readText(skill.file));
    return { enabled: result.model || result.user, mode: result.model ? result.user ? 'on' : 'model-only' : result.user ? 'manual' : 'off', reason: result.model && result.user ? '' : result.user ? '仅允许手动调用。' : result.model ? '仅允许模型调用。' : '模型调用与手动调用均已关闭。' };
  } catch (error) { return { enabled: null, mode: 'unknown', reason: error.message }; }
}
function toggleText(text, enabled) {
  const p = parse(text);
  if (!enabled && !p.model && !p.user) return text;
  if (enabled && !p.original && (p.model || p.user)) return text;
  let original = p.original;
  if (enabled) {
    if (original) for (const field of fields) {
      const old = original.fields[field];
      if (old.present) p.document.set(field, old.value); else p.document.delete(field);
    }
    else { p.document.set(fields[0], false); p.document.set(fields[1], true); }
    original = null;
  } else {
    original ||= { version: 1, fields: Object.fromEntries(fields.map(field => [field, { present: Object.hasOwn(p.data, field), value: p.data[field] }])) };
    p.document.set(fields[0], true); p.document.set(fields[1], false);
  }
  let header = p.document.toString({ lineWidth: 0 }).replace(/\r?\n/g, p.eol);
  if (original) header += `# skilldock-original-invocation: ${Buffer.from(JSON.stringify(original)).toString('base64')}${p.eol}`;
  const result = p.match[1] + header + p.match[3] + p.match[4];
  parse(result);
  return result;
}
function load(file) {
  const raw = fs.readFileSync(file), text = raw.toString('utf8').replace(/^\uFEFF/, '');
  parse(text);
  return { provider: 'dsh', file, raw, text, digest: hash(raw) };
}
function transferable(text) { return parse(text).original ? toggleText(text, true) : text; }
module.exports = { parse, status, toggleText, load, transferable };
