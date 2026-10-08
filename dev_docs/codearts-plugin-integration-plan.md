# Jet Hub 插件移植计划（把 dsh-codearts-auth 改造为 Maxma 插件）

> 建立日期：2026-10-07
> 目标仓库：`https://gitee.com/iJetLi/deepseek-harness-codearts`（`dsh-codearts-auth` v0.2.0-rc.3 / npm `1.0.261007`）
> 调研期的本地只读参考检出与探针沙箱放在仓库外，已在根 `.gitignore` 忽略（不入库）

## 0. 定位：这是 **Maxma 的插件**，不是「在 Maxma 里跑 DSH」

Maxma 的 Agent 引擎是 **pi**（`@earendil-works/pi-coding-agent`，kernel in-process）；
目标仓库是给 **DSH**（DeepSeek Harness / Cordis 插件体系）写的插件。两者不是同一个框架。

因此本移植的判据是：**凡用户可见的面，必须是 Maxma 的**；DSH 的包只作为该插件**自身代码**的
运行时依赖存在，不出现在 Maxma 的产品面上。

| 面 | 归属 | 说明 |
| --- | --- | --- |
| 模型接入 | **Maxma / pi** | 插件注册的 provider 路由经 pi 的 `registerProvider({ streamSimple })` 变成 pi 模型，出现在 Maxma 模型选择器里 |
| 管理界面 | **Maxma / Vue** | Jet Hub 页面是 Maxma 的 Vue 路由页，不是 React bundle + `window.__ModuleLoader__` |
| 插件管理 | **Maxma / 注册表** | 启用/停用/配置走 Maxma 的插件注册表与 `routes/plugins.ts` |
| REST 面 | **Maxma / Hono** | Jet Hub 的 55 个 RPC 方法以 Maxma 路由形式暴露 |
| 数据落盘 | **Maxma 数据目录** | `data/plugins/**`，便携模式随包走；不写 `~/.dsh` |
| Cordis / dsh-llm / dsh-credentials | 插件内部实现细节 | 插件 `import` 了它们的**运行时导出**（`LlmAdapter` 基类、`credentialRef`、错误码…），换掉等于重写两个基础包 —— 见 §3 决策 |

## 1. 已核实的事实（含证据）

### 1.1 目标仓库规模

| 项 | 值 |
| --- | --- |
| `src/`（宿主侧 TS） | 169 文件 / **88,865 行** |
| `plugin-src/`（客户端 JS） | 13 文件 / 13,816 行 |
| `tests/unit` | **278 个 spec** 文件 / 102,942 行（含 e2e 38 个，默认 skip） |
| 产物 | npm 已发布 `dsh-codearts-auth@1.0.261007`，含预编译 `lib/`（646 文件，8.36 MB 解包）—— **无需自行构建** |
| 能力 | 14 个 provider 路由 + 1 个聚合路由；多账号池、OAuth/设备码/QR/微信登录、token 静默续期、积分查询/签到/领取、模型目录与黑名单、限流轮换、用量徽标、Token 账本、本机 OpenAI 网关、账号备份导入导出 |

### 1.2 宿主契约（已实测）

插件入口：`name='codearts-auth'`、`inject=['credentials','commands','llm']`、`apply(ctx)`、`Config` schema。
最小宿主只需提供 4 个服务，其余（`logger`/`effect`/`plugin`/`get`/`provide`/`on`/`emit`）由 Cordis 自带：

- `credentials` —— DSH 只给抽象类 `CredentialProvider`，**必须宿主实现**（4 个方法：`resolve`/`set`/`unset`/`describe`；记录半边插件几乎不用）；
- `llm` —— `@deepseek-ai/dsh-llm` 的 `LlmRuntime`，**具体类可直接复用**；
- `commands` —— **死依赖**（全 src 零 `ctx.commands.*` 调用），只为放行注入闸门，用 `CommandRuntime` 占位即可；
- `settings`、`attachments`、`connection.fetch.register`、`agents`、`profileContext` —— **全部可选**，缺失时插件自行降级（settings 缺失 → 落 `state.json`）。

**实测结果（Node 22.23.2 与 Bun 1.3.14 均通过）**：这样一个宿主能让插件**原样加载**，
注册 **15 条 provider 路由**（codearts / buddy / workbuddy / lobsterai / qoder / qodercn /
trae / cline / loomy / raccoon / minimax / zcode / opencode / gemini / jet-hub-auto）
与 12 个 `*Auth` 服务。

### 1.3 Maxma 侧现状

- `bun-backend/src/routes/plugins.ts` 原本是 **100% 桩**（读恒空/404、写恒 501）。
  → **本轮已替换为真实实现**（见 §4）。
- 前端 `PluginListView.vue` / `PluginDetailView.vue` / `stores/plugin.ts` /
  `components/plugins/**` / `api.listPlugins…` **早就写好了**，但 `/plugins` 两条路由
  被 redirect 到 `/extensions`，所以是**死代码**（未被任何组件 import）。
- 能力清单 `features.plugins` 原本 `{enabled:false}`；本轮改为 `{enabled:true, marketplace:false}`。
- Maxma 的模型扩展缝：`bun-sidecar/src/kernel/model.ts` 的 `resolvePiModel()`；
  现成范例是内置免费通道 `bun-sidecar/src/kernel/opencode-zen.ts` ——
  它用 `modelRuntime.registerProvider(id, { ..., streamSimple })` 把自定义传输接进 pi。
  **这就是本插件接入 Maxma 的落点。**

## 2. 架构（目标形态）

```text
Maxma (pi / Vue / Hono)                     插件（Jet Hub，进程内）
──────────────────────────────────────────  ──────────────────────────────────────
web 插件页（Vue 路由 /plugins/jet-hub）  ──►  REST /api/plugins/jet-hub/rpc
                                                 │
bun-backend/src/routes/plugins-jet-hub.ts  ──►  jet-hub-rpc 的 55 个方法
                                                 │
pi ModelRuntime.registerProvider(route,         │
     { api, models, streamSimple })  ◄──── pi 桥：prepareCall(provider,model).stream(opts)
                                                 │
Maxma 会话（chat-ws → kernel）              DSH LlmRuntime（进程内注册表）
                                                 ▲
maxma 凭据服务（MaxmaCredentialProvider）──►  ctx.credentials
                                                 ▲
data/plugins/dsh/**（state.json 等）      Cordis Context（宿主装配）
```

## 3. 关键决策与理由

**决策：宿主侧复用插件的已验证实现，不重写。** 依据：

- 插件对 DSH 的依赖是**类型 + 少量运行时导出**（`LlmAdapter` 基类、`credentialRef`、
  `LlmError`、错误码常量…），不是对 DSH 应用的依赖；
- 宿主 shim 本体只需约 300–600 行；而原生重写是 88,865 行 + 278 个单测 + 重踩
  AGENTS.md 记录的数十起线上事故（DPoP 终态误判、全池 401 被封 24h、0.1.7 消息形状迁移…）；
- 关键是**产品面归属**（§0 表格）：模型走 pi、界面走 Vue、管理走 Maxma 注册表 —— 这三条
  决定「它是不是 Maxma 的插件」，与插件内部用哪个注册表类无关。

**客户端不采用 React bundle。** 理由：产物依赖 `window.__ModuleLoader__` + React +
6 个 DSH 客户端服务，塞进 Vue 等于同跑两个框架；且 `--dsw-alias-*` 主题变量在 Maxma 里
会退化成浅色硬编码。改用：**RPC 契约逐字保留 + 19 个纯逻辑模块直接复用 + CSS 复制并补主题变量 + 视图层用 Vue 重写**。

## 4. 已交付（按轮次）

### Round 9（P4d 第二片）：**备份与迁移**

| 交付 | 文件 | 验证 |
| --- | --- | --- |
| 备份面板（状态 / 导出下载 / 选文件导入 / 导入回执逐项展示） | `web/src/stores/jetHub.ts`、`views/JetHubView.vue` | `web/tests/jetHubPanels.spec.ts`（12 条，含 5 条备份语义） |

**两条与直觉不符、已由源码 + 真机确认的事实**（都做成了界面上的显式警告）：

1. **导出含明文凭据**。`payload.credentials."<REF>"` 是完整凭据 JSON —— 导出前二次确认，
   并提醒「不要提交到仓库或转发」。
