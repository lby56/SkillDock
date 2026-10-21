const aiState = { settings: null, context: null, profileId: 'codex-local', prompt: '', selected: new Set(), job: null, result: null, building: false, built: null, loading: false, editing: false, draft: null, applying: false };
const aiPresets = {
  codex: { name: '本机 Codex', type: 'codex', baseUrl: '', model: '' },
  openai: { name: 'OpenAI', type: 'responses', baseUrl: 'https://api.openai.com/v1', model: '' },
  deepseek: { name: 'DeepSeek', type: 'chat', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  qwen: { name: '通义千问 Qwen', type: 'chat', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: '' },
  anthropic: { name: 'Claude / Anthropic', type: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: '' },
  gemini: { name: 'Google Gemini', type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: '' },
  ollama: { name: '本机 Ollama', type: 'chat', baseUrl: 'http://localhost:11434/v1', model: '' },
  custom: { name: '自定义兼容 API', type: 'chat', baseUrl: '', model: '' }
};
const aiProtocols = { codex: 'Codex CLI（使用本机登录）', responses: 'OpenAI Responses', chat: 'OpenAI Chat Completions（兼容 API）', anthropic: 'Anthropic Messages', gemini: 'Gemini GenerateContent' };
function aiConnectionForm() {
  const p = aiState.draft || {}, codex = p.type === 'codex';
  return `<div class="ai-connection-form"><div class="ai-fields"><label>快速选择服务商<select id="ai-preset"><option value="">选择一个预设…</option>${Object.entries(aiPresets).map(([key, v]) => `<option value="${key}">${esc(v.name)}</option>`).join('')}</select></label><label>连接名称<input id="ai-name" value="${esc(p.name)}" placeholder="例如：我的 DeepSeek"></label><label>接口协议<select id="ai-protocol">${Object.entries(aiProtocols).map(([key, v]) => `<option value="${key}" ${p.type === key ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label><label>模型 ID<input id="ai-model" value="${esc(p.model)}" placeholder="${codex ? '留空，沿用 Codex 已配置的模型' : '填写服务商提供的模型 ID'}"></label><label class="ai-span">${codex ? 'Codex 程序路径' : 'API 地址（Base URL）'}<input id="ai-url" value="${esc(codex ? p.executable : p.baseUrl)}" placeholder="${codex ? esc(aiState.settings.codexPath || '自动检测，或填写 codex.exe 完整路径') : 'https://…/v1'}" spellcheck="false"></label>${codex ? '' : `<label class="ai-span">API Key<input id="ai-key" type="password" autocomplete="off" value="${esc(p.apiKey || '')}" placeholder="${p.hasKey ? '已加密保存；留空保留原 Key' : '填入 API Key，本机服务可留空'}"><small>使用 Windows 加密存储；配置页不会读取已保存的 Key。</small></label>`}</div><div class="ai-buttons"><button class="btn primary" data-action="ai-save-profile">保存连接</button>${p.id ? '<button class="btn danger" data-action="ai-remove-profile">删除连接</button>' : ''}<button class="btn" data-action="ai-close-form">收起</button></div></div>`;
}
function aiDraw() {
  if (state.route !== 'ai' || !aiState.settings) return;
  const s = aiState.settings, c = aiState.context, running = aiState.job?.status === 'running';
  $('#content').innerHTML = heading('AI 修改', '用一句话描述需求，让 AI 帮你修改 SkillDock 的界面和功能。', `<button class="btn" data-action="ai-build" ${aiState.building || running ? 'disabled' : ''}>${icon('box')}${aiState.building ? '正在构建…' : '构建新版'}</button>`)
    + `<div class="ai-layout"><div class="ai-main"><div class="panel ai-panel"><div class="panel-heading"><div><h2>选择 AI 连接</h2><p>Codex 使用本机登录；API 支持保存多套服务商配置。</p></div>${icon('code')}</div><div class="ai-connection-bar"><select id="ai-profile" aria-label="AI 连接" ${running ? 'disabled' : ''}>${s.profiles.map(p => `<option value="${p.id}" ${p.id === aiState.profileId ? 'selected' : ''}>${esc(p.name)} · ${esc(p.model || '本机配置')}</option>`).join('')}</select><button class="btn" data-action="ai-edit-profile" ${running ? 'disabled' : ''}>配置</button><button class="btn" data-action="ai-new-profile" ${running ? 'disabled' : ''}>${icon('plus')}添加</button><button class="btn" data-action="ai-probe" ${running ? 'disabled' : ''}>测试连接</button></div>${aiState.editing ? aiConnectionForm() : ''}</div>
    <div class="panel ai-panel"><div class="panel-heading"><div><h2>这次想改什么？</h2><p>例如：给全部技能页增加按更新时间排序，保留现有筛选和开关。</p></div></div><textarea id="ai-prompt" rows="5" maxlength="12000" placeholder="描述你想增加的功能、要调整的界面或要修复的问题…" ${running ? 'disabled' : ''}>${esc(aiState.prompt)}</textarea><div class="ai-prompt-bottom"><span>生成会将勾选的源码发送到所选 AI 服务。</span><button class="btn primary" data-action="ai-generate" ${running || !c || aiState.applying ? 'disabled' : ''}>${icon('code')}${running ? '正在生成…' : '生成修改方案'}</button></div><div id="ai-job">${aiJobMarkup()}</div></div>
    <div id="ai-result">${aiResultMarkup()}</div>${aiState.built ? `<div class="panel ai-panel"><h2>新版已准备好</h2><p class="config-path ai-root">${esc(aiState.built.directory)}</p><div class="ai-buttons"><button class="btn primary" data-action="ai-launch-build">打开新版并关闭当前窗口</button><button class="btn" data-action="ai-open-build">打开新版目录</button></div></div>` : ''}</div>
    <div class="ai-side"><div class="panel ai-panel"><div class="panel-heading"><div><h2>修改目标</h2><p>SkillDock 应用源码</p></div>${icon('folder')}</div><label class="ai-label" for="ai-root">源码目录</label><div class="ai-root-field"><input id="ai-root" value="${esc(s.projectRoot)}" spellcheck="false" ${running ? 'disabled' : ''}><button class="btn" data-action="ai-browse-root" ${running ? 'disabled' : ''}>浏览</button></div><div class="ai-buttons"><button class="btn" data-action="ai-save-root" ${running ? 'disabled' : ''}>保存并读取</button></div>${c ? `<div class="ai-file-heading"><strong>发送给 AI 的文件</strong><span id="ai-bytes">${aiBytes()}</span></div><div class="ai-file-buttons"><button class="subtle" data-action="ai-files-all">全选</button><button class="subtle" data-action="ai-files-none">清空</button></div><div class="ai-file-list">${c.files.map(f => `<label><input type="checkbox" data-ai-file="${esc(f.path)}" ${aiState.selected.has(f.path) ? 'checked' : ''} ${running ? 'disabled' : ''}><span title="${esc(f.path)}">${esc(f.path)}</span><small>${fmtBytes(f.bytes)}</small></label>`).join('')}</div><p class="ai-help">仅修改勾选的已有文件；可新增源码文件。每次最多发送 240 KB。</p>` : '<p class="ai-help">选择完整源码目录，再读取可编辑文件。</p>'}</div><div class="panel ai-panel"><div class="panel-heading"><div><h2>修改备份</h2><p>应用前自动保存原文件，可恢复。</p></div>${icon('restore')}</div>${s.history.length ? `<div class="ai-history">${s.history.slice(0, 8).map(h => `<div><strong>${esc(h.summary || h.label)}</strong><small>${fmtDate(h.at)} · ${h.count} 个文件 · ${h.status === 'restored' ? '已恢复' : h.status === 'applied' ? '已应用' : '未应用'}</small>${h.status === 'applied' ? `<button class="btn" data-action="ai-undo" data-id="${h.id}">恢复原文件</button>` : ''}</div>`).join('')}</div>` : '<p class="ai-help">还没有应用修改。</p>'}<p class="ai-help">源码改完后点击“构建新版”，在新窗口查看效果。</p></div></div></div>`;
}
function aiBytes() { const bytes = aiState.context?.files.filter(f => aiState.selected.has(f.path)).reduce((sum, f) => sum + f.bytes, 0) || 0; return `${fmtBytes(bytes)} / 240 KB`; }
function aiJobMarkup() {
  const j = aiState.job; if (!j) return '';
  const label = { running: 'AI 正在处理', done: '方案已生成', error: '生成失败', cancelled: '已取消' }[j.status] || '';
  return `<div class="ai-job ${j.status === 'error' ? 'ai-error' : ''}"><div><strong>${esc(label)}</strong>${j.status === 'running' ? '<button class="btn" data-action="ai-cancel">停止生成</button>' : ''}</div><p>${esc(j.error || j.logs?.slice(-1)[0] || '等待响应…')}</p></div>`;
}
function aiResultMarkup() {
  const r = aiState.result; if (!r) return '';
  return `<div class="panel ai-panel"><div class="panel-heading"><div><h2>${r.applied ? '修改已应用' : '预览修改方案'}</h2><p>${esc(r.summary)}</p></div><span class="state-label">${r.changes.length} 个文件</span></div><div class="ai-diffs">${r.changes.map((c, i) => `<details ${i === 0 ? 'open' : ''}><summary>${esc(c.path)} <span>${c.before === null ? '新增文件' : '修改文件'}</span></summary><div class="ai-diff-grid"><div><h3>修改前</h3><pre>${esc(c.before ?? '（新文件）')}</pre></div><div><h3>修改后</h3><pre>${esc(c.content)}</pre></div></div></details>`).join('')}</div><div class="ai-buttons"><button class="btn primary" data-action="ai-apply" ${r.applied || aiState.applying || aiState.job?.status === 'running' ? 'disabled' : ''}>${icon('check')}${r.applied ? '已应用并备份' : aiState.applying ? '正在应用…' : '应用修改'}</button><span class="ai-help">应用后自动保存备份；文件有新变化时会取消写入。</span></div></div>`;
}
async function aiLoadContext() {
  aiState.context = await api('aiContext', { kind: 'app' });
  aiState.selected = new Set(aiState.context.files.filter(f => f.path.startsWith('src/') && !f.path.includes('selection.') && !f.path.includes('overview.')).map(f => f.path));
  // Keep the first request below the context limit even in a larger project.
  let bytes = 0; for (const f of aiState.context.files) if (aiState.selected.has(f.path)) { bytes += f.bytes; if (bytes > 240 * 1024) aiState.selected.delete(f.path); }
}
async function aiPage() {
  if (aiState.settings) { aiDraw(); return; }
  if (aiState.loading) return; aiState.loading = true;
  $('#content').innerHTML = heading('AI 修改', '正在读取本机连接设置…');
  try { aiState.settings = await api('aiSettings'); aiState.profileId = aiState.settings.profiles[0]?.id || ''; if (aiState.settings.projectRoot) await aiLoadContext(); aiDraw(); }
  catch (error) { toast(error.message, true); if (aiState.settings) aiDraw(); }
  finally { aiState.loading = false; }
}
function aiReadDraft() {
  if (!$('#ai-name')) return;
  const type = $('#ai-protocol').value;
  aiState.draft = { ...aiState.draft, name: $('#ai-name').value, type, model: $('#ai-model').value, baseUrl: type === 'codex' ? '' : $('#ai-url').value, executable: type === 'codex' ? $('#ai-url').value : '', apiKey: $('#ai-key')?.value || '' };
}
async function aiPoll(id) {
  try {
    const job = await api('aiStatus', id); if (aiState.job?.id !== id) return;
    aiState.job = job;
    if (state.route === 'ai' && $('#ai-job')) $('#ai-job').innerHTML = aiJobMarkup();
    if (job.status === 'running') setTimeout(() => aiPoll(id), 700);
    else { if (job.result) aiState.result = job.result; aiDraw(); if (job.error) toast(job.error, true); }
  } catch (error) { aiState.job = { id, status: 'error', error: error.message }; aiDraw(); }
}
document.addEventListener('input', event => {
  if (event.target.id === 'ai-prompt') aiState.prompt = event.target.value;
  if (['ai-name', 'ai-model', 'ai-url', 'ai-key'].includes(event.target.id)) aiReadDraft();
});
document.addEventListener('change', event => {
  const e = event.target;
  if (e.id === 'ai-profile') { aiState.profileId = e.value; aiState.editing = false; aiDraw(); }
  if (e.id === 'ai-preset' && e.value) { aiState.draft = { ...aiPresets[e.value] }; aiDraw(); }
  if (e.id === 'ai-protocol') { aiReadDraft(); aiDraw(); }
  if (e.dataset.aiFile) { e.checked ? aiState.selected.add(e.dataset.aiFile) : aiState.selected.delete(e.dataset.aiFile); $('#ai-bytes').textContent = aiBytes(); }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action^="ai-"]'); if (!button || button.disabled) return;
  const action = button.dataset.action; button.disabled = true;
  try {
    if (action === 'ai-edit-profile' || action === 'ai-new-profile') { aiState.draft = action === 'ai-new-profile' ? { ...aiPresets.custom } : { ...aiState.settings.profiles.find(p => p.id === aiState.profileId) }; aiState.editing = true; aiDraw(); }
    else if (action === 'ai-close-form') { aiState.editing = false; aiState.draft = null; aiDraw(); }
    else if (action === 'ai-save-profile') {
      aiReadDraft(); const previousIds = new Set(aiState.settings.profiles.map(p => p.id));
      aiState.settings = await api('aiSaveSettings', { profile: aiState.draft });
      aiState.profileId = aiState.draft.id || aiState.settings.profiles.find(p => !previousIds.has(p.id))?.id || aiState.profileId;
      aiState.draft = null; aiState.editing = false; if (aiState.settings.projectRoot) await aiLoadContext(); toast('AI 连接已保存。'); aiDraw();
    } else if (action === 'ai-remove-profile') { aiState.settings = await api('aiSaveSettings', { deleteProfile: aiState.draft.id }); aiState.profileId = aiState.settings.profiles[0]?.id || ''; aiState.editing = false; aiState.draft = null; if (aiState.settings.projectRoot) await aiLoadContext(); aiDraw(); }
    else if (action === 'ai-probe') { button.textContent = '测试中…'; const r = await api('aiProbe', aiState.profileId); toast(r.message); }
    else if (action === 'ai-browse-root') { const root = await api('chooseLocation'); if (root) $('#ai-root').value = root; }
    else if (action === 'ai-save-root') { aiState.settings = await api('aiSaveSettings', { projectRoot: $('#ai-root').value }); await aiLoadContext(); aiState.result = null; aiDraw(); toast('已读取应用源码。'); }
    else if (action === 'ai-files-all' || action === 'ai-files-none') { aiState.selected = new Set(action === 'ai-files-all' ? aiState.context.files.map(f => f.path) : []); aiDraw(); }
    else if (action === 'ai-generate') {
      const r = await api('aiStart', { token: aiState.context.token, profileId: aiState.profileId, prompt: aiState.prompt, files: [...aiState.selected] });
      aiState.job = { id: r.id, status: 'running', logs: ['正在连接 AI…'] }; aiState.result = null; aiDraw(); aiPoll(r.id);
    } else if (action === 'ai-cancel') { await api('aiCancel', aiState.job.id); }
    else if (action === 'ai-apply') { aiState.applying = true; const r = await api('aiApply', aiState.result.token); aiState.result.applied = true; aiState.settings.history = r.history; state.snapshot = await api('snapshot'); await aiLoadContext(); toast(r.message); }
    else if (action === 'ai-undo') { const r = await api('aiUndo', button.dataset.id); aiState.settings.history = r.history; aiState.result = null; await aiLoadContext(); toast(r.message); aiDraw(); }
    else if (action === 'ai-build') { aiState.building = true; aiDraw(); aiState.built = await api('aiBuild'); toast(aiState.built.message); }
    else if (action === 'ai-open-build') await api('aiOpenBuild');
    else if (action === 'ai-launch-build') await api('aiLaunchBuild');
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; if (action === 'ai-probe') button.textContent = '测试连接'; if (action === 'ai-apply' || action === 'ai-build') { aiState.applying = false; aiState.building = false; aiDraw(); } }
});
