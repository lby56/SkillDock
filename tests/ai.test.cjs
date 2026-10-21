const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, put, addSkill } = require('./helpers.cjs');
const { fs, path } = require('../src/files.cjs');
const { AIWorkbench, endpoint } = require('../src/ai-workbench.cjs');
const secure = { isEncryptionAvailable: () => true, encryptString: x => Buffer.from(`encrypted:${x}`), decryptString: x => x.toString().replace(/^encrypted:/, '') };
function setup(extra = {}) {
  const f = fixture('ai'), root = path.join(f.directory, '项目 中文 space');
  put(path.join(root, 'package.json'), '{"name":"skilldock","version":"1.6.0"}');
  put(path.join(root, 'src/main.cjs'), 'const title = "original";\n');
  put(path.join(root, 'src/renderer/style.css'), 'body { color: red; }\n');
  const ai = new AIWorkbench({ manager: f.manager, safeStorage: secure, projectRoot: root, ...extra });
  return { ...f, root, ai };
}
async function proposal(f, changes, summary = '调整界面') {
  f.ai.generate = async () => JSON.stringify({ summary, changes });
  const c = f.ai.context({ kind: 'app' });
  const j = f.ai.start({ token: c.token, profileId: 'codex-local', prompt: '修改标题', files: c.files.map(x => x.path) });
  await new Promise(resolve => setImmediate(resolve)); return f.ai.status(j.id);
}
test('API Key stays encrypted and is never returned to renderer; edit preserves or removes it', () => {
  const f = setup(); let s = f.ai.saveSettings({ profile: { name: 'Test', type: 'chat', baseUrl: 'http://localhost:1234/v1', model: 'local', apiKey: 'private-key-123' } });
  const p = s.profiles.find(x => x.name === 'Test');
  assert.equal(p.hasKey, true); assert.ok(!JSON.stringify(s).includes('private-key'));
  assert.ok(!fs.readFileSync(f.ai.file, 'utf8').includes('private-key'));
  s = f.ai.saveSettings({ profile: { ...p, name: 'Updated', apiKey: '' } }); assert.equal(s.profiles.find(x => x.id === p.id).hasKey, true);
  s = f.ai.saveSettings({ profile: { ...p, removeKey: true } }); assert.equal(s.profiles.find(x => x.id === p.id).hasKey, false);
});
test('unavailable encryption refuses a Key without changing configuration', () => {
  const f = setup({ safeStorage: { isEncryptionAvailable: () => false } });
  assert.throws(() => f.ai.saveSettings({ profile: { name: 'x', type: 'chat', baseUrl: 'https://example.com/v1', model: 'x', apiKey: 'private' } }), /加密/);
  assert.equal(f.ai.settings().profiles.length, 1);
});
test('successful multi-file application, persistent backups and undo preserve original bytes', async () => {
  const f = setup(), source = path.join(f.root, 'src/main.cjs'); fs.writeFileSync(source, Buffer.from('\uFEFFconst title = "original";\r\n'));
  const before = fs.readFileSync(source);
  const j = await proposal(f, [{ path: 'src/main.cjs', content: 'const title = "new";\n' }, { path: 'src/new.cjs', content: 'module.exports = 1;\n' }]);
  assert.equal(j.status, 'done'); assert.deepEqual(fs.readFileSync(source), before, 'generation must not write');
  const result = f.ai.apply(j.result.token); assert.match(fs.readFileSync(source, 'utf8'), /new/);
  const reopened = new AIWorkbench({ manager: f.manager, safeStorage: secure, projectRoot: f.root });
  assert.equal(reopened.history()[0].status, 'applied'); reopened.undo(result.id);
  assert.deepEqual(fs.readFileSync(source), before); assert.equal(fs.existsSync(path.join(f.root, 'src/new.cjs')), false);
});
test('preflight prevents all writes if one file changed after generation', async () => {
  const f = setup(); const j = await proposal(f, [{ path: 'src/main.cjs', content: 'const title = "new";' }, { path: 'src/renderer/style.css', content: 'body { color: blue; }' }]);
  put(path.join(f.root, 'src/renderer/style.css'), 'external change');
  assert.throws(() => f.ai.apply(j.result.token), /其他程序修改/);
  assert.match(fs.readFileSync(path.join(f.root, 'src/main.cjs'), 'utf8'), /original/);
});
test('undo refuses to overwrite later user edits', async () => {
  const f = setup(); const j = await proposal(f, [{ path: 'src/main.cjs', content: 'const title = "new";' }]);
  const result = f.ai.apply(j.result.token); put(path.join(f.root, 'src/main.cjs'), 'later user change');
  assert.throws(() => f.ai.undo(result.id), /后续修改/); assert.equal(fs.readFileSync(path.join(f.root, 'src/main.cjs'), 'utf8'), 'later user change');
});
test('traversal, credentials, scripts outside src, links and invalid JavaScript are rejected', async () => {
  for (const change of [{ path: '../escaped.js', content: '' }, { path: 'src/../../escaped.js', content: '' }, { path: 'src/.secret.js', content: '' }, { path: 'scripts/package.cjs', content: '' }, { path: 'src/auth.json', content: '{}' }, { path: 'src/main.cjs', content: 'const = bad' }]) {
    const f = setup(), j = await proposal(f, [change]); assert.equal(j.status, 'error', change.path);
    assert.match(fs.readFileSync(path.join(f.root, 'src/main.cjs'), 'utf8'), /original/);
  }
  const f = setup(), outside = path.join(f.directory, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(f.root, 'src/link'), 'junction');
  const j = await proposal(f, [{ path: 'src/link/evil.js', content: '1' }]); assert.equal(j.status, 'error'); assert.equal(fs.existsSync(path.join(outside, 'evil.js')), false);
});
test('existing unselected files cannot be replaced by model output', async () => {
  const f = setup(); f.ai.generate = async () => JSON.stringify({ summary: 'x', changes: [{ path: 'src/renderer/style.css', content: 'changed' }] });
  const c = f.ai.context({ kind: 'app' }), j = f.ai.start({ token: c.token, profileId: 'codex-local', prompt: 'x', files: ['src/main.cjs'] });
  await new Promise(r => setImmediate(r)); assert.equal(f.ai.status(j.id).status, 'error');
});
test('cancellation and concurrent-task rejection leave sources untouched', async () => {
  const f = setup(); f.ai.generate = (_p, _t, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const c = f.ai.context({ kind: 'app' }), input = { token: c.token, profileId: 'codex-local', prompt: 'x', files: ['src/main.cjs'] };
  const j = f.ai.start(input); assert.throws(() => f.ai.start(input), /正在运行/); f.ai.cancel(j.id);
  await new Promise(r => setImmediate(r)); assert.equal(f.ai.status(j.id).status, 'cancelled'); assert.match(fs.readFileSync(path.join(f.root, 'src/main.cjs'), 'utf8'), /original/);
});
test('all four API protocols send correct endpoint, auth and extract text with split Chinese UTF-8', async () => {
  const payload = JSON.stringify({ summary: '中文修改', changes: [{ path: 'src/main.cjs', content: 'const title="中文";' }] });
  const replies = { chat: { choices: [{ message: { content: payload }, finish_reason: 'stop' }] }, responses: { status: 'completed', output: [{ content: [{ type: 'output_text', text: payload }] }] }, anthropic: { content: [{ type: 'text', text: payload }] }, gemini: { candidates: [{ content: { parts: [{ text: payload }] }, finishReason: 'STOP' }] } };
  for (const type of Object.keys(replies)) {
    const f = setup({ fetchImpl: async (url, options) => {
      const suffix = { chat: '/v1/chat/completions', responses: '/v1/responses', anthropic: '/v1/messages', gemini: '/v1/models/model:generateContent' }[type];
      assert.equal(new URL(url).pathname, suffix); assert.equal(options.redirect, 'error');
      assert.equal(options.headers[type === 'gemini' ? 'x-goog-api-key' : type === 'anthropic' ? 'x-api-key' : 'Authorization'], type === 'chat' || type === 'responses' ? 'Bearer private' : 'private');
      const buf = Buffer.from(JSON.stringify(replies[type]));
      return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < buf.length; i += 2) controller.enqueue(buf.subarray(i, i + 2)); controller.close(); } }));
    } });
    const s = f.ai.saveSettings({ profile: { name: type, type, model: 'model', baseUrl: 'https://api.example.com/v1', apiKey: 'private' } });
    assert.equal(await f.ai.generate(f.ai.config.profiles.find(p => p.name === type), 'request', new AbortController().signal, () => {}), payload);
    assert.equal(s.profiles.find(p => p.name === type).hasKey, true);
  }
});
test('endpoint rejects insecure remote HTTP, credentials and query parameters', () => {
  for (const url of ['http://example.com/v1', 'https://user:pass@example.com/v1', 'https://example.com/v1?key=private']) assert.throws(() => endpoint(url, 'chat', 'x'));
  assert.equal(endpoint('https://example.com/v1/chat/completions', 'chat'), 'https://example.com/v1/chat/completions');
});
test('Codex uses stdin, explicit read-only sandbox and machine-readable output without shell commands', async () => {
  const f = setup({ processRunner: async (exe, args, options) => {
    assert.ok(args.includes('read-only')); assert.ok(args.includes('--json')); assert.equal(args.at(-1), '-'); assert.match(options.input, /中文需求/);
    assert.ok(!options.cwd.startsWith(f.root));
    return JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ summary: 'ok', changes: [{ path: 'src/main.cjs', content: '1;' }] }) } }) + '\n';
  } });
  const exe = path.join(f.directory, 'codex.exe'); put(exe, 'fake executable');
  const p = { type: 'codex', executable: exe, model: '' };
  assert.match(await f.ai.generate(p, '中文需求', new AbortController().signal, () => {}), /summary/);
});
test('managed skills remain protected', () => {
  const f = setup(); put(path.join(f.manager.locations.codex, 'skills/.system/protected/SKILL.md'), '---\nname: protected\ndescription: Protected\n---\nOriginal.');
  const skill = f.manager.snapshot().skills.find(s => s.name === 'protected');
  assert.throws(() => f.ai.context({ kind: 'skill', skillId: skill.id }), /系统内置/);
});