2. **导入是整体替换，不是合并**。RPC `backup.import` **没有模式参数**
   （`importBackup(credentials, pool, raw)` → `pool.replaceAll(...)`）。
   README 里写的 replace / merge 两种模式与这个已发布版本不符。
   插件专门提供 `backup.status`，就是让界面在覆盖前告知「有 N 个账号会被替换」——
   界面照它的设计意图用上了。

**真机往返验证**：
```
backup.status 前  → {"accounts":1,"withoutExpiry":1}
backup.export     → payload 顶层键 format,version,exportedAt,credentials,accounts,
                    disabledModels,permanentLocks,loomyPermanentLocked（凭据 1 条 / 账号 1 条）
backup.import {payload} → {"credentialsImported":1,"accountsImported":1,"skipped":[],
                           "expiredAccounts":0,"missingCredentials":0}
backup.status 后  → {"accounts":1,"withoutExpiry":1}          ← 往返稳定
backup.import（不包 payload，直接传快照）→ 被拒：备份内容不是对象  ← 客户端必须发 { payload }
```

**真机又探到一个类型 bug 并已修**：`skipped` 是**数组**（被跳过条目明细），不是计数 ——
我先前写成 `number`，界面会渲染出 `[object Object]`。现在按 `unknown[]` 处理并显示条数。

### Round 8（P4d 第一片）：**用量 / 网关 / 积分面板**

| 交付 | 文件 | 验证 |
| --- | --- | --- |
| Token 用量面板（`usage.tokenLedger` + `usage.tokenLedgerHistory`：合计网格 + 按渠道 + 历史采样数） | `web/src/stores/jetHub.ts`、`views/JetHubView.vue` | `web/tests/jetHubPanels.spec.ts`（7 条） |
| 本机网关面板（读运行时状态 + 写**插件配置**的开关，明确「需重启后端」） | 同上 | 同上 |
| 积分（`credits.balances` 按渠道 + `credits.claimAll` 一键领取，汇总**按单位分列**） | 同上 | 同上 |
| 网关开关成为真实插件设置（默认关），宿主装配时注入 env | `bun-backend/src/plugins/registry.ts`（configSchema）、`plugins/dsh/index.ts`（`resolveDshHostOptions()`） | `tests/plugins/dsh-host.test.ts`（+2 条） |

**真机验证（后端实跑 + HTTP）**：
```
POST /api/jet-hub  usage.tokenLedger        → {requests:0,…,errors:0}
POST /api/jet-hub  usage.tokenLedgerHistory → history=0
POST /api/jet-hub  gateway.getEnabled       → enabled=true running=false blockedByEnv=true models=7
POST /api/jet-hub  credits.balances trae    → {accounts:[], windowDays:15}
POST /api/jet-hub  credits.balances cline   → {accounts:[]}
GET  /api/plugins/codearts-auth/config      → {}                        ← 默认
PUT  /api/plugins/codearts-auth/config      → {gatewayEnabled:true}      ← 写入成功
GET  /api/plugins/codearts-auth/config      → {"gatewayEnabled":true}    ← 持久化
GET  /api/plugins/codearts-auth             → config_schema 含 gatewayEnabled；restart_required=true
```

**真机探到一个 UX 缺陷并已修**：`gateway.getEnabled` 回的是**插件自己的偏好**（默认 `enabled:true`），
而 Maxma 默认关（env 挡住，故 `blockedByEnv:true`）。若按钮跟着插件偏好走，会显示「停用网关」，
用户点下去写的却已经是 `false` —— 完全对不上。现在界面**分成两行**：`Maxma 设置`（按钮以此为准）
与 `插件运行时`（运行中/未监听），并说明「启用后需重启后端」。

### Round 7（P4c）：**浏览器授权登录**

| 交付 | 文件 | 验证 |
| --- | --- | --- |
| 登录会话（`account.create` → 出示 loginUrl → 轮询 `login.poll` → 终态）+ 取消 + 能力边界 | `web/src/stores/jetHub.ts` | `web/tests/jetHubLogin.spec.ts`（6 条） |
| 登录卡片 UI（授权链接 + 复制 + 轮询计数 + 取消/关闭 + 成功回执） | `web/src/views/JetHubView.vue` | `vue-tsc` 零错误 |

**流程（13 个渠道同形，源码 + 真机确认）**：
```
account.create { provider } → { accountId, loginUrl }   ← 立即返回，界面马上能显示链接
                              （插件同时在账号池放一条无凭据占位条目，后台跑登录）
用户在浏览器授权
login.poll { accountId }    → { done:false } … → { done:true, success:true }
```
- **能力边界**：`opencode`（有自己的 `opencode.addAccount`）与 `jet-hub-auto`（聚合伪路由）
  回 `bad-request: unknown provider` —— 界面据此禁用按钮并说明原因，不发无谓请求。
- **终态语义**：done / timeout / cancelled / error 四态齐全；单次轮询失败不判死会话
  （插件侧登录仍在后台跑），连续 5 次才判 error。
- ⚠️ 这条链路有**可见副作用**（插件可能拉起系统浏览器、开回环回调端口），故独立成一次会话，
  带明确取消入口，不混进批量动作。

**真机验证（step 1，用 buddy —— 它的分支显式传 `openBrowser: () => {}`，不会弹浏览器）**：
```
account.create {provider:"buddy"} → ok
  accountId : buddy-4ca9e11b
  loginUrl  : https://copilot.tencent.com/login?platform=ide&state=4b38ebe7-…
login.poll  (未授权)              → { done:false }        ← 凭据未写入，判定正确
account.delete {accountId}        → 账号数回到 0           ← 取消/清理路径可用
```
> 完整走完需要真人在浏览器里授权，属于用户侧动作；界面侧的可测部分（发起、出示链接、
> 轮询收敛、取消、清理）已全部覆盖。

### Round 6（P4 第二片）：**写操作接通**

| 交付 | 文件 | 验证 |
| --- | --- | --- |
| store 写操作（渠道启停 / 模型停用 / 账号测试·续期·删除 / 重置限流），入参逐字对齐插件校验 | `web/src/stores/jetHub.ts` | `web/tests/jetHubStore.spec.ts`（10 条，含逐字 payload 断言） |
| 页面按钮接线（渠道开关、模型启停、账号操作、重置限流、删除二次确认、动作回执） | `web/src/views/JetHubView.vue` | `vue-tsc` 零错误 |

**真机验证（写操作真的落库）**：
```
provider.status trae            → closed=false
provider.setEnabled false       → ok；再查 closed=true     ← 关闭生效
provider.setEnabled true        → 再查 closed=false        ← 恢复生效
model.setDisabled <首个模型> true → 再查 disabled=true      ← 停用落库
model.setDisabled ... false     → 再查 disabled=false      ← 回滚落库
account.reset {}                → {clearedCount:0, accountCount:0}
account.test {accountId:"NOPE"} → bad-request「账号 NOPE 不存在」（界面可直接展示）
```

### Round 5（P4 第一片）：**Jet Hub 管理界面（只读）**

| 交付 | 文件 | 验证 |
| --- | --- | --- |
| 管理界面的数据源（渠道清单由后端从插件运行时转出，**前端不硬编码**） | `bun-backend/src/routes/plugins.ts`（`GET /api/plugins/:name/providers`） | `tests/plugins/registry-routes.test.ts` |
| Jet Hub store（渠道清单 / 状态 / 账号，read-through 不做本地增量） | `web/src/stores/jetHub.ts` | `web/tests/jetHubStore.spec.ts`（5 条） |
| Jet Hub 页面：左侧渠道 rail（已打开/已关闭）+ 右侧渠道面板（模型/账号/模型列表） | `web/src/views/JetHubView.vue` | `vue-tsc` 零错误 |
| 路由 `/plugins/:name/jet-hub` + 插件详情页「打开管理界面」入口 | `web/src/router/index.ts`、`views/PluginDetailView.vue` | `web/tests/pluginRoutes.spec.ts` |

**真机验证（后端实跑 + HTTP）**：
```
GET /api/plugins                              → [{name:"codearts-auth", enabled:true, category:"integration"}]
GET /api/plugins/codearts-auth/providers      → 15 个渠道（codearts→CodeArts Agent, buddy→CodeBuddy (腾讯), …）
POST /api/jet-hub  provider.status {providers:[15 ids]}
                                              → 15 条状态（codearts models=9 / buddy 16 / trae 28 / jet-hub-auto 0，
                                                 accounts 与 closed 均如实回传）
```
即：**界面所需的全部只读数据已可端到端取到**。本片刻意只做只读 —— 写操作
（登录、续期、启停、领取积分、备份）的方法入参形状尚未核对，按钮做成显式禁用
而不是假装可用。

