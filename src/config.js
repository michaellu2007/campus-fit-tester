// config.json + playground.json 读取与校验。
// 分层：数据进 config（服务器/账号）+ playground（场地），逻辑进模块。
const fs = require('fs');
const path = require('path');

// 某实现的路径方案示例（非标准协议）——按你的服务端在 config.server.endpoints 覆盖
const DEFAULT_ENDPOINTS = {
  login: '/public/public/login',
  fitnessQuery: '/webservice/wechat/student/fitness/queryOneStudentFitness.do',
  makeStroll: '/webservice/wechat/student/stroll/makeStroll.do',
  saveStroll: '/webservice/wechat/student/stroll/saveStroll.do',
  submitStroll: '/webservice/wechat/student/stroll/submitStroll.do',
};

function load(configPath) {
  const p = path.resolve(configPath || path.join(process.cwd(), 'config.json'));
  if (!fs.existsSync(p)) {
    console.error(`[config] 未找到 ${p}`);
    console.error('  执行 node src/index.js init 生成，或复制 config.example.json 后按 docs/CONFIG.md 填写');
    process.exit(1);
  }
  let c;
  try { c = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.error('[config] JSON 解析失败: ' + e.message); process.exit(1); }

  const missing = [];
  const need = (ok, msg) => { if (!ok) missing.push(msg); };

  need(c.acknowledgeOwnSystem === true,
    'acknowledgeOwnSystem 必须显式设为 true —— 本工具仅用于测试你自己部署的系统');
  need(c.server && typeof c.server.baseUrl === 'string' && /^https?:\/\//.test(c.server.baseUrl),
    'server.baseUrl（形如 https://your-server.example.com）');
  need(c.account && /^\d{11}$/.test(String(c.account.phone || '')), 'account.phone（11 位手机号）');
  need(c.account && c.account.password, 'account.password');
  need(c.device && /^wx[0-9a-f]{16}$/.test(String(c.device.appid || '')),
    'device.appid（你自己的小程序 appid，wx + 16 位十六进制）');

  if (missing.length) {
    console.error('[config] 配置不完整：');
    missing.forEach(m => console.error('  - ' + m));
    console.error('  执行 node src/index.js init，或参考 docs/CONFIG.md');
    process.exit(1);
  }

  c.server.endpoints = Object.assign({}, DEFAULT_ENDPOINTS, c.server.endpoints || {});
  c.account.loginParams = Object.assign({ client_id: 1000, identity_type: 1 }, c.account.loginParams || {});
  c.school = c.school || {};
  c.school.distanceCap = Number(c.school.distanceCap) || 8000;
  c.school.distanceMax = Number(c.school.distanceMax) || 8100;
  c.run = c.run || {};
  c.run.paceMin = Number(c.run.paceMin) || 5.9;
  c.run.paceMax = Number(c.run.paceMax) || 7.2;
  c.run.distanceScale = Number(c.run.distanceScale) || 0.9;
  c.reads = Object.assign({ agencyId: "wx.getStorageSync('agencyId') || 0" }, c.reads || {});
  c.runtime = Object.assign({ dir: 'runtime', cdpPort: 62000 }, c.runtime || {});
  c.playground = c.playground || 'playground.json';
  c.configPath = p;

  const pg = loadPlayground(c, path.dirname(p));
  if (!pg) process.exit(1);
  c.playgroundData = pg;
  return c;
}

// 场地文件：agencyId + 围栏 + 跑道几何，一处换场地
function loadPlayground(c, baseDir) {
  const p = path.isAbsolute(c.playground) ? c.playground : path.join(baseDir, c.playground);
  if (!fs.existsSync(p)) {
    console.error(`[playground] 未找到场地文件 ${p}`);
    console.error('  复制 playground.example.json 为 playground.json，按 docs/CONFIG.md 填你自己的场地');
    return null;
  }
  let g;
  try { g = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.error('[playground] JSON 解析失败: ' + e.message); return null; }

  const bad = [];
  if (!(Number(g.agencyId) > 0)) bad.push('agencyId（学校编号，>0）');
  if (!Array.isArray(g.fenceCenter) || g.fenceCenter.length !== 2 || !g.fenceCenter.every(Number))
    bad.push('fenceCenter（围栏圆心 [纬度, 经度]）');
  if (!g.track || !(Number(g.track.straight) > 0) || !(Number(g.track.radius) > 0))
    bad.push('track.straight / track.radius（跑道直道长/弯道半径，米，>0）');
  if (bad.length) {
    console.error(`[playground] ${p} 不完整：`);
    bad.forEach(b => console.error('  - ' + b));
    console.error('  参考 docs/CONFIG.md 的 playground 一节');
    return null;
  }
  g.agencyId = Number(g.agencyId);
  g.fenceCenter = g.fenceCenter.map(Number);
  g.track = { straight: Number(g.track.straight), radius: Number(g.track.radius) };
  g.path = p;
  return g;
}

module.exports = { load, loadPlayground, DEFAULT_ENDPOINTS };
