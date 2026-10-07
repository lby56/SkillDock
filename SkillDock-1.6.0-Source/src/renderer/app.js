const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = text => String(text ?? '').replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[value]));
const names = { codex: 'Codex', claude: 'Claude Code', opencode: 'OpenCode', dsh: 'DeepSeek Harness' };
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  box: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  sync: '<path d="M20 7H5l4-4M4 17h15l-4 4M20 7l-4 4M4 17l4-4"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
  settings: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  power: '<path d="M12 2v10M6 5a9 9 0 1 0 12 0"/>',
  refresh: '<path d="M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5M4 14a8 8 0 0 0 14 5l3-3m0 5v-5h-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z"/>',
  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  restore: '<path d="M3 4v6h6M3 10a9 9 0 1 1 1 7M12 7v5l3 2"/>',
  file: '<path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8M8 16h6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  alert: '<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 9.5v5M12 17.5v.1"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.box}</svg>`;
const logo = provider => `<span class="provider-logo ${provider}">${provider === 'codex' ? '≋' : provider === 'claude' ? '✳' : provider === 'dsh' ? 'DS' : '>_'}</span>`;
const fmtBytes = size => size > 1048576 ? `${(size / 1048576).toFixed(1)} MB` : size > 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`;
const fmtDate = value => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
// Files unpacked without timestamps report the 1970 epoch; showing that date would look like a bug.
const fmtFullDate = value => new Date(value).getFullYear() < 1990 ? '未知' : new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtScanTime = value => new Date(value).toDateString() === new Date().toDateString() ? new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : fmtDate(value);
const state = { snapshot: null, route: 'overview', provider: 'all', search: '', filter: 'all', overviewFilter: 'all', selected: new Set(), overviewSelected: new Set(), batchScope: 'all', detailId: null, detail: null, busy: false, syncSource: 'codex', syncSelected: new Set(), syncTargets: new Set(['claude', 'opencode', 'dsh']), imports: null, plan: null };
let toastTimer, detailSequence = 0;
function toast(message, error = false) {
  const element = $('#toast'); element.textContent = message; element.className = `visible${error ? ' error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => element.className = '', error ? 11000 : 6500);
}
async function api(method, input) { return window.skilldock.call(method, input); }
async function run(action) {
  if (state.busy) return;
  state.busy = true; document.body.setAttribute('aria-busy', 'true');
  const buttons = $$('dialog[open] .modal-footer button'); buttons.forEach(button => button.disabled = true);
  try { await action(); } catch (error) { toast(error.message, true); }
  finally { state.busy = false; document.body.removeAttribute('aria-busy'); buttons.forEach(button => button.disabled = false); }
}
function accept(result) {
  if (result?.snapshot) state.snapshot = result.snapshot;
  if (result?.message) toast(result.message);
}
async function refresh() {
  state.snapshot = await api('snapshot');
  state.selected = new Set([...state.selected].filter(id => state.snapshot.skills.some(skill => skill.id === id)));
  state.detail = null; render();
}
async function rescan() {
  const button = $('#refresh'); button.classList.add('spinning');
  try { await refresh(); toast(`已重新扫描，共发现 ${state.snapshot.skills.length} 个技能目录。`); }
  finally { button.classList.remove('spinning'); }
}
function navigate(route, provider = 'all') {
  closeSkillMenu(); state.route = route; state.provider = provider; state.selected.clear(); state.overviewSelected.clear(); state.batchScope = 'all'; state.detailId = null; state.detail = null;
  state.search = ''; state.overviewFilter = 'all'; $('#content').scrollTop = 0; render();
}
function navigation() {
  const skills = state.snapshot.skills;
  const item = (route, title, name, count, provider = 'all') => {
    const active = state.route === route && state.provider === provider;
    return `<button data-action="nav" data-route="${route}" data-provider="${provider}" class="nav-item${active ? ' active' : ''}"${active ? ' aria-current="page"' : ''} title="${title}">${names[provider] ? logo(provider) : icon(name)}<span class="nav-text">${title}</span>${count !== undefined ? `<span class="count">${count}</span>` : ''}</button>`;
  };
  $('#navigation').innerHTML = '<div class="nav-label">工作空间</div>'
    + item('overview', '四端总览', 'layers', state.snapshot.catalog.length) + item('library', '全部技能', 'grid', skills.length)
    + item('favorites', '我的收藏', 'star', skills.filter(skill => skill.favorite).length)
    + '<div class="nav-label">连接的工具</div>'
    + Object.keys(names).map(provider => item('library', names[provider], '', skills.filter(skill => skill.providers.includes(provider)).length, provider)).join('')
    + '<div class="nav-label">管理</div>'
    + item('sync', '同步中心', 'sync') + item('trash', '回收站', 'trash', state.snapshot.recycleCount || undefined)
    + item('ai', 'AI 修改', 'code') + item('history', '操作记录', 'clock') + item('settings', '目录设置', 'settings');
}
function sidebarStatus() {
  $('.offline').textContent = state.snapshot.portable ? '便携模式 · 无需安装' : '本地运行 · 无需登录';
  $('#scan-time').textContent = `扫描于 ${fmtScanTime(state.snapshot.scannedAt)}`;
  $('#scan-time').title = `上次扫描：${fmtFullDate(state.snapshot.scannedAt)}`;
  $('#app-version').textContent = `v${state.snapshot.version}`;
}
function heading(title, description, actions = '', info = false) {
  return `<header class="page-header"><div class="page-title"><h1>${title}</h1><p class="subtitle">${description}${info ? `<button class="link-button" data-action="scope-info">${icon('info')}说明</button>` : ''}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</header>`;
}
function empty(title, description, name = 'box') { return `<div class="empty">${icon(name)}<h3>${title}</h3><p>${description}</p></div>`; }
function errorBanner() {
  const errors = state.snapshot.errors;
  return errors.length ? `<div class="error-banner">${icon('alert')}<span>扫描发现 ${errors.length} 项异常：${esc(errors[0].message)}</span><button class="link-button" data-action="errors">查看详情</button></div>` : '';
}
function filteredSkills({ filter = state.filter, search = state.search } = {}) {
  const query = search.toLowerCase();
  return state.snapshot.skills.filter(skill => {
    if (state.provider !== 'all' && !skill.providers.includes(state.provider)) return false;
    if (state.route === 'favorites' && !skill.favorite) return false;
    if (query && !`${skill.name} ${skill.description} ${skill.source} ${skill.path}`.toLowerCase().includes(query)) return false;
    const statuses = state.provider === 'all' ? Object.values(skill.states) : [skill.states[state.provider]];
    if (filter === 'local' && skill.locked) return false;
    if (filter === 'on' && !statuses.some(status => status.enabled === true)) return false;
    if (filter === 'off' && !statuses.some(status => status.enabled === false)) return false;
    if (filter === 'managed' && !skill.locked) return false;
    if (filter === 'duplicates' && !skill.duplicates.length) return false;
    if (filter === 'invalid' && !skill.metadataError && !skill.warnings.length) return false;
    return true;
  });
}
function providerChip(skill, provider) {
  const status = skill.states[provider];
  return `<span class="provider-chip ${status.enabled === false ? 'off' : status.enabled === null ? 'managed' : ''}" title="${esc(status.enabled === null ? status.reason : `${names[provider]}：${status.enabled ? '启用' : '禁用'}`)}"><span class="dot"></span>${names[provider]}</span>`;
}
function starButton(skill) {
  const label = skill.favorite ? '取消收藏' : '收藏';
  return `<button class="star ${skill.favorite ? 'is-favorite' : ''}" data-action="favorite" data-id="${skill.id}" aria-pressed="${skill.favorite}" aria-label="${label} ${esc(skill.name)}" title="${label}">${icon('star')}</button>`;
}
const isBuiltinName = name => state.snapshot.rules.keepClaudeBuiltins && state.snapshot.builtinReport.names.includes(name.toLowerCase());
// A personal copy of a Claude Code built-in inside another tool's folder breaks the sync rule.
const isBuiltinCopy = skill => !skill.locked && ['codex', 'opencode', 'shared', 'dsh'].includes(skill.rootId) && isBuiltinName(skill.name);
function skillTags(skill) {
  const origin = skill.builtin ? '<span class="tag claude" title="claude.ai 同步的 Anthropic 官方技能">Claude 自带</span>' : skill.locked ? '<span class="tag">托管</span>' : skill.duplicates.length ? '<span class="tag">多份</span>' : '';
  const check = isBuiltinCopy(skill) ? '<span class="tag warn" title="Claude Code 自带技能只留在 Claude Code">不应同步</span>' : skill.metadataError ? '<span class="tag warn">格式异常</span>' : skill.warnings.length ? '<span class="tag warn">需检查</span>' : '';
  return origin + check;
}
function builtinPending() {
  const { rules, builtinReport: report } = state.snapshot;
  if (!rules.keepClaudeBuiltins) return '';
  return [report.copies.length && `其他工具目录里有 ${report.copies.length} 个副本`, report.openCode.length && `OpenCode 中仍启用 ${report.openCode.length} 个`].filter(Boolean).join('，');
}
function ruleBanner() {
  const pending = builtinPending();
  return pending ? `<div class="rule-banner">${icon('info')}<span>Claude Code 自带技能应只留在 Claude Code：${pending}。</span><button class="btn" data-action="builtin-cleanup">按规则整理</button></div>` : '';
}
function rulePanel() {
  const { rules, builtinReport: report } = state.snapshot, pending = builtinPending();
  const status = !rules.keepClaudeBuiltins ? '' : pending
    ? `<div class="rule-status warn">${icon('info')}<span>与规则不符：${pending}。</span><button class="btn" data-action="builtin-cleanup">按规则整理</button></div>`
    : `<div class="rule-status">${icon('check')}<span>当前没有与规则不符的项目。</span></div>`;
  return `<div class="panel"><div class="panel-heading"><div><h2>同步规则</h2><p>决定哪些技能参与「同步全部至四端」和手动同步。</p></div>${icon('sync')}</div><label class="rule-row"><input type="checkbox" id="rule-keep-builtins" ${rules.keepClaudeBuiltins ? 'checked' : ''}><span><strong>Claude Code 自带技能只留在 Claude Code</strong><small>claude.ai 同步下来的 Anthropic 官方技能${report.names.length ? `（当前 ${report.names.length} 个：${report.names.map(esc).join('、')}）` : ''}不会被复制到 Codex、OpenCode 和 Harness。OpenCode 会直接读取 Claude 的技能目录，所以还需要在 OpenCode 中禁用它们。</small></span></label>${status}</div>`;
}
async function builtinCleanupDialog() {
  const plan = await api('previewBuiltinCleanup'); state.cleanupPlan = plan;
  const copies = plan.copies.length ? `<div class="section-caption">移入回收站 · ${plan.copies.length} 个副本</div><div class="modal-options">${plan.copies.map(item => `<div class="plan-row"><div class="plan-top"><div>${esc(item.name)}<small>${esc(item.source)}</small><small class="config-path">${esc(item.path)}</small></div>${icon('trash')}</div></div>`).join('')}</div>` : '';
  const openCode = plan.openCode.length ? `<div class="section-caption">在 OpenCode 中禁用 · ${plan.openCode.length} 个</div><div class="note neutral">${plan.openCode.map(item => esc(item.name)).join('、')}</div>` : '';
  modal('按规则整理', `<p>规则：Claude Code 自带技能只留在 Claude Code。移除的副本进入回收站，可随时恢复；OpenCode 配置写入前自动备份。Claude Code 里的这些技能不受影响。</p>${copies}${openCode}<div class="note neutral">Codex 需重启后读取变化；OpenCode 请在新会话中确认。</div>`, `<button class="btn primary" data-action="confirm-builtin-cleanup">${icon('check')} 确认整理</button>`);
}
function skillRow(skill) {
  const status = state.provider !== 'all' ? skill.states[state.provider] : null, selected = state.selected.has(skill.id);
  const control = status && status.canToggle !== false
    ? `<button class="switch ${status.enabled === true ? 'on' : ''}" data-action="toggle" data-id="${skill.id}" data-provider="${state.provider}" data-enabled="${status.enabled !== true}" role="switch" aria-checked="${status.enabled === true}" aria-label="${esc(skill.name)} ${names[state.provider]} 开关" title="${names[state.provider]}：${status.enabled === true ? '已启用' : '已禁用'}" ${status.enabled === null ? 'disabled' : ''}></button>`
    : starButton(skill);
  return `<div class="skill-row${state.detailId === skill.id ? ' current' : ''}${selected ? ' is-selected' : ''}" ${selectionRowAttributes(skill.id, selected)} data-action="detail" data-id="${skill.id}" data-skill="${esc(skill.name)}">
    <input type="checkbox" data-row-select="${skill.id}" aria-label="选择 ${esc(skill.name)}" ${selected ? 'checked' : ''}>
    <div class="skill-summary"><div class="skill-line"><span class="skill-name" title="${esc(skill.name)}">${esc(skill.name)}</span>${skillTags(skill)}</div><div class="skill-sub"><span class="skill-desc" title="${esc(skill.description)}">${esc(skill.description)}</span><span class="skill-tags">${skill.providers.map(provider => providerChip(skill, provider)).join('')}</span></div></div>
    ${control}</div>`;
}
function listOnly() {
  pruneSelection();
  const skills = filteredSkills();
  $('#skill-list').innerHTML = skills.length ? skills.map(skillRow).join('') : state.search ? empty('没有匹配的技能', '换个关键词，或调整筛选条件。', 'search') : empty('这里还没有技能', '试试其他筛选条件，或从本地文件夹导入技能。', 'search');
  $('#list-count').textContent = `${skills.length} 个技能`;
  $('#select-all').checked = skills.length > 0 && skills.every(skill => state.selected.has(skill.id));
  $('#select-all').indeterminate = state.selected.size > 0 && !skills.every(skill => state.selected.has(skill.id));
  $('#selection-container').innerHTML = batchSelectionBar(`<button class="btn" data-action="sync-selected">${icon('sync')}同步</button><button class="btn" data-action="export">${icon('download')}导出</button><button class="btn danger" data-action="delete-selected">${icon('trash')}删除</button>`);
}
function library() {
  const title = state.route === 'favorites' ? '我的收藏' : state.provider === 'all' ? '技能库' : `${names[state.provider]} 技能`;
  const description = state.route === 'favorites' ? '常用技能集中在这里，开关与同步和技能库一致。' : state.provider === 'all' ? '把重复配置留在过去。发现、整理，让技能在工具间自由流动。' : `管理 ${names[state.provider]} 能发现的全局技能与配置开关。`;
  const filters = [['all', '所有技能'], ['local', '个人技能'], ['on', '已启用'], ['off', '已禁用'], ['managed', '托管 / 系统'], ['duplicates', '同名多份'], ['invalid', '需要检查']];
  const skills = filteredSkills();
  if (!skills.some(skill => skill.id === state.detailId)) { state.detailId = skills[0]?.id || null; state.detail = null; }
  $('#content').innerHTML = heading(title, description, `<button class="btn" data-action="nav" data-route="sync">${icon('sync')} 同步技能</button><button class="btn primary" data-action="import">${icon('plus')} 导入技能</button>`, true)
    + errorBanner() + ruleBanner()
    + `<div class="workspace"><section class="library"><div class="library-tools"><label class="search">${icon('search')}<input id="search" type="search" placeholder="搜索名称、描述或路径…" value="${esc(state.search)}" aria-label="搜索技能"><kbd>Ctrl K</kbd></label><select id="status-filter" aria-label="筛选状态">${filters.map(([value, label]) => `<option value="${value}" ${state.filter === value ? 'selected' : ''}>${label} · ${filteredSkills({ filter: value, search: '' }).length}</option>`).join('')}</select></div><div class="list-meta"><label><input type="checkbox" id="select-all" data-selection-all aria-label="全选当前列表"><span id="list-count"></span></label><span class="selection-guide">Ctrl / Shift 多选 · 右键批量开关</span></div><div id="skill-list" class="skill-list" role="grid" aria-label="技能列表" aria-multiselectable="true"></div><div id="selection-container"></div></section><aside class="detail" id="detail-panel"></aside></div>`;
  listOnly(); renderDetail();
}
const modeLabels = { manual: '仅手动调用', 'model-only': '仅模型调用', on: '已启用', allow: '已启用', off: '已禁用', deny: '已禁用', ask: '调用时询问', 'user-invocable-only': '仅手动调用', 'name-only': '仅显示名称', managed: '托管', unknown: '读取异常', 'tool-off': '工具已关闭' };
function renderDetail() {
  const panel = $('#detail-panel'); if (!panel) return;
  const skill = state.snapshot.skills.find(skill => skill.id === state.detailId);
  if (panel.dataset.current !== (skill?.id || '')) { panel.dataset.current = skill?.id || ''; panel.scrollTop = 0; }
  if (!skill) { panel.innerHTML = empty('选一个技能看看', '查看说明、来源和每个工具的开关状态。'); return; }
  const providers = skill.providers.map(provider => {
    const status = skill.states[provider];
    return `<div class="provider-state">${logo(provider)}<span>${names[provider]}</span><span class="provider-mode ${status.enabled === true ? 'is-on' : ''}">${modeLabels[status.mode] || esc(status.mode)}</span><button class="switch ${status.enabled === true ? 'on' : ''}" data-action="toggle" data-id="${skill.id}" data-provider="${provider}" data-enabled="${status.enabled !== true}" role="switch" aria-checked="${status.enabled === true}" aria-label="${esc(skill.name)} ${names[provider]} 开关" ${status.canToggle === false || status.enabled === null ? 'disabled' : ''} title="${esc(status.reason || '切换全局配置')}"></button></div>`;
  }).join('');
  const notes = (skill.locked ? `<div class="note neutral">${esc(skill.lockedReason)}</div>` : skill.duplicates.length ? '<div class="note">检测到同名副本。Claude Code / OpenCode 的名称开关会作用于同名技能；删除会影响读取该目录的所有工具。</div>' : '')
    + (skill.metadataError ? `<div class="note">${esc(skill.metadataError)}</div>` : '')
    + (skill.warnings.length ? `<div class="note neutral">同步前建议检查：<ul>${skill.warnings.map(warning => `<li>${esc(warning)}</li>`).join('')}</ul></div>` : '');
  panel.innerHTML = `<div class="detail-header"><div class="detail-top"><div class="skill-symbol">${icon(skill.locked ? 'lock' : 'code')}</div>${starButton(skill)}</div><h2>${esc(skill.name)}</h2><div class="detail-tags">${skillTags(skill)}</div><p class="detail-description">${esc(skill.description)}</p></div>`
    + `<div class="detail-body"><div class="section-caption">工具状态</div>${providers}<div class="detail-actions"><button class="btn" data-action="preview-content" data-id="${skill.id}">${icon('file')} 查看内容</button><button class="btn" data-action="sync-one" data-id="${skill.id}">${icon('sync')} 同步到</button></div><dl class="detail-meta"><dt>来源</dt><dd>${esc(skill.source)}</dd><dt>更新时间</dt><dd>${fmtFullDate(skill.modified)}</dd><dt>位置</dt><dd class="config-path">${esc(skill.path)}</dd></dl>${notes}<div class="detail-links"><button data-action="open" data-id="${skill.id}">${icon('folder')} 打开文件夹</button><button class="danger" data-action="delete-one" data-id="${skill.id}" ${skill.locked ? 'disabled' : ''}>${icon('trash')} 删除</button></div></div>`;
}
function syncPage() {
  pruneSelection();
  const roots = state.snapshot.roots.filter(root => root.writable);
  const sources = syncSources();
  const picker = state.imports
    ? `<div class="target-card">${icon('folder')}<span class="target-name">本地导入<small>${sources.length} 个技能，仅用于本次同步</small></span><button class="subtle" data-action="clear-import">取消导入</button></div>`
    : `<select id="sync-source" class="sync-select" aria-label="同步来源">${roots.map(root => `<option value="${root.id}" ${root.id === state.syncSource ? 'selected' : ''}>${esc(root.label)}</option>`).join('')}</select>`;
  const rows = sources.map(skill => {
    const selected = state.syncSelected.has(skill.id), detail = skill.locked ? '托管来源 · 仅复制' : skill.directoryName !== skill.name ? `目录：${skill.directoryName}` : skill.description;
    return `<label class="${selected ? 'is-selected' : ''}" ${selectionRowAttributes(skill.id, selected)}><input type="checkbox" data-row-select="${skill.id}" aria-label="选择 ${esc(skill.name)}" ${selected ? 'checked' : ''}><span class="source-text"><span class="source-name">${esc(skill.name)}</span><small title="${esc(detail)}">${esc(detail)}</small></span></label>`;
  }).join('');
  const steps = [['layers', '先看见变化', '识别新增、相同与冲突，逐个列出文件变化。'], ['restore', '保留原来的版本', '覆盖前的版本会进入回收站，随时可以恢复。'], ['check', '使用前检查兼容性', '工具专有字段和依赖不会自动转换，请在目标工具中检查。']];
  $('#content').innerHTML = heading('同步中心', '选择一份来源，把完整技能复制到其他工具。每次同步都先比较文件差异。', `<button class="btn" data-action="import">${icon('plus')} 导入本地技能</button><button class="btn primary" data-action="sync-all">${icon('sync')} 同步全部至四端</button>`)
    + `<div class="panel"><div class="panel-heading"><div><h2>创建一次同步</h2><p>复制 SKILL.md、脚本和资源文件；目标工具保留自己的启用状态。</p></div><span class="state-label">手动同步</span></div><div class="sync-layout"><div><div class="step-title"><span class="step-badge">1</span>选择来源与技能</div>${picker}<div class="sync-source-list" role="grid" aria-label="同步来源技能" aria-multiselectable="true">${rows || empty('来源暂无技能', '可以先导入技能，或选择其他来源目录。')}</div><div class="sync-source-footer"><button class="subtle" data-action="sync-select-all">全选 / 取消全选</button><span class="sync-select-hint">已选 ${state.syncSelected.size} 项 · Ctrl / Shift 多选 · 右键开关</span></div></div><div><div class="step-title"><span class="step-badge">2</span>选择目标目录</div>${roots.map(root => `<label class="target-card"><input type="checkbox" data-sync-target="${root.id}" ${state.syncTargets.has(root.id) ? 'checked' : ''}>${root.id === 'shared' ? icon('layers') : logo(root.id)}<span class="target-name">${esc(root.label)}<small class="config-path">${esc(root.path)}</small></span></label>`).join('')}<div class="note neutral">OpenCode 也能读取 Claude Code 与 .agents 目录。仅为 OpenCode 提供已有技能时，通常无需再复制一份。</div></div></div><div class="sync-bottom"><span>同名文件默认跳过；覆盖前自动保留完整原版本。</span><button class="btn primary" data-action="preview-sync">${icon('sync')} 预览同步差异</button></div></div>`
    + `<div class="panel"><div class="guide-grid">${steps.map(([name, title, text]) => `<div class="guide-step">${icon(name)}<div><h3>${title}</h3><p>${text}</p></div></div>`).join('')}</div></div>`;
}
const recordKinds = { sync: ['sync', 'sync'], delete: ['trash', 'delete'], restore: ['restore', 'enable'], enable: ['power', 'enable'], disable: ['power', 'disable'], 'batch-toggle': ['power', ''], settings: ['settings', ''], export: ['download', ''], deduplicate: ['layers', ''] };
async function recordsPage(type) {
  const expectedRoute = state.route;
  const trash = type === 'trash';
  $('#content').innerHTML = heading(trash ? '回收站' : '操作记录', trash ? '已删除的技能和同步前的版本保留在这里，直到你需要恢复。' : '查看开关、同步、删除与恢复操作。记录只保存在本机。') + `<div class="panel" id="records">${empty('正在读取…', '')}</div>`;
  try {
    const records = await api(trash ? 'recycleBin' : 'history'); if (state.route !== expectedRoute) return;
    $('#records').innerHTML = records.length ? records.map(record => {
      const [name, kind] = trash ? ['box', record.reason === 'sync-overwrite' ? 'sync' : 'delete'] : recordKinds[record.action] || ['clock', ''];
      const reason = { 'sync-overwrite': '同步覆盖备份', rule: '按同步规则移除' }[record.reason] || '已删除';
      return `<div class="list-record"><div class="record-icon ${kind}">${icon(name)}</div><div class="record-main"><strong>${esc(trash ? record.name : record.message)}</strong><p>${esc(trash ? `${reason} · ${fmtBytes(record.bytes)} · ${record.original}` : record.path || '本地操作')}</p></div><span class="record-time">${fmtDate(record.at)}</span>${trash ? `<button class="btn" data-action="restore" data-id="${record.id}">${icon('restore')} 恢复</button>` : ''}</div>`;
    }).join('') : empty(trash ? '回收站是空的' : '还没有操作记录', trash ? '删除与覆盖前的版本会保留在这里。' : '开始管理技能后，操作记录会自动出现在这里。', trash ? 'trash' : 'clock');
  } catch (error) { toast(error.message, true); }
}
function settingsPage() {
  const labels = { codex: 'Codex 配置目录', claude: 'Claude Code 配置目录', opencode: 'OpenCode 配置目录', dsh: 'DeepSeek Harness 配置目录', shared: '共享 .agents 目录', dshAgents: 'Harness 兼容 .agents 目录' };
  const row = ([provider, label]) => `<div class="setting-row"><label for="location-${provider}">${names[provider] ? logo(provider) : icon('layers')}${label}</label><div class="path-field"><input id="location-${provider}" value="${esc(state.snapshot.locationInputs[provider])}" placeholder="自动：${esc(state.snapshot.locations[provider])}" spellcheck="false"><button class="btn" data-action="choose-location" data-provider="${provider}">${icon('folder')} 浏览</button></div><small>当前解析位置：<span class="config-path">${esc(state.snapshot.locations[provider])}</span>${provider === 'dsh' ? '<br>管理 skills 下的技能；开关使用 Harness 原生调用字段。' : state.snapshot.configPaths[provider] ? `<br>开关配置：<span class="config-path">${esc(state.snapshot.configPaths[provider])}</span>` : provider === 'dshAgents' ? '<br>Harness 的共享兼容来源；同步到个人目录后可独立切换。' : '<br>默认供 Codex、OpenCode 和 Harness 兼容读取。'}</small></div>`;
  $('#content').innerHTML = heading('目录设置', '自动识别当前用户的工具目录，也可以指定自己的位置。修改这里仅改变 SkillDock 的管理范围。')
    + rulePanel()
    + `<div class="panel"><div class="panel-heading"><div><h2>${state.snapshot.portable ? '便携模式 · 当前用户' : '本机位置'}</h2><p>留空表示自动识别；支持 ~、%USERPROFILE%、%APP_DIR% 和相对程序目录的路径（例如 ./tools/dsh）。</p></div>${icon('folder')}</div>${Object.entries(labels).map(row).join('')}<div class="sync-bottom"><span>工具本身也须使用同一目录。自定义外部绝对路径在换电脑后需要重新选择。</span><div class="setting-actions"><button class="btn" data-action="reset-settings">恢复自动识别</button><button class="btn primary" data-action="save-settings">保存并重新扫描</button></div></div></div>`
    + `<div class="panel"><div class="panel-heading"><div><h2>备份与管理数据</h2><p>${state.snapshot.portable ? '数据随整个应用文件夹移动，并按电脑和用户隔离。分发给他人请使用原始便携 ZIP。' : '配置备份、回收站和操作记录保存在本机。'}<br><span class="config-path">${esc(state.snapshot.dataDir)}</span></p></div><button class="btn" data-action="open-data">${icon('folder')} 打开目录</button></div><ul class="info-list compact"><li>${esc(state.snapshot.scopeNote)}</li><li>Harness 管理用户目录，支持文件夹与平铺 Markdown；共享来源只读。Codex 配置变化后需要重启。</li><li>同步技能不包含工具安装、登录、MCP 连接和脚本依赖；技能正文中原有的绝对路径请在目标环境调整。</li></ul></div>`;
}
function render() {
  if (!state.snapshot) return; closeSkillMenu(); navigation(); sidebarStatus();
  $('#content').classList.toggle('fill', ['overview', 'library', 'favorites'].includes(state.route));
  if (state.route === 'overview') overviewPage();
  else if (['library', 'favorites'].includes(state.route)) library();
  else if (state.route === 'sync') syncPage();
  else if (state.route === 'settings') settingsPage();
  else if (state.route === 'ai') aiPage();
  else recordsPage(state.route);
}
function modal(title, body, footer = '', size = '') {
  const dialog = $('#modal'); dialog.className = size;
  $('#modal-content').innerHTML = `<div class="modal-header"><h2>${title}</h2><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon('close')}</button></div><div class="modal-body">${body}</div><div class="modal-footer"><button class="btn" data-action="close-modal">${footer ? '取消' : '关闭'}</button>${footer}</div>`;
  if (!dialog.open) dialog.showModal();
}
function closeModal() { $('#modal').close(); }
function scopeInfo() {
  const locked = state.snapshot.skills.filter(skill => skill.locked).length;
  const items = state.route === 'overview' ? [
    '同名技能合并为一行，每一列显示该工具实际读取的那一份。',
    'Codex、Claude Code、OpenCode 使用各自的全局开关配置；Harness 使用技能原生的调用开关。',
    '标有「Claude 自带」的是 claude.ai 同步的 Anthropic 官方技能。开启同步规则时它们只留在 Claude Code，其他列显示「不同步」，同步全部至四端会跳过它们。',
    'Codex 修改后需重启才会读取新配置；其他工具请在新会话中确认。',
    'OpenCode 可以共用 Claude Code 的技能目录，开关仍各自独立。',
    '插件来源显示配置状态，插件本身需在原工具中安装并启用。',
    '同步只复制技能文件，不包含专用工具、MCP 连接或运行环境。'
  ] : [
    '每个技能目录单独列为一项；同名技能在不同目录中各算一份。',
    `当前有 ${locked} 个托管或系统技能（插件、内置、云同步或链接目录），可用「托管 / 系统」筛选查看，其文件受保护。`,
    'Claude Code 与 OpenCode 的开关按技能名称生效，会同时作用于同名副本。',
    '删除会把整个技能目录移入回收站，读取该目录的所有工具都会受影响。'
  ];
  modal(state.route === 'overview' ? '四端开关说明' : '扫描范围说明', `<ul class="info-list">${[...items, state.snapshot.scopeNote].map(item => `<li>${esc(item)}</li>`).join('')}</ul>`);
}
function importDialog() {
  modal('导入技能', `<p>选择含有 SKILL.md 的文件夹，或已有的技能 ZIP。接着选择要安装到的工具。</p><div class="modal-options"><button class="btn" data-action="import-folder">${icon('folder')} 从文件夹导入</button><button class="btn" data-action="import-zip">${icon('upload')} 从 ZIP 导入</button></div><div class="note neutral">所有内容仅在本机处理，导入时不会执行技能脚本。</div>`);
}
async function doImport(method) {
  const result = await api(method); if (!result) return;
  state.imports = result; state.syncSelected = new Set(result.skills.map(skill => skill.id));
  closeModal(); state.route = 'sync'; state.provider = 'all'; render();
}
function syncModal(ids) {
  state.quickIds = ids;
  const skills = ids.map(id => state.snapshot.skills.find(skill => skill.id === id)).filter(Boolean);
  const builtin = skills.some(skill => isBuiltinName(skill.name));
  const preselect = root => skills.every(skill => skill.rootId !== root.id) && root.id !== 'shared' && !(builtin && root.providers.some(provider => provider !== 'claude'));
  modal('同步到其他工具', `<p>将 ${skills.length} 个技能复制到以下目录。下一步会展示具体文件差异。</p><div class="modal-options">${state.snapshot.roots.filter(root => root.writable).map(root => `<label><input type="checkbox" data-quick-target="${root.id}" ${preselect(root) ? 'checked' : ''}>${root.id === 'shared' ? icon('layers') : logo(root.id)} ${esc(root.label)}</label>`).join('')}</div>${builtin ? '<div class="note">所选包含 Claude Code 自带技能。按同步规则，它们只留在 Claude Code，复制到其他目录会被跳过。</div>' : ''}`, `<button class="btn primary" data-action="quick-preview-sync">预览差异</button>`);
}
async function previewSync(quick = false) {
  const targets = quick ? $$('[data-quick-target]:checked').map(element => element.dataset.quickTarget) : [...state.syncTargets];
  const ids = quick ? state.quickIds : [...state.syncSelected];
  let importToken;
  if (!quick && state.imports) {
    importToken = state.imports.importToken;
  }
  const plan = await api('previewSync', { ids, targets, importToken }); state.plan = plan;
  const labels = { new: '新增', same: '完全相同', conflict: '存在差异', blocked: '需先修正' };
  modal('确认同步差异', `<p>默认仅新增缺失技能。勾选覆盖后，将先备份目标目录，再替换为源目录的完整内容。</p><div class="modal-options">${plan.rows.map(row => `<div class="plan-row"><div class="plan-top"><div>${esc(row.name)}<small>→ ${esc(row.target)} · ${row.files} 个文件 · ${fmtBytes(row.bytes)}</small></div><span class="state-label ${row.state}">${labels[row.state]}</span></div>${row.blocked ? `<div class="note">${esc(row.blocked)}</div>` : row.changes.length ? `<div class="plan-changes">${row.changes.slice(0, 100).map(file => `<div class="${file.status}">${{ add: '＋', remove: '－', change: '~' }[file.status]} ${esc(file.path)}</div>`).join('')}${row.changes.length > 100 ? `<div>另有 ${row.changes.length - 100} 项变化</div>` : ''}</div>` : ''}${row.warnings.length ? `<div class="note neutral">${row.warnings.map(esc).join('<br>')}</div>` : ''}</div>`).join('')}</div>${plan.rows.some(row => row.state === 'conflict') ? '<label class="modal-check"><input type="checkbox" id="sync-overwrite">覆盖存在差异的目标（旧版本自动放入回收站）</label>' : ''}<div class="note neutral">复制保留原始内容。目标中的启用配置、工具依赖与专用指令需要在目标工具中确认。</div>`, `<button class="btn primary" data-action="apply-sync">${icon('check')} 执行同步</button>`);
}
async function deleteDialog(ids) {
  const plan = await api('previewDelete', ids); state.deletePlan = plan;
  modal('移入回收站', `<p>以下 ${plan.items.length} 个技能目录将从原位置移出，可在回收站恢复。读取该目录的所有工具都会受影响。</p><div class="modal-options">${plan.items.map(item => `<div class="plan-row"><div class="plan-top"><div>${esc(item.name)}<small>${esc(item.providers.map(provider => names[provider]).join(' / '))}</small><small class="config-path">${esc(item.path)}</small></div>${icon('trash')}</div></div>`).join('')}</div>`, `<button class="btn danger" data-action="confirm-delete">${icon('trash')} 移入回收站</button>`);
}
function toggleDialog(ids, enabled, provider) {
  const skills = ids.map(id => state.snapshot.skills.find(skill => skill.id === id)).filter(Boolean);
  const providers = provider ? [provider] : Object.keys(names).filter(item => skills.some(skill => skill.states[item]?.canToggle));
  if (!providers.length) throw new Error('所选均为托管技能，请在来源工具中管理。');
  state.toggleRequest = { ids, enabled };
  modal(enabled ? '启用技能' : '禁用技能', `<p>将为所选技能更新指定工具的全局配置。Claude Code 和 OpenCode 的开关按名称生效，会影响该工具内的同名副本。</p><div class="modal-options">${providers.map(item => `<label><input name="toggle-provider" type="radio" value="${item}" ${providers[0] === item ? 'checked' : ''}>${logo(item)} ${names[item]} <span class="muted">${skills.filter(skill => skill.states[item]?.canToggle).length} 项</span></label>`).join('')}</div><div class="note neutral">原配置自动备份。Codex 需要重启后生效；其他工具请在新会话中确认。</div>`, `<button class="btn primary" data-action="confirm-toggle">确认${enabled ? '启用' : '禁用'}</button>`);
}
async function toggle(id, provider, enabled) {
  const skill = state.snapshot.skills.find(item => item.id === id);
  if (['claude', 'opencode'].includes(provider) && skill.duplicates.length) { toggleDialog([id], enabled, provider); return; }
  const result = await api('setEnabled', { ids: [id], provider, enabled }); accept(result); renderKeepingScroll();
}
async function contentDialog(id) {
  const detail = await api('detail', id); state.detail = detail;
  modal(`${esc(detail.name)} · 内容`, `<div class="preview-tabs"><button class="active" data-action="content-tab" data-tab="text">SKILL.md</button><button data-action="content-tab" data-tab="files">文件 (${detail.files.length})</button></div><div id="content-preview"><pre class="source-preview">${esc(detail.content)}</pre></div>`, '', 'wide');
}
document.addEventListener('click', event => {
  if (handleSelectionClick(event)) return;
  const button = event.target.closest('[data-action]'); if (!button) return;
  if (event.target.matches('input,select')) return;
  const action = button.dataset.action, d = button.dataset;
  if (action === 'nav') { navigate(d.route, d.provider || 'all'); return; }
  if (action === 'close-modal') { if (!state.busy) closeModal(); return; }
  if (action === 'detail') { state.detailId = d.id; listOnly(); renderDetail(); return; }
  if (action === 'overview-detail') { state.route = 'library'; state.provider = 'all'; state.filter = 'all'; state.detailId = d.id; state.selected.clear(); state.overviewSelected.clear(); state.search = ''; render(); $(`.skill-row[data-id="${CSS.escape(d.id)}"]`)?.scrollIntoView({ block: 'center' }); return; }
  if (action === 'overview-filter') { state.overviewFilter = d.filter; closeSkillMenu(); overviewPage(); return; }
  if (action === 'scope-info') { scopeInfo(); return; }
  if (action === 'import') { importDialog(); return; }
  if (action === 'sync-one') { syncModal([d.id]); return; }
  if (action === 'sync-selected') { syncModal([...state.selected]); return; }
  if (action === 'clear-selection') { state.selected.clear(); listOnly(); return; }
  if (action === 'batch-toggle') { toggleDialog([...state.selected], d.enabled === 'true', state.provider === 'all' ? null : state.provider); return; }
  if (action === 'sync-select-all') {
    const sources = state.imports ? state.imports.skills : state.snapshot.skills.filter(skill => skill.rootId === state.syncSource);
    state.syncSelected = state.syncSelected.size === sources.length ? new Set() : new Set(sources.map(skill => skill.id)); syncPage(); return;
  }
  if (action === 'clear-import') { state.imports = null; state.syncSelected.clear(); syncPage(); return; }
  if (action === 'content-tab') {
    $$('.preview-tabs button').forEach(element => element.classList.toggle('active', element.dataset.tab === d.tab));
    $('#content-preview').innerHTML = d.tab === 'text' ? `<pre class="source-preview">${esc(state.detail.content)}</pre>` : state.detail.fileError ? `<div class="note">${esc(state.detail.fileError)}</div>` : state.detail.files.map(file => `<div class="file-row"><span>${esc(file.path)}</span><span>${fmtBytes(file.size)}</span></div>`).join(''); return;
  }
  if (action === 'errors') { modal('扫描异常', state.snapshot.errors.map(error => `<div class="note error-item"><strong class="config-path">${esc(error.path)}</strong><br>${esc(error.message)}</div>`).join('')); return; }
  run(async () => {
    if (action === 'favorite') { const skill = state.snapshot.skills.find(item => item.id === d.id); state.snapshot = await api('favorite', { id: d.id, value: !skill.favorite }); renderKeepingScroll(); }
    else if (action === 'toggle') await toggle(d.id, d.provider, d.enabled === 'true');
    else if (action === 'confirm-toggle') {
      const provider = $('[name=toggle-provider]:checked').value;
      const ids = state.toggleRequest.ids.filter(id => { const skill = state.snapshot.skills.find(item => item.id === id); return skill && skill.states[provider]?.canToggle; });
      accept(await api('setEnabled', { ids, provider, enabled: state.toggleRequest.enabled })); closeModal(); renderKeepingScroll();
    }
    else if (action === 'open') await api('openSkill', d.id);
    else if (action === 'open-data') await api('openData');
    else if (action === 'preview-content') await contentDialog(d.id);
    else if (action === 'delete-one') await deleteDialog([d.id]);
    else if (action === 'delete-selected') await deleteDialog([...state.selected]);
    else if (action === 'confirm-delete') { accept(await api('deleteSkills', state.deletePlan.token)); closeModal(); state.selected.clear(); render(); }
    else if (action === 'restore') { accept(await api('restore', d.id)); render(); }
    else if (action === 'builtin-cleanup') await builtinCleanupDialog();
    else if (action === 'confirm-builtin-cleanup') { accept(await api('applyBuiltinCleanup', state.cleanupPlan.token)); closeModal(); state.selected.clear(); render(); }
    else if (action === 'sync-all') await previewAllSync();
    else if (action === 'preview-sync') await previewSync();
    else if (action === 'quick-preview-sync') await previewSync(true);
    else if (action === 'apply-sync') { accept(await api('applySync', { token: state.plan.token, overwrite: $('#sync-overwrite')?.checked || false })); closeModal(); state.selected.clear(); render(); }
    else if (action === 'import-folder') await doImport('importFolder');
    else if (action === 'import-zip') await doImport('importZip');
    else if (action === 'export') { const result = await api('exportZip', [...state.selected]); if (result) accept(result); }
    else if (action === 'choose-location') { const result = await api('chooseLocation'); if (result) $(`#location-${d.provider}`).value = result; }
    else if (action === 'reset-settings') { state.snapshot = await api('resetLocations'); toast('已恢复当前用户的自动目录。'); render(); }
    else if (action === 'save-settings') {
      const locations = Object.fromEntries(['codex', 'claude', 'opencode', 'dsh', 'shared', 'dshAgents'].map(provider => [provider, $(`#location-${provider}`).value.trim()]));
      state.snapshot = await api('setLocations', locations); toast('目录设置已保存。'); render();
    }
  });
});
document.addEventListener('change', event => {
  const input = event.target;
  if (input.id === 'status-filter') { state.filter = input.value; state.detailId = null; closeSkillMenu(); library(); }
  else if (input.id === 'sync-source') { state.syncSource = input.value; state.syncSelected.clear(); syncPage(); }
  else if (input.id === 'rule-keep-builtins') run(async () => { state.snapshot = await api('setRules', { keepClaudeBuiltins: input.checked }); toast(input.checked ? '已开启：Claude Code 自带技能只留在 Claude Code。' : '已关闭：Claude Code 自带技能可以同步到其他工具。'); render(); });
  else if (input.dataset.syncSelect) { if (input.checked) state.syncSelected.add(input.dataset.syncSelect); else state.syncSelected.delete(input.dataset.syncSelect); }
  else if (input.dataset.syncTarget) { if (input.checked) state.syncTargets.add(input.dataset.syncTarget); else state.syncTargets.delete(input.dataset.syncTarget); }
});
document.addEventListener('input', event => { if (event.target.id === 'search') { state.search = event.target.value; closeSkillMenu(); if (state.route === 'overview') overviewList(); else listOnly(); } });
$('#refresh').innerHTML = `${icon('refresh')}<span>刷新</span>`;
$('#refresh').addEventListener('click', () => run(rescan));
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#search')?.focus(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') { event.preventDefault(); run(rescan); }
});
$('#modal').addEventListener('cancel', event => { if (state.busy) event.preventDefault(); });
installSelectionHandlers();
refresh().catch(error => { $('#content').innerHTML = empty('无法读取技能', esc(error.message), 'info'); toast(error.message, true); });
