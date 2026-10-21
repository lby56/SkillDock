const F = require('./files.cjs');
const { path, key, tree, exists, safeName, assertWithin, assertNoLinks, readText } = F;
const toolNames = require('./providers.cjs');
const DSH = require('./dsh.cjs');
const canonicalName = skill => skill.name.toLowerCase();
function rank(skill, provider) {
  if (provider === 'codex' && skill.rootId === 'codex' && skill.locked) return 0;
  if (provider === 'claude' && skill.originKind === 'cloud') return 0;
  if (provider === 'opencode' && skill.originKind === 'cloud') return 0;
  if (skill.rootId === provider) return 1;
  if (skill.originKind === 'plugin') return 2;
  if (skill.originKind === 'cloud') return 3;
  return 4;
}
// With the rule on, Claude Code's own (claude.ai synced, Anthropic) skills stay in Claude Code only.
function catalog(skills, { keepClaudeBuiltins = false } = {}) {
  const groups = new Map();
  for (const skill of skills) {
    const name = canonicalName(skill);
    if (!groups.has(name)) groups.set(name, { name, description: skill.description, copies: [], tools: {} });
    groups.get(name).copies.push(skill);
  }
  for (const group of groups.values()) {
    for (const provider of Object.keys(toolNames)) {
      const candidates = group.copies.filter(skill => skill.providers.includes(provider)).sort((a, b) => rank(a, provider) - rank(b, provider) || b.modified.localeCompare(a.modified));
      const selected = candidates[0];
      group.tools[provider] = selected ? { id: selected.id, path: selected.path, file: selected.file, state: selected.states[provider], count: candidates.length, kind: selected.originKind, rootId: selected.rootId, source: selected.source } : null;
    }
    const preferred = [...group.copies].sort((a, b) => Number(!a.locked) - Number(!b.locked) || b.modified.localeCompare(a.modified))[0];
    group.description = preferred.description;
    group.builtin = group.copies.some(skill => skill.builtin);
    group.excluded = keepClaudeBuiltins && group.builtin ? Object.keys(toolNames).filter(provider => provider !== 'claude') : [];
    group.complete = Object.entries(group.tools).every(([provider, tool]) => tool || group.excluded.includes(provider));
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}
// Copies of Claude Code's own skills in other tools' writable folders, and OpenCode switches that still load them.
// Tool-owned versions with the same name (Codex plugin or system skills) are locked and left alone.
function builtinReport(groups) {
  const rows = groups.filter(group => group.builtin);
  return {
    names: rows.map(group => group.name),
    copies: rows.flatMap(group => group.copies.filter(skill => ['codex', 'opencode', 'shared', 'dsh'].includes(skill.rootId) && !skill.locked))
      .map(skill => ({ id: skill.id, name: skill.name, rootId: skill.rootId, path: skill.path, source: skill.source })),
    openCode: rows.filter(group => group.tools.opencode?.state.enabled === true && group.tools.opencode.state.canToggle).map(group => ({ id: group.tools.opencode.id, name: group.name }))
  };
}
function previewAll(manager) {
  const snapshot = manager.snapshot();
  if (snapshot.errors.length) throw new Error('存在目录或配置读取异常，请修复后再同步全部。');
  const groups = catalog(snapshot.skills, { keepClaudeBuiltins: manager.keepClaudeBuiltins() }), roots = manager.roots(), rows = [];
  const already = [], relocations = [], stateTransfers = [], excluded = [];
  for (const group of groups) {
    const coverage = new Set(Object.keys(group.tools).filter(provider => group.tools[provider]));
    // A dedicated Harness copy allows independent invocation flags without changing shared skills.
    if (!group.copies.some(skill => skill.rootId === 'dsh')) coverage.delete('dsh');
    const claudeRoot = roots.find(root => root.id === 'claude');
    const consolidate = !coverage.has('claude') && claudeRoot.providers.includes('opencode') ? group.copies.filter(skill => ['opencode', 'shared'].includes(skill.rootId)) : [];
    if (consolidate.some(skill => skill.rootId === 'shared')) coverage.delete('codex');
    // Claude's directory supplies OpenCode too. Process it first to avoid a second copy.
    for (const provider of ['claude', 'codex', 'opencode', 'dsh']) {
      if (coverage.has(provider)) { already.push({ name: group.name, provider }); continue; }
      if (group.excluded.includes(provider)) { excluded.push({ name: group.name, provider }); continue; }
      const root = roots.find(item => item.id === provider && item.writable);
      if (!root) throw new Error(`未配置 ${toolNames[provider]} 技能目录。`);
      const source = [...group.copies].sort((a, b) => rank(a, provider) - rank(b, provider) || b.modified.localeCompare(a.modified))[0];
      const name = safeName(group.name);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) throw new Error(`${name} 无法转换为四端通用名称，请先修正。`);
      if (source.metadataError) throw new Error(`${source.name} 的 YAML 元数据无效，请修复后重试。`);
      const destination = path.join(root.path, name);
      assertWithin(root.path, destination); assertNoLinks(destination);
      if (exists(destination)) throw new Error(`${destination} 已存在但未能识别为目标技能，未覆盖。`);
      const sourceTree = tree(source.path);
      const normalizeName = source.name !== name || source.directoryName !== name;
      const content = readText(source.file);
      let normalizedContent = normalizeName ? content.replace(/^(name:[ \t]*).+$/m, `$1${name}`) : content;
      if (normalizeName && normalizedContent === content) throw new Error(`${name} 的名称无法安全规范化。`);
      if (normalizedContent.includes('# skilldock-original-invocation: ')) normalizedContent = DSH.transferable(normalizedContent);
      if (provider === 'dsh') DSH.parse(normalizedContent);
      if (normalizedContent === content) normalizedContent = null;
      rows.push({ name, source: source.path, destination, rootId: root.id, target: root.label,
        sourceDigest: sourceTree.digest, destinationDigest: null, state: 'new', blocked: '', changes: [],
        files: sourceTree.files.length, bytes: sourceTree.bytes, warnings: source.warnings || [],
        normalizedContent, suppliedProviders: root.providers, sourceKind: source.originKind });
      if (provider === 'codex') {
        const old = consolidate.find(skill => skill.rootId === 'shared');
        if (old) stateTransfers.push({ provider: 'codex', skill: { path: destination, file: path.join(destination, 'SKILL.md') }, enabled: old.states.codex.enabled, configDigest: manager.configs().codex.digest });
      }
      for (const supplied of root.providers) if (supplied !== 'dsh' || root.id === 'dsh') coverage.add(supplied);
      if (provider === 'claude') for (const old of consolidate) relocations.push({ source: old.path, rootId: old.rootId, sourceDigest: tree(old.path).digest, destination, normalizedContent });
    }
  }
  return manager.makePlan('sync', { all: true, rows, already, relocations, stateTransfers, excluded, skillCount: groups.length,
    excludedSkills: new Set(excluded.map(item => item.name)).size,
    note: '补齐缺失目录，保留各端已有版本和开关。OpenCode 复用 Claude 目录，独有或共享来源迁移后不保留重复目录；Harness 使用专属目录以独立管理调用开关；内置、云同步和插件的原始文件保持原位。' });
}
module.exports = { catalog, builtinReport, previewAll, canonicalName };
