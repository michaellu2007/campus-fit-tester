// CLI 入口：init / run / wmpf-check / selfcheck
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const config = require('./config');

const cmd = process.argv[2];
const args = process.argv.slice(3);

function loadConfig() { return config.load(); }

// ---- init：问答式生成 config.json + playground.json（快速适配自己的系统/场地）----
async function init() {
  // TTY 用 readline 交互；管道喂入（自动化测试）则整读 stdin 按行消费
  const piped = !process.stdin.isTTY;
  const pipedLines = piped ? fs.readFileSync(0, 'utf8').split(/\r?\n/).map(s => s.trim()) : null;
  const rl = piped ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q, def) => {
    process.stdout.write(`${q}${def ? ` [${def}]` : ''}: `);
    if (piped) return Promise.resolve(pipedLines.shift() || def || '');
    return new Promise(res => rl.question(`${q}${def ? ` [${def}]` : ''}: `, a => res(a.trim() || def || '')));
  };
  try {
    console.log('== campus-fit-tester 初始化 ==');
    console.log('仅用于测试你自己部署的系统。回车使用 [方括号] 中的默认值。\n');

    // 现有配置作为默认值
    let cur = {}, curPg = {};
    const cfgPath = path.join(process.cwd(), 'config.json');
    const pgPath = path.join(process.cwd(), 'playground.json');
    try { cur = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) {}
    try { curPg = JSON.parse(fs.readFileSync(pgPath, 'utf8')); } catch (e) {}

    const baseUrl = await ask('服务端根地址 (https://...)', cur.server && cur.server.baseUrl);
    const phone = await ask('测试账号手机号 (11位)', cur.account && cur.account.phone);
    const password = await ask('测试账号密码', cur.account && cur.account.password);
    const appid = await ask('你的小程序 appid (wx+16位十六进制)', cur.device && cur.device.appid);

    console.log('\n-- 场地（写入 playground.json，可随场地更换）--');
    const pgName = await ask('场地名称', curPg.name || '我的操场');
    const agencyId = await ask('学校编号 agencyId (>0)', curPg.agencyId);
    const lat = await ask('围栏圆心纬度', curPg.fenceCenter && curPg.fenceCenter[0]);
    const lng = await ask('围栏圆心经度', curPg.fenceCenter && curPg.fenceCenter[1]);
    const straight = await ask('跑道直道长度（米）', curPg.track && curPg.track.straight);
    const radius = await ask('跑道弯道半径（米）', curPg.track && curPg.track.radius);

    const ack = await ask('确认仅用于测试自己部署的系统？(y/N)', '');
    if (ack.toLowerCase() !== 'y') { console.log('已取消 —— 未写入任何文件'); return; }

    const outCfg = {
      acknowledgeOwnSystem: true,
      server: { baseUrl },
      account: { phone, password },
      device: { appid },
      playground: 'playground.json',
    };
    const outPg = {
      name: pgName, agencyId: Number(agencyId),
      fenceCenter: [Number(lat), Number(lng)],
      track: { straight: Number(straight), radius: Number(radius) },
    };
    fs.writeFileSync(cfgPath, JSON.stringify(outCfg, null, 2) + '\n');
    fs.writeFileSync(pgPath, JSON.stringify(outPg, null, 2) + '\n');
    console.log(`\n已写入 ${cfgPath}`);
    console.log(`已写入 ${pgPath}`);
    console.log('下一步：npm run selfcheck 自检 → npm run setup:runtime 装运行时 → node src/index.js run --distance 2000');
  } finally { if (rl) rl.close(); }
}

// ---- wmpf-check：检测微信 WMPF 版本配置的收录情况（自动选择，不做偏移推导）----
function wmpfCheck(cfg) {
  const rt = path.resolve(cfg.runtime.dir);
  const confDir = path.join(rt, 'frida', 'config', 'win32');
  if (!fs.existsSync(path.join(rt, 'src', 'index.ts'))) {
    console.error('[wmpf] runtime 未安装。执行: npm run setup:runtime');
    process.exit(1);
  }
  const versions = fs.existsSync(confDir)
    ? fs.readdirSync(confDir)
        .filter(f => /^addresses\.(\d+)\.json$/.test(f))
        .map(f => Number(f.match(/^addresses\.(\d+)\.json$/)[1]))
        .sort((a, b) => a - b)
    : [];
  console.log('[wmpf] 运行时会自动检测本机微信的 WMPF 版本号，');
  console.log('[wmpf] 并自动选用 runtime/frida/config/win32/addresses.<版本>.json 中的对应配置。');
  console.log('[wmpf] 当前配置表收录版本：' + (versions.length
    ? versions[0] + ' ~ ' + versions[versions.length - 1] + '（共 ' + versions.length + ' 个）'
    : '(空)'));
  console.log('[wmpf] 若微信更新后提示 "version config not found: XXXXX"，');
  console.log('[wmpf] 说明 XXXXX 未收录 —— 请参照 docs/WMPF-ADAPTATION.md 手动推导偏移并新增配置文件。');
}

