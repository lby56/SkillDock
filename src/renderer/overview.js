const overviewFilters = [['all', '全部', '所有技能'], ['complete', '已齐全', '需要同步的工具都已有来源'], ['missing', '待同步', '还有工具缺少来源，可用「同步全部至四端」补齐'], ['disabled', '含禁用', '至少在一个工具中被禁用']];
function overviewCell(group, provider) {
  const entry = group.tools[provider];
  if (!entry && group.excluded.includes(provider)) return `<div class="overview-cell excluded" title="Claude Code 自带技能，按同步规则不复制到 ${names[provider]}。"><span class="excluded-label">不同步</span></div>`;
  if (!entry) return `<div class="overview-cell missing" title="${names[provider]} 还没有这个技能，可用「同步全部至四端」补齐。"><span class="missing-pill">待同步</span></div>`;
  const status = entry.state;
  const label = status.enabled === false ? '已禁用' : status.enabled === true ? (entry.kind === 'plugin' ? '配置启用' : '已启用') : '来源托管';
  const tone = status.enabled === false ? 'is-off' : status.enabled === true ? 'is-on' : 'is-managed';
  const source = { cloud: '云同步', system: '内置', plugin: '插件配置', personal: entry.rootId === 'shared' || entry.rootId === 'dsh-agents' ? '共享兼容来源' : provider === 'opencode' && entry.rootId === 'claude' ? '共用 Claude 目录' : '本地' }[entry.kind] || '本地';
  return `<div class="overview-cell"><button class="switch ${status.enabled === true ? 'on' : ''}" data-action="toggle" data-id="${entry.id}" data-provider="${provider}" data-enabled="${status.enabled !== true}" title="${esc(status.reason || names[provider])}" role="switch" aria-checked="${status.enabled === true}" aria-label="${esc(group.name)} ${names[provider]} 开关" ${status.canToggle === false || status.enabled === null ? 'disabled' : ''}></button><div class="cell-text"><span class="overview-status ${tone}">${label}</span><small title="${esc(entry.path)}">${source}${entry.count > 1 ? ` · ${entry.count} 份` : ''}</small></div></div>`;
}
function overviewList() {
  pruneSelection();
  const groups = filteredOverview();
  $('#overview-rows').innerHTML = groups.map(group => `<div class="overview-row ${state.overviewSelected.has(group.name) ? 'is-selected' : ''}" ${selectionRowAttributes(group.name, state.overviewSelected.has(group.name))} data-overview-skill="${esc(group.name)}"><div class="overview-name"><input type="checkbox" data-row-select="${esc(group.name)}" aria-label="选择 ${esc(group.name)}" ${state.overviewSelected.has(group.name) ? 'checked' : ''}><div class="overview-summary"><div class="overview-title"><button data-action="overview-detail" data-id="${group.copies[0].id}" title="${esc(group.name)} · 在技能库中查看">${esc(group.name)}</button>${group.builtin ? '<span class="tag claude" title="claude.ai 同步的 Anthropic 官方技能">Claude 自带</span>' : ''}</div><p title="${esc(group.description)}">${esc(group.description)}</p></div></div>${Object.keys(names).map(provider => overviewCell(group, provider)).join('')}</div>`).join('') || empty('没有匹配的技能', state.search ? '换个关键词试试。' : '当前筛选下没有技能。', 'search');
  $('#overview-count').textContent = groups.length;
  const all = $('#overview-select-all');
  all.checked = groups.length > 0 && groups.every(group => state.overviewSelected.has(group.name));
  all.indeterminate = state.overviewSelected.size > 0 && !all.checked;
  $('#overview-selection-bar').innerHTML = batchSelectionBar();
}
function overviewPage() {
  const groups = state.snapshot.catalog;
  $('#content').innerHTML = heading('四端总览', '同一技能只显示一行，分别控制四个工具的开关。已有的官方版本和启用设置各自保留。', `<button class="btn primary" data-action="sync-all">${icon('sync')} 同步全部至四端</button>`, true)
    + errorBanner() + ruleBanner()
    + `<section class="overview-panel"><div class="overview-toolbar"><label class="search">${icon('search')}<input id="search" type="search" placeholder="搜索技能名称、描述…" value="${esc(state.search)}" aria-label="搜索技能"><kbd>Ctrl K</kbd></label><div class="segmented" role="group" aria-label="按状态筛选">${overviewFilters.map(([key, label, hint]) => `<button data-action="overview-filter" data-filter="${key}" class="${state.overviewFilter === key ? 'active' : ''}" aria-pressed="${state.overviewFilter === key}" title="${hint}">${label}<span>${groups.filter(group => overviewMatches(group, key)).length}</span></button>`).join('')}</div><span class="selection-guide">勾选 / Ctrl 点选 · Shift 连选 · 右键批量开关</span></div><div class="overview-head"><label><input type="checkbox" id="overview-select-all" data-selection-all aria-label="全选当前总览">技能<span class="head-count" id="overview-count"></span></label>${Object.keys(names).map(provider => `<span>${logo(provider)}<span title="${names[provider]}">${provider === 'dsh' ? 'Harness' : names[provider]}</span></span>`).join('')}</div><div id="overview-rows" role="grid" aria-label="四端技能列表" aria-multiselectable="true"></div><div id="overview-selection-bar"></div></section>`;
  overviewList();
}
async function previewAllSync() {
  const plan = await api('previewSyncAll'); state.plan = plan;
  modal('同步全部至四端', `<p>共 ${plan.skillCount} 种技能，需要新增 ${plan.rows.length} 个目录${plan.relocations.length ? `，迁移 ${plan.relocations.length} 个已有来源` : ''}${plan.excludedSkills ? `；按同步规则跳过 ${plan.excludedSkills} 个 Claude Code 自带技能` : ''}。${esc(plan.note)}</p><div class="modal-options">${plan.rows.length ? plan.rows.map(row => `<div class="plan-row"><div class="plan-top"><div>${esc(row.name)}<small>→ ${esc(row.target)} · ${row.files} 个文件 · ${fmtBytes(row.bytes)}</small>${row.normalizedContent ? '<small>已适配目标技能名称或调用状态，正文与资源保持原样。</small>' : ''}</div><span class="state-label new">新增</span></div></div>`).join('') : '<div class="note neutral">四端已有全部技能来源，无需重复复制。</div>'}</div><div class="note neutral">仅补齐缺项；同步后分别使用四端开关管理。专用工具与依赖需要在目标环境中具备。</div>`, `<button class="btn primary" data-action="apply-sync">${icon('check')} ${plan.rows.length ? '执行同步' : '完成检查'}</button>`);
}
