// 会话流程：CDP 连接 → kit → 登录 → 查计划 → makeStroll → 心跳（时钟驱动+自适应）→ 签名提交
// 业务流程与线上格式分离：组包在 protocol.js，URL 在 config，本文件只管编排。
const WebSocket = require('ws');
const protocol = require('./protocol');
const api = require('./api');

// ---- CDP（Chrome DevTools Protocol，经 runtime 的 62000 代理连到小程序逻辑层）----
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.sid = null;
    this.events = []; this.listeners = []; this.methods = new Map();
    ws.on('message', raw => {
      const m = JSON.parse(raw);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method) { this.events.push(m); this.listeners.forEach(fn => fn(m)); }
    });
  }
  connect() { return new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); }); }
  send(method, params = {}) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (this.sid) msg.sessionId = this.sid;
    this.methods.set(id, method);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(msg));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('cdp timeout: ' + method)); } }, 15000);
    });
  }
  onEvent(fn) { this.listeners.push(fn); }
}

// 逐个探测候选 target，找到小程序逻辑层上下文（对页面名无假设，兼容各微信版本）
async function findRuntime(cdp) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  const cands = targetInfos.filter(t =>
    (t.type === 'page' || t.type === 'webview') &&
    /servicewechat\.com|liteapp\.weixin|appservice/i.test(t.url + ' ' + t.title));
  if (!cands.length) throw new Error('未找到小程序 target —— 请先打开小程序');
  for (const t of cands) {
    console.log('[try] ' + (t.title || t.targetId.slice(0, 8)) + ' ' + t.url.slice(0, 70));
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
    cdp.sid = sessionId;
    await cdp.send('Runtime.enable');
    await new Promise(r => setTimeout(r, 1200));
    const ctxs = cdp.events
      .filter(e => e.method === 'Runtime.executionContextCreated' && e.sessionId === sessionId)
      .map(e => e.params.context)
      .filter(c => c && !/DevTools/i.test(c.name || ''));
    for (const c of ctxs) {
      let state = '?';
      try {
        const r = await cdp.send('Runtime.evaluate', {
          expression: 'typeof getCurrentPages + "/" + typeof wx + "/" + typeof wx.getUserCryptoManager',
          contextId: c.id, returnByValue: true,
        });
        state = String(r.result && r.result.value);
        if (/^function\/object\/function/.test(state)) {
          console.log('[ctx] hit id=' + c.id);
          return { ctxId: c.id, sessionId };
        }
      } catch (e) { state = 'eval-err'; }
      console.log('[ctx] probe id=' + c.id + ' -> ' + state);
    }
    await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {});
    cdp.sid = null;
  }
  throw new Error('未找到 appservice 上下文 —— 重新打开小程序（任意页面）后重试');
}

