// 设备 UA 生成：手机版小程序 webview 形态。appid 从 config 注入。
// 只覆盖安卓（iOS 用 WKWebView，无 Chrome 段，缺乏真机样本不伪造）。
const fs = require('fs');
const path = require('path');

const BRANDS = {
  'Xiaomi':  [{ m: '24129PN74C', os: 16 }, { m: '24101PNB7C', os: 16 }, { m: '25010PN30C', os: 16 }, { m: '2210132C', os: 15 }],
  'HUAWEI':  [{ m: 'PLR-AL00', os: 15 }, { m: 'PLA-AL10', os: 15 }],
  'OPPO':    [{ m: 'PKH110', os: 16 }, { m: 'PKJ110', os: 16 }],
  'vivo':    [{ m: 'V2413A', os: 16 }, { m: 'V2408A', os: 16 }],
  'SAMSUNG': [{ m: 'SM-S9310', os: 16 }, { m: 'SM-S9260', os: 16 }],
  'HONOR':   [{ m: 'PTP-AN00', os: 16 }, { m: 'PTP-AN10', os: 16 }],
  'OnePlus': [{ m: 'PJZ110', os: 16 }],
  'Redmi':   [{ m: '25060RK16C', os: 16 }],
};

// 微信版本与内核成对取用（同年代）；XWEB 为腾讯内核号，与 Chromium 无固定换算，按公开样本配对
const WX_PROFILES = [
  { mm: '8.0.49.2600(0x2800313B)', chrome: '132.0.6834.160', xweb: '1311071', sdk: '20250206' },
  { mm: '8.0.78.3180(0x28004E30)', chrome: '142.0.7444.102', xweb: '1420237', sdk: '20260905' },
];
const BUILD_IDS = ['TKQ1.220829.002', 'AP3A.240905.015', 'UKQ1.230917.001', 'TP1A.220624.014'];

const hcode = s => { let h = 0; for (const ch of String(s)) h = ((h << 5) - h + ch.charCodeAt(0)) | 0; return Math.abs(h); };

// 生成一条 UA。brand/model/os 缺省时按 appid 哈希自动选（同 install 稳定）
function build(config) {
  const brands = Object.keys(BRANDS);
  const brand = config.device.brand || brands[hcode(config.device.appid) % brands.length];
  const list = BRANDS[brand];
  const dev = list[hcode(brand + config.device.appid) % list.length];
  const model = config.device.model || dev.m;
  const os = config.device.os || dev.os;
  const seed = hcode(model);
  const net = ['WIFI', '5G', '4G'][seed % 3];
  const p = WX_PROFILES[seed % WX_PROFILES.length];
  const mp = ' miniProgram/' + config.device.appid;
  return 'Mozilla/5.0 (Linux; Android ' + os + '; ' + model +
    ' Build/' + BUILD_IDS[seed % BUILD_IDS.length] + '; wv) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/' + p.chrome + ' Mobile Safari/537.36 ' +
    'XWEB/' + p.xweb + ' MMWEBSDK/' + p.sdk + ' MMWEBID/' + (1000 + seed % 9000) +
    ' MicroMessenger/' + p.mm + ' WeChat/arm64 Weixin NetType/' + net + ' Language/zh_CN ABI/arm64' + mp;
}

// UA 持久化到 device.txt（同 install 稳定）；首行生效，# 开头为注释
function loadOrBuild(config) {
  const f = path.join(process.cwd(), 'device.txt');
  try {
    const first = fs.readFileSync(f, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
    if (first && first.startsWith('Mozilla/')) return first;
  } catch (e) {}
  const ua = build(config);
  try { fs.writeFileSync(f, ua + '\n'); } catch (e) {}
  return ua;
}

module.exports = { build, loadOrBuild, BRANDS, WX_PROFILES };
