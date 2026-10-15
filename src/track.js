// 轨迹生成：跑道模型 + 两层离散 OU（AR(1) 均值回归）+ 状态机 + 页面口径距离。
// 几何（直道/半径）与折算系数（0.9）来自 config，无硬编码业务值。

function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
function gaussFrom(rnd) {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const randRange = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));

const STATES = [
  { name: 'RUNNING',  dur: [300, 27.5], mul: 1.15 },
  { name: 'JOGGING',  dur: [15, 40],    mul: 0.95 },
  { name: 'WALKING',  dur: [10, 20],    mul: 0.70 },
  { name: 'RESTING',  dur: [0, 0],      mul: 0 },
];
const STATE_DUR = [300, 27.5, 10, 20];
const AVG_MUL = STATES.reduce((a, st, i) => a + st.mul * STATE_DUR[i], 0) / STATE_DUR.reduce((a, b) => a + b, 0);

// 弧长 → 跑道坐标（直道-半圆-直道-半圆）
function trackPosition(s, track) {
  const L = track.straight, R = track.radius, C = 2 * L + 2 * Math.PI * R;
  s = ((s % C) + C) % C;
  const Q = C / 4;
  if (s < L) return { x: -L / 2 + s, y: R };
  s -= L;
  if (s < Math.PI * R) return { x: L / 2 + R * Math.sin(s / R), y: R * Math.cos(s / R) };
  s -= L;
  if (s < L) return { x: L / 2 - s, y: -R };
  s -= L;
  return { x: -L / 2 - R * Math.sin(s / R), y: -R * Math.cos(s / R) };
}

// 页面口径：逐段 ×scale 后 ceil 累加（客户端上报距离的计算方式）
function pageAlgoCumulative(points, scale) {
  const out = [];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const dLat = (points[i].latitude - points[i - 1].latitude) * 111319.49;
    const dLng = (points[i].longitude - points[i - 1].longitude) * 111319.49 * Math.cos(points[i].latitude * Math.PI / 180);
    acc += Math.ceil(scale * Math.sqrt(dLat * dLat + dLng * dLng));
    out.push(acc);
  }
  return out;
}

// 生成 n 个点（1 点/秒）的轨迹。speedBase m/s 由名义配速换算，状态机/OU/正弦在名义值附近扰动
function generate(lenParam, centerLat, centerLng, opts) {
  const track = opts.track, speedBase = 1000 / (opts.avgPace * 60);
  const rnd = mulberry(opts.seed || (Date.now() & 0xffffffff));
  const g = () => gaussFrom(rnd);
  const phase = g() * Math.PI;
  const rotation = (rnd() * Math.PI) % (Math.PI / 2);
  const noiseStd = opts.noiseStd || 0.4;

  let s = 0, state = 0, stateLeft = randRange(rnd, ...STATES[0].dur);
  let paceJitter = 0, driftX = 0, driftY = 0, t = 0;
  const points = [];
  for (let i = 0; i < lenParam; i++) {
    const st = STATES[state];
    paceJitter = 0.97 * paceJitter + 0.03 * g() * 0.35;                        // OU：速度慢漂移
    const sway = 1 + 0.05 * Math.sin(2 * Math.PI * t / 300 + phase);           // 300s 正弦慢变
    const speed = speedBase * (st.mul / AVG_MUL) * (1 + paceJitter) * sway;
    s += speed;
    stateLeft -= 1;
    if (stateLeft <= 0) { state = (state + 1) % STATES.length; stateLeft = randRange(rnd, ...STATES[state].dur); }
    const p = trackPosition(s, track);
    driftX = 0.95 * driftX + 0.05 * g() * 6;                                   // OU：GPS 漂移
    driftY = 0.95 * driftY + 0.05 * g() * 6;
    const nx = p.x + driftX + g() * noiseStd;
    const ny = p.y + driftY + g() * noiseStd;
    const xr = nx * Math.cos(rotation) - ny * Math.sin(rotation);
    const yr = nx * Math.sin(rotation) + ny * Math.cos(rotation);
    points.push({ latitude: centerLat + yr * 8.993216e-6, longitude: centerLng + xr * 1.041666e-5 });
    t += 1;
  }
  return points;
}

// 迭代校准：调点数使页面口径距离逼近目标（±2%）
function calibrate(targetM, centerLat, centerLng, opts) {
  const scale = opts.scale;
  const speedBase = 1000 / (opts.avgPace * 60);
  let lenParam = Math.round(targetM / (scale * speedBase * 0.9)) + 40;
  let pts = [], cum = [0];
  for (let k = 0; k < 5; k++) {
    pts = generate(lenParam, centerLat, centerLng, Object.assign({}, opts, { seed: (opts.seed || 1) + k * 977 }));
    cum = pageAlgoCumulative(pts, scale);
    const f = cum[cum.length - 1] || 0;
    if (Math.abs(f - targetM) <= Math.max(5, 0.02 * targetM)) break;
    lenParam = Math.max(60, Math.round(lenParam * targetM / (f || 1)));
  }
  return { pts, cum };
}

module.exports = { generate, calibrate, pageAlgoCumulative, trackPosition, STATES };
