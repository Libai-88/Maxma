// vite.config.ts
import { defineConfig, loadEnv } from "file:///D:/Maxma/MaxmaHere/web/node_modules/vite/dist/node/index.js";
import vue from "file:///D:/Maxma/MaxmaHere/web/node_modules/@vitejs/plugin-vue/dist/index.mjs";
import { fileURLToPath, URL } from "node:url";

// src/utils/wsProtocol.ts
function selectWebSocketProtocol(protocols) {
  return protocols.values().next().value ?? false;
}

// vite.config.ts
var __vite_injected_original_import_meta_url = "file:///D:/Maxma/MaxmaHere/web/vite.config.ts";
function relaxDevCsp() {
  return {
    name: "maxma:relax-dev-csp",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace(
        /<meta http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"[^>]*>/,
        (_, policy) => `<meta http-equiv="Content-Security-Policy" content="${policy.replace(/script-src 'self';/, "script-src 'self' 'unsafe-inline' 'unsafe-eval';").replace(/connect-src 'self'/, "connect-src 'self' ws: wss: http: https:")}" />`
      );
    }
  };
}
var vite_config_default = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiPort = Number(process.env.MAXMA_API_PORT) || Number(env.MAXMA_API_PORT) || Number(env.VITE_MAXMA_API_PORT) || 8e3;
  const webPort = Number(process.env.MAXMA_WEB_PORT) || Number(env.MAXMA_WEB_PORT) || Number(env.VITE_MAXMA_WEB_PORT) || 5173;
  return {
    plugins: [vue(), relaxDevCsp()],
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["tests/setup.ts"]
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", __vite_injected_original_import_meta_url))
      },
      // 关键：去重 CodeMirror 核心包，确保运行时只有一份 @codemirror/state 实例。
      // 否则 vue-codemirror 和直接 import 的 @codemirror/view 各自打包一份 state，
      // EditorView.lineWrapping（FacetProvider）的 instanceof 检查失败，
      // 抛出 "Unrecognized extension value in extension set ([object Object])"。
      dedupe: [
        "@codemirror/state",
        "@codemirror/view",
        "@codemirror/language",
        "@codemirror/commands"
      ]
    },
    build: {
      minify: "esbuild",
      esbuild: {
        drop: ["console"]
      },
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL("./index.html", __vite_injected_original_import_meta_url)),
          "quick-chat": fileURLToPath(new URL("./quick-chat.html", __vite_injected_original_import_meta_url)),
          splash: fileURLToPath(new URL("./splash.html", __vite_injected_original_import_meta_url))
        },
        output: {
          manualChunks: {
            "vue-vendor": ["vue", "vue-router", "vue-virtual-scroller"],
            "markdown-vendor": ["markdown-it", "markdown-it-task-lists", "markdown-it-texmath", "katex"],
            "codemirror": [
              "codemirror",
              "vue-codemirror",
              "@codemirror/lang-markdown",
              "@codemirror/theme-one-dark",
              "@codemirror/view",
              "@codemirror/state",
              "@codemirror/language",
              "@codemirror/commands"
            ]
          }
        }
      }
    },
    server: {
      port: webPort,
      proxy: {
        "/api": `http://localhost:${apiPort}`,
        "/ws": {
          target: `ws://localhost:${apiPort}`,
          ws: true,
          changeOrigin: true,
          // 必须显式处理 WebSocket 子协议，否则浏览器收到空的
          // Sec-WebSocket-Protocol 响应头，拒绝建立连接。
          handleProtocols: selectWebSocketProtocol
        }
      }
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiLCAic3JjL3V0aWxzL3dzUHJvdG9jb2wudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxNYXhtYVxcXFxNYXhtYUhlcmVcXFxcd2ViXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJEOlxcXFxNYXhtYVxcXFxNYXhtYUhlcmVcXFxcd2ViXFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9EOi9NYXhtYS9NYXhtYUhlcmUvd2ViL3ZpdGUuY29uZmlnLnRzXCI7Ly8vIDxyZWZlcmVuY2UgdHlwZXM9XCJ2aXRlc3RcIiAvPlxyXG5pbXBvcnQgeyBkZWZpbmVDb25maWcsIGxvYWRFbnYsIHR5cGUgUGx1Z2luT3B0aW9uIH0gZnJvbSAndml0ZSdcclxuaW1wb3J0IHZ1ZSBmcm9tICdAdml0ZWpzL3BsdWdpbi12dWUnXHJcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGgsIFVSTCB9IGZyb20gJ25vZGU6dXJsJ1xyXG5pbXBvcnQgeyBzZWxlY3RXZWJTb2NrZXRQcm90b2NvbCB9IGZyb20gJy4vc3JjL3V0aWxzL3dzUHJvdG9jb2wnXHJcblxyXG4vLyBEZXYtb25seSBwbHVnaW46IHJlbGF4IENTUCBtZXRhIHNvIFZpdGUgSE1SIGNsaWVudCAoaW5saW5lIDxzY3JpcHQ+KSxcclxuLy8gc291cmNlbWFwIGluamVjdGlvbnMsIGFuZCBicm93c2VyIGRldnRvb2xzIGV4dGVuc2lvbnMgKFZ1ZSBEZXZUb29scyBldGMuKVxyXG4vLyBkb24ndCBnZXQgYmxvY2tlZCBieSB0aGUgcHJvZHVjdGlvbiBDU1AgYHNjcmlwdC1zcmMgJ3NlbGYnYC5cclxuLy8gT25seSBhY3RpdmUgaW4gc2VydmUgbW9kZSAoZGV2IHNlcnZlcikgXHUyMDE0IHByb2R1Y3Rpb24gYnVpbGQga2VlcHMgc3RyaWN0IENTUC5cclxuZnVuY3Rpb24gcmVsYXhEZXZDc3AoKTogUGx1Z2luT3B0aW9uIHtcclxuICByZXR1cm4ge1xyXG4gICAgbmFtZTogJ21heG1hOnJlbGF4LWRldi1jc3AnLFxyXG4gICAgYXBwbHk6ICdzZXJ2ZScsXHJcbiAgICB0cmFuc2Zvcm1JbmRleEh0bWwoaHRtbCkge1xyXG4gICAgICByZXR1cm4gaHRtbC5yZXBsYWNlKFxyXG4gICAgICAgIC88bWV0YSBodHRwLWVxdWl2PVwiQ29udGVudC1TZWN1cml0eS1Qb2xpY3lcIltePl0qY29udGVudD1cIihbXlwiXSopXCJbXj5dKj4vLFxyXG4gICAgICAgIChfLCBwb2xpY3k6IHN0cmluZykgPT5cclxuICAgICAgICAgIGA8bWV0YSBodHRwLWVxdWl2PVwiQ29udGVudC1TZWN1cml0eS1Qb2xpY3lcIiBjb250ZW50PVwiJHtwb2xpY3lcclxuICAgICAgICAgICAgLnJlcGxhY2UoL3NjcmlwdC1zcmMgJ3NlbGYnOy8sIFwic2NyaXB0LXNyYyAnc2VsZicgJ3Vuc2FmZS1pbmxpbmUnICd1bnNhZmUtZXZhbCc7XCIpXHJcbiAgICAgICAgICAgIC5yZXBsYWNlKC9jb25uZWN0LXNyYyAnc2VsZicvLCBcImNvbm5lY3Qtc3JjICdzZWxmJyB3czogd3NzOiBodHRwOiBodHRwczpcIil9XCIgLz5gXHJcbiAgICAgIClcclxuICAgIH0sXHJcbiAgfVxyXG59XHJcblxyXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoKHsgbW9kZSB9KSA9PiB7XHJcbiAgY29uc3QgZW52ID0gbG9hZEVudihtb2RlLCBwcm9jZXNzLmN3ZCgpLCAnJylcclxuICBjb25zdCBhcGlQb3J0ID1cclxuICAgIE51bWJlcihwcm9jZXNzLmVudi5NQVhNQV9BUElfUE9SVCkgfHxcclxuICAgIE51bWJlcihlbnYuTUFYTUFfQVBJX1BPUlQpIHx8XHJcbiAgICBOdW1iZXIoZW52LlZJVEVfTUFYTUFfQVBJX1BPUlQpIHx8XHJcbiAgICA4MDAwXHJcbiAgY29uc3Qgd2ViUG9ydCA9XHJcbiAgICBOdW1iZXIocHJvY2Vzcy5lbnYuTUFYTUFfV0VCX1BPUlQpIHx8XHJcbiAgICBOdW1iZXIoZW52Lk1BWE1BX1dFQl9QT1JUKSB8fFxyXG4gICAgTnVtYmVyKGVudi5WSVRFX01BWE1BX1dFQl9QT1JUKSB8fFxyXG4gICAgNTE3M1xyXG5cclxuICByZXR1cm4ge1xyXG4gICAgcGx1Z2luczogW3Z1ZSgpLCByZWxheERldkNzcCgpXSxcclxuICAgIHRlc3Q6IHtcclxuICAgICAgZW52aXJvbm1lbnQ6ICdqc2RvbScsXHJcbiAgICAgIGdsb2JhbHM6IHRydWUsXHJcbiAgICAgIHNldHVwRmlsZXM6IFsndGVzdHMvc2V0dXAudHMnXSxcclxuICAgIH0sXHJcbiAgICByZXNvbHZlOiB7XHJcbiAgICAgIGFsaWFzOiB7XHJcbiAgICAgICAgJ0AnOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoJy4vc3JjJywgaW1wb3J0Lm1ldGEudXJsKSksXHJcbiAgICAgIH0sXHJcbiAgICAgIC8vIFx1NTE3M1x1OTUyRVx1RkYxQVx1NTNCQlx1OTFDRCBDb2RlTWlycm9yIFx1NjgzOFx1NUZDM1x1NTMwNVx1RkYwQ1x1Nzg2RVx1NEZERFx1OEZEMFx1ODg0Q1x1NjVGNlx1NTNFQVx1NjcwOVx1NEUwMFx1NEVGRCBAY29kZW1pcnJvci9zdGF0ZSBcdTVCOUVcdTRGOEJcdTMwMDJcclxuICAgICAgLy8gXHU1NDI2XHU1MjE5IHZ1ZS1jb2RlbWlycm9yIFx1NTQ4Q1x1NzZGNFx1NjNBNSBpbXBvcnQgXHU3Njg0IEBjb2RlbWlycm9yL3ZpZXcgXHU1NDA0XHU4MUVBXHU2MjUzXHU1MzA1XHU0RTAwXHU0RUZEIHN0YXRlXHVGRjBDXHJcbiAgICAgIC8vIEVkaXRvclZpZXcubGluZVdyYXBwaW5nXHVGRjA4RmFjZXRQcm92aWRlclx1RkYwOVx1NzY4NCBpbnN0YW5jZW9mIFx1NjhDMFx1NjdFNVx1NTkzMVx1OEQyNVx1RkYwQ1xyXG4gICAgICAvLyBcdTYyOUJcdTUxRkEgXCJVbnJlY29nbml6ZWQgZXh0ZW5zaW9uIHZhbHVlIGluIGV4dGVuc2lvbiBzZXQgKFtvYmplY3QgT2JqZWN0XSlcIlx1MzAwMlxyXG4gICAgICBkZWR1cGU6IFtcclxuICAgICAgICAnQGNvZGVtaXJyb3Ivc3RhdGUnLFxyXG4gICAgICAgICdAY29kZW1pcnJvci92aWV3JyxcclxuICAgICAgICAnQGNvZGVtaXJyb3IvbGFuZ3VhZ2UnLFxyXG4gICAgICAgICdAY29kZW1pcnJvci9jb21tYW5kcycsXHJcbiAgICAgIF0sXHJcbiAgICB9LFxyXG4gICAgYnVpbGQ6IHtcclxuICAgICAgbWluaWZ5OiAnZXNidWlsZCcsXHJcbiAgICAgIGVzYnVpbGQ6IHtcclxuICAgICAgICBkcm9wOiBbJ2NvbnNvbGUnXSxcclxuICAgICAgfSxcclxuICAgICAgcm9sbHVwT3B0aW9uczoge1xyXG4gICAgICAgIGlucHV0OiB7XHJcbiAgICAgICAgICBtYWluOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoJy4vaW5kZXguaHRtbCcsIGltcG9ydC5tZXRhLnVybCkpLFxyXG4gICAgICAgICAgJ3F1aWNrLWNoYXQnOiBmaWxlVVJMVG9QYXRoKG5ldyBVUkwoJy4vcXVpY2stY2hhdC5odG1sJywgaW1wb3J0Lm1ldGEudXJsKSksXHJcbiAgICAgICAgICBzcGxhc2g6IGZpbGVVUkxUb1BhdGgobmV3IFVSTCgnLi9zcGxhc2guaHRtbCcsIGltcG9ydC5tZXRhLnVybCkpLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgb3V0cHV0OiB7XHJcbiAgICAgICAgICBtYW51YWxDaHVua3M6IHtcclxuICAgICAgICAgICAgJ3Z1ZS12ZW5kb3InOiBbJ3Z1ZScsICd2dWUtcm91dGVyJywgJ3Z1ZS12aXJ0dWFsLXNjcm9sbGVyJ10sXHJcbiAgICAgICAgICAgICdtYXJrZG93bi12ZW5kb3InOiBbJ21hcmtkb3duLWl0JywgJ21hcmtkb3duLWl0LXRhc2stbGlzdHMnLCAnbWFya2Rvd24taXQtdGV4bWF0aCcsICdrYXRleCddLFxyXG4gICAgICAgICAgICAnY29kZW1pcnJvcic6IFtcclxuICAgICAgICAgICAgICAnY29kZW1pcnJvcicsXHJcbiAgICAgICAgICAgICAgJ3Z1ZS1jb2RlbWlycm9yJyxcclxuICAgICAgICAgICAgICAnQGNvZGVtaXJyb3IvbGFuZy1tYXJrZG93bicsXHJcbiAgICAgICAgICAgICAgJ0Bjb2RlbWlycm9yL3RoZW1lLW9uZS1kYXJrJyxcclxuICAgICAgICAgICAgICAnQGNvZGVtaXJyb3IvdmlldycsXHJcbiAgICAgICAgICAgICAgJ0Bjb2RlbWlycm9yL3N0YXRlJyxcclxuICAgICAgICAgICAgICAnQGNvZGVtaXJyb3IvbGFuZ3VhZ2UnLFxyXG4gICAgICAgICAgICAgICdAY29kZW1pcnJvci9jb21tYW5kcycsXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0sXHJcbiAgICB9LFxyXG4gICAgc2VydmVyOiB7XHJcbiAgICAgIHBvcnQ6IHdlYlBvcnQsXHJcbiAgICAgIHByb3h5OiB7XHJcbiAgICAgICAgJy9hcGknOiBgaHR0cDovL2xvY2FsaG9zdDoke2FwaVBvcnR9YCxcclxuICAgICAgICAnL3dzJzoge1xyXG4gICAgICAgICAgdGFyZ2V0OiBgd3M6Ly9sb2NhbGhvc3Q6JHthcGlQb3J0fWAsXHJcbiAgICAgICAgICB3czogdHJ1ZSxcclxuICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcclxuICAgICAgICAgIC8vIFx1NUZDNVx1OTg3Qlx1NjYzRVx1NUYwRlx1NTkwNFx1NzQwNiBXZWJTb2NrZXQgXHU1QjUwXHU1MzRGXHU4QkFFXHVGRjBDXHU1NDI2XHU1MjE5XHU2RDRGXHU4OUM4XHU1NjY4XHU2NTM2XHU1MjMwXHU3QTdBXHU3Njg0XHJcbiAgICAgICAgICAvLyBTZWMtV2ViU29ja2V0LVByb3RvY29sIFx1NTRDRFx1NUU5NFx1NTkzNFx1RkYwQ1x1NjJEMlx1N0VERFx1NUVGQVx1N0FDQlx1OEZERVx1NjNBNVx1MzAwMlxyXG4gICAgICAgICAgaGFuZGxlUHJvdG9jb2xzOiBzZWxlY3RXZWJTb2NrZXRQcm90b2NvbCxcclxuICAgICAgICB9LFxyXG4gICAgICB9LFxyXG4gICAgfSxcclxuICB9XHJcbn0pXHJcbiIsICJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiRDpcXFxcTWF4bWFcXFxcTWF4bWFIZXJlXFxcXHdlYlxcXFxzcmNcXFxcdXRpbHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkQ6XFxcXE1heG1hXFxcXE1heG1hSGVyZVxcXFx3ZWJcXFxcc3JjXFxcXHV0aWxzXFxcXHdzUHJvdG9jb2wudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0Q6L01heG1hL01heG1hSGVyZS93ZWIvc3JjL3V0aWxzL3dzUHJvdG9jb2wudHNcIjsvKiogU2VsZWN0IHRoZSBmaXJzdCB3ZWJzb2NrZXQgc3VicHJvdG9jb2wgcmVxdWVzdGVkIGJ5IHRoZSBicm93c2VyLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlbGVjdFdlYlNvY2tldFByb3RvY29sKHByb3RvY29sczogU2V0PHN0cmluZz4pOiBzdHJpbmcgfCBmYWxzZSB7XG4gIHJldHVybiBwcm90b2NvbHMudmFsdWVzKCkubmV4dCgpLnZhbHVlID8/IGZhbHNlXG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQ0EsU0FBUyxjQUFjLGVBQWtDO0FBQ3pELE9BQU8sU0FBUztBQUNoQixTQUFTLGVBQWUsV0FBVzs7O0FDRjVCLFNBQVMsd0JBQXdCLFdBQXdDO0FBQzlFLFNBQU8sVUFBVSxPQUFPLEVBQUUsS0FBSyxFQUFFLFNBQVM7QUFDNUM7OztBREgySixJQUFNLDJDQUEyQztBQVU1TSxTQUFTLGNBQTRCO0FBQ25DLFNBQU87QUFBQSxJQUNMLE1BQU07QUFBQSxJQUNOLE9BQU87QUFBQSxJQUNQLG1CQUFtQixNQUFNO0FBQ3ZCLGFBQU8sS0FBSztBQUFBLFFBQ1Y7QUFBQSxRQUNBLENBQUMsR0FBRyxXQUNGLHVEQUF1RCxPQUNwRCxRQUFRLHNCQUFzQixrREFBa0QsRUFDaEYsUUFBUSxzQkFBc0IsMENBQTBDLENBQUM7QUFBQSxNQUNoRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0Y7QUFFQSxJQUFPLHNCQUFRLGFBQWEsQ0FBQyxFQUFFLEtBQUssTUFBTTtBQUN4QyxRQUFNLE1BQU0sUUFBUSxNQUFNLFFBQVEsSUFBSSxHQUFHLEVBQUU7QUFDM0MsUUFBTSxVQUNKLE9BQU8sUUFBUSxJQUFJLGNBQWMsS0FDakMsT0FBTyxJQUFJLGNBQWMsS0FDekIsT0FBTyxJQUFJLG1CQUFtQixLQUM5QjtBQUNGLFFBQU0sVUFDSixPQUFPLFFBQVEsSUFBSSxjQUFjLEtBQ2pDLE9BQU8sSUFBSSxjQUFjLEtBQ3pCLE9BQU8sSUFBSSxtQkFBbUIsS0FDOUI7QUFFRixTQUFPO0FBQUEsSUFDTCxTQUFTLENBQUMsSUFBSSxHQUFHLFlBQVksQ0FBQztBQUFBLElBQzlCLE1BQU07QUFBQSxNQUNKLGFBQWE7QUFBQSxNQUNiLFNBQVM7QUFBQSxNQUNULFlBQVksQ0FBQyxnQkFBZ0I7QUFBQSxJQUMvQjtBQUFBLElBQ0EsU0FBUztBQUFBLE1BQ1AsT0FBTztBQUFBLFFBQ0wsS0FBSyxjQUFjLElBQUksSUFBSSxTQUFTLHdDQUFlLENBQUM7QUFBQSxNQUN0RDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFLQSxRQUFRO0FBQUEsUUFDTjtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsSUFDQSxPQUFPO0FBQUEsTUFDTCxRQUFRO0FBQUEsTUFDUixTQUFTO0FBQUEsUUFDUCxNQUFNLENBQUMsU0FBUztBQUFBLE1BQ2xCO0FBQUEsTUFDQSxlQUFlO0FBQUEsUUFDYixPQUFPO0FBQUEsVUFDTCxNQUFNLGNBQWMsSUFBSSxJQUFJLGdCQUFnQix3Q0FBZSxDQUFDO0FBQUEsVUFDNUQsY0FBYyxjQUFjLElBQUksSUFBSSxxQkFBcUIsd0NBQWUsQ0FBQztBQUFBLFVBQ3pFLFFBQVEsY0FBYyxJQUFJLElBQUksaUJBQWlCLHdDQUFlLENBQUM7QUFBQSxRQUNqRTtBQUFBLFFBQ0EsUUFBUTtBQUFBLFVBQ04sY0FBYztBQUFBLFlBQ1osY0FBYyxDQUFDLE9BQU8sY0FBYyxzQkFBc0I7QUFBQSxZQUMxRCxtQkFBbUIsQ0FBQyxlQUFlLDBCQUEwQix1QkFBdUIsT0FBTztBQUFBLFlBQzNGLGNBQWM7QUFBQSxjQUNaO0FBQUEsY0FDQTtBQUFBLGNBQ0E7QUFBQSxjQUNBO0FBQUEsY0FDQTtBQUFBLGNBQ0E7QUFBQSxjQUNBO0FBQUEsY0FDQTtBQUFBLFlBQ0Y7QUFBQSxVQUNGO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsSUFDQSxRQUFRO0FBQUEsTUFDTixNQUFNO0FBQUEsTUFDTixPQUFPO0FBQUEsUUFDTCxRQUFRLG9CQUFvQixPQUFPO0FBQUEsUUFDbkMsT0FBTztBQUFBLFVBQ0wsUUFBUSxrQkFBa0IsT0FBTztBQUFBLFVBQ2pDLElBQUk7QUFBQSxVQUNKLGNBQWM7QUFBQTtBQUFBO0FBQUEsVUFHZCxpQkFBaUI7QUFBQSxRQUNuQjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
