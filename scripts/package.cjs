const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const { packager } = await import('@electron/packager');
  const version = require('electron/package.json').version;
  const cacheRoot = path.join(process.env.LOCALAPPDATA || '', 'electron', 'Cache');
  const zipName = `electron-v${version}-win32-x64.zip`;
  const cached = fs.existsSync(cacheRoot) ? fs.readdirSync(cacheRoot).map(name => path.join(cacheRoot, name)).find(dir => fs.existsSync(path.join(dir, zipName))) : undefined;
  const appVersion = require('../package.json').version;
  const tag = process.env.SKILLDOCK_BUILD_TAG || '';
  if (tag && !/^ai-\d+$/.test(tag)) throw new Error('Invalid build tag.');
  const destination = path.join(__dirname, '..', 'dist', `SkillDock-Portable-${appVersion}${tag ? '-' + tag : ''}`);
  if (fs.existsSync(destination)) throw new Error('Release directory already exists; never overwrite a portable installation and its data.');
  const staging = path.join(__dirname, '..', 'dist', `.build-${Date.now()}`);
  const result = await packager({
    dir: path.join(__dirname, '..'), out: staging,
    name: 'SkillDock', executableName: 'SkillDock', platform: 'win32', arch: 'x64',
    electronVersion: require('electron/package.json').version,
    electronZipDir: process.env.ELECTRON_ZIP_DIR || cached,
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    overwrite: true, asar: true, prune: true,
    ignore: file => {
      const relative = file.replace(/^[\\/]+/, '');
      return relative !== '' && !['src', 'assets', 'node_modules', 'package.json'].includes(relative.split(/[\\/]/)[0]);
    },
    win32metadata: { CompanyName: 'Local Tools', FileDescription: 'SkillDock - Local Skills Manager', ProductName: 'SkillDock', InternalName: 'SkillDock' }
  });
  fs.renameSync(result[0], destination);
  fs.rmdirSync(staging);
  fs.writeFileSync(path.join(destination, 'portable.json'), JSON.stringify({ format: 1, mode: 'portable' }, null, 2));
  fs.copyFileSync(path.join(__dirname, '..', 'PORTABLE.md'), path.join(destination, '使用说明.md'));
  fs.copyFileSync(path.join(__dirname, '..', 'LICENSE'), path.join(destination, 'LICENSE-SkillDock.txt'));
  fs.writeFileSync(path.join(destination, '启动 SkillDock.cmd'), '@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=\r\nstart \"\" \"%~dp0SkillDock.exe\"\r\n');
  console.log(JSON.stringify({ packaged: [destination], portable: true, version: appVersion }));
})().catch(error => { console.error(error); process.exitCode = 1; });
