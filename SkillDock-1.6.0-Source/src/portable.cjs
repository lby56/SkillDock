const os = require('node:os');
const { fs, path, hash, exists, assertNoLinks, atomicWrite } = require('./files.cjs');
function resolveRuntime({ packaged = false, execPath = process.execPath, env = process.env, home = env.SKILLDOCK_HOME || os.homedir(), hostname = os.hostname(), appDir = path.dirname(execPath) } = {}) {
  home = path.resolve(home); appDir = path.resolve(appDir);
  const portable = packaged && exists(path.join(appDir, 'portable.json'));
  const userKey = hash(`${hostname.toLowerCase()}\n${home.toLowerCase()}`).slice(0, 20);
  const dataRoot = portable ? path.join(appDir, 'data') : path.join(home, '.skilldock');
  const dataDir = env.SKILLDOCK_DATA ? path.resolve(appDir, env.SKILLDOCK_DATA) : portable ? path.join(dataRoot, 'users', userKey) : dataRoot;
  return { portable, appDir, home, dataDir, dataRoot, userKey, explicitData: !!env.SKILLDOCK_DATA };
}
function prepareRuntime(runtime) {
  assertNoLinks(runtime.dataDir);
  try {
    fs.mkdirSync(runtime.dataDir, { recursive: true });
    const probe = path.join(runtime.dataDir, '.write-check');
    atomicWrite(probe, ''); fs.unlinkSync(probe);
  } catch (error) {
    throw new Error(`无法写入应用数据目录：${runtime.dataDir}\n请将整个 SkillDock 文件夹解压到当前用户可写的位置，例如文档目录或 U 盘。\n${error.message}`);
  }
  const stamp = path.join(runtime.dataDir, '.initialized.json');
  if (!exists(stamp) && runtime.portable && !runtime.explicitData) {
    const legacy = path.join(runtime.home, '.skilldock');
    // Import only this user's prior app state. Browser caches and diagnostics are not application data.
    for (const name of ['preferences.json', 'history.jsonl', 'trash', 'config-backups']) {
      const source = path.join(legacy, name), destination = path.join(runtime.dataDir, name);
      if (exists(source) && !exists(destination)) {
        assertNoLinks(source);
        const check = value => {
          assertNoLinks(value);
          if (fs.lstatSync(value).isDirectory()) for (const child of fs.readdirSync(value)) check(path.join(value, child));
        };
        check(source);
        fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
      }
    }
    atomicWrite(stamp, JSON.stringify({ version: 1, importedAt: new Date().toISOString() }));
  }
  return runtime;
}
module.exports = { resolveRuntime, prepareRuntime };
