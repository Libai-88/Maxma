# 构建流程与产物位置（唯一事实源）

> 建立日期：2026-10-08
> 目的：把「每次构建跑什么、产物落在哪、怎么验证」固定下来，便于排障与交接。
> **本文档与脚本冲突时以脚本为准，并立刻回来改本文档。**

## 1. 三种构建形态与固定产物位置

| # | 形态 | 命令 | 产物位置（固定） | 用户拿到什么 |
| --- | --- | --- | --- | --- |
| 1 | **后端 bundle**（中间产物） | `build\build-server.bat` | `dist\bun-server\` | 不直接分发 |
| 2 | **Web 便携包** | `build-portable.bat` | `..\MaxmaHere-Portable\` | 整个目录（拷走即用） |
| 3 | **Electron 桌面便携包** | `powershell -File build-desktop-portable.ps1` | `dist\electron-portable\MaxmaHere-<版本>-portable-x64.zip` + `.sha256` | zip + 校验文件 |

### 1.1 `dist\bun-server\` 的内容（1 与 2、3 的共同输入）

```text
dist\bun-server\
  server.js          ← bun build --target bun 打包的后端（入口）
  bun.exe            ← 固定版运行时（约 94MB）
  externals.json     ← **运行时依赖清单**（由 build-server.mjs 推导生成）
  node_modules\
    sharp\ @img\ ... ← sharp 原生件（贴纸上传的图片转换）
    dsh-codearts-auth\ @deepseek-ai\ ... jose\ undici\   ← 插件栈
```

⚠️ **`externals.json` 是构建链的关键契约**，别删也别手改：它由
`bun-backend/build-server.mjs` 从插件栈的 `package.json` **递归求依赖闭包**得到
（当前 23 个包），`build-server.bat`、`electron-builder.config.cjs`、
`portable-smoke-test.ps1` 三处都读它。

## 2. 依赖顺序

```text
build-server.bat  ──┬─→ dist\bun-server\ ──┬─→ build-portable.bat ──→ ..\MaxmaHere-Portable\
                    │                      │
                    │                      └─→ build-desktop-portable.ps1 ──→ dist\electron-portable\*.zip
                    │
                    └─ 产出 externals.json（被上面两条链读取）
```

**先跑 `build-server.bat` 再跑 2 或 3**（后两者本身也会重建 bundle，但显式顺序更易排障）。
`build-desktop-portable.ps1` 会自己调 `build-server.mjs`，**不会**调 `build-server.bat`
—— 所以插件栈的暂存逻辑必须在 `.ps1` 里也有一份（见 §4 的踩坑记录）。

## 3. 验证（一个脚本验两种布局）

```powershell
# Web 便携包
powershell -NoProfile -ExecutionPolicy Bypass -File build\portable-smoke-test.ps1

# 桌面运行目录（zip 解开后的实际运行位置）
powershell -NoProfile -ExecutionPolicy Bypass -File build\portable-smoke-test.ps1 `
  -PortableDir dist\electron-portable\win-unpacked\resources\maxma -Port 8020 -SeedDefaults
```

两种布局**同构**（都有 `server.js` / `bun.exe` / `portable.flag` / `version.py` /
`externals.json`），所以同一个脚本都能验。差别只有默认配置位置：
桌面版播种在 `win-unpacked\data\api\data\`（程序旁），Web 包在 `PortableDir\data\api\data\`
—— `-SeedDefaults` 会两个都试。

冒烟脚本检查的关键点（**不是**「接口返回 200」那种弱检查）：

```text
[portable-smoke] auth: ok
[portable-smoke] health: status=ok version=v2.6.11      ← 版本与随包 version.py 比对
[portable-smoke] news: 46 entries
[portable-smoke] plugins: 1 registered                   ← 注册表里有内置插件
[portable-smoke] plugin provider routes: 15              ← **插件运行时真的加载了**
[portable-smoke] externals: 23 declared, 0 missing       ← 外置包一个不缺
```

## 4. 踩过的坑（改构建脚本前先读）

### 4.1 插件栈必须外置，不能内联进 server.js

`@deepseek-ai/dsh-llm` 在模块作用域执行
`createRequire(import.meta.url)("../package.json")` 读自己的版本号。内联进 `server.js` 后
`import.meta.url` 变成 server.js 的位置，`../package.json` 就解析到**便携包上一级目录**，
启动即抛 `Cannot find module '../package.json'`。外层只表现为
`invalid plugin, expect function or object with an apply method, received undefined`，
**看不出是版本号读取引起的**。

### 4.2 清单必须推导，不能手写

手写清单漏过 `dsh-commands` 依赖的 `@deepseek-ai/dsh-attachment`（只在便携包启动时暴露）。
现在唯一来源是 `build-server.mjs` 的 `dependencyClosure()`。

### 4.3 electron-builder 的 `extraResources` 会过滤掉 node_modules

`desktop/electron-builder.config.cjs` 第一条 `extraResources` 的 filter 是
`["**/*", "!node_modules/{**/*}"]` —— **只有显式列出的包才会进包**。
这里曾经漏掉整个插件栈：**zip 照常生成、大小正常**，用户装上后插件静默不工作。
现在该文件读 `externals.json` 逐包 `map` 出 `extraResources`。

### 4.4 守卫不能只检查「清单文件存在」

`externals.json` 由 `.mjs` 生成，**永远存在**；缺的是 `node_modules` 里的包。
所以守卫一律校验**包目录**（`node_modules/<pkg>/package.json`）。

### 4.5 `.ps1` 含中文字符串必须带 UTF-8 BOM

Windows PowerShell 5.1 对**无 BOM** 的 `.ps1` 按系统 ANSI（中文机器上是 GBK）解码。
中文在**注释**里无害，但在**字符串**里时会把引号吃掉：

```text
Write-Host "中文输出：测试"
  → The string is missing the terminator: ".
