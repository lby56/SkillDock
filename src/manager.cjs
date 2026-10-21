const os = require('node:os');
const YAML = require('yaml');
const AdmZip = require('adm-zip');
const F = require('./files.cjs');
const C = require('./configs.cjs');
const { fs, path, crypto, hash, key, id, exists, within, assertWithin, assertNoLinks, safeName, readText, atomicWrite, tree, copyTree, removeOwned } = F;
const PROVIDERS = require('./providers.cjs');
const P = require('./location-paths.cjs');
const DSH = require('./dsh.cjs');

class SkillManager {
  constructor(options = {}) {
    this.home = options.home || process.env.SKILLDOCK_HOME || os.homedir();
    this.dataDir = options.dataDir || process.env.SKILLDOCK_DATA || path.join(this.home, '.skilldock');
    this.env = options.env || (options.home || process.env.SKILLDOCK_HOME ? {} : process.env);
    this.preferencesFile = path.join(this.dataDir, 'preferences.json');
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.runtime = options.runtime || { portable: false, appDir: options.appDir || path.join(__dirname, '..') };
    this.pathContext = { home: this.home, env: this.env, appDir: this.runtime.appDir };
    this.preferences = exists(this.preferencesFile) ? C.parseJson(readText(this.preferencesFile)) : {};
    const bindings = P.load(this.preferences, this.pathContext);
    this.locations = bindings.locations; this.preferences.locationSpecs = bindings.specs;
    delete this.preferences.locations;
    this.plans = new Map();
    this.imports = new Map();
    this.lastSnapshot = null;
  }
  roots() {
    const external = this.env.OPENCODE_DISABLE_EXTERNAL_SKILLS !== 'true' && this.env.OPENCODE_DISABLE_EXTERNAL_SKILLS !== '1';
    const sharedDsh = key(this.locations.shared) === key(this.locations.dshAgents);
    return [
      { id: 'dsh', label: 'DeepSeek Harness 个人技能', path: path.join(this.locations.dsh, 'skills'), providers: ['dsh'], writable: true, shallow: true },
      ...(!sharedDsh ? [{ id: 'dsh-agents', label: 'Harness 共享 .agents 技能', path: path.join(this.locations.dshAgents, 'skills'), providers: ['dsh'], writable: false, shallow: true, lockedReason: '共享兼容来源：同步到 Harness 个人目录后，可独立调整开关。' }] : []),
      { id: 'codex', label: 'Codex 个人技能', path: path.join(this.locations.codex, 'skills'), providers: ['codex'], writable: true },
      { id: 'claude', label: 'Claude Code 个人技能', path: path.join(this.locations.claude, 'skills'), providers: external ? ['claude', 'opencode'] : ['claude'], writable: true },
      { id: 'opencode', label: 'OpenCode 个人技能', path: path.join(this.locations.opencode, 'skills'), providers: ['opencode'], writable: true },
      { id: 'shared', label: '共享技能 · .agents', path: path.join(this.locations.shared, 'skills'), providers: [...(external ? ['codex', 'opencode'] : ['codex']), ...(sharedDsh ? ['dsh'] : [])], writable: true },
      { id: 'codex-plugins', label: 'Codex 插件缓存', path: path.join(this.locations.codex, 'plugins', 'cache'), providers: ['codex'], writable: false },
      { id: 'claude-plugins', label: 'Claude Code 插件缓存', path: path.join(this.locations.claude, 'plugins', 'cache'), providers: ['claude'], writable: false }
    ];
  }
  configPaths() {
    const jsonc = path.join(this.locations.opencode, 'opencode.jsonc');
    return {
      codex: path.join(this.locations.codex, 'config.toml'),
      claude: path.join(this.locations.claude, 'settings.json'),
      opencode: exists(jsonc) ? jsonc : path.join(this.locations.opencode, 'opencode.json')
    };
  }
  configs() {
    return Object.fromEntries(Object.entries(this.configPaths()).map(([provider, file]) => {
      if (provider === 'dsh') return [provider, { provider, perSkill: true }];
      try { return [provider, C.loadConfig(provider, file)]; }
      catch (error) { return [provider, { provider, file, error: `${PROVIDERS[provider]} 配置读取失败：${error.message}` }]; }
    }));
  }
  metadata(directory, root, lockedReason = '', flat = false) {
    const file = flat ? directory : path.join(directory, 'SKILL.md');
    const directoryName = flat ? path.basename(directory, path.extname(directory)) : path.basename(directory);
    if (fs.statSync(file).size > 2 * 1024 * 1024) throw new Error('SKILL.md 超过 2 MB，已跳过。');
    const content = readText(file);
    const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|\s*$)/);
    let meta = {}, error = '';
    try { if (match) meta = YAML.parse(match[1], { maxAliasCount: 30 }) || {}; else error = '缺少 YAML 元信息'; }
    catch (e) { error = `YAML 格式错误：${e.message.split('\n')[0]}`; }
    const name = typeof meta.name === 'string' ? meta.name : directoryName;
    const originKind = root.id.endsWith('-plugins') ? 'plugin' : (root.id === 'claude' && path.relative(root.path || directory, directory).split(path.sep)[0] === 'synced') ? 'cloud' : (path.relative(root.path || directory, directory).split(path.sep)[0] === '.system') ? 'system' : 'personal';
    const builtin = originKind === 'cloud' && this.claudeBuiltin(directory);
    const warnings = [];
    if (!meta.name) warnings.push('缺少 name；跨工具同步前请补全。');
    if (typeof meta.description !== 'string' || !meta.description.trim()) warnings.push('缺少 description，工具可能无法正确识别。');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) warnings.push('名称不符合 OpenCode 格式。');
    if (name !== directoryName) warnings.push('name 与文件夹名不同，跨工具加载行为可能不同。');
    if (meta.context === 'fork' || meta['allowed-tools'] || /!`/.test(content)) warnings.push('包含 Claude Code 专用字段或动态指令，请检查目标工具兼容性。');
    return {
      id: id(directory), rootId: root.id, path: directory, file, name, layout: flat ? 'file' : 'directory',
      commandName: originKind === 'cloud' ? `anthropic-skills:${path.basename(directory)}` : path.basename(directory), directoryName, originKind, builtin,
      description: typeof meta.description === 'string' ? meta.description : '暂无描述',
      providers: root.providers, source: root.label, locked: !!lockedReason, lockedReason,
      modified: fs.statSync(file).mtime.toISOString(), revision: hash(content),
      manualOnly: meta['disable-model-invocation'] === true, metadataError: error, warnings,
      favorite: (this.preferences.favorites || []).includes(id(directory)) || (this.preferences.favoriteRefs || []).includes(P.reference({ rootId: root.id, path: directory }, this.roots()))
    };
  }
  // claude.ai writes manifest.json beside the synced skills; Anthropic's own skills carry an "anthropic…" source.
  // Without a readable entry the skill is treated as built-in, so the sync rule errs on the side of not copying it.
  claudeBuiltin(directory) {
    try {
      const manifest = JSON.parse(readText(path.join(path.dirname(directory), 'manifest.json')));
      const entry = (manifest.skills || []).find(item => [item.skillId, item.name].includes(path.basename(directory)));
      return !entry?.source || /^anthropic/i.test(entry.source);
    } catch { return true; }
  }
  keepClaudeBuiltins() { return this.preferences.keepClaudeBuiltins !== false; }
  snapshot() {
    const configs = this.configs(), skills = [], errors = [], roots = this.roots();
    const seen = new Set();
    for (const root of roots) {
      if (!exists(root.path)) continue;
      const walk = (directory, depth, lockedReason = '') => {
        if (depth > 10) return;
        try {
          let linked = false;
          try { assertNoLinks(directory); } catch { linked = true; }
          const lock = lockedReason || root.lockedReason || (linked ? '符号链接或目录联接：仅查看，避免影响链接目标。' : '') || (!root.writable ? '插件管理的目录：保护原始文件。Codex 开关按技能路径保存；插件本身也需要在 Codex 中安装并启用。' : '');
          const flat = fs.statSync(directory).isFile();
          if (flat || ((!root.shallow || depth === 1) && exists(path.join(directory, 'SKILL.md')))) {
            if (seen.has(key(directory))) return;
            seen.add(key(directory));
            const supplied = root.providers.filter(provider => provider !== 'dsh' || depth === 1);
            if (!supplied.length) return;
            const skill = this.metadata(directory, { ...root, providers: supplied }, lock, flat);
            skill.states = Object.fromEntries(supplied.map(provider => {
              if (provider === 'dsh') {
                const status = DSH.status(skill);
                return [provider, { ...status, canToggle: !linked && root.id === 'dsh' && status.enabled !== null, reason: root.id === 'dsh' ? status.reason : '共享兼容来源：同步到 Harness 个人目录后，可独立调整开关。' }];
              }
              const canToggle = !linked && !(provider === 'claude' && skill.originKind === 'plugin');
              return [provider, canToggle ? { ...C.status(configs[provider], skill), canToggle: true } : { enabled: null, mode: 'managed', canToggle: false, reason: skill.lockedReason }];
            }));
            skills.push(skill); return;
          }
          if (root.shallow && depth >= 1) return;
          for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (depth === 0 && root.providers.includes('dsh') && entry.isFile() && /\.md$/i.test(entry.name) && !entry.name.startsWith('.')) {
              const flatPath = path.join(directory, entry.name);
              if (!seen.has(key(flatPath))) {
                const flatSkill = this.metadata(flatPath, { ...root, providers: ['dsh'] }, lock, true);
                const status = DSH.status(flatSkill);
                flatSkill.states = { dsh: { ...status, canToggle: !linked && root.id === 'dsh' && status.enabled !== null, reason: root.id === 'dsh' ? status.reason : '共享兼容来源：同步到 Harness 个人目录后，可独立调整开关。' } };
                flatSkill.warnings.push('平铺 Markdown 导出为 SKILL.md；如引用同级资源，请将资源整理到技能文件夹后同步。');
                seen.add(key(flatPath)); skills.push(flatSkill);
              }
              continue;
            }
            if (['node_modules', '.git', '.trash', '__pycache__'].includes(entry.name)) continue;
            if (entry.name.startsWith('.') && (entry.name !== '.system' || root.shallow)) continue;
            if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
            const next = path.join(directory, entry.name);
            if (entry.isSymbolicLink() && !exists(path.join(next, 'SKILL.md'))) continue;
            const reason = entry.name === '.system' ? '系统内置技能：文件受保护，可在此单独切换启用状态。' : (root.id === 'claude' && entry.name === 'synced' ? 'claude.ai 同步技能：可在此切换本机开关；删除及云端同步设置仍由 claude.ai 管理。' : lock);
            walk(next, depth + 1, reason);
          }
        } catch (error) { errors.push({ path: directory, message: error.message }); }
      };
      walk(root.path, 0);
    }
    for (const config of Object.values(configs)) if (config.error) errors.push({ path: config.file, message: config.error });
    const names = new Map();
    for (const skill of skills) {
      for (const provider of skill.providers) {
        const nameKey = `${provider}:${provider === 'claude' ? skill.commandName : skill.name}`;
        if (!names.has(nameKey)) names.set(nameKey, []);
        names.get(nameKey).push(skill.id);
      }
    }
    for (const skill of skills) skill.duplicates = [...new Set(skill.providers.flatMap(provider => names.get(`${provider}:${provider === 'claude' ? skill.commandName : skill.name}`) || []).filter(other => other !== skill.id))];
    skills.sort((a, b) => Number(a.locked) - Number(b.locked) || a.name.localeCompare(b.name));
    this.lastSnapshot = { skills, roots: roots.map(root => ({ ...root, exists: exists(root.path) })), errors,
      configPaths: this.configPaths(), locations: this.locations, dataDir: this.dataDir, providers: PROVIDERS,
      portable: this.runtime.portable, appDir: this.runtime.appDir,
      locationInputs: Object.fromEntries(P.locationKeys.map(name => { const spec = this.preferences.locationSpecs?.[name]; return [name, !spec ? '' : spec.base === 'home' ? `~/${spec.path}` : spec.base === 'app' ? `./${spec.path}` : spec.path]; })),
      catalog: require('./catalog.cjs').catalog(skills, { keepClaudeBuiltins: this.keepClaudeBuiltins() }), rules: { keepClaudeBuiltins: this.keepClaudeBuiltins() },
      recycleCount: this.recycleBin().length, version: require('../package.json').version, scannedAt: new Date().toISOString(),
      scopeNote: '显示用户全局目录及其配置。项目、企业策略、启动参数、Harness 预设和 OpenCode agent 覆盖可能改变实际加载状态。' };
    this.lastSnapshot.builtinReport = require('./catalog.cjs').builtinReport(this.lastSnapshot.catalog);
    return this.lastSnapshot;
  }
  getSkill(skillId, allowLocked = true) {
    const skill = this.snapshot().skills.find(item => item.id === skillId);
    if (!skill) throw new Error('技能已不存在，请刷新列表。');
    if (!allowLocked && skill.locked) throw new Error(skill.lockedReason);
    const root = this.roots().find(item => item.id === skill.rootId);
    assertWithin(root.path, skill.path);
    return skill;
  }
  detail(skillId) {
    const skill = this.getSkill(skillId);
    let files = [], bytes = 0, error = '';
    try { const contents = tree(skill.path); files = contents.files.map(item => ({ path: item.path, size: item.size })); bytes = contents.bytes; } catch (e) { error = e.message; }
    return { ...skill, content: readText(skill.file), files, bytes, fileError: error };
  }
  log(action, message, extra = {}) {
    fs.appendFileSync(path.join(this.dataDir, 'history.jsonl'), `${JSON.stringify({ id: crypto.randomUUID(), at: new Date().toISOString(), action, message, ...extra })}\n`, 'utf8');
  }
  history() {
    return readText(path.join(this.dataDir, 'history.jsonl')).split('\n').filter(Boolean).slice(-150).reverse().flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  }
  backupConfig(config, text, reason) {
    // Validate before writing and preserve a byte-for-byte recovery copy.
    if (config.provider === 'dsh') DSH.parse(text); else if (config.provider === 'codex') require('smol-toml').parse(text); else C.parseJson(text);
    const backupDirectory = path.join(this.dataDir, 'config-backups', `${Date.now()}-${crypto.randomUUID()}`);
    fs.mkdirSync(backupDirectory, { recursive: true });
    fs.writeFileSync(path.join(backupDirectory, 'original'), config.raw);
    fs.writeFileSync(path.join(backupDirectory, 'record.json'), JSON.stringify({ file: config.file, existed: exists(config.file), reason, at: new Date().toISOString() }, null, 2));
    const bom = config.raw.subarray(0, 3).equals(Buffer.from([239, 187, 191])) ? '\uFEFF' : '';
    atomicWrite(config.file, bom + text, config.digest);
    return backupDirectory;
  }
  setEnabledBatch(input) { return require('./batch-toggle.cjs').setEnabledBatch(this, input); }
  setEnabled({ ids, provider, enabled }) {
    if (provider === 'dsh') return this.setEnabledBatch({ requests: [{ ids, provider, enabled }] });
    if (!PROVIDERS[provider] || !Array.isArray(ids) || !ids.length || typeof enabled !== 'boolean') throw new Error('无效的开关请求。');
    const snapshot = this.snapshot();
    const skills = [...new Set(ids)].map(skillId => {
      const skill = snapshot.skills.find(item => item.id === skillId);
      if (!skill || !skill.providers.includes(provider) || !skill.states[provider]?.canToggle) throw new Error('所选技能不支持此工具的开关操作。');
      assertNoLinks(skill.path);
      return skill;
    });
    const file = this.configPaths()[provider];
    const config = C.loadConfig(provider, file);
    let text = config.text;
    for (const skill of skills) {
      const data = provider === 'codex' ? require('smol-toml').parse(text) : C.parseJson(text);
      text = C.toggleText({ ...config, text, data }, skill, enabled);
    }
    const backup = this.backupConfig(config, text, enabled ? 'enable' : 'disable');
    this.log(enabled ? 'enable' : 'disable', `${PROVIDERS[provider]}：${enabled ? '启用' : '禁用'} ${skills.map(skill => skill.name).join('、')}`, { backup });
    return { message: `${skills.length} 个技能已${enabled ? '启用' : '禁用'}。${provider === 'codex' ? '请重启 Codex，使配置生效。' : '请在新会话中确认加载状态。'}`, snapshot: this.snapshot() };
  }
  favorite({ id: skillId, value }) {
    const favorites = new Set(this.preferences.favorites || []);
    if (value) favorites.add(skillId); else favorites.delete(skillId);
    this.preferences.favorites = [...favorites];
    const reference = P.reference(this.getSkill(skillId), this.roots()), refs = new Set(this.preferences.favoriteRefs || []);
    if (value) refs.add(reference); else refs.delete(reference);
    this.preferences.favoriteRefs = [...refs];
    this.savePreferences();
    return this.snapshot();
  }
  savePreferences() { atomicWrite(this.preferencesFile, JSON.stringify(this.preferences, null, 2)); }
  setLocations(locations) {
    const auto = P.defaults(this.pathContext), specs = {}, resolved = {};
    for (const name of P.locationKeys) {
      const value = locations?.[name];
      resolved[name] = value?.trim() ? P.expand(value, this.pathContext) : auto[name];
      if (key(resolved[name]) !== key(auto[name])) specs[name] = P.encode(resolved[name], this.pathContext);
    }
    P.validate(resolved);
    this.preferences.locationSpecs = specs; this.locations = resolved;
    this.savePreferences(); this.plans.clear(); this.imports.clear();
    this.log('settings', '更新技能目录设置');
    return this.snapshot();
  }
  setRules({ keepClaudeBuiltins } = {}) {
    if (typeof keepClaudeBuiltins !== 'boolean') throw new Error('无效的同步规则。');
    this.preferences.keepClaudeBuiltins = keepClaudeBuiltins;
    this.savePreferences(); this.plans.clear();
    this.log('settings', keepClaudeBuiltins ? '同步规则：Claude Code 自带技能只留在 Claude Code' : '同步规则：Claude Code 自带技能可同步到其他工具');
    return this.snapshot();
  }
  previewBuiltinCleanup() {
    const { builtinReport: report, rules } = this.snapshot();
    if (!rules.keepClaudeBuiltins) throw new Error('同步规则已关闭，无需整理。');
    if (!report.copies.length && !report.openCode.length) throw new Error('没有与同步规则不符的项目。');
    return this.makePlan('builtin-cleanup', { copies: report.copies.map(item => ({ ...item, digest: tree(item.path).digest })), openCode: report.openCode });
  }
  applyBuiltinCleanup(token) {
    const plan = this.plan(token, 'builtin-cleanup');
    for (const item of plan.copies) if (tree(this.getSkill(item.id, false).path).digest !== item.digest) throw new Error(`${item.name} 已变化，请重新整理。`);
    const done = [];
    try {
      for (const item of plan.copies) {
        const record = this.archive(item.path, item.rootId, 'rule'); done.push(record);
        this.log('delete', `${item.name} 已移入回收站（Claude Code 自带技能只留在 Claude Code）`, { recycleId: record.id, path: item.path });
      }
    } catch (error) { throw new Error(`已移入回收站 ${done.length} 项，可随时恢复。${error.message}`); }
    if (plan.openCode.length) {
      try { this.setEnabled({ ids: plan.openCode.map(item => item.id), provider: 'opencode', enabled: false }); }
      catch (error) { throw new Error(`已移入回收站 ${done.length} 项；OpenCode 未能禁用：${error.message}`); }
    }
    this.plans.delete(token);
    const parts = [done.length && `${done.length} 个副本已移入回收站`, plan.openCode.length && `OpenCode 中禁用 ${plan.openCode.length} 个（请在新会话中确认）`].filter(Boolean);
    return { message: `已按规则整理：${parts.join('；')}。`, snapshot: this.snapshot() };
  }
  makePlan(type, data) {
    // Plans expire and are validated again before any write.
    for (const [token, value] of this.plans) if (Date.now() - value.created > 15 * 60 * 1000) this.plans.delete(token);
    const token = crypto.randomUUID();
    const plan = { token, type, created: Date.now(), ...data };
    this.plans.set(token, plan); return plan;
  }
  plan(token, type) {
    const plan = this.plans.get(token);
    if (!plan || plan.type !== type || Date.now() - plan.created > 15 * 60 * 1000) throw new Error('预览已过期，请重新预览。');
    return plan;
  }
  previewDelete(ids) {
    const items = [...new Set(ids)].map(skillId => {
      const skill = this.getSkill(skillId, false);
      return { id: skill.id, path: skill.path, name: skill.name, rootId: skill.rootId, providers: skill.providers, digest: tree(skill.path).digest };
    });
    if (!items.length) throw new Error('请先选择技能。');
    return this.makePlan('delete', { items });
  }
  archive(directory, rootId, reason) {
    const root = this.roots().find(item => item.id === rootId && item.writable);
    if (!root) throw new Error('目标不是可管理的技能目录。');
    assertWithin(root.path, directory); assertNoLinks(directory);
    const info = tree(directory), recordId = crypto.randomUUID();
    const folder = path.join(this.dataDir, 'trash', recordId), payload = path.join(folder, 'payload');
    fs.mkdirSync(folder, { recursive: true });
    const record = { id: recordId, original: directory, rootId, name: path.basename(directory), relative: path.relative(root.path, directory).replaceAll('\\', '/'), layout: fs.statSync(directory).isFile() ? 'file' : 'directory', at: new Date().toISOString(), reason, digest: info.digest, bytes: info.bytes, status: 'pending' };
    atomicWrite(path.join(folder, 'record.json'), JSON.stringify(record, null, 2));
    try { fs.renameSync(directory, payload); }
    catch (error) {
      if (error.code !== 'EXDEV') throw error;
      if (fs.statSync(directory).isFile()) fs.copyFileSync(directory, payload, fs.constants.COPYFILE_EXCL); else copyTree(directory, payload);
      if (tree(directory).digest !== info.digest) throw new Error('源文件已变化，未删除原件。');
      removeOwned(root.path, directory);
    }
    record.status = 'ready';
    atomicWrite(path.join(folder, 'record.json'), JSON.stringify(record, null, 2));
    return record;
  }
  deleteSkills(token) {
    const plan = this.plan(token, 'delete');
    for (const item of plan.items) {
      const skill = this.getSkill(item.id, false);
      if (tree(skill.path).digest !== item.digest) throw new Error(`${item.name} 已变化，请重新确认删除。`);
    }
    const done = [];
    try { for (const item of plan.items) { const record = this.archive(item.path, item.rootId, 'delete'); done.push(record); this.log('delete', `${item.name} 已移入回收站`, { recycleId: record.id }); } }
    catch (error) { throw new Error(`已移入回收站 ${done.length} 项，可随时恢复。${error.message}`); }
    this.plans.delete(token); return { message: `${done.length} 个技能已移入回收站。`, snapshot: this.snapshot() };
  }
  recycleBin() {
    const directory = path.join(this.dataDir, 'trash');
    if (!exists(directory)) return [];
    return fs.readdirSync(directory).flatMap(entry => {
      const folder = path.join(directory, entry);
      try { const record = JSON.parse(readText(path.join(folder, 'record.json'))); return exists(path.join(folder, 'payload')) ? [record] : []; } catch { return []; }
    }).sort((a, b) => b.at.localeCompare(a.at));
  }
  restore(recordId) {
    const record = this.recycleBin().find(item => item.id === recordId);
    if (!record) throw new Error('回收记录不存在。');
    const root = this.roots().find(item => item.id === record.rootId && item.writable);
    if (!root) throw new Error('原目录未配置，请先恢复目录设置。');
    if (record.relative) record.original = path.resolve(root.path, record.relative);
    assertWithin(root.path, record.original); assertNoLinks(record.original);
    if (exists(record.original)) throw new Error('原位置已存在同名技能。请先处理当前版本，再恢复备份。');
    const folder = path.join(this.dataDir, 'trash', record.id), payload = path.join(folder, 'payload');
    assertWithin(path.join(this.dataDir, 'trash'), folder);
    if (tree(payload).digest !== record.digest) throw new Error('回收站文件与备份指纹不同，请检查文件。');
    fs.mkdirSync(path.dirname(record.original), { recursive: true });
    try { fs.renameSync(payload, record.original); }
    catch (error) {
      if (error.code !== 'EXDEV') throw error;
      const stageRoot = path.join(path.dirname(root.path), '.skilldock-staging');
      const stage = path.join(stageRoot, crypto.randomUUID());
      assertNoLinks(stageRoot);
      try {
        if (record.layout === 'file') { fs.mkdirSync(stageRoot, { recursive: true }); fs.copyFileSync(payload, stage, fs.constants.COPYFILE_EXCL); } else copyTree(payload, stage);
        if (exists(record.original)) throw new Error('目标目录已出现，请刷新后重试。');
        fs.renameSync(stage, record.original);
        removeOwned(folder, payload);
      } finally { if (exists(stage)) removeOwned(stageRoot, stage); }
    }
    record.status = 'restored'; record.restoredAt = new Date().toISOString();
    atomicWrite(path.join(folder, 'record.json'), JSON.stringify(record, null, 2));
    this.log('restore', `恢复 ${record.name}`, { path: record.original });
    return { message: `已恢复 ${record.name}。`, snapshot: this.snapshot() };
  }
  previewSyncAll() { return require('./catalog.cjs').previewAll(this); }
  previewSync({ ids = [], targets = [], importToken }) {
    const imported = importToken ? this.imports.get(importToken) : null;
    if (importToken && !imported) throw new Error('导入已过期，请重新选择文件。');
    const sources = importToken ? imported.filter(skill => ids.includes(skill.id)) : ids.map(skillId => this.getSkill(skillId));
    if (!sources?.length || !targets.length) throw new Error('请选择来源技能与目标目录。');
    const rows = [], destinations = new Set();
    const builtinNames = new Set(this.keepClaudeBuiltins() ? this.snapshot().builtinReport.names : []);
    for (const source of sources) {
      const sourceTree = tree(source.path);
      if (!exists(source.file)) throw new Error('来源缺少技能文件。');
      for (const rootId of [...new Set(targets)]) {
        const root = this.roots().find(item => item.id === rootId && item.writable);
        if (!root) throw new Error('目标目录不可写。');
        const destination = path.join(root.path, safeName(source.directoryName));
        assertWithin(root.path, destination); assertNoLinks(destination);
        if (key(destination) === key(source.path)) continue;
        if (within(source.path, destination, true) || within(destination, source.path, true)) throw new Error('来源与目标目录存在包含关系，不能同步。');
        if (destinations.has(key(destination))) throw new Error(`多个来源会写入同一目标 ${source.directoryName}，请一次只选一个版本。`);
        destinations.add(key(destination));
        const targetTree = exists(destination) ? tree(destination) : null;
        let normalizedContent = readText(source.file);
        if (normalizedContent.includes('# skilldock-original-invocation: ')) normalizedContent = DSH.transferable(normalizedContent);
        if (root.id === 'dsh' && exists(path.join(destination, 'SKILL.md')) && DSH.status({ file: path.join(destination, 'SKILL.md') }).enabled === false) normalizedContent = DSH.toggleText(normalizedContent, false);
        if (normalizedContent === readText(source.file)) normalizedContent = null;
        const effectiveFiles = sourceTree.files.map(file => file.path === 'SKILL.md' && normalizedContent ? { ...file, hash: hash(normalizedContent), size: Buffer.byteLength(normalizedContent) } : file);
        const sourceMap = new Map(effectiveFiles.map(file => [file.path, file]));
        const targetMap = new Map((targetTree?.files || []).map(file => [file.path, file]));
        const changes = [...new Set([...sourceMap.keys(), ...targetMap.keys()])].map(file => ({ path: file, status: !targetMap.has(file) ? 'add' : !sourceMap.has(file) ? 'remove' : sourceMap.get(file).hash !== targetMap.get(file).hash ? 'change' : 'same' })).filter(file => file.status !== 'same');
        let blocked = '';
        if (root.id === 'dsh') {
          try { DSH.parse(normalizedContent || readText(source.file)); } catch (error) { blocked = error.message; }
          if (exists(path.join(root.path, `${source.name}.md`))) blocked = 'Harness 已有同名平铺 Markdown 技能，请先处理该版本以避免重复。';
        }
        if (root.id === 'claude' && source.directoryName.toLowerCase() === 'synced') blocked = 'synced 是 Claude Code 的保留名称。';
        if (root.providers.includes('opencode') && (source.metadataError || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(source.name) || source.name.length > 64 || source.name !== source.directoryName)) blocked = 'OpenCode 要求有效的 name，且必须与目录名一致；请先修正源技能。';
        if (builtinNames.has(source.name.toLowerCase()) && root.providers.some(provider => provider !== 'claude')) blocked = 'Claude Code 自带技能按同步规则只留在 Claude Code；如需复制，请先在「目录设置 → 同步规则」中关闭该规则。';
        rows.push({ name: source.name, source: source.path, destination, rootId, target: root.label,
          sourceDigest: sourceTree.digest, destinationDigest: targetTree?.digest || null,
          state: blocked ? 'blocked' : !targetTree ? 'new' : !changes.length && JSON.stringify(sourceTree.directories) === JSON.stringify(targetTree.directories) ? 'same' : 'conflict',
          normalizedContent,
          blocked, changes, bytes: sourceTree.bytes, files: sourceTree.files.length, warnings: source.warnings || [] });
      }
    }
    if (!rows.length) throw new Error('来源和目标相同，没有需要同步的项目。');
    return this.makePlan('sync', { rows });
  }
  applySync({ token, overwrite = false }) {
    const plan = this.plan(token, 'sync');
    const rows = plan.rows.filter(row => row.state === 'new' || (overwrite && row.state === 'conflict'));
    // Validate every selected row before the first destination is changed.
    for (const row of rows) {
      if (tree(row.source).digest !== row.sourceDigest) throw new Error(`${row.name} 的来源已变化，请重新预览。`);
      const now = exists(row.destination) ? tree(row.destination).digest : null;
      if (now !== row.destinationDigest) throw new Error(`${row.name} 的目标已变化，请重新预览。`);
      const root = this.roots().find(item => item.id === row.rootId && item.writable);
      assertWithin(root.path, row.destination); assertNoLinks(row.destination);
    }
    for (const move of plan.relocations || []) {
      const root = this.roots().find(root => root.id === move.rootId && root.writable);
      if (!root) throw new Error('迁移来源已不在管理范围。');
      assertWithin(root.path, move.source); assertNoLinks(move.source);
      if (tree(move.source).digest !== move.sourceDigest) throw new Error('迁移来源已变化，请重新预览。');
    }
    let count = 0;
    for (const row of rows) {
      const root = this.roots().find(item => item.id === row.rootId && item.writable);
      const stagingRoot = path.join(path.dirname(root.path), '.skilldock-staging');
      assertNoLinks(stagingRoot);
      fs.mkdirSync(stagingRoot, { recursive: true });
      const stage = path.join(stagingRoot, crypto.randomUUID());
      let backup = null;
      try {
        copyTree(row.source, stage);
        if (tree(stage).digest !== row.sourceDigest) throw new Error('来源在复制时发生变化，请重新预览。');
        if ((exists(row.destination) ? tree(row.destination).digest : null) !== row.destinationDigest) throw new Error('目标已变化，请重新预览。');
        if (row.normalizedContent) atomicWrite(path.join(stage, 'SKILL.md'), row.normalizedContent);
        if (exists(row.destination)) backup = this.archive(row.destination, row.rootId, 'sync-overwrite');
        fs.mkdirSync(path.dirname(row.destination), { recursive: true });
        try { fs.renameSync(stage, row.destination); }
        catch (error) { if (error.code !== 'EXDEV') throw error; copyTree(stage, row.destination); removeOwned(stagingRoot, stage); }
        count++;
        this.log('sync', `${row.name} → ${row.target}`, { path: row.destination, backupId: backup?.id });
      } catch (error) {
        if (backup && !exists(row.destination)) { try { this.restore(backup.id); } catch {} }
        throw new Error(`已同步 ${count} 项；${row.name} 失败：${error.message}${backup ? ' 原版本保留在回收站或已恢复。' : ''}`);
      } finally { if (exists(stage)) removeOwned(stagingRoot, stage); }
    }
    if (plan.stateTransfers?.length) {
      const config = C.loadConfig('codex', this.configPaths().codex);
      if (plan.stateTransfers.some(transfer => transfer.configDigest !== config.digest)) throw new Error('Codex 配置已变化，保留迁移来源，请重新检查。');
      let text = config.text;
      for (const transfer of plan.stateTransfers) text = C.toggleText({ ...config, text, data: require('smol-toml').parse(text) }, transfer.skill, transfer.enabled);
      const bom = config.raw.subarray(0, 3).equals(Buffer.from([239, 187, 191])) ? '\uFEFF' : '';
      atomicWrite(config.file, bom + text, config.digest);
    }
    for (const move of plan.relocations || []) {
      const root = this.roots().find(root => root.id === move.rootId && root.writable);
      const sourceTree = tree(move.source), targetTree = tree(move.destination);
      if (sourceTree.digest !== move.sourceDigest) throw new Error('迁移来源已变化，保留原件，请重新检查。');
      const targetFiles = new Map(targetTree.files.map(file => [file.path, file.hash]));
      if (sourceTree.files.length !== targetTree.files.length || sourceTree.files.some(file => targetFiles.get(file.path) !== (file.path === 'SKILL.md' && move.normalizedContent ? hash(move.normalizedContent) : file.hash)) || JSON.stringify(sourceTree.directories) !== JSON.stringify(targetTree.directories)) throw new Error('迁移目标校验失败，保留原件。');
      removeOwned(root.path, move.source);
      this.log('sync', `迁移到共用目录：${path.basename(move.source)}`, { path: move.destination });
    }
    this.plans.delete(token);
    return { message: `同步完成：写入 ${count} 项，跳过 ${plan.rows.length - count} 项。启用状态沿用目标工具配置。`, snapshot: this.snapshot() };
  }
  importFolder(directory) {
    assertNoLinks(directory);
    const fakeRoot = { id: 'import', providers: [], label: '本地导入' };
    const sources = [];
    const find = (current, depth) => {
      if (depth > 5) return;
      if (exists(path.join(current, 'SKILL.md'))) { tree(current); sources.push(this.metadata(current, fakeRoot)); return; }
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        if (entry.isDirectory()) find(path.join(current, entry.name), depth + 1);
      }
    };
    find(directory, 0);
    if (!sources.length) throw new Error('没有找到 SKILL.md；请选择技能文件夹或包含技能的目录。');
    const token = crypto.randomUUID(); this.imports.set(token, sources);
    return { importToken: token, skills: sources };
  }
  importZip(file) {
    const zip = new AdmZip(file), entries = zip.getEntries();
    if (entries.length > 30000) throw new Error('ZIP 文件数量超过限制。');
    let total = 0;
    const destination = path.join(this.dataDir, 'imports', crypto.randomUUID());
    for (const entry of entries) {
      const normalized = entry.entryName.replaceAll('\\', '/');
      const segments = normalized.split('/').filter(Boolean);
      if (!segments.length || segments.some(segment => segment === '..' || segment === '.' || /[:\x00]/.test(segment)) || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) throw new Error('ZIP 包含不安全路径。');
      for (const segment of segments) {
        if (/[<>:\"|?*\x00-\x1f]/.test(segment) || /[. ]$/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)) throw new Error('ZIP 含有无效文件名。');
      }
      if (((entry.header.attr >>> 16) & 0xf000) === 0xa000) throw new Error('ZIP 含有符号链接，无法导入。');
      total += entry.header.size;
      if (total > 1024 * 1024 * 1024) throw new Error('ZIP 解压大小超过 1 GB。');
      assertWithin(destination, path.join(destination, normalized));
    }
    fs.mkdirSync(destination, { recursive: true });
    try {
      for (const entry of entries) {
        const target = path.join(destination, entry.entryName.replaceAll('\\', '/'));
        if (entry.isDirectory) fs.mkdirSync(target, { recursive: true });
        else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, entry.getData(), { flag: 'wx' }); }
      }
      return this.importFolder(destination);
    } catch (error) { removeOwned(path.join(this.dataDir, 'imports'), destination); throw error; }
  }
  exportZip(ids, output) {
    const skills = ids.map(skillId => this.getSkill(skillId));
    if (!skills.length) throw new Error('请先选择技能。');
    if (skills.some(skill => within(skill.path, output, true))) throw new Error('请把 ZIP 保存到技能目录之外。');
    assertNoLinks(output);
    const zip = new AdmZip();
    const seen = new Set();
    for (const skill of skills) {
      const contents = tree(skill.path);
      let prefix = skill.directoryName;
      if (seen.has(prefix.toLowerCase())) prefix = `${skill.rootId}-${skill.id.slice(0, 6)}/${skill.directoryName}`;
      seen.add(prefix.toLowerCase());
      for (const directory of contents.directories) zip.addFile(`${prefix}/${directory}/`, Buffer.alloc(0));
      for (const file of contents.files) {
        let content = fs.readFileSync(F.sourceFile(skill.path, file.path));
        if (file.path === 'SKILL.md' && content.toString('utf8').includes('# skilldock-original-invocation: ')) content = Buffer.from(DSH.transferable(content.toString('utf8').replace(/^\uFEFF/, '')));
        zip.addFile(`${prefix}/${file.path}`, content);
      }
      if (tree(skill.path).digest !== contents.digest) throw new Error('导出期间文件变化，请重试。');
    }
    atomicWrite(output, zip.toBuffer());
    this.log('export', `导出 ${skills.length} 个技能`, { path: output });
    return { message: `已导出 ${skills.length} 个技能。`, path: output };
  }
}
module.exports = { SkillManager, PROVIDERS };