### Round 1–2：插件子系统 + 宿主

| 交付 | 文件 | 验证 |
| --- | --- | --- |
| DSH 兼容宿主（Cordis 装配 + 状态隔离 + 动态加载 + 卸载） | `bun-backend/src/plugins/dsh/host.ts` | `tests/plugins/dsh-host.test.ts` |
| Maxma 凭据服务（`CredentialProvider` 实现，YAML 落盘、串行写、不泄值） | `bun-backend/src/plugins/dsh/credential-provider.ts` | 同上 |
| 插件注册表（描述符 + 用户态、启用/停用/配置持久化、装配清单） | `bun-backend/src/plugins/registry.ts` | `tests/plugins/registry-routes.test.ts` |
| 真实插件 REST（替换 501 桩，形状对齐前端既有契约） | `bun-backend/src/routes/plugins.ts` | 同上 + `tests/routes-2.5.test.ts` |
| 插件数据路径 + 能力开关打开 | `app-paths.ts`、`routes/capabilities.ts` | 同上 |

### Round 3（P1）：**模型接进 pi**

| 交付 | 文件 | 验证 |
| --- | --- | --- |
| pi ⇄ 插件 双向翻译（报文/工具/事件流/usage/终态） | `bun-backend/src/plugins/dsh/pi-bridge.ts` | `tests/plugins/pi-bridge.test.ts`（10 条） |
| 「插件路由 → pi provider」注册器（懒注册、只接管插件路由） | `bun-backend/src/plugins/dsh/pi-providers.ts` | 同上 |
| kernel 侧注册器插槽（保持引擎层不反向依赖后端） | `bun-sidecar/src/kernel/plugin-models.ts`、`kernel/model.ts` | `bun-sidecar` 83 条全绿 |
| 启动装配（fire-and-forget，不拦 Maxma 启动） | `bun-backend/src/plugins/dsh/index.ts`、`server.ts` | 真机脚本验证：15 条路由可达 |

### Round 4（P2）：**管理面接进 Maxma**

| 交付 | 文件 | 验证 |
| --- | --- | --- |
| `connection` 服务（`connection.fetch.register` 契约） | `bun-backend/src/plugins/dsh/connection.ts` | `tests/plugins/http-bridge.test.ts` |
| 插件 HTTP 端点通用转发中间件（路径+方法查表，挂在鉴权之后） | `bun-backend/src/plugins/dsh/http-bridge.ts` | 同上 + 真机 HTTP 验证 |
| 挂载到 Hono（含鉴权边界） | `server.ts` | 见下 |

**真机验证（后端实跑 + HTTP）**：
```
GET  /api/health                                    → 200 (v2.6.11)
POST /api/jet-hub   (带 X-Maxma-Token, account.list) → 200 {"result":{"ok":true,"value":{"accounts":[]}}}
POST /api/jet-hub   (不带 Token)                     → 401   ← 插件端点与 Maxma 其它 API 同受保护
GET  /api/jet-hub                                    → 404   ← 转发不越权匹配，其余路由不受影响
```
插件自报注册的端点为 `POST /api/jet-hub` 与 `GET /api/jet-hub/captcha-carrier`（后者是 ZCode
captcha 载体页）。**55 个 RPC 方法由此全部可达**，界面层不再需要任何后端改动。

### 前端（P3 起步）

| 交付 | 文件 | 验证 |
| --- | --- | --- |
| `/plugins`、`/plugins/:name` 由 redirect 改为真实路由 + `meta.feature:'plugins'` 守卫 | `web/src/router/index.ts` | `web/tests/pluginRoutes.spec.ts` |
| 导航入口（`/extensions` 更名「扩展」，新增「插件」走 `/plugins`）+ 设置菜单 | `Dock.vue`、`AppSettingsMenu.vue` | 同上 |

> 关键背景：这四类前端文件（`PluginListView` / `PluginDetailView` / `stores/plugin.ts` /
> `components/plugins/**`）**早就写好了**，但两条路由是 redirect，导致它们从未被 import、
> 从未被打包、也从未被 `vue-tsc` 检查过。接回去后 `vue-tsc --noEmit` 依然零错误。

**当前测试基线**：后端 177 / 引擎 83 / 前端 222，全部 0 失败。

## 5. 坑与铁律（踩过的，别再踩）

1. **`ctx.plugin()` 必须 await**：服务要等 fiber 装配完才可见，立刻 `ctx.get()` 拿到 `undefined`。
2. **类插件要传「类 + config」，不能传实例**：传实例报 `invalid plugin, expect function or object with an "apply" method`。
3. **Cordis 服务类里不能用 ES `#private`**：服务实例被包成 Proxy，私有字段品牌检查必失败
   （实测 `Cannot access private method or acessor`）。用下划线前缀成员。
4. **env 必须在 `import` 插件之前设置**：插件多个模块在模块作用域求值路径/开关
   （`ZCODE_HOME = homedir()`、`trae-product` 通道表…），import 后再改无效。
5. **`.credentials.yaml` 的位置与形状不能改**：`state.json` 丢失时，插件唯一兜底是
   **文本扫描** `$DSH_HOME/.credentials.yaml` 的顶格 `refs:` 段重建账号索引。
   形状不对 → 账号静默「消失」且不报错。
6. **`Bun.YAML.stringify` 输出流式风格**（整份压成一行 `{version: 1,refs: {...}}`），
   按行扫描的消费者读不到 → 需要块状 YAML 时用 `yaml-store.writeTextAtomic` + 手工拼接。
7. **插件内部生产派发只走 `adapter.prepareCall().stream(options)`**，从不调顶层 `adapter.stream`；
   所以必须用真的 `LlmRuntime`（本方案正是如此），自研 llm 服务会让 Token 记账与失效模型剔除**静默失效**。
8. **重复注册的报错形状要匹配**（`DUPLICATE_DIRECTORY` 或 `already declared/registered` 文案），
   否则 fiber 重启竞态会把整棵树打挂。
9. **停用/启用不热生效**：插件装配在启动时完成，界面必须如实显示「需重启」
   （`restart_required`），不能假装已生效。

## 6. 后续阶段与验收判据

| 阶段 | 内容 | 验收判据 |
| --- | --- | --- |
| ~~P1~~ ✅ | ~~**pi 桥**：把插件 15 条路由注册成 pi provider（`registerProvider({ api, models, streamSimple })`），`streamSimple` 内调 `prepareCall().stream()` 并把 DSH `StreamChunk` 翻成 pi `AssistantMessageEventStream`~~ | 已交付：10 条翻译单测 + 真机 15 路由可达 |
| ~~P2~~ ✅ | ~~Jet Hub RPC 桥：插件 `connection.fetch.register` 的端点接进 Maxma（鉴权之后），信封与 `ok:false → error{code,message}` 逐字保留~~ | 已交付：真机 HTTP `account.list` 返回 `ok:true`、无 Token 401 |
| P3（进行中） | 前端接线收尾：`/plugins` 路由与导航已通；补 `PluginListView` 的真实数据渲染回归测试 | 列表页渲染注册表数据、守卫在 `plugins.enabled=false` 时重定向 |
| ~~P4~~ ✅ | ~~管理页骨架 + 渠道 rail + 只读面板~~ ✅ 已完成。**下一步：写操作**——先探明 `provider.setEnabled` / `account.create` / `account.refresh` / `account.test` / `account.reset` / `account.update` / `account.delete` / `credits.claimAll` / `credits.balances` / `model.setDisabledMany` 的入参形状，再逐面板接按钮（登录流程要处理插件开系统浏览器 + 回环回调：`login.poll` 是轮询式） | 每个写操作一条契约测试（成功 + 插件回 `ok:false` 两条路径） |
| ~~P4b~~ ✅ | ~~其余面板：积分与额度、网关、Token 账本、备份、会话内用量徽标~~ | 已交付：Rounds 8 / 9 / 12；纯逻辑模块以**插件自带单测**验收（74 条） |
| P5 | 全功能对齐盘点：对照 §1.1 能力清单逐项打勾，缺口登记 | 一张「能力 → Maxma 落点 → 测试」对照表，无未登记缺口 |

### Round 18（方案 A）：**插件随包 —— 便携版可用**

前一轮发现的问题：**便携包里插件不工作**（开发模式完全正常，所以此前所有验收都漏掉了它）。
本轮按方案 A 修掉并验证。

