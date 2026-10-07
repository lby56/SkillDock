const { path, key, within, assertNoLinks } = require('./files.cjs');
const locationKeys = ['codex', 'claude', 'opencode', 'dsh', 'shared', 'dshAgents'];
function expand(value, { home, appDir, env = {} }) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('路径不能为空。');
  let result = value.trim();
  const vars = { ...env, USERPROFILE: home, HOME: home, APP_DIR: appDir };
  result = result.replace(/%([A-Za-z_][A-Za-z0-9_]*)%|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, a, b) => {
    const name = Object.keys(vars).find(key => key.toLowerCase() === (a || b).toLowerCase());
    if (!name || !vars[name]) throw new Error(`环境变量 ${a || b} 未设置。`);
    return vars[name];
  });
  if (result === '~') result = home;
  else if (/^~[/\\]/.test(result)) result = path.join(home, result.slice(2));
  if (/^[a-z]:[^/\\]/i.test(result)) throw new Error('请使用完整盘符路径，例如 D:\\Tools，或以 .\\ 开头的相对路径。');
  return path.resolve(appDir, result);
}
function defaults(context) {
  const { home, env } = context;
  const pick = (name, fallback) => env[name]?.trim() ? expand(env[name], context) : fallback;
  return {
    codex: pick('CODEX_HOME', path.join(home, '.codex')),
    claude: pick('CLAUDE_CONFIG_DIR', path.join(home, '.claude')),
    opencode: pick('OPENCODE_CONFIG_DIR', path.join(pick('XDG_CONFIG_HOME', path.join(home, '.config')), 'opencode')),
    dsh: pick('DSH_HOME', path.join(home, '.dsh')),
    shared: path.join(home, '.agents'),
    dshAgents: pick('DSH_AGENTS_HOME', path.join(home, '.agents'))
  };
}
function encode(value, context) {
  for (const [base, directory] of [['app', context.appDir], ['home', context.home]]) {
    if (within(directory, value, true)) return { base, path: path.relative(directory, value).replaceAll('\\', '/') };
  }
  return { base: 'absolute', path: value };
}
function decode(spec, context) {
  if (!spec || typeof spec.path !== 'string') throw new Error('保存的目录设置无效，请恢复自动识别。');
  if (spec.base === 'absolute') {
    if (!path.isAbsolute(spec.path)) throw new Error('保存的绝对路径无效。');
    return path.resolve(spec.path);
  }
  const base = spec.base === 'home' ? context.home : spec.base === 'app' ? context.appDir : null;
  if (!base) throw new Error('保存的路径基准无效。');
  const value = path.resolve(base, spec.path);
  if (!within(base, value, true)) throw new Error('相对路径超出保存的基准目录。');
  return value;
}
function load(preferences, context) {
  const auto = defaults(context), locations = { ...auto }, specs = { ...(preferences.locationSpecs || {}) };
  // Legacy preferences belong to the current user; new saves retain only explicit overrides.
  if (!preferences.locationSpecs && preferences.locations) {
    for (const name of locationKeys) if (preferences.locations[name] && key(preferences.locations[name]) !== key(auto[name])) specs[name] = encode(expand(preferences.locations[name], context), context);
  }
  for (const name of locationKeys) if (specs[name]) locations[name] = decode(specs[name], context);
  return { locations, specs, auto };
}
function validate(locations) {
  for (const value of Object.values(locations)) {
    if (path.parse(value).root === path.resolve(value)) throw new Error('不能将磁盘根目录设为配置目录。');
    assertNoLinks(value);
  }
  const entries = Object.entries(locations);
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const [a, first] = entries[i], [b, second] = entries[j];
    if ([a, b].every(name => ['shared', 'dshAgents'].includes(name)) && key(first) === key(second)) continue;
    if (within(first, second, true) || within(second, first, true)) throw new Error('不同工具的配置目录不能相同或互相包含；请使用各工具独立目录。');
  }
}
function reference(skill, roots) {
  const root = roots.find(item => item.id === skill.rootId);
  return root ? `${root.id}:${path.relative(root.path, skill.path).replaceAll('\\', '/').toLowerCase()}` : skill.id;
}
module.exports = { locationKeys, expand, defaults, encode, decode, load, validate, reference };