async function connectCDP(port) {
  const ws = new WebSocket('ws://127.0.0.1:' + port);
  const cdp = new CDP(ws);
  await cdp.connect();
  const { ctxId } = await findRuntime(cdp);
  const evalInApp = expr => cdp.send('Runtime.evaluate', {
    expression: expr, contextId: ctxId, returnByValue: true, awaitPromise: true,
  }).then(r => {
    if (r.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    return r.result.value;
  });
  return { cdp, evalInApp, close: () => cdp.ws.close() };
}

// ---- 变量读取接口化：config.reads = { 变量名: 在小程序内执行的 JS 表达式 } ----
// 每条表达式 try 包裹（失败记 null），结果进 kit.<变量名>。内置固定能力
// （wx.login → jsCode、getUserCryptoManager → encryptKey）不开放配置，是流程硬依赖。
function buildReadsCode(reads) {
  return Object.entries(reads || {}).map(([name, expr]) =>
    `out[${JSON.stringify(name)}] = (function(){ try { return ${expr}; } catch (e) { return null; } })();`
  ).join('\n      ');
}

// ---- 会话主流程 ----
async function run(config, distance, ua) {
  const ep = name => api.endpoint(config, name);

  const { evalInApp, close } = await connectCDP(config.runtime.cdpPort);
  try {
    // 1) 从小程序取变量与加密三件套（登录页即可拿到）
    const kit = await evalInApp(`(function(){
      return new Promise(function(resolve){
        var out = {}, n = 0;
        function done(){ if (++n === 2) resolve(out); }
        ${buildReadsCode(config.reads)}
        wx.login({ success: function(r){ out.jsCode = r.code; done(); },
                   fail: function(e){ out.loginErr = e && e.errMsg; done(); } });
        try {
          wx.getUserCryptoManager().getLatestUserKey({
            success: function(r){ out.encryptKey = r.encryptKey; out.keyVersion = r.version; done(); },
            fail: function(e){ out.keyErr = e && e.errMsg; done(); } });
        } catch(e) { out.keyErr = String(e); done(); }
        setTimeout(function(){ if (n < 2) { out.timeout = true; resolve(out); } }, 10000);
      });
    })()`);
    if (!kit.encryptKey || !kit.jsCode) { console.error('[session] key/jsCode failed:', kit.keyErr || kit.loginErr); process.exit(1); }

    // 2) 账号密码登录（config.account）
    const lg = await api.post(ep('login'), Object.assign({ identifier: config.account.phone, credential: config.account.password }, config.account.loginParams), '', ua);
    let token = null, lj = null;
    try { lj = JSON.parse(lg.body); } catch (e) {}
    token = (lj && ((lj.userinfo && lj.userinfo.token) || (lj.data && lj.data.userinfo && lj.data.userinfo.token) || (lj.data && lj.data.token) || lj.token)) || null;
    if (!token) { console.error('[session] login failed:', lg.body.slice(0, 300)); process.exit(1); }
    console.log('[session] login ok');

    // 3) 查体测计划：detail.current[0]，空则 history[0]
    // agencyId 优先用 reads 读到的（真实来源），回落 playground.json（场地文件）
    const agencyId = Number(kit.agencyId) > 0 ? Number(kit.agencyId) : Number(config.playgroundData.agencyId);
    if (!(agencyId > 0)) throw new Error('agencyId 未取到（reads 读空且 playground.json 未填）');
    console.log('[session] agencyId =', agencyId, Number(kit.agencyId) > 0 ? '(reads)' : '(config)');
    const q = await api.post(ep('fitnessQuery'), { agencyId, page: 1, rows: 999 }, token, ua);
    let fitnessId = null, planName = '';
    try {
      const j = JSON.parse(q.body);
      const d = protocol.detail(j);
      const plan = (d.current && d.current[0]) || (d.history && d.history[0]) || null;
      if (plan) { fitnessId = plan.fitnessId || null; planName = plan.fitnessName || ''; }
    } catch (e) {}
    if (!fitnessId) { console.error('[session] fitnessId not found:', q.body.slice(0, 300)); process.exit(1); }
    console.log('[session] fitnessId =', fitnessId, planName ? '(' + planName + ')' : '');

    // 4) 开记录
    const mk = await api.post(ep('makeStroll'), { fitnessId }, token, ua);
    let recordId = null, gradeType = 0;
    try {
      const j = JSON.parse(mk.body);
      const d = protocol.detail(j);
      recordId = d.strollRecordId || null;
      gradeType = d.gradeType || 0;
    } catch (e) {}
    if (!recordId) { console.error('[session] makeStroll failed:', mk.body.slice(0, 300)); process.exit(1); }
    console.log('[session] recordId =', recordId, 'gradeType =', gradeType);

    // 5) 生成轨迹并校准到目标距离（页面口径 ±2%）
    const track = require('./track');
    const pace = config.run.paceMin + Math.random() * (config.run.paceMax - config.run.paceMin);
    console.log('[session] pace', pace.toFixed(2), 'min/km');
    const { pts, cum } = track.calibrate(distance, config.playgroundData.fenceCenter[0], config.playgroundData.fenceCenter[1],
      { avgPace: pace, scale: config.run.distanceScale, track: config.playgroundData.track });
    const finalD = cum[cum.length - 1];
    console.log(`[session] calib: ${pts.length} pts -> ${finalD}m (target ${distance}), eta ${Math.ceil(pts.length / 60)} min`);
    if (!pts.length || !(finalD > 0)) { console.error('[session] 空轨迹，拒绝提交'); process.exit(1); }
    // 学校距离封顶（部分学校服务端只认上限内距离）
    let submitD = Math.round(finalD);
    const cap = Number(config.school.distanceCap) || 8000;
    if (submitD > cap) { submitD = cap; console.log('[session] cap: submit', submitD + 'm'); }

    // 6) 心跳：位置由真实时钟驱动（轨迹 1 点/秒），间隔自适应 0.9~3s。
    //    网络慢只是少发几跳，不会拉长时长——服务端按墙钟算的配速 = 轨迹编码配速。
    const hbT0 = Date.now();
    const cfg = { min: 0.9, max: 3.0, cur: 2.0 };
    let sent = 0, lastPct = -5, hbCount = 0, lastPrint = 0;
    while (sent < pts.length) {
      const elapsedS = Math.floor((Date.now() - hbT0) / 1000);
      sent = Math.min(elapsedS, pts.length);
      const curDist = cum[sent - 1] || 0;
      const hb = {
        fitnessId, gradeType, strollDistance: Math.round(curDist),
        submitTimestamp: Date.now(), strollRecordId: recordId,
        strollDetail: JSON.stringify({ map: pts.slice(0, sent).map(p => ({ x: p.longitude, y: p.latitude })) }),
      };
      const hbStart = Date.now();
      try {
        const resp = await api.post(ep('saveStroll'), hb, token, ua);
        hbCount++;
        cfg.cur = Date.now() - hbStart > 1500 ? Math.min(cfg.max, cfg.cur + 0.5) : Math.max(cfg.min, cfg.cur - 0.3);
        const pct = Math.round(sent / pts.length * 100);
        if (hbCount === 1 || (pct !== lastPct && pct % 5 === 0) || Date.now() - lastPrint > 30000) {
          lastPct = pct; lastPrint = Date.now();
          const bar = '='.repeat(Math.round(24 * sent / pts.length)).padEnd(24, '-');
          console.log(`[session] [${bar}] ${pct}%  ${curDist}m  ${Math.floor(sent / 60)}min  (${resp.status})`);
        }
      } catch (e) {
        hbCount++;
        cfg.cur = Math.min(cfg.max, cfg.cur + 0.5);
        if (hbCount % 10 === 0) console.error('[session] hb fail:', e.message);
      }
      const wait = hbStart + cfg.cur * 1000 - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    console.log(`[session] heartbeats: ${hbCount}, avg interval ${((Date.now() - hbT0) / hbCount / 1000).toFixed(1)}s`);

    // 7) 最终提交：业务 6 字段 + 签名三件套（jsCode 现取，encryptKey 用会话开头那份）
    const fresh = await evalInApp(`(function(){
      return new Promise(function(resolve){
        wx.login({ success: function(r){ resolve({ jsCode: r.code }); },
                   fail: function(e){ resolve({ loginErr: e && e.errMsg }); } });
        setTimeout(function(){ resolve({ loginErr: 'timeout' }); }, 10000);
      });
    })()`);
    if (!fresh || !fresh.jsCode) { console.error('[session] refresh jsCode failed'); process.exit(1); }
    const body = Object.assign({
      fitnessId, gradeType, strollDistance: submitD,
      submitTimestamp: Date.now(), strollRecordId: recordId,
      strollDetail: JSON.stringify({ map: pts.map(p => ({ x: p.longitude, y: p.latitude })) }),
    }, protocol.submitSignature(recordId, submitD, kit.encryptKey), { jsCode: fresh.jsCode, keyVersion: kit.keyVersion });
    const fin = await api.post(ep('submitStroll'), body, token, ua);
    let ok = false, msg = '';
    try { const j = JSON.parse(fin.body); ok = j.status === 0; msg = j.message || ''; } catch (e) { msg = fin.body.slice(0, 120); }
    console.log(ok ? '[session] submit ok' : `[session] submit failed (http ${fin.status}): ${msg}`);
    return ok;
  } finally { close(); }
}

module.exports = { run, connectCDP, buildReadsCode };