#### 根因（与最初猜测不同）

第一直觉是「bundle 里的动态 import 被改写」。孤立复现（`bun build` 一个小文件 + 变量
specifier）显示 import 其实是好的 —— 所以插桩到真实现场，拿到了真正的错误：

```
[plugins] 插件子系统启动失败：ResolveMessage: Cannot find module
          '../package.json' from 'D:\...\portable\server.js'
```

这句来自 **`@deepseek-ai/dsh-llm`**：它在模块作用域执行
`createRequire(import.meta.url)("../package.json")` 填 `APP_IDENTITY.version`。
被内联进 server.js 后 `import.meta.url` 变成 server.js 的位置，`../package.json`
就跑到便携包**上一级目录**去了。外层只表现为
「invalid plugin, expect function or object with an apply method, received undefined」——
完全看不出是版本号读取引起的。

> 教训：这个错误在 `import` 阶段抛出，而我的 `loadModule` 把它包成了「插件未就绪」，
> 把真实原因吞掉了。**插桩打一行 `console.error` 比继续推理快得多。**

#### 改法

1. **`build-server.mjs`**：把插件栈标为 `external`，不内联。
   清单**不手写**，而是从 `package.json` **递归求依赖闭包**（`dependencies` +
   `peerDependencies`）——手写清单实测漏过 `dsh-commands` 依赖的
   `@deepseek-ai/dsh-attachment`，只在便携包启动时才报模块找不到。
   闭包结果（23 个包）落地成 `dist/bun-server/externals.json`。
2. **`build-server.bat`**：读 `externals.json` 逐包 `xcopy`（不整树拷贝，避免便携包
   塞进未使用的包），拷完逐个校验 `package.json` 可解析，并对清单条目数设下限
   （防「清单被截断却报成功」）。
3. **`build-portable.bat` / `build-desktop-portable.ps1`**：在构建期就校验
   `externals.json` + 插件本体 + `dsh-llm` 存在 —— 缺了只会在运行时表现为
   「插件静默不工作」，极难归因。
4. **`portable-smoke-test.ps1`**：原来的检查只是「`/api/plugins` 返回 200」，
   而那个端点读的是**注册表 JSON 文件**、根本不碰插件运行时 —— 插件栈缺失时它照样 200。
   改为校验：插件已注册且启用 → **`/plugins/codearts-auth/providers` 有 ≥15 条路由**
   （这才证明插件真的加载了）→ `externals.json` 声明的包一个不缺。

#### 验证

真实构建脚本端到端跑通：
```
[3/4] Bundling backend (server.js)...
[bundle] server.js 20.6MB
[bundle] externals OK (23 个包保留为运行时依赖)
[bundle] externals manifest -> dist\bun-server\externals.json
[4/4] Staging runtime (bun.exe + sharp native modules + plugin stack)...
      plugin stack staged (23 packages)
```

便携布局实跑（`server.js` + `bun.exe` + `node_modules` + `portable.flag` + `data/`）：
```
health                                    → ok
GET /api/plugins/codearts-auth/providers  → 15 条（codearts→CodeArts Agent, buddy→CodeBuddy (腾讯) …）
GET /api/plugins/codearts-auth/models     → 15 渠道 / 7 模型（与开发模式一致）
POST /api/jet-hub  account.list           → ok=true
POST /api/jet-hub  usage.badgePreference  → ok=true preference=auto
POST /api/jet-hub  provider.status        → codearts.models=9 trae.models=28
```

冒烟脚本（含本轮新增的三项插件校验）：
```
[portable-smoke] plugins: 1 registered
[portable-smoke] plugin provider routes: 15
[portable-smoke] externals: 23 declared, 0 missing
[portable-smoke] PASS: portable bundle startup + all verification points OK
```

体积代价：`node_modules` 由约 12MB 增至约 26MB（基线便携包 181MB）。

#### 回归测试

`bun-backend/tests/plugins/portable-packaging.test.ts`（9 条）锁住这套契约：
external 传参、闭包推导**用真实 node_modules 实跑一遍**、manifest 落地、
`.bat` 按清单拷贝并校验、`.bat` 保持 CRLF、冒烟脚本校验插件真的加载、
两条便携链的构建期守卫、以及「插件依赖必须在插件自己的 package.json 里声明」。
### Round 17（P11 续）：**真实对话跑通 —— 又抓三个契约缺陷，现已打通**

不再满足于「接口都在」，而是**通过插件渠道真实跑了一轮对话**（全部走生产链路：
WebSocket → chat-ws → pi ModelRuntime → 插件 DSH 适配器 → 真实上游 → 流式回包）。

用 `opencode` 渠道（它的匿名槽无需浏览器登录就有 6 个可用模型，是唯一能自动验证的渠道）：

```
ws open → 发送 prompt（provider=opencode model=big-pickle）
事件序列 = hello > thinking_start > thinking_delta > token > thinking_end > answer > done
事件总数 = 12
模型回复 = "收到"
```

**这一轮又连抓三个契约缺陷**（每一个都只在「真正发请求」时才现形，接口检查全过）：

| # | 现象 | 根因 | 修法 |
| --- | --- | --- | --- |
| 1 | `No API key for opencode/big-pickle` | pi 的 `AgentSession.setModel()` 先 `await checkAuth(provider)`；插件渠道注册时没有 key，前置检查为假 | 注册后用 `setRuntimeApiKey(provider, 'plugin-managed')` 放行（与 Maxma 给 providers.yaml 渠道注入密钥同一个官方 API；真实鉴权仍在插件适配器内） |
| 2 | `no adapter registered for provider "undefined"` | dsh-llm 的 `LlmRuntime.prepareCall(**config**, signal)` 吃的是**整份配置对象**，我按 `(provider, model, signal)` 位置参数调用 → `config.provider === undefined` | 改成传整份 `config`；`PluginCallSource.prepareCall(config, signal)` 接口同步改造 |
| 3 | `The object can not be cloned.` | dsh-llm 对 config 做 `structuredClone`，而我把 `AbortSignal` 塞进了 config（AbortSignal 不可结构化克隆） | signal 改走第二位置参数；派发时再附到 stream 的 options（`callConfigEquals` 只比对 provider/model/reasoningEffort/temperature/maxTokens/stop，且派发路径不克隆） |

**三个都补了回归测试**，其中第 1 条用「模拟 pi 那条规则」的 runtime、第 3 条用真的 `structuredClone` 把配置锁死 ——
这样下次谁把 signal 塞回 config，测试会立刻红，而不是等到用户发消息才发现。
### Round 16（P11）：**端到端验收 —— 抓到两个真实阻断缺陷**

真实后端实跑（`bun run src/server.ts` + 真插件），走完整用户路径：

```
 1) GET  /api/health                              ok
 2) GET  /api/capabilities                        plugins.enabled=true  marketplace=false
 3) GET  /api/plugins                             [codearts-auth] enabled=true
 4) GET  /api/plugins/codearts-auth               builtin=true restart_required=true
                                                  config_schema 键: providers, gatewayEnabled
 5) GET  /api/plugins/codearts-auth/providers     15 条渠道路由
 6) GET  /api/plugins/codearts-auth/models        15 渠道 / 7 模型（374ms）
 7) POST /api/jet-hub  provider.status            ok=true，15 条渠道状态
 8) POST /api/jet-hub  usage.badge(trae)          ok=true preference=auto
 9) PUT  toggle enabled=false                     providers=0  models=0  detail.enabled=false
10) PUT  toggle enabled=true                      providers=15（registry.json 落盘确认）
```

**缺陷 1（阻断级）：`chat-ws` 把插件模型挡在门外。**
`chat-ws.ts` 原来对 providers.yaml 里查不到的 provider 一律抛「所选提供商不可用」——
而插件渠道**本来就不在那份文件里**（凭据与端点在插件自己的适配器内）。
后果：插件模型在 pi 侧能解析，**用户一发消息就报「所选提供商不可用」**。
修法：查不到时再问一句 `isPluginProvider(providerId)`，是插件渠道就走 pi 解析，
且**不传** baseUrl / apiKey / providerType（那些由插件适配器自己决定，传空值反而会覆盖）。

