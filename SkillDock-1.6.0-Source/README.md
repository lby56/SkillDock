# SkillDock

Windows 便携技能管理器，支持 Codex、Claude Code、OpenCode、DeepSeek Harness。

当前版本：1.6.0，包含「AI 修改」工作台。普通用户下载发行页的 `SkillDock-1.6.0-Portable-win-x64.zip`，完整解压后运行 `SkillDock.exe`。便携版自带 Electron，无需安装 Node.js。

用户使用、路径规则与分享方式见 [PORTABLE.md](PORTABLE.md)。

## 开发

```powershell
npm.cmd ci
npm.cmd start
npm.cmd test
node tests/ui.cjs
node tests/overview-ui.cjs
node tests/selection-ui.cjs
node tests/builtin-rule-ui.cjs
```

源码开发和构建需要 Windows x64、Node.js 22 或更新版本，以及 npm。AI 修改工作台需要另行配置本机 Codex CLI 或自己的 API；在便携版中修改应用，还需要选择完整源码目录并安装项目依赖。

`npm.cmd test` 中 Harness 的原生加载器检查需要本机已安装 DeepSeek Harness；`tests/portable-ui.cjs` 还需要 Codex CLI。构建和启动 SkillDock 本身不依赖这些工具。

## 发行

```powershell
npm.cmd run package
npm.cmd run release
```

构建按白名单只收录程序、图标和生产依赖，生成独立版本目录并拒绝覆盖已有便携安装。发行 ZIP 禁止包含运行后的 data 目录。

GitHub 仓库收录源码、`package-lock.json` 和文档；便携版 ZIP 与 `.sha256` 文件上传到 GitHub Releases。`.gitignore` 已排除依赖、构建产物、测试数据和本机运行数据。

将最终 ZIP 全新解压至 qa 下含中文和空格的目录，以 `SKILLDOCK_PORTABLE_DIR` 指向解压后的程序目录，再运行 `node tests/portable-ui.cjs`。该验收会关闭并移动测试副本，在另一个模拟用户目录再次启动，验证运行时路径和数据隔离。所有功能测试使用隔离用户目录；Harness 验收可直接调用本机安装的官方文件系统技能加载器，Codex 路径验收只读取临时 CODEX_HOME 的技能目录，不发起模型调用。
