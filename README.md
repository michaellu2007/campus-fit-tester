# campus-fit-tester

> ## ⚠️ 免责声明
>
> **本项目仅用于对你自己部署、自己拥有或获得书面授权的校园体测系统做接口与安全测试。**
> 请遵守所在学校/机构的规定与当地法律法规。生成、提交虚假运动数据到未授权的第三方系统
> 属违规行为，由此产生的一切后果由使用者自行承担，与本项目作者无关。
> `config.json` 中的 `acknowledgeOwnSystem` 必须显式设为 `true`，否则程序拒绝启动。
>
> **本项目与任何商业体测平台无关联、无合作、无授权关系。** 使用本项目产生的一切数据与后果由使用者自行承担。

自建校园体测系统的**接口测试客户端**：通过微信 PC 版的小程序调试通道（WMPF + CDP），
对你自己的服务端执行一次完整的「登录 → 查询体测计划 → 开记录 → 心跳 → 提交」流程，
用于验证服务端的签名校验、心跳节奏、距离合理性、围栏判定等防线是否有效。

协议层模块化：服务端地址、端点路径、账号在 `config.json`；场地（学校编号/围栏/跑道）
在 `playground.json`；请求信封/签名集中在 `src/protocol.js` 一个文件。
不硬编码任何学校、场地坐标、服务器或凭据。

## 它能测什么

| 你的防线 | 工具的对应行为 |
|---|---|
| 请求签名（sn / X-Sn-Verify / HMAC） | 按协议正确计算并提交 |
| 心跳节奏（间隔、时间戳单调性） | 时钟驱动，位置 = f(墙钟秒)，自适应间隔 0.9~3s |
| 距离合理性（strollDistance vs 轨迹） | 客户端口径 Σceil(0.9×段)，轨迹含 OU 漂移 |
| 围栏判定 | 轨迹以 playground.json 指定圆心生成 |
| 提交加密三件套（sign/jsCode/keyVersion） | wx.getUserCryptoManager 现场取值 |

## 快速开始

```bash
# 0) 要求：Windows、node 18+、PC 微信已登录
git clone <本仓库>
cd campus-fit-tester
npm install

# 1) 问答式生成 config.json + playground.json
#    （服务器地址 → 账号 → 场地名/编号/围栏/跑道 → appid → 确认）
node src/index.js init

# 2) 离线自检（不触网）
npm run selfcheck

# 3) 拉取外部 runtime（WMPFDebugger，GPL-2.0-only，独立进程运行）
npm run setup:runtime

# 4) 检查微信 WMPF 版本是否在配置表中
npm run wmpf-check

# 5) 打开微信 → 进入你的小程序（任意页面，登录状态）→ 执行
node src/index.js run --distance 2000
```

## 适配你自己的场地：只改一个文件

`playground.json` —— 学校编号和轨迹路线数据都在这一个文件里，换场地就换它：

```json
{
  "name": "我的操场",
  "agencyId": 1234,                          // 学校编号（reads 读不到时的兜底）
  "fenceCenter": [31.0, 121.0],              // 围栏圆心 [纬度, 经度]
  "track": { "straight": 80, "radius": 35 }  // 跑道直道长/弯道半径（米）
}
```

> 仓库自带的 `playground.example.json` 全是占位值，**不含任何真实场地数据**——
> 场地几何按你自己操场填写。

## 适配你自己的服务端：三层各管各的

| 想改什么 | 改哪里 | 谁需要改 |
|---|---|---|
| 服务器地址、端点路径、账号、appid、登录参数 | `config.json` | 所有人 |
| 学校编号、围栏、跑道几何 | `playground.json` | 所有人 |
| 服务端把 agencyId 存在别的位置 | `config.json` 的 `reads` 表 | 少数人 |
| 请求信封/签名算法不同（sn、X-Sn-Verify、HMAC） | `src/protocol.js` | 服务端非同类实现的人 |

## WMPF 版本适配

运行时**自动检测**本机微信的 WMPF 版本号，并**自动选用** `runtime/frida/config/win32/addresses.<版本>.json`
（WMPFDebugger 自带数十个版本的配置）。微信更新后若提示 `version config not found: XXXXX`，
说明新版本未被收录——按 [docs/WMPF-ADAPTATION.md](docs/WMPF-ADAPTATION.md) 用 IDA 推导三个偏移，
新增一个配置文件即可。本项目不做偏移的自动推导。

## 项目结构

```
src/
├── index.js      # CLI：init / run / wmpf-check / selfcheck；拉起 runtime
├── config.js     # config.json + playground.json 读取校验
├── protocol.js   # ★线上格式★：信封结构、sn 排序 MD5、X-Sn-Verify、提交签名——唯一描述协议的文件
├── api.js        # HTTP 传输 + 端点调用（URL 全部来自 config）
├── session.js    # 流程编排：登录→计划→makeStroll→心跳→提交
├── ua.js         # 手机版小程序 UA 生成（appid 来自 config）
└── track.js      # 轨迹生成（跑道模型、OU 漂移、状态机）+ 页面口径距离
runtime/          # 外部依赖：WMPFDebugger（GPL-2.0-only，gitignore，见 npm run setup:runtime）
```

改服务器地址 → 只改 `config.json`；换场地 → 只改 `playground.json`；
服务端的信封/签名格式不同 → 只改 `src/protocol.js`；
业务流程和传输层不用动。

## 许可证

MIT。`runtime/` 下的 WMPFDebugger 为独立外部程序（GPL-2.0-only，作者 evi0s），
以独立进程运行，不属于本项目的衍生作品，其许可证与归属权不变。
