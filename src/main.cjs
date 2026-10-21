const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, safeStorage } = require('electron');
const path = require('node:path');
const { SkillManager } = require('./manager.cjs');
const { AIWorkbench } = require('./ai-workbench.cjs');
let win, manager, workbench, builtApp;
let queue = Promise.resolve();

const { resolveRuntime, prepareRuntime } = require('./portable.cjs');
let runtime;
try {
  runtime = prepareRuntime(resolveRuntime({ packaged: app.isPackaged, appDir: app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..') }));
  app.setPath('userData', path.join(runtime.dataDir, 'electron'));
} catch (error) { dialog.showErrorBox('SkillDock 数据目录不可用', error.message); app.exit(1); }
app.setName('SkillDock');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(() => {
    manager = new SkillManager({ home: runtime.home, dataDir: runtime.dataDir, runtime, env: process.env.SKILLDOCK_HOME ? {} : process.env });
    const sourceRoot = app.isPackaged ? path.resolve(runtime.appDir, '../..') : path.join(__dirname, '..');
    workbench = new AIWorkbench({ manager, safeStorage, projectRoot: require('node:fs').existsSync(path.join(sourceRoot, 'src/main.cjs')) ? sourceRoot : '' });
    win = new BrowserWindow({
      width: 1440, height: 930, minWidth: 1080, minHeight: 720,
      title: 'SkillDock · 技能管理器', backgroundColor: nativeTheme.shouldUseDarkColors ? '#111214' : '#f4f5f7',
      icon: path.join(__dirname, '..', 'assets', 'icon.png'), autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    const actions = {
      aiSettings: () => workbench.settings(), aiSaveSettings: input => workbench.saveSettings(input),
      aiContext: input => workbench.context(input), aiStart: input => workbench.start(input),
      aiStatus: id => workbench.status(id), aiCancel: id => workbench.cancel(id),
      aiApply: token => workbench.apply(token), aiUndo: id => workbench.undo(id), aiProbe: id => workbench.probe(id),
      aiBuild: async () => { builtApp = await workbench.build(); return builtApp; },
      aiOpenBuild: async () => { if (!builtApp) throw new Error('请先构建新版。'); const result = await shell.openPath(builtApp.directory); if (result) throw new Error(result); return true; },
      aiLaunchBuild: () => {
        if (!builtApp) throw new Error('请先构建新版。');
        const { spawn } = require('node:child_process'), env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
        const child = spawn(builtApp.executable, [], { cwd: builtApp.directory, env, windowsHide: true, detached: true, stdio: 'ignore' });
        child.on('error', error => dialog.showErrorBox('新版启动失败', error.message)); child.unref();
        setTimeout(() => app.quit(), 350); return true;
      },
      snapshot: () => manager.snapshot(), detail: id => manager.detail(id),
      setEnabled: input => manager.setEnabled(input), setEnabledBatch: input => manager.setEnabledBatch(input), favorite: input => manager.favorite(input),
      previewDelete: ids => manager.previewDelete(ids), deleteSkills: token => manager.deleteSkills(token),
      previewSyncAll: () => manager.previewSyncAll(), previewSync: input => manager.previewSync(input), applySync: input => manager.applySync(input),
      recycleBin: () => manager.recycleBin(), restore: id => manager.restore(id),
      history: () => manager.history(), setLocations: locations => manager.setLocations(locations), resetLocations: () => manager.setLocations(null),
      setRules: rules => manager.setRules(rules), previewBuiltinCleanup: () => manager.previewBuiltinCleanup(), applyBuiltinCleanup: token => manager.applyBuiltinCleanup(token),
      openSkill: async id => { const result = await shell.openPath(manager.getSkill(id).path); if (result) throw new Error(result); return true; },
      openData: async () => { const result = await shell.openPath(manager.dataDir); if (result) throw new Error(result); return true; },
      chooseLocation: async () => { const result = await dialog.showOpenDialog(win, { title: '选择配置目录', properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : result.filePaths[0]; },
      importFolder: async () => { const result = await dialog.showOpenDialog(win, { title: '选择包含 SKILL.md 的文件夹', properties: ['openDirectory'] }); return result.canceled ? null : manager.importFolder(result.filePaths[0]); },
      importZip: async () => { const result = await dialog.showOpenDialog(win, { title: '导入技能 ZIP', properties: ['openFile'], filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }] }); return result.canceled ? null : manager.importZip(result.filePaths[0]); },
      exportZip: async ids => {
        const result = await dialog.showSaveDialog(win, { title: '导出技能', defaultPath: `skills-${new Date().toISOString().slice(0, 10)}.zip`, filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }] });
        return result.canceled ? null : manager.exportZip(ids, result.filePath);
      }
    };
    ipcMain.handle('skilldock', (event, method, input) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return { ok: false, error: '请求来源无效。' };
      if (!Object.hasOwn(actions, method)) return { ok: false, error: '未知操作。' };
      if (['aiStatus', 'aiCancel', 'aiProbe', 'aiBuild'].includes(method)) return Promise.resolve().then(() => actions[method](input)).then(data => ({ ok: true, data }), error => ({ ok: false, error: error.message }));
      const request = queue.then(async () => {
        try { return { ok: true, data: await actions[method](input) }; }
        catch (error) { return { ok: false, error: error.message || String(error) }; }
      });
      queue = request.then(() => undefined, () => undefined);
      return request;
    });
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  }).catch(error => { dialog.showErrorBox('SkillDock 无法启动', error.stack || error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { if (workbench?.job?.status === 'running') workbench.cancel(workbench.job.id); });
}
