// 拉取外部 runtime（WMPFDebugger，GPL-2.0，作者 evi0s）
// 独立进程 spawn，属聚合而非衍生，与本项目的 MIT 许可证互不传染
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'runtime');
const REPO = 'https://github.com/evi0s/WMPFDebugger.git';

if (fs.existsSync(path.join(OUT, 'src', 'index.ts'))) {
  console.log('runtime 已存在，跳过（如需更新请删除 runtime/ 后重跑）');
  process.exit(0);
}
console.log('克隆 WMPFDebugger (GPL-2.0) ->', OUT);
execFileSync('git', ['clone', '--depth', '1', REPO, OUT], { stdio: 'inherit' });
console.log('安装依赖...');
execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: OUT, stdio: 'inherit' });
console.log('完成。runtime/ 已 gitignore，不随本项目分发。');