**缺陷 2（阻断级，且是静默的）：pi 拒绝没有 baseUrl 的自定义模型。**
真机错误：`Provider trae: "baseUrl" is required when defining custom models.`
而这个错误被 `registerPluginProviderOn` 的 try/catch 吞成一条 warn，
表现成「模型 not found in pi registry」——**很难联想到是缺 baseUrl**。
修法：注册时带占位 `baseUrl`，且**刻意用保留域** `https://plugin.invalid/<route>`：
万一哪天真被当 URL 用，会立刻响亮地失败，而不是悄悄打到别人的服务器上。
（这解释了一个反直觉现象：端到端跑之前 `opencode/big-pickle` 能解析、`jet-hub-auto/auto` 不能 ——
前者在 pi 内建目录里本来就有，后者的注册被这条规则拒了。）

**修复后复验**：
```
resolvePiModel opencode/big-pickle    -> name=big-pickle ctx=200000 api=openai-completions
resolvePiModel jet-hub-auto/auto      -> name=Auto（临期优先 · 整池） ctx=200000   ← 之前 THREW
resolvePiModel opencode-zen/mimo...   -> ok（内建免费通道不受影响）
isPluginProvider: opencode/trae/jet-hub-auto=true；opencode-zen/deepseek/''=false
```

**两条回归测试**（把教训钉住，而不是只修一次）：
`"注册必须带 baseUrl —— 否则 pi 会拒绝自定义模型（真机踩过）"`（用一个**模拟 pi 那条规则**的
runtime 把注册锁死）+ `isPluginProvider` 的两条分支（未装配恒 false / 装配后认得插件渠道）。

#### 关于「15 个渠道只有 7 个模型」——这不是 bug，是插件的门控

第 6 步的数字一开始让我以为模型没接上。查插件源码后确认是**刻意的**：

```
// llm-adapter.js  async listModels(_provider) {
//   ⚠️ 没有任何已登录账号时返回空数组 → DSH 的 buildModelCatalog 把整个 provider 分组隐藏
//   ⚠️ 必须返回 [] 而不能抛错（抛错会被归入 catalog 的 failures，界面上反而多出一条 provider 报错）
```

我的端点用的是**插件自己的适配器**（`llm.listModels`），所以自动继承了这套门控 ——
这正是模型选择器该有的语义：**没登录的渠道不出现**（而不是列一堆点了就报错的模型）。
对照真机：同一进程里插件的**管理视图** `model.list` 给出 trae 28 / qoder 17 / opencode 14
（那是 Jet Hub 的「显示列表」，不受门控），而选择器数据源给 7 个（只有真能服务的
opencode 匿名槽 6 个 + 聚合路由 `auto` 1 个）。用户登录某个渠道后，它的模型会自动出现。
### Round 15（P10）：**锁定永久积分 —— 功能缺口清零**

| 交付 | 文件 | 验证 |
| --- | --- | --- |
| 「锁定永久积分」开关（5 个渠道），文案整段来自搬运过来的 `permanentLockCopy()` | `web/src/stores/jetHub.ts`、`views/JetHubView.vue`、`utils/jetHub/credits-capabilities.js` | `web/tests/jetHubCreditsCapabilities.spec.ts`（9 条） |
| **跨包一致性**：Maxma 侧能力表 vs 插件宿主侧 provider 集合 | `bun-backend/tests/plugins/jet-hub-coverage.test.ts` | 1 条断言（含「插件新增 provider 就红」的数量守卫） |

**我原本打算做二次确认，读源码后改了主意。** 插件客户端对这两个端点**不做确认**：
它用一句解释清楚的 title + 直接切换 + 切换后的提示。照做 —— 给一个**可逆的行为开关**
套确认框只会让人麻木（真正需要确认的是备份导入那种不可逆动作）。
（插件笔记里说的「丢失不可逆」指的是 `permanent-locks.json` 这个**存储文件**的耐久性，
不是这个开关本身。）

**文案不是我自己写的**，整段来自搬运过来的 `permanentLockCopy()`：

```
buddy / workbuddy / trae / lobsterai（按到期时间分桶）：
  锁定永久积分后只消耗「{N} 天内到期」的积分包（那部分再不用就作废）。这类积分用尽后将没有可用账号。点此锁定。
loomy（服务端直接给两个命名池，没有窗口概念）：
  锁定永久积分后只消耗每日赠送额度（今日额度用尽即无可用账号），可保住永久积分。点此锁定。
```

**三条从插件事故史里带出来的约束**（都有用例守着）：
1. **N 必须用插件回的 `windowDays`**，不能写死 15 —— 它可被 `DSH_BUDDY_EXPIRING_WINDOW_DAYS`
   覆盖，写死会让文案与实际选号判据分叉；
2. **判据是「是否按到期时间分桶」不是「是不是 buddy」** —— `trae` / `lobsterai` 与 buddy 系
   走同一套分桶，若落到 Loomy 那套「每日额度」文案就是错的（它们没有这个概念）；
3. **窗口天数的边界**：`undefined` / `null` / `''` 必须回落默认（否则渲染出「只消耗 0 天内到期的
   积分」这种荒谬提示），但**数字 `0` 是合法值**（表示没有临时积分），不能被 `||` 静默换掉。

**真机验证**：
```
credits.permanentLock {provider:"loomy"}          → {provider:"loomy", locked:false}            ← 不带窗口天数
credits.permanentLock {provider:"buddy"}          → {provider:"buddy", locked:false, windowDays:15}
credits.permanentLock {provider:"trae"}           → {provider:"trae", locked:false, windowDays:15}
credits.permanentLock {provider:"loomy",locked:true}  → locked:true（再读仍是 true，已持久化）
credits.permanentLock {provider:"loomy",locked:false} → locked:false（解锁同样落库）
credits.permanentLock {provider:"cline"}          → bad-request「该 provider 不支持锁定永久积分：cline」
loomy.permanentLock {}                            → 历史别名可用，返回同一份状态
```

**跨包一致性断言**（这条比插件仓库里的同名断言更有价值）：在插件仓库里客户端能力表与宿主
provider 集合同属一个包；在 Maxma 里前者被搬到了 `web/src/utils/jetHub/`、后者还在 npm 包里 ——
任何一侧改动而另一侧没跟上，都会在这里红。它带一条**数量守卫**：插件新增 provider 时，
断言会先提示「请同步这份映射与客户端能力表」。
### Round 14（P9）：**渠道专属面板（4 个方法）**

| 交付 | 文件 | 验证 |
| --- | --- | --- |
| Cline 订阅额度（`cline.quota`）+ 请求日志（`cline.requestLog`，按账号） | `web/src/stores/jetHub.ts`、`views/JetHubView.vue` | `web/tests/jetHubChannels.spec.ts`（7 条） |
| Loomy / Raccoon 新人任务与登录奖励（`onboarding.status` / `claim`，按账号，含领取） | 同上 | 同上 |

**插件端点的硬限制（界面照做，避免用户在不支持的渠道点了才吃错）**：
- `cline.quota` 只认 `provider: 'cline'`；
- `cline.requestLog` 只认 cline，且 **accountId 必传** —— 面板用同一个账号同时切额度与日志；
- `onboarding.status` / `claim` **只支持 loomy 与 raccoon**，且必须带 accountId
  （真机确认其余渠道回 `unsupported provider`）。

**两条如实传达的语义**：
1. **请求日志是插件自己发出的请求流水**（进程内存，重启即丢），不是官方用量接口 ——
   面板明确写「请勿用它对外对账」，否则用户会拿去核对账单；
2. **失败行必须保留**（与成功行同表展示）：那是排查「为什么没回复」的第一线索。
   另外 Raccoon 的领取是**幂等**的，已领过时 `earned` 报**累计值**而不是 0
   （插件记录过这个真实缺陷），界面用「累计已领」而不是「本次新增」的口径展示。
### Round 13（P8）：**批量 / 排序 / 自动化开关（11 个方法）**

| 交付 | 文件 | 验证 |
| --- | --- | --- |
| 批量与排序：账号重测/全测/全量重置/更新(改名·启停)/排序、模型全停·全启/清理失效/批量启停、渠道排序、自动签到开关 | `web/src/stores/jetHub.ts`、`views/JetHubView.vue`、`components/chat/JetHubUsageBadge.vue` | `web/tests/jetHubBatch.spec.ts`（9 条，逐字锁 payload） |
| **原样搬运**「停用账号 → 是否同时关模型」的联动判定 + 其官方单测 | `web/src/utils/jetHub/account-model-link.js`、`.d.ts` | `web/tests/jetHubAccountModelLink.spec.ts`（14 条） |

