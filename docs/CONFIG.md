# 配置说明

配置分两个文件，改动频率从高到低：

| 文件 | 内容 | 什么时候改 |
|---|---|---|
| `config.json` | 服务器地址、测试账号、appid | 每换一个被测系统 |
| `playground.json` | 场地：学校编号、围栏圆心、跑道几何 | 每换一个操场 |

最快方式：`node src/index.js init` 问答式生成两个文件。手工配置则复制
`config.example.json` → `config.json`、`playground.example.json` → `playground.json`。

**带 ★ 的为必填。**

## config.json

### 顶层

| 字段 | 说明 |
|---|---|
| ★ `acknowledgeOwnSystem` | 必须显式 `true`：确认你只将该工具用于测试**你自己部署的系统**，否则启动即拒 |
| ★ `server.baseUrl` | 你的服务端根地址，形如 `https://your-server.example.com` |
| `server.endpoints.*` | 五个端点路径，有默认值。**注意：默认路径是某一个实现的方案示例，不是标准协议**——按你的服务端覆盖 |
| `account.phone` / `password` | 测试账号（明文存本地，勿提交仓库） |
| `account.loginParams` | 登录体附加参数（默认 `{client_id:1000, identity_type:1}`，按你的服务端实现覆盖） |
| `device.appid` | ★ 你自己的小程序 appid（`wx`+16 位十六进制）。只影响 UA 的 `miniProgram/<appid>` 段——填你被测系统对应的小程序；CDP 目标探测不依赖它 |
| `device.brand/model/os` | 设备型号。留 `null` 按 appid 哈希自动选（同机稳定） |
| `playground` | 场地文件路径，默认 `playground.json` |
| `runtime.dir` / `cdpPort` | WMPFDebugger 目录与 CDP 端口（默认 `runtime` / `62000`） |
| `reads` | 小程序变量读取接口，见下 |

### run（配速与轨迹行为）

| 字段 | 默认 | 说明 |
|---|---|---|
| `paceMin` / `paceMax` | 5.9 / 7.2 | 名义配速区间（min/km）随机取值。`ceil(0.9×段)` 折算会让实际配速比名义快约 15% |
| `fastChance` | 0.05 | 快配速档概率 |
| `paceFastMin` / `paceFastMax` | 4.4 / 5.0 | 快档区间 |
| `distanceScale` | 0.9 | 页面口径折算系数（每段 ×0.9 再 ceil），与你的服务端/小程序实现保持一致 |

### reads（小程序变量读取接口）

| 字段 | 说明 |
|---|---|
| `<变量名>` | **JS 表达式**，在小程序逻辑层里执行，结果进 `kit.<变量名>`；抛错安全记 null |

默认 `"agencyId": "wx.getStorageSync('agencyId') || 0"`。学校编号存在别处就改这一行——
session 优先用读到的值，回落 `playground.json` 的 `agencyId`。

## playground.json（场地）

| 字段 | 说明 |
|---|---|
| ★ `agencyId` | 学校编号（>0）。`reads` 读不到时的兜底来源 |
| ★ `fenceCenter` | 围栏圆心 `[纬度, 经度]`，轨迹以此为中心生成——**填你自己操场的** |
| ★ `track.straight` / `track.radius` | 跑道直道长/弯道半径（米）——**填你自己操场的** |
| `name` | 场地名（仅日志显示） |
| `school.distanceCap` / `distanceMax` | 提交距离封顶（默认 8000，封顶后按封顶值签名）/ CLI 输入上限（默认 8100）——这两个留在 config.json 的 school 段 |

## 响应结构说明

宽容解析：优先顶层 `detail`，兜底 `data.detail`；登录取 `userinfo.token`（含 `data.userinfo.token` 兜底）；提交成功判定 `status === 0`。这些都是**按目标服务端实现自适应**，不是协议标准——你的服务端结构不同就改 `src/protocol.js` 的 `detail()` 或 `src/session.js` 解析处。
