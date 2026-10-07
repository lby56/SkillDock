const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const key = value => path.resolve(value).replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
const id = value => hash(key(value)).slice(0, 24);
const exists = value => fs.existsSync(value);
function within(root, target, allowRoot = false) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return (allowRoot && rel === '') || (rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}
function assertWithin(root, target, allowRoot = false) {
  if (!within(root, target, allowRoot)) throw new Error('路径超出所选目录，操作已取消。');
}
function assertNoLinks(target) {
  let cursor = path.resolve(target);
  for (;;) {
    if (exists(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('此路径包含符号链接或目录联接；为保护原目录，仅支持查看。');
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}
function safeName(value) {
  if (typeof value !== 'string' || !value || value.length > 100 || /[<>:"/\\|?*\x00-\x1f]/.test(value) || /^\./.test(value) || /[. ]$/.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) throw new Error('技能目录名称无效。');
  return value;
}
function readText(file, fallback = '') {
  return exists(file) ? fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '') : fallback;
}
function atomicWrite(file, data, expected) {
  assertNoLinks(file);
  const old = exists(file) ? fs.readFileSync(file) : null;
  if (expected !== undefined && hash(old || '') !== expected) throw new Error('文件已被其他程序修改，请刷新后重试。');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.skilldock-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, data, { flag: 'wx' });
    if (expected !== undefined && hash(exists(file) ? fs.readFileSync(file) : '') !== expected) throw new Error('文件已被其他程序修改，请刷新后重试。');
    fs.renameSync(temp, file);
  } finally { if (exists(temp)) fs.unlinkSync(temp); }
}
function tree(directory) {
  assertNoLinks(directory);
  const files = [], directories = [];
  if (fs.statSync(directory).isFile()) {
    const raw = fs.readFileSync(directory);
    if (raw.length > 2 * 1024 * 1024) throw new Error('平铺技能超过 2 MB。');
    files.push({ path: 'SKILL.md', size: raw.length, hash: hash(raw) });
    return { files, directories, bytes: raw.length, digest: hash(JSON.stringify({ directories, files })) };
  }
  let bytes = 0;
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      assertWithin(directory, full);
      if (entry.isSymbolicLink()) throw new Error(`技能包含链接，不能安全复制：${entry.name}`);
      const relative = path.relative(directory, full).replaceAll('\\', '/');
      if (entry.isDirectory()) { directories.push(relative); visit(full); }
      else if (entry.isFile()) {
        const stat = fs.statSync(full); bytes += stat.size;
        if (bytes > 1024 * 1024 * 1024 || files.length >= 30000) throw new Error('技能超过 1 GB 或 30,000 个文件，请先精简目录。');
        files.push({ path: relative, size: stat.size, hash: hash(fs.readFileSync(full)) });
      } else throw new Error(`不支持此文件类型：${relative}`);
    }
  }
  visit(directory);
  const digest = hash(JSON.stringify({ directories, files }));
  return { files, directories, bytes, digest };
}
function copyTree(source, destination) {
  const before = tree(source);
  if (exists(destination)) throw new Error('目标目录已存在，操作已取消。');
  assertNoLinks(destination);
  fs.mkdirSync(destination, { recursive: true });
  for (const directory of before.directories) fs.mkdirSync(path.join(destination, directory), { recursive: true });
  for (const file of before.files) {
    const target = path.join(destination, file.path);
    assertWithin(destination, target);
    fs.copyFileSync(sourceFile(source, file.path), target, fs.constants.COPYFILE_EXCL);
  }
  if (tree(source).digest !== before.digest || tree(destination).digest !== before.digest) throw new Error('复制期间文件发生变化，已停止；请重新预览。');
  return before;
}
function removeOwned(root, target) {
  assertWithin(root, target);
  assertNoLinks(target);
  fs.rmSync(target, { recursive: true, force: true });
}
function sourceFile(source, relative) { return fs.statSync(source).isFile() ? source : path.join(source, relative); }
module.exports = { sourceFile, fs, path, crypto, hash, key, id, exists, within, assertWithin, assertNoLinks, safeName, readText, atomicWrite, tree, copyTree, removeOwned };
