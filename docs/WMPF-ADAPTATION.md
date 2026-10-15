# 微信 WMPF 版本适配指南

本项目**只做版本自动选择**：运行时自动检测本机微信的 WMPF 版本号，并从
`runtime/frida/config/win32/addresses.<版本>.json` 加载对应配置。

- 收录了 → 自动选用，无需任何操作
- 未收录 → 运行时报 `[frida] version config not found: XXXXX`，按本指南手动推导偏移并新增配置文件

> 偏移是微信二进制里的函数地址/结构体偏移，**无法自动推导**，需要用 IDA 做一次逆向。
> 欢迎把新版本的配置文件以 PR 形式贡献回上游（WMPFDebugger，作者 evi0s）。

## 前置

1. 找到微信的 WMPF 运行时目录，形如：

```
%appdata%\Tencent\xwechat\xplugin\Plugins\RadiumWMPF\19339\extracted\runtime
```

其中 `19339` 就是版本号（运行时也是从进程路径里这样提取的）。

2. 用 IDA 打开该目录下的 `flue.dll`（旧版本可能是 `WeChatAppEx.exe`）。
   **等字符串/交叉引用视图完全加载完再操作**，否则定位不到。

## LoadStartHookOffset

搜索 `OnLoadStart`（驼峰），找到引用了包含 `applet_index_container.cc` 字符串的交叉引用函数
（形如 `sub_18xxxxxxx+E6`）。F5 看伪代码，函数特征是强制把第二参数（`rdx`/`x1`）置 1：

```cpp
if ( (_BYTE)a2 ) ...
```

函数起始地址去掉模块基址就是 `LoadStartHookOffset`（如 `sub_1825B50C0` → `"0x25B50C0"`）。

## SceneOffsets

在上面的伪代码末尾找形如下面的调用（19339 示例）：

```cpp
result = sub_182B02350(*(_QWORD *)(*(_QWORD *)(a1 + 56) + 1376LL), ...)
```

- `1376` 是 SceneOffsets 第 1 个值
- 双击进入 `sub_182B02350`，找形如下面的判断（`1101` 是目标 scene 值）：

```cpp
if ( *(_DWORD *)(*(_QWORD *)(*(_QWORD *)(result + 1312) + 16LL) + 456LL) != 1101 ...
```

- `1312`、`456` 是其余两个值 → `"SceneOffsets": [1376, 1312, 456]`

## CDPFilterHookOffset

在字符串里搜索 `SendToClientFilter`，`x` 查看引用它的唯一函数；该函数里调用的
第一个函数就是 hook 目标（如 `sub_181DB82D0` 内首先调用的 `sub_1824839E0`）：

```
"CDPFilterHookOffset": "0x24839E0",
```

## 保存配置

写到 `runtime/frida/config/win32/addresses.<新版本号>.json`：

```json
{
    "Version": 19339,
    "LoadStartHookOffset": "0x25B5DD0",
    "CDPFilterHookOffset": "0x301B3C0",
    "SceneOffsets": [1376, 1312, 456]
}
```

下次运行时，工具检测到该版本即自动选用。

> 配错偏移的后果：微信进程崩溃或 hook 静默失效。拿不准就对照相邻版本的值，
> 三个值整体趋势是缓慢增大的。
