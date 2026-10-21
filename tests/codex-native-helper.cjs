const { spawn } = require('node:child_process');
const { fs, path } = require('../src/files.cjs');
const os = require('node:os');
const executable = path.join(os.homedir(), '.codex/packages/standalone/current/bin/codex.exe');
function listNativeCodex(codeHome, cwd) {
  if (!fs.existsSync(executable)) throw new Error('Local Codex executable is unavailable.');
  return new Promise((resolve, reject) => {
    const proc = spawn(executable, ['app-server', '--stdio'], { cwd, env: { ...process.env, CODEX_HOME: codeHome }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', stderr = '', finished = false;
    const stop = (error, result) => {
      if (finished) return; finished = true; clearTimeout(timer);
      const settle = () => error ? reject(error) : resolve(result);
      if (proc.exitCode !== null) settle(); else { proc.once('exit', settle); proc.stdin.end(); proc.kill(); }
    };
    const timer = setTimeout(() => stop(new Error(`Local Codex inventory timeout: ${stderr.slice(-500)}`)), 20000);
    const send = object => proc.stdin.write(JSON.stringify(object) + '\n');
    proc.stderr.on('data', chunk => { stderr += chunk; });
    proc.stdin.on('error', error => { if (!finished) stop(error); });
    proc.on('error', error => stop(error));
    proc.on('exit', code => { if (!finished) stop(new Error(`Codex inventory exited ${code}: ${stderr.slice(-500)}`)); });
    proc.stdout.on('data', chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        let response; try { response = JSON.parse(line); } catch { continue; }
        if (response.error && [1, 2].includes(response.id)) return stop(new Error(JSON.stringify(response.error)));
        if (response.id === 1) {
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'skills/list', params: { cwds: [cwd], forceReload: true } });
        } else if (response.id === 2) return stop(null, response.result);
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'skilldock_portable_qa', version: '1.5.0' }, capabilities: { experimentalApi: true } } });
  });
}
module.exports = { listNativeCodex, executable };
