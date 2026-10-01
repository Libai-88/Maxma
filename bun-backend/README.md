# bun-backend

MaxmaHere 的 Bun 后端（Hono + Bun.serve）。REST 路由、chat WebSocket、kernel in-process 装配与前端静态托管（Web 形态）都在 `src/`。

## 安装依赖

```bash
bun install
```

## 运行

```bash
bun run src/server.ts    # 默认 http://127.0.0.1:8000
```

## 测试

```bash
bun test
```

## 构建

```bash
bun run build-server.mjs # 产出 ../dist/bun-server/server.js（bundle 路线）
```

打包形态为 `bun.exe run server.js` + 随包携带 sharp 原生件（`bun build --compile` 单文件与 sharp/libvips 不兼容）。完整便携包组装见根目录 `build-portable.bat`。
