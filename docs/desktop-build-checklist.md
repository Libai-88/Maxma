# Desktop Build Checklist

每次改动桌面端打包链路前，先按这个最小清单执行，避免继续沿用旧假设。

## 1. 先判断这次改动影响到哪里

- 新增或修改了 Python 依赖、原生扩展、动态导入：
  必须检查 `build/maxma-server.spec`
- 新增或修改了前端 API、运行时鉴权、桌面环境分支：
  必须检查 `web/` 构建链路和 `desktop/src-tauri/tauri.conf.json`
- 新增或修改了 sidecar 启动方式、产物路径、复制路径：
  必须检查 `build/build-server.bat` 和 `desktop/src-tauri/binaries/`

## 2. 打包前先列出本次“新增项”和“关联文件”

- 新增了哪些第三方依赖
- 新增了哪些动态导入或 `.pyd` / `.dll` / 二进制资源
- 哪些打包文件必须同步修改
- 哪些旧产物会干扰判断，必须先清理

最低限度至少检查这些文件：

- `build/maxma-server.spec`
- `build/build-server.bat`
- `desktop/src-tauri/tauri.conf.json`
- `desktop/src-tauri/binaries/`
- `web/vite.config.ts`

## 3. 开始打包前先清理旧产物

- 清掉历史遗留的 `dist/maxma-server/` 目录产物
- 清掉旧的 `dist/maxma-server.exe`
- 不要让旧产物参与任何故障判断

## 4. 固定执行顺序

1. 重打后端：生成 `dist/maxma-server.exe`
2. 复制到 `desktop/src-tauri/binaries/maxma-server-x86_64-pc-windows-msvc.exe`
3. 重构前端：`web/dist`
4. 重编 Tauri：生成新的桌面 `exe` / 安装包

## 5. 固定验证顺序

1. 先单独运行 `dist/maxma-server.exe`
2. 确认 `/api/health` 可访问
3. 再运行 Tauri 桌面端
4. 再验证模型列表、技能列表、MCP 列表、聊天输入框

## 6. 发现异常时的处理原则

- 先确认当前真实产物形态是单文件还是目录模式
- 先确认出错的是后端 sidecar、本体前端、还是 Tauri 启动链
- 只有定位到“当前真实产物”后，才继续修问题