**为什么值得为「停用账号」单独搬一个纯逻辑模块**：插件门控刻意**不看 `enabled`**
（停用只影响自动选号），于是停用某渠道**最后一个**启用账号后，它的模型仍留在模型选择器里 ——
用户看到「我都停用了怎么还能选到」。插件把这件事做成**一次显式选择**而不是替用户改门控语义，
判定逻辑就是 `disablingLeavesNoEnabledAccount()`。两条边界必须守住：

1. **只在「停用后不再有任何启用账号」时才问** —— 否则关掉全部模型纯属误伤；
2. **对已停用账号再点停用不问**（空操作），否则用户收到一个无从理解的确认框。

⚠️ 判定必须在**提交 `account.update` 之前**取：提交后列表已刷新，答案会变成变更后的状态，
多账号场景会误判。原版这条守卫读的是插件的 React 客户端（Maxma 里不存在），我把它**改为锁
Maxma 的 JetHubView**，同样的两条不变式，锁我们这边的实现。
### Round 12（P7）：**会话内用量徽标（插件 README 头号卖点）**

| 交付 | 文件 | 验证 |
| --- | --- | --- |
| **原样搬运**三个纯逻辑模块（`badge-model` / `credits-format` / `quota-format`）+ 类型声明 | `web/src/utils/jetHub/*.js`、`*.d.ts` | `web/tests/jetHubBadgeModel.spec.ts` |
| 徽标状态机（60s 轮询、隐藏页跳过、失败保留上次读数、偏好读写） | `web/src/stores/jetHub.ts` | `web/tests/jetHubBadge.spec.ts`（8 条） |
| 徽标组件 + 挂进聊天输入区（`ContextUsageBadge` 旁，对应插件的 `conversation.input.right` 槽位） | `web/src/components/chat/JetHubUsageBadge.vue`、`components/ChatInput.vue` | `vue-tsc` 零错误 |

**做法：把折叠态文案的口径整段搬运，而不是照着重写。**
`badge-model.js` + 它的两个依赖是**零 React 依赖**的纯逻辑（这正是插件当初把它们拆出来的原因），
所以整份复制进 `web/src/utils/jetHub/`，连它的**官方单测一起复制**并只改 import 路径：

```
web/tests/jetHubBadgeModel.spec.ts → 74 passed
```

**这 74 条是插件自己写的、锁「窗口 > 套餐包 > 积分」口径的用例，逐字未改。**
它们通过 = 折叠态口径的移植是忠实的；这比我自己写一批断言再自称"对齐"强得多。

**两条按插件踩坑记录保留的行为**（测试里各有一条用例守着）：
1. **首次读数未回 ≠ 没有账号**：前者走 `loading`（显示「读取中…」），否则首屏会说
   「未配置启用账号」，用户以为账号丢了（插件 2026-10-02 的真实报障）。
2. **读失败保留上次读数**，只有「首次且无数据」才进 failed（显示「用量不可用」）。

**另外**：判断「当前模型是不是插件渠道」用的是**后端给的渠道清单**
（`/plugins/:name/providers`），不在前端硬编码那 15 个 id —— 否则某渠道的徽标会永远不出现。

### Round 11（P6）：**OpenCode 账号池接通（5 个方法）**

| 交付 | 文件 | 验证 |
| --- | --- | --- |
| OpenCode 专属动作（手动 key 添加 / 匿名通道 / 出口代理 / 代理测试 / 指纹轮换） | `web/src/stores/jetHub.ts`、`views/JetHubView.vue` | `web/tests/jetHubOpencode.spec.ts`（7 条） |
| 覆盖清单更新：`opencode.*` 5 个移出未接表（测试会拦「已接却还留在未接表」） | `bun-backend/tests/plugins/jet-hub-coverage.test.ts` | 5 条断言全绿 |

**为什么 OpenCode 单列一块**：它是本插件里形态最特殊的渠道 ——
**唯一不跳浏览器**的登录（手动粘贴 API key，`sk-` + 20 位以上）、有「匿名通道」概念、
支持按账号设出口代理与指纹轮换。所以界面在 `opencode` 渠道下换成专属表单，
而不是复用渠道面板的浏览器授权按钮。

**真机验证（全部 5 个方法）**：
```
opencode.addAccount {apiKey:"nope"}            → bad-request「API key 形状不对（应以 sk- 开头、至少 20 位…）」
opencode.addAccount {apiKey:"sk-"+a*28}        → {accountId:"opencode-aaaaaaaa", existed:false}
opencode.addAccount 同一个 key 再来一次          → {accountId:"opencode-aaaaaaaa", existed:true}   ← 复用同一账号
opencode.addAnonymous {}                       → {accountId:"opencode-anon-ca8ce6", existed:false}
opencode.setProxy {}                           → bad-request「缺少 accountId」
opencode.setProxy {proxy:"ftp://nope"}         → bad-request「不支持的协议 ftp（仅支持 http/https/socks5）」
opencode.testProxy {proxy:"ftp://nope"}        → 同上（先校验协议才发请求）
opencode.rotateFingerprint {}                  → bad-request「缺少 accountId」
account.list {provider:"opencode"}             → 3 个账号
```

**两条按插件要求如实传达的领域事实**（写在面板文案里，不是可有可无的说明）：
1. **同一个 key 重复添加会复用同一账号** —— 否则用户会以为是两个独立额度桶，实际仍打在同一份额度上；
2. **匿名通道按出口 IP 限额**：换 key、换指纹都**不**增加配额，指纹分离只用于防关联；
   要多份额度只能给不同匿名通道配不同代理。

### Round 10（P5）：**方法面覆盖清单（可核对、防漂移）**

| 交付 | 文件 | 验证 |
| --- | --- | --- |
| 覆盖核查测试：从插件分派器现读方法面、从 `web/src` 现读调用，两边做差集；每个未接方法必须有登记原因，已接的不许留在未接表里 | `bun-backend/tests/plugins/jet-hub-coverage.test.ts` | 4 条断言（含「提取逻辑不空转」的自检） |
| 进度表落文档 | 本文档 §8 | 当前 50 个方法 / 已接 19 / 未接 31（全部登记原因） |

**为什么值得单独做这件事**：`全功能移植` 如果只是一句话，就永远无法判断做完了没有。
这个测试让清单**自己会红** —— 插件升级加了方法、或有人接了方法忘了更新清单，都会失败。
两边都是现读源码，手抄名单会漂移，而漂移的清单比没有清单更坏。

> ⚠️ 提取逻辑本身也有坑：第一版用 `callJetHub(?:<[^>]*>)?\(` 抓调用，遇到嵌套泛型
> （`callJetHub<Array<Record<string, unknown>>>('…')`）会在第一个 `>` 处截断，
> 结果**一个都抓不到**、清单变成永远通过的空转。测试里专门留了一条自检断言防这个。

### 已验证的 RPC 形状（P4 直接照用，无需再探）前端统一走 `callJetHub(method, payload)`（`web/src/api/index.ts`，含 `ok:false → JetHubError` 语义，
测试 `web/tests/jetHubRpc.spec.ts`）。以下形状均来自**真机离线调用**：

```
provider.status  { providers: string[] }        → { statuses: { <route>: { models:{total,disabled},
                                                                        accounts:{total,enabled},
                                                                        closed:boolean } } }
model.list       { provider }                    → { models: [{ id, name, disabled, dead }] }
usage.badgePreference {}                         → { preference: 'auto'|'subscription'|'credits' }
gateway.getEnabled {}                            → { enabled, running, blockedByEnv, address, apiKey,
                                                     models: [{ id, provider, model, name, input[] }] }
account.list     {}                              → { accounts: [...] }
```

⚠️ 两个坑：
- `aggregate.catalog` 回 **`bad-request: unknown method`** —— 聚合面板的方法名与分组表不一致，
  P4 做聚合面板时要先从 `jet-hub-rpc.js` 的 switch 里核对准确名字，别照分组表猜。
- `provider.status` **必须传 `providers` 字符串数组**，否则回 `bad-request: providers 必须是字符串数组`。

### ⚠️ 方法名以插件 switch 为准（分组表有错）

从 `lib/jet-hub-rpc.js` 的 `case '...'` 逐条提取的**权威**方法名里，**没有 `aggregate.*`** ——
早前按分组表猜的 `aggregate.catalog` 真机回 `bad-request: unknown method`。聚合渠道在方法面
就是 `jet-hub-auto` 这一个普通路由（用 `provider.status` / `model.list` 即可）。
完整集合见该文件的 case 标签（47 个 + `opencode.*` 5 个）。