// ---- selfcheck：离线自检（不触网、不需要微信）----
function selfcheck(cfg) {
  const protocol = require('./protocol');
  const ua = require('./ua');
  const track = require('./track');
  let n = 0;
  const ok = (c, m) => { if (!c) throw Error('FAIL: ' + m); n++; };

  // config + playground
  ok(cfg.acknowledgeOwnSystem === true, 'acknowledgeOwnSystem');
  ok(/^https?:\/\//.test(cfg.server.baseUrl), 'server.baseUrl');
  const pg = cfg.playgroundData;
  ok(Number(pg.agencyId) > 0, 'playground agencyId');
  ok(pg.fenceCenter.length === 2 && pg.fenceCenter.every(Number), 'playground fenceCenter');
  ok(pg.track.straight > 0 && pg.track.radius > 0, 'playground track geometry');
  ok(cfg.account.loginParams && typeof cfg.account.loginParams === 'object', 'account.loginParams');

  // protocol：信封键序 + 签名确定性
  const env = protocol.envelope({ a: 1, b: 2 }, 'TOK');
  ok(Object.keys(env.header).join() === 'token,snTime,sn,from', 'envelope header fields');
  const s1 = protocol.submitSignature('1', 1000, 'key1').sign;
  const s2 = protocol.submitSignature('1', 1000, 'key1').sign;
  ok(s1 === s2 && s1.length > 20, 'submit signature deterministic');

  // UA：确定性 + appid 注入
  const u1 = ua.build(cfg);
  ok(u1 === ua.build(cfg), 'ua deterministic');
  ok(u1.includes('miniProgram/' + cfg.device.appid), 'ua appid suffix');

  // reads：生成的表达式在假 wx 环境执行正确，坏表达式安全记 null
  const { buildReadsCode } = require('./session');
  const fakeWx = { getStorageSync: k => ({ agencyId: 42 }[k]) || 0 };
  const out1 = {};
  new Function('out', 'wx', buildReadsCode({ agencyId: "wx.getStorageSync('agencyId') || 0" }))(out1, fakeWx);
  ok(out1.agencyId === 42, 'reads expression: agencyId=' + out1.agencyId);
  const out2 = {};
  new Function('out', 'wx', buildReadsCode({ bad: 'wx.nope().deep' }))(out2, fakeWx);
  ok(out2.bad === null, 'reads bad expr safe-null');

  // track：校准收敛到 ±2%，距离单调
  const center = pg.fenceCenter;
  const { pts, cum } = track.calibrate(2000, center[0], center[1], { avgPace: 6.5, scale: cfg.run.distanceScale, track: pg.track });
  ok(pts.length > 100, 'track points generated: ' + pts.length);
  const d = cum[cum.length - 1];
  ok(Math.abs(d - 2000) <= Math.max(5, 0.02 * 2000), 'calibrated distance: ' + d + 'm');
  for (let i = 1; i < cum.length; i++) ok(cum[i] >= cum[i - 1], 'distance monotonic @' + i);

  console.log('selfcheck ok (' + n + ' checks)');
}

// ---- run：拉起 runtime → 等小程序接入 → 会话 ----
async function run(cfg, distance) {
  const rt = path.resolve(cfg.runtime.dir);
  if (!fs.existsSync(path.join(rt, 'src', 'index.ts'))) {
    console.error('[run] runtime 未安装。执行: npm run setup:runtime');
    process.exit(1);
  }
  const port = Number(cfg.runtime.cdpPort);
  const isPortOpen = () => new Promise(res => {
    const s = require('net').connect(port, '127.0.0.1');
    s.on('connect', () => { s.destroy(); res(true); });
    s.on('error', () => res(false));
  });

  let child = null;
  if (!(await isPortOpen())) {
    console.log('[run] starting runtime...');
    const tsNode = path.join(rt, 'node_modules', 'ts-node', 'dist', 'bin.js');
    child = spawn(process.execPath, [tsNode, '-T', 'src/index.ts'], { cwd: rt, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', d => process.stdout.write('[wmpf] ' + d));
    child.stderr.on('data', d => process.stderr.write('[wmpf] ' + d));
    const t0 = Date.now();
    while (!(await isPortOpen())) {
      if (Date.now() - t0 > 60000) { console.error('[run] runtime 启动超时（微信开着吗？）'); process.exit(1); }
      await new Promise(r => setTimeout(r, 500));
    }
    // 等 frida 完成注入、小程序接入（runtime 日志里出现接入标志）
    await new Promise(resolve => {
      const timer = setTimeout(() => resolve(), 60000);
      const onData = d => { if (String(d).includes('miniapp client connected')) { clearTimeout(timer); resolve(); } };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
    });
    console.log('[run] connected');
    await new Promise(r => setTimeout(r, 1500));
  } else {
    console.log('[run] runtime 已在运行，直接复用');
  }

  const ua = require('./ua').loadOrBuild(cfg);
  const session = require('./session');
  const ok = await session.run(cfg, distance, ua);
  if (child) { try { child.kill(); } catch (e) {} }
  process.exit(ok ? 0 : 1);
}

// ---- main ----
(async () => {
  if (cmd === 'init') return init();
  if (cmd === 'wmpf-check') return wmpfCheck(loadConfig());
  if (cmd === 'selfcheck') return selfcheck(loadConfig());
  if (cmd === 'run') {
    const cfg = loadConfig();
    const di = args.indexOf('--distance');
    const distance = di >= 0 ? Number(args[di + 1]) : 0;
    if (!(distance > 0 && distance <= cfg.school.distanceMax)) {
      console.error('--distance 范围 (0, ' + cfg.school.distanceMax + ']');
      process.exit(1);
    }
    return run(cfg, distance);
  }
  console.log(`用法:
  node src/index.js init                    # 问答式生成 config.json + playground.json
  node src/index.js run --distance 3000     # 完整测试会话
  node src/index.js wmpf-check              # 检查 WMPF 版本配置收录情况
  node src/index.js selfcheck               # 离线自检`);
})();