```

症状是一堆看不懂的语法错（`Try statement is missing its Catch…`），**不是**「编码错误」。
`.bat` 同理必须保持 **CRLF**（cmd.exe 无法解析纯 LF）。

### 4.6 编辑这些文件时不要弄丢 BOM / 换行

用会重写整个文件的工具编辑 `build-desktop-portable.ps1`、`build\portable-smoke-test.ps1`
等脚本时，务必确认 BOM 与 CRLF 保留。`bun-backend/tests/plugins/portable-packaging.test.ts`
里有自动化守卫（BOM 规则 + CRLF 规则），改完跑一次后端测试即可。

### 4.7 冒烟脚本传相对 `-PortableDir` 会让 bun 瞬间退出（不是超时）

`build\portable-smoke-test.ps1` 用 `-PortableDir` 拼 bun.exe / server.js / 各 env。
传**相对路径**（如 `dist\...`）时这些全是相对解析，bun 进程**瞬间退出（exit 1）**，
脚本却只会傻等 120s 超时——症状与「服务起不来」难以区分（真机踩过，排障半多小时）。
现在脚本入口 `Resolve-Path -LiteralPath $PortableDir` 强制绝对路径，守卫见打包测试
「冒烟脚本必须把 -PortableDir 解析成绝对路径」。

### 4.8 产物里的旧 hash chunk（dist 累积与叠加拷贝）

vite 关闭了 `emptyOutDir`（safe-delete 钩子对 >50 文件的 rmSync 会**静默失败但退出 0**，
见 `web/vite.config.ts` 注释）。由此有两处会累积旧 hash 的 chunk：

1. **仓库 `web\dist`**：由 `web/scripts/clean-dist.mjs`（接入 `npm run build` 前置）
   用 rename 隔离解决 —— rmSync 不可靠，rename 不受钩子拦截。
2. **桌面链 win-unpacked**：`build-desktop-portable.ps1` 往**上次构建残留**里叠加拷贝。
   已改为暂存 `web\dist` 前先删再拷（镜像语义，路径护栏与 stale-data 相同）。
   实测修复后 ZIP 从 266.5MB 瘦到 245.6MB。

诊断特征：`web\dist\assets` 里同一入口出现两个 hash（如 `JetHubView-CHP0TWVG.js` +
`JetHubView-CZBEl02D.js`）。守卫见打包测试「前端构建必须先清空 dist」「桌面链暂存
web\dist 必须先清后拷」。

## 5. 回归测试

```text
cd bun-backend && bun test tests/plugins/portable-packaging.test.ts   （12 条）
```

覆盖：external 传参、闭包推导（**用真实 node_modules 实跑**）、manifest 落地、
`.bat` 按清单拷贝并校验、`.bat` CRLF、`.ps1` BOM、冒烟脚本强度、
两条便携链的构建期守卫、electron-builder 的 `extraResources` 派生、插件依赖声明。

## 6. 版本一致性

发布前核对四处（`build-desktop-portable.ps1` 的 [5/5] 会强制前两项）：

```text
version.py                    ← 单一数据源
web/package.json
desktop/package.json
git tag
```

## 7. 体积基线（2026-10-08，含插件）

| 产物 | 体积 |
| --- | --- |
| `dist\bun-server\server.js` | 20.6 MB |
| `dist\bun-server\bun.exe` | 94 MB |
| `dist\bun-server\node_modules\`（sharp + 插件栈） | 约 40 MB |
| `..\MaxmaHere-Portable\` | 约 201 MB |
| `dist\electron-portable\...zip` | 245.6 MB（清掉累积的旧 hash chunk 后） |

插件带来的增量约 **+20MB**（Web 包）—— 插件本体 9.8MB + 23 个依赖。