### 已验证的写操作入参（真机探测：喂 `{}` 读它的校验文案）

| 方法 | 入参 | 来源 |
| --- | --- | --- |
| `provider.setEnabled` | `{ provider, enabled }` | 「provider 与非空布尔 enabled 必填」 |
| `provider.setOrder` | `{ order: string[] }` | 「order 必须是字符串数组」 |
| `model.list` | `{ provider }` | 真机 OK |
| `model.setDisabled` | `{ provider, modelId, disabled }` | 「provider 与 modelId 必填」 |
| `model.setDisabledMany` | `{ provider, modelIds: string[], disabled }` | 「provider、modelIds（数组）与 disabled（布尔）必填」 |
| `model.setAllDisabled` | `{ provider, disabled }` | 「provider 与 disabled（布尔）必填」 |
| `model.clearDead` | `{ provider }` | 「provider 必填」 |
| `account.test` / `account.refresh` / `account.delete` | `{ accountId }` | 「缺少 accountId」/「Account undefined not found」 |
| `account.reorder` | `{ provider, order }` | 「provider 必填」 |
| `account.reset` | `{}`（全局清限流冷却） | 真机 OK：`{clearedCount, accountCount}` |
| `account.create` | `{ provider }` → 返回 `loginUrl`+`state`，随后轮询 `login.poll` | 读源码确认（**会打开系统浏览器**） |
| `credits.claimAll` / `credits.balances` / `credits.status` / `credits.permanentLock` | `{ provider }` | 「unsupported provider: undefined」 |
| `onboarding.status` / `onboarding.claim` / `cline.requestLog` / `usage.badge` | `{ provider }` | 同上 |
| `gateway.setEnabled` | `{ enabled }` | 「非空布尔 enabled 必填」 |
| `backup.export` / `backup.import` / `backup.status` | `{}` | 真机 OK |
| `usage.tokenLedger` / `usage.tokenLedgerHistory` / `usage.autoCheckin` / `captcha.demand` | `{}` | 真机 OK |

⚠️ **`backup.export` 的返回里带明文凭据**（真机确认：`payload.credentials."<REF>"` 是完整凭据 JSON）。
它比其他方法敏感得多：界面上必须**显式二次确认 + 明示「包含全部账号凭据」**，
且不要把它塞进日志或诊断上报。

⚠️ 我原计划的 `account.create` 登录取号要**打开系统浏览器**并起回环回调端口 —— 属于有可见副作用
的操作，必须单独做 UX（提示 + 轮询 `login.poll` + 失败回退），不要混在批量动作里。

### P4 的既定做法（来自客户端侧调研，别再重新论证）- **RPC 直接用普通 HTTP**：前端调 `POST /api/jet-hub`，信封 `{type:'client-request', rpcId, method:'jet-hub', payload:{method, payload}}`；判定 `result.ok`，`ok:false` 时按 `error.code` 抛错。**逐字保留 `ok:false → throw` 语义**（这是插件客户端 `unwrapRpcResult` 的行为，丢了会把失败显示成成功）。
- **视图层用 Vue 重写**，不要把 React bundle 塞进来（它依赖 `window.__ModuleLoader__`、React 与 6 个 DSH 客户端服务）。
- **19 个纯逻辑模块可 1:1 搬运**（零 React 依赖）：`badge-model` `quota-format` `credits-format` `credits-capabilities` `credit-expiry` `model-filter` `model-groups` `model-bulk` `account-order` `account-model-link` `provider-toggle` `new-account` `openai-gateway-panel` `aggregate-panel-logic` `token-ledger-panel` `tokens-per-second` `backup-payload` `backup-convert` `backup-crypto`。
- **CSS 可整体复用**：`dim-jh-*` 前缀、无 `:root`、无 Tailwind；唯一耦合是约 207 处 `var(--dsw-alias-*, <hex>)`，需在 Maxma 侧补两套（浅/深）同名变量，否则深色模式丢失。容器要给确定高度（样式假设 `height:100%` 的两栏布局）。
- **必须一起搬的 UI 契约**：能力矩阵「发请求前门控」；网关/供应商状态「由宿主给定、前端只读不判」；停用最后一个启用账号时追问「是否同时关掉该渠道全部模型」；备份导入「裁剪必须在发请求前、`disabledModels` 不裁」。

## 8. 方法面覆盖清单（「全功能移植」的进度表）

**这份表不是手抄的**：`bun-backend/tests/plugins/jet-hub-coverage.test.ts` 从
`dsh-codearts-auth/lib/*.js` 的分派器里现读方法名，从 `web/src/**` 现读 Maxma 的调用，
两边做差集。规则：

- 插件升级后**新增**了方法 → 差集冒出新名字 → 测试红（去接，或去登记缺口）；
- 某方法被接上却忘了从未接表里删 → 测试红（清单不许骗人）。

当前：**方法面 50 个，已接 42 个；未接 8 个，其中 1 个是历史别名、7 个是形态/策略上本就不该接的 —— 功能缺口为 0**。

| 命名空间 | 已接/合计 | 未接 |
| --- | --- | --- |
| `account.*` | **11/11** | — |
| `backup.*` | **3/3** | — |
| `captcha.*` | 0/3 | carrierUrl, contribute, demand（desktop-only 载体） |
| `cline.*` | **2/2** | — |
| `credits.*` | 3/4 | status（与已接的 balances 重叠） |
| `gateway.*` | 1/2 | setEnabled（**刻意不用**：改用插件配置 + 重启） |
| `login.*` | 1/3 | sendSms, submitSms（Loomy 备用路径） |
| `loomy.*` | 0/1 | permanentLock（历史别名，已被 credits.permanentLock 覆盖） |
| `model.*` | **5/5** | — |
| `onboarding.*` | **2/2** | — |
| `opencode.*` | **5/5** | — |
| `provider.*` | **4/4** | — |
| `usage.*` | **5/5** | — |

**已接的 42 个**（除了下面 8 个，插件方法面已全覆盖）：
`provider.status` · `provider.setEnabled` · `account.list` · `account.create` · `account.test` ·
`account.refresh` · `account.delete` · `account.reset` · `model.list` · `model.setDisabled` ·
`credits.balances` · `credits.claimAll` · `usage.tokenLedger` · `usage.tokenLedgerHistory` ·
`gateway.getEnabled` · `backup.status` · `backup.export` · `backup.import` · `login.poll` ·
`opencode.addAccount` · `opencode.addAnonymous` · `opencode.setProxy` · `opencode.testProxy` ·
`opencode.rotateFingerprint` · `usage.badge` · `usage.badgePreference`

**未接的 8 个 —— 功能缺口为 0**，每一项都有明确归属：

| 未接项 | 归属 |
| --- | --- |
| `loomy.permanentLock` | **历史别名**：与 `credits.permanentLock` 同一实现、provider 固定 loomy（老客户端 bundle 在用）。Maxma 走现代端点 `{ provider: 'loomy' }` 即覆盖同一能力。真机确认两者都存在且行为一致。 |
| `captcha.carrierUrl` / `captcha.contribute` / `captcha.demand` | **形态不适用**：ZCode 的 captcha 内部载体依赖 `globalThis.dshDesktop` 协议与 `<webview>` 租约，Maxma 是 Web 形态 —— 插件在这些渠道上本就是**刻意的零动作**。 |
| `login.sendSms` / `login.submitSms` | **备用路径**：Loomy 的短信登录是备选，主路径（微信扫码）已通过 `account.create` 接通。 |
| `gateway.setEnabled` | **宿主策略差异**：Maxma 刻意改用「写插件配置 + 重启」，因为插件一旦看到 `DSH_OPENAI_GATEWAY_ENABLED` 停用，这个接口也不会让它监听端口（真机确认 `blockedByEnv: true`）。 |
| `credits.status` | **能力重复**：与已接的 `credits.balances` 重叠（真机确认两者回同一份余额数据的不同切面）。 |

> **结论：插件的功能面已全部搬进 Maxma。** 剩下 8 项中 7 项是形态/策略/重复问题，
> 1 项是历史别名。没有任何「本来该有但没做」的功能。

## 9. 安全与边界

- **不联网安装第三方代码**：`POST /api/plugins/install` 目前只启用已随包分发的插件；
  真正的网络安装必须先过安全评审（下载 → 解压校验 → 体积/条目上限 → 路径穿越防护 → 原子落盘，
  对照 `capabilities.ts` 的 skills 安装范式）。在那之前宁可返回 501 也不开洞。
