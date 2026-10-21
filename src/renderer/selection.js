const selectionAnchors = new Map();
let activeSkillMenu = null;
function overviewMatches(group, filter = state.overviewFilter) {
  if (filter === 'complete') return group.complete;
  if (filter === 'missing') return !group.complete;
  if (filter === 'disabled') return Object.values(group.tools).some(entry => entry?.state.enabled === false);
  return true;
}
function filteredOverview() {
  return state.snapshot.catalog.filter(group => overviewMatches(group) && `${group.name} ${group.description}`.toLowerCase().includes(state.search.toLowerCase()));
}
function syncSources() {
  return state.imports ? state.imports.skills : state.snapshot.skills.filter(skill => skill.rootId === state.syncSource);
}
function selectionContext() {
  if (!state.snapshot) return null;
  if (state.route === 'overview') return { name: 'overview', selected: state.overviewSelected, items: filteredOverview().map(group => ({ key: group.name, label: group.name, group })) };
  if (['library', 'favorites'].includes(state.route)) return { name: `${state.route}:${state.provider}`, selected: state.selected, provider: state.provider === 'all' ? null : state.provider, items: filteredSkills().map(skill => ({ key: skill.id, label: skill.name, skill })) };
  if (state.route === 'sync') return { name: `sync:${state.syncSource}`, selected: state.syncSelected, items: syncSources().map(skill => ({ key: skill.id, label: skill.name, skill })) };
  return null;
}
function pruneSelection(context = selectionContext()) {
  if (!context) return;
  const visible = new Set(context.items.map(item => item.key));
  for (const key of context.selected) if (!visible.has(key)) context.selected.delete(key);
  if (!visible.has(selectionAnchors.get(context.name))) selectionAnchors.delete(context.name);
}
function selectionRowAttributes(key, selected) {
  return `role="row" data-selection-key="${esc(key)}" aria-selected="${selected}" tabindex="0"`;
}
function paintSelection() {
  if (state.route === 'overview') overviewList();
  else if (state.route === 'sync') { const top = $('.sync-source-list')?.scrollTop || 0; syncPage(); if ($('.sync-source-list')) $('.sync-source-list').scrollTop = top; }
  else { listOnly(); renderDetail(); }
}
function selectSkillRow(key, { toggle = false, shift = false, additive = false } = {}) {
  const context = selectionContext(); if (!context) return;
  pruneSelection(context);
  const keys = context.items.map(item => item.key), index = keys.indexOf(key);
  if (index < 0) return;
  const anchor = selectionAnchors.get(context.name), anchorIndex = keys.indexOf(anchor);
  if (shift && anchorIndex >= 0) {
    if (!additive) context.selected.clear();
    for (const entry of keys.slice(Math.min(index, anchorIndex), Math.max(index, anchorIndex) + 1)) context.selected.add(entry);
  } else {
    if (!toggle && !additive) context.selected.clear();
    if (toggle && context.selected.has(key)) context.selected.delete(key); else context.selected.add(key);
    selectionAnchors.set(context.name, key);
  }
  if (context.name !== 'overview' && state.route !== 'sync') state.detailId = key;
  paintSelection();
  document.querySelector(`[data-selection-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}
function selectVisibleSkills(clear = false) {
  const context = selectionContext(); if (!context) return;
  context.selected.clear();
  if (!clear) for (const item of context.items) context.selected.add(item.key);
  selectionAnchors.set(context.name, clear ? null : context.items[0]?.key);
  paintSelection();
}
function batchSelection(scope, enabled) {
  const context = selectionContext(), ids = new Map();
  if (!context) return { requests: [], skipped: 0, available: 0 };
  const providers = context.provider ? [context.provider] : scope === 'all' ? Object.keys(names) : [scope];
  let skipped = 0, available = 0;
  for (const item of context.items.filter(item => context.selected.has(item.key))) {
    for (const provider of providers) {
      const entry = item.group ? item.group.tools[provider] : item.skill?.providers?.includes(provider) ? { id: item.skill.id, state: item.skill.states?.[provider] } : null;
      if (!entry || !entry.state?.canToggle || typeof entry.state.enabled !== 'boolean') {
        if (item.group || entry) skipped++;
        continue;
      }
      available++;
      if (entry.state.enabled === enabled) continue;
      if (!ids.has(provider)) ids.set(provider, new Set());
      ids.get(provider).add(entry.id);
    }
  }
  return { requests: [...ids].map(([provider, values]) => ({ provider, enabled, ids: [...values] })), skipped, available };
}
function batchSelectionBar(extra = '') {
  const context = selectionContext(); if (!context?.selected.size) return '';
  const scope = context.provider || state.batchScope || 'all';
  const enabled = batchSelection(scope, true), disabled = batchSelection(scope, false);
  return `<div class="selection-bar quick-selection"><strong>已选 ${context.selected.size} 项</strong>${context.provider ? `<span class="batch-provider">${logo(context.provider)}仅 ${names[context.provider]}</span>` : `<select id="batch-scope" aria-label="批量调整工具">${[['all', context.name === 'overview' ? '四端同时' : '全部适用工具'], ...Object.entries(names)].map(([key, label]) => `<option value="${key}" ${scope === key ? 'selected' : ''}>${label}</option>`).join('')}</select>`}<button class="btn" data-bulk-enabled="true" data-bulk-scope="${scope}" ${enabled.requests.length ? '' : 'disabled'}>启用</button><button class="btn" data-bulk-enabled="false" data-bulk-scope="${scope}" ${disabled.requests.length ? '' : 'disabled'}>禁用</button>${extra ? `<span class="bar-divider"></span>${extra}` : ''}<button class="subtle" data-selection-command="clear">取消选择</button></div>`;
}
function refreshSelectionToolbar() {
  if (state.route === 'overview') overviewList();
  else if (state.route === 'sync') syncPage();
  else listOnly();
}
function renderKeepingScroll() {
  const positions = ['content', 'overview-rows', 'skill-list', 'detail-panel'].map(id => [id, document.getElementById(id)?.scrollTop || 0]);
  const syncTop = $('.sync-source-list')?.scrollTop || 0;
  render();
  for (const [id, top] of positions) { const element = document.getElementById(id); if (element) element.scrollTop = top; }
  if ($('.sync-source-list')) $('.sync-source-list').scrollTop = syncTop;
}
async function applyQuickToggle(scope, enabled) {
  const { requests, skipped } = batchSelection(scope, enabled);
  closeSkillMenu();
  if (!requests.length) { toast('所选技能无需修改，或没有可切换的开关。'); return; }
  await run(async () => {
    try {
      const result = await api('setEnabledBatch', { requests });
      accept(result); renderKeepingScroll();
      if (skipped) toast(`${result.message} 跳过 ${skipped} 个未安装或不可切换的开关。`);
    } catch (error) {
      try { state.snapshot = await api('snapshot'); renderKeepingScroll(); } catch {}
      throw error;
    }
  });
}
function closeSkillMenu(restoreFocus = false) {
  const previous = activeSkillMenu; activeSkillMenu = null;
  const menu = $('#skill-context-menu'); if (menu) menu.hidden = true;
  if (restoreFocus && previous?.key) document.querySelector(`[data-selection-key="${CSS.escape(previous.key)}"]`)?.focus({ preventScroll: true });
}
function openSkillMenu(event, row = event.target.closest('[data-selection-key]')) {
  const context = selectionContext();
  if (!context || state.busy || $('#modal').open) return;
  event.preventDefault();
  const key = row?.dataset.selectionKey;
  if (key && !context.selected.has(key)) selectSkillRow(key, { additive: event.ctrlKey || event.metaKey });
  pruneSelection();
  const current = selectionContext(), selected = current.items.filter(item => current.selected.has(item.key));
  const scopes = current.provider ? [current.provider] : ['all', ...Object.keys(names)];
  const actionRow = scope => {
    const label = scope === 'all' ? (state.route === 'overview' ? '四端同时' : '全部适用工具') : names[scope];
    const buttons = [true, false].map(enabled => {
      const result = batchSelection(scope, enabled), count = result.requests.reduce((sum, request) => sum + request.ids.length, 0);
      return `<button role="menuitem" data-bulk-scope="${scope}" data-bulk-enabled="${enabled}" aria-label="${label}${enabled ? '启用' : '禁用'}所选" title="修改 ${count} 个开关" ${count ? '' : 'disabled'}>${enabled ? '启用' : '禁用'}</button>`;
    }).join('');
    return `<div class="context-tool-row ${scope === 'all' ? 'context-all-tools' : ''}"><span>${scope === 'all' ? icon('layers') : logo(scope)}${label}</span><div>${buttons}</div></div>`;
  };
  const menu = $('#skill-context-menu');
  menu.innerHTML = `<div class="context-heading">${icon('power')}<strong>${selected.length ? `调整选中的 ${selected.length} 项` : '技能快捷操作'}</strong></div><div class="context-tools">${scopes.map(actionRow).join('')}</div><div class="context-divider"></div><button role="menuitem" class="context-command" data-selection-command="all">全选当前结果 <kbd>Ctrl A</kbd></button><button role="menuitem" class="context-command" data-selection-command="clear" ${selected.length ? '' : 'disabled'}>取消选择 <kbd>Esc</kbd></button>${selected.length === 1 && (selected[0].group || state.snapshot.skills.some(skill => skill.id === selected[0].skill.id)) ? `<div class="context-divider"></div><button role="menuitem" class="context-command" data-context-detail="${esc(selected[0].group ? selected[0].group.copies[0].id : selected[0].skill.id)}">${icon('file')} 查看技能内容</button>` : ''}<div class="context-hint">勾选 / Ctrl 点选 · Shift 连选</div>`;
  menu.hidden = false;
  const liveRow = key ? document.querySelector(`[data-selection-key="${CSS.escape(key)}"]`) : row;
  const rect = liveRow?.getBoundingClientRect();
  const x = event.clientX || (rect ? rect.left + 32 : 220), y = event.clientY || (rect ? rect.top + 24 : 100);
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
  const scrollPositions = new Map();
  for (let ancestor = liveRow; ancestor; ancestor = ancestor.parentElement) scrollPositions.set(ancestor, [ancestor.scrollTop, ancestor.scrollLeft]);
  const documentScroll = document.scrollingElement;
  scrollPositions.set(documentScroll, [documentScroll.scrollTop, documentScroll.scrollLeft]);
  activeSkillMenu = { key, scrollPositions };
  menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}
function handleSelectionClick(event) {
  const command = event.target.closest('[data-selection-command]');
  if (command) {
    event.preventDefault(); if (state.busy) return true;
    const clear = command.dataset.selectionCommand === 'clear'; closeSkillMenu(); selectVisibleSkills(clear); return true;
  }
  const bulk = event.target.closest('[data-bulk-enabled]');
  if (bulk) { event.preventDefault(); if (!bulk.disabled && !state.busy) applyQuickToggle(bulk.dataset.bulkScope, bulk.dataset.bulkEnabled === 'true'); return true; }
  const detail = event.target.closest('[data-context-detail]');
  if (detail) { event.preventDefault(); closeSkillMenu(); run(() => contentDialog(detail.dataset.contextDetail)); return true; }
  const all = event.target.closest('[data-selection-all]');
  if (all) {
    event.preventDefault(); if (state.busy) return true;
    const context = selectionContext(); selectVisibleSkills(context.items.length > 0 && context.items.every(item => context.selected.has(item.key))); return true;
  }
  const row = event.target.closest('[data-selection-key]');
  if (!row) return false;
  const checkbox = event.target.matches('input[data-row-select]');
  const modified = event.ctrlKey || event.metaKey || event.shiftKey;
  if (!checkbox && event.target.closest('button,a,input,select,textarea') && !modified) return false;
  if (!checkbox && event.target.closest('button[role="switch"]')) return false;
  event.preventDefault(); if (state.busy) return true;
  selectSkillRow(row.dataset.selectionKey, { toggle: checkbox || event.ctrlKey || event.metaKey, shift: event.shiftKey, additive: event.ctrlKey || event.metaKey });
  document.querySelector(`[data-selection-key="${CSS.escape(row.dataset.selectionKey)}"]`)?.focus({ preventScroll: true });
  return true;
}
function installSelectionHandlers() {
  document.addEventListener('contextmenu', event => {
    if (event.target.closest('[data-selection-key],#overview-rows,#skill-list,.sync-source-list')) openSkillMenu(event);
  });
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#skill-context-menu')) closeSkillMenu(); });
  document.addEventListener('scroll', event => {
    if (!activeSkillMenu || $('#skill-context-menu')?.contains(event.target)) return;
    const target = event.target === document ? document.scrollingElement : event.target;
    const previous = activeSkillMenu.scrollPositions.get(target);
    if (!previous || previous[0] !== target.scrollTop || previous[1] !== target.scrollLeft) closeSkillMenu();
  }, true);
  window.addEventListener('resize', () => closeSkillMenu()); window.addEventListener('blur', () => closeSkillMenu());
  document.addEventListener('change', event => { if (event.target.id === 'batch-scope') { state.batchScope = event.target.value; refreshSelectionToolbar(); } });
  document.addEventListener('keydown', event => {
    if (activeSkillMenu) {
      const buttons = [...$('#skill-context-menu').querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus(); return;
      }
      if (event.key === 'Escape') { event.preventDefault(); closeSkillMenu(true); return; }
      if (event.key === 'Tab') { closeSkillMenu(true); return; }
    }
    if ($('#modal').open || state.busy || event.target.closest('input:not([type="checkbox"]):not([type="radio"]),textarea,select,[contenteditable="true"]')) return;
    const context = selectionContext(); if (!context) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); closeSkillMenu(); selectVisibleSkills(); }
    else if (event.key === 'Escape' && context.selected.size) { event.preventDefault(); selectVisibleSkills(true); }
    else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      const row = event.target.closest('[data-selection-key]') || [...document.querySelectorAll('[data-selection-key]')].find(row => context.selected.has(row.dataset.selectionKey)) || $('[data-selection-key]');
      if (row) openSkillMenu(event, row);
    } else if (event.code === 'Space' && event.target.matches('[data-selection-key]')) {
      event.preventDefault(); selectSkillRow(event.target.dataset.selectionKey, { toggle: true, shift: event.shiftKey });
    }
  });
}