- 插件的本机 OpenAI 网关默认**关闭**（`DSH_OPENAI_GATEWAY_ENABLED=0`），避免与 Maxma 抢端口；
  需要时由用户在 Jet Hub 页面显式开启。
- 凭据只落 Maxma 数据目录；`describe` 系列接口不返回值本体。
- 插件要 spawn 浏览器、绑回环端口、跑 headful Chromium（ZCode captcha）、读同目录 `.wasm`（Qoder）：
  这些在受限环境可能不可用，但**都不会让插件加载失败**（插件自身已降级），只影响对应渠道的登录/领取。


## 10. 全功能健康复查（PLUGIN-001 · 用户报障「积分刷新后还是 0」触发的系统性复查）

复查方法：**不靠眼查**。真机调用插件 RPC → 递归拍平真实返回结构 → 与界面实际读取的
字段做差集；参数名用空参调用的校验文案反向核对；按钮显隐与插件能力矩阵
（`credits-capabilities.js`）× 15 渠道逐项对照。

### 10.1 修掉的缺陷（7 处）

| # | 类别 | 位置 | 缺陷 | 影响 |
|---|---|---|---|---|
| 1 | 数据契约 | `credits.balances` | 把 `balance` 对象当数字读（真实余额在 `balance.total`，单位在 `packages[].unit`） | 积分恒显示 0（用户报障的那处） |
| 2 | 数据契约 | `account.list` | 不传 `provider`（插件严格等值过滤，`{}` 恒回 `[]`） | 账号列表永远为空，即使已登录 —— 与 #1 叠加成同一个人可见症状 |
| 3 | 数据契约 | `account.reorder` | 键名写成 `order`（应为 `orderedIds`；`provider.setOrder` 才用 `order`，两者不同名） | 拖排序没反应 |
| 4 | 数据契约 | `cline.quota` / `cline.requestLog` | 读不存在的 `summary` / `status` / `durationMs` | 两栏永远空白 |
| 5 | 数据契约 | `onboarding.status` | 把 `tasks` 当数组（实为三个平行 Record：tasks/titles/points） | 任务列表永远为空 |
| 6 | 能力门控 | 五个面板 | 只用了 permanentLock 一个门控：「一键领取」6 渠道空按钮、「账号测试」仅 gemini 支持、**Loomy 显示重测会白烧积分**、Cline/onboarding 用硬编码 | 无效按钮 / 用户资产损失 |
| 7 | 能力门控 | 聊天徽标 | `jet-hub-auto` 在渠道清单里但 `usage.badge` 不支持 → 每 60s 一个必然失败的请求 | 选自动选号时永久刷报错 |

### 10.2 复查中确认为健康（不需要修）的项

- 网关面板：`running/address/apiKey/models/blockedByEnv` 全部与真实形状一致。
- 备份：`export/import/status` 回执字段一致；`skipped` 是数组（明细）不是计数。
- 自动签到：`usage.autoCheckin` 返回 `{autoCheckin:{enabled,...}}`，store/模板读取一致。
- 重测/重置本身是池内本地操作（无标记时零请求、恒 ok）——门控它们的理由是
  Loomy 白烧积分（#6），不是「点了报错」。
- 聊天链路端到端（真机）：`chat-ws → resolvePiModel → pi-bridge → opencode 匿名通道`
  出 token 全通（事件序列 `hello → thinking → answer → done`）；`jet-hub-auto/auto`
  在无候选渠道时回干净可读的 AGENT_ERROR（自动适配器 v1 只接入
  codearts/loomy/zcode/buddy/workbuddy，是设计意图，非缺陷）。

### 10.3 防复发基建

- `bun-backend/tests/plugins/plugin-data-contract.test.ts`（12 条）：真机调离线端点、
  拍平真实结构、断言界面消费字段存在，每个修掉的缺陷留一条**反证**
  （如 `accounts[].unit` 不存在、`tasks` 不是数组、`rows[].status` 不存在）。
- `web/tests/jetHubCapabilityGating.spec.ts`（11 条）：能力表语义不得漂移 +
  源码契约（按钮必须带 v-if 门控、门控值必须来自能力矩阵、徽标必须挡 jet-hub-auto）。
- `web/tests/jetHubCreditRendering.spec.ts`（7 条，#1 时加）：余额渲染与源码契约。

### 10.4 诚实边界（未实机验证的部分）

- 13 个需真实登录的渠道的登录流（无凭据，无法 e2e）；参数名已过空参校验文案审计。
- `credits.claimAll` 在支持渠道上的真实领取（需要已登录账号）。
- 网关 `gateway.setEnabled` 的监听态（宿主策略刻意关闭，面板正确显示 blockedByEnv）。

## 11. 追加复查（用户实测触发：「插件正常了，但模型配置页看不见供应商、对话框选不了模型」）

用户实测插件管理面正常后，暴露**模型集成面**的两处断点。机制对照（插件侧
`llm-adapter.listModels` 的约定）：渠道账号池为空 → 返回 `[]`（不抛错）；登录后
→ 远端目录 + 静态兜底。所以数据链路本身是通的，断在两个 UI 消费端：

| # | 位置 | 缺陷 | 修复 |
|---|---|---|---|
| 8 | 模型选择器（ChatView） | 模型清单只在页面挂载/供应商变更时拉取；**Jet Hub 登录成功后不刷新** → 新渠道模型在对话框里始终缺席，必须整页刷新 | jetHub store 账号变化（登录成功 / opencode 加账号 / 删账号）→ `refreshChatModels()` → `fetchAvailableModels({force:true})`（force 先等在途请求落地再重拉，防止拿到登录前旧清单） |
| 9 | ProvidersView（模型配置页） | 只读 providers.yaml；**插件渠道不在那份清单里**（凭据在插件适配器内）→ 用户登录后到这页找不到渠道，以为登录没生效 | 新增「插件渠道」只读区：数据源与模型选择器同源（`/api/plugins/:name/models`），渠道未登录如实标「未读取到 · 该渠道尚未登录」，管理入口指回 Jet Hub 页（避免两处管理同一凭据） |
| 10 | 模型选择器 → chat-ws → 插件适配器 | **模型 id 与展示名混淆**：chat store 合并插件模型时 `name: m.name \|\| m.id` 把展示标签（如「Hy4 preview · x0.29→免费」）当 model_name 发给后端 → 插件按 id 解析不到 → 一条对话都发不出去（AGENT_ERROR）。opencode 侥幸可用只因它 id===name，掩盖了缺陷 | `name: m.id`（wire 上只放 id，pi-providers 注册同样按 m.id 对齐），展示名移入 `displayName`。**配套可观测性缺陷**：finish kind=error 的 `failure` 明细在 pi-bridge pump 里被整条丢弃 → sidecar 事件映射四层兜底全空 → 界面只剩零诊断价值的「Unknown agent error」；现在逐层提取（Error/string/对象）为 `partial.errorMessage` |
| 11 | pi-bridge 消息转换 → dsh-llm | **assistant 消息缺 `source` 契约**：dsh-llm 要求 assistant 消息必填 `ModelMessageSource`（`{kind:'model', provider, model}`），pi-bridge 转换不带 → 第一轮模型回复（含工具调用）落地后，第二轮请求 `LlmRuntime.forAdapter()` 读 `message.source.replayState` 直接 TypeError（真机：「undefined is not an object」，buddy 6.4s 处炸）。#10 的修复让真实错误文本透传出来才得以定位 | 转换时补 `source`：provider/model 优先取 pi 消息自带元数据，取不到用发起调用的路由兜底；`replayState` 本就不携带（pi 会话重放不走它，`forAdapter` 对 undefined 原样放行） |

防复发：`web/tests/jetHubModelIntegration.spec.ts`（6 条）锁整条链 —— chat store
合并插件模型 + force 语义 + **name=m.id 契约（禁止回退 `m.name \|\| m.id`）**、jetHub
store 四个账号变化点必须联动刷新、ProvidersView 只读区契约（同源数据、空清单如实
标注、插件停用整区隐藏）。后端 `pi-bridge.test.ts` 锁 finish.failure 三种形状
（字符串/Error/对象）都必须落进 errorMessage。

**基线**：后端 223 / 引擎 sidecar 83 / 前端 410 全绿，`vue-tsc` 零错误。
提交：`d210ade`（#1）、`d4878df`（#2–#5）、本文对应提交（#6–#7）、`cee1d46`（#8–#10）、`d2a72a8`（#11）。
