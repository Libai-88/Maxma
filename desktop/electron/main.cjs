const { app, BrowserWindow, dialog, ipcMain, Notification, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { createBrowserController } = require("./browser-view.cjs");
const { startBrowserAgentServer } = require("./browser-agent-server.cjs");
const { assertOpenableHtml } = require("./path-actions.cjs");

const isWindows = process.platform === "win32";
const executableDir = app.isPackaged
  ? path.dirname(app.getPath("exe"))
  : path.resolve(__dirname, "..", "..");
const dataDir = app.isPackaged
  ? path.join(executableDir, "data")
  : path.resolve(__dirname, "..", "..", "dist", "electron-dev");
const bundleDir = app.isPackaged
  ? path.join(process.resourcesPath, "maxma")
  : process.env.MAXMA_BUNDLE_DIR || path.resolve(__dirname, "..", "..", "dist", "electron-runtime");
const backendExe = path.join(bundleDir, "bun.exe");
const backendScript = path.join(bundleDir, "server.js");
const backendLogDir = path.join(dataDir, "logs");
const piAgentDir = path.join(dataDir, "pi");
const downloadsDir = path.join(dataDir, "downloads");
const runtimeDirs = [
  dataDir,
  path.join(dataDir, "electron"),
  path.join(dataDir, "session"),
  path.join(dataDir, "cache"),
  path.join(dataDir, "temp"),
  piAgentDir,
  backendLogDir,
  downloadsDir,
];
for (const directory of runtimeDirs) fs.mkdirSync(directory, { recursive: true });

// Keep Electron/Chromium profile files and temporary files beside the portable app.
process.env.TEMP = path.join(dataDir, "temp");
process.env.TMP = process.env.TEMP;
app.setPath("userData", path.join(dataDir, "electron"));
app.setPath("sessionData", path.join(dataDir, "session"));
app.setPath("cache", path.join(dataDir, "cache"));
app.setPath("temp", path.join(dataDir, "temp"));
app.setAppLogsPath(backendLogDir);
app.setName("MaxmaHere");

let backend = null;
let backendLog = null;
let mainWindow = null;
let backendPort = null;
let appOrigin = null;
let browserController = null;
let browserAgentServer = null;
let isQuitting = false;

const lockAcquired = app.requestSingleInstanceLock();
if (!lockAcquired) app.quit();

function writeBackendLog(chunk, streamName) {
  if (!backendLog) return;
  const prefix = streamName === "stderr" ? "[stderr] " : "";
  backendLog.write(prefix + String(chunk));
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("无法分配本地服务端口")));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function checkHealth(port) {
  return new Promise((resolve) => {
    const request = http.get(
      { hostname: "127.0.0.1", port, path: "/api/health", timeout: 1000 },
      (response) => {
        response.resume();
        resolve(response.statusCode >= 200 && response.statusCode < 500);
      },
    );
    request.once("timeout", () => request.destroy());
    request.once("error", () => resolve(false));
  });
}

/**
 * 引擎配置目录落点校验（只认"明确 false"）。
 *
 * 上面 startBackend() 注入的 `PI_CODING_AGENT_DIR` 是 pi **自己拼出来的**变量名
 * （config.js: `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`）。上游改命名后这里会
 * 静默失效，便携包把会话/设置/凭据写进用户主目录，且不报错——正是本次审计发现的
 * S1 项。后端在 /api/health 里如实报 `engine.agent_dir_inside_expected`（经
 * `getAgentDir()` 验结果，不比字符串），这里在**桌面形态**把它喊出来：
 * 桌面壳必定设置了该变量，读到 false 就是真出问题；读不到（网络异常）则不打扰，
 * 因为那属于"未知"，不是"失败"。
 */
function checkEngineAgentDir(port) {
  return new Promise((resolve) => {
    const request = http.get(
      { hostname: "127.0.0.1", port, path: "/api/health", timeout: 2000 },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { text += chunk; });
        response.on("end", () => {
          try {
            const health = JSON.parse(text);
            const engine = health?.engine;
            if (engine && engine.agent_dir_inside_expected === false) {
              const detail =
                `引擎配置目录未落在 Maxma 数据目录内：\n  ${engine.agent_dir}\n` +
                `期望位于：\n  ${engine.expected_root}\n\n` +
                "这通常意味着 PI_CODING_AGENT_DIR 注入失效（引擎侧改了变量命名）。" +
                "会话、设置与凭据将被写入用户主目录，不会随便携包携带。";
              dialog.showErrorBox("MaxmaHere 数据目录异常", detail);
            }
          } catch {
            /* 解析失败按"未知"处理，不阻塞启动 */
          }
          resolve();
        });
      },
    );
    request.once("timeout", () => { request.destroy(); resolve(); });
    request.once("error", () => resolve());
  });
}

async function waitForBackend(port, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!backend || backend.exitCode !== null) {
      throw new Error("Maxma 后端提前退出，请查看 data/logs/desktop-backend.log");
    }
    if (await checkHealth(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error("Maxma 后端启动超时，请查看 data/logs/desktop-backend.log");
}

async function startBackend() {
  if (!fs.existsSync(backendExe) || !fs.existsSync(backendScript)) {
    throw new Error("桌面包缺少 Bun 后端运行文件");
  }

  backendPort = await getAvailablePort();
  backendLog = fs.createWriteStream(path.join(backendLogDir, "desktop-backend.log"), { flags: "a" });
  backend = spawn(backendExe, ["run", backendScript], {
    cwd: bundleDir,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      MAXMA_BUNDLE_DIR: bundleDir,
      MAXMA_EXE_DIR: bundleDir,
      MAXMA_DATA_DIR: dataDir,
      MAXMA_BUN_PORT: String(backendPort),
      MAXMA_API_PORT: String(backendPort),
      MAXMA_BUN_HOST: "127.0.0.1",
      MAXMA_ENV: "production",
      PI_CODING_AGENT_DIR: piAgentDir,
    },
  });
  backend.stdout.on("data", (chunk) => writeBackendLog(chunk, "stdout"));
  backend.stderr.on("data", (chunk) => writeBackendLog(chunk, "stderr"));
  backend.once("error", (error) => writeBackendLog(`${error.stack || error}\n`, "stderr"));
  backend.once("exit", (code, signal) => {
    writeBackendLog(`后端退出 code=${code} signal=${signal}\n`, "stderr");
    if (!isQuitting && app.isReady()) {
      dialog.showErrorBox("Maxma 后端已退出", "后端进程已停止。日志位于 data/logs/desktop-backend.log。");
      app.quit();
    }
  });

  await waitForBackend(backendPort);
  // 探活成功后立刻核对引擎数据目录落点（桌面形态一定注入了该变量，
  // 读到 false 就是注入失效——见 checkEngineAgentDir 的注释）。
  await checkEngineAgentDir(backendPort);
}

function openExternalUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "mailto:") {
      void shell.openExternal(url);
    }
  } catch {
    // Invalid or non-web links stay inside the app and are ignored.
  }
}

function isTrustedSender(event) {
  if (!appOrigin) return false;
  const senderUrl = event?.senderFrame?.url ?? "";
  return senderUrl === appOrigin || senderUrl.startsWith(`${appOrigin}/`);
}

function registerDesktopIpc() {
  ipcMain.handle("maxma:pick-path", async (event, kind) => {
    if (!isTrustedSender(event)) throw new Error("拒绝来自非应用页面的文件选择请求");
    if (kind !== "file" && kind !== "folder") throw new Error("未知的文件选择类型");
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!app.isPackaged && process.env.MAXMA_UI_TEST_PICK_PATH) {
      return { path: process.env.MAXMA_UI_TEST_PICK_PATH };
    }
    const result = await dialog.showOpenDialog(owner ?? mainWindow, {
      title: kind === "folder" ? "选择工作区文件夹" : "选择文件",
      properties: kind === "folder" ? ["openDirectory"] : ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    return { path: result.filePaths[0] };
  });

  ipcMain.handle("maxma:reveal-path", async (event, pathValue) => {
    if (!isTrustedSender(event)) throw new Error("拒绝来自非应用页面的资源管理器请求");
    if (typeof pathValue !== "string" || pathValue.length === 0 || pathValue.includes("\x00")) {
      throw new Error("无效路径");
    }
    if (!fs.existsSync(pathValue)) throw new Error("路径不存在");
    shell.showItemInFolder(pathValue);
  });

  ipcMain.handle("maxma:notify", async (event, payloadValue) => {
    if (!isTrustedSender(event)) throw new Error("拒绝来自非应用页面的通知请求");
    if (!Notification.isSupported()) return { shown: false, reason: "unsupported" };
    const payload = payloadValue && typeof payloadValue === "object" ? payloadValue : {};
    const title = typeof payload.title === "string" ? payload.title.slice(0, 120) : "Maxma";
    const body = typeof payload.body === "string" ? payload.body.slice(0, 600) : "";
    if (!body) throw new Error("通知正文不能为空");
    const notification = new Notification({ title, body, silent: false });
    notification.on("click", () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });
    notification.show();
    return { shown: true };
  });

  ipcMain.handle("maxma:open-path", async (event, pathValue) => {
    if (!isTrustedSender(event)) throw new Error("拒绝来自非应用页面的系统打开请求");
    // P1 只用于文件面板的 HTML「系统打开」。不能把 shell.openPath 变成
    // 任意可执行文件的启动器——渲染层一旦被注入，这就是一条执行链。
    assertOpenableHtml(pathValue);
    const result = await shell.openPath(pathValue);
    if (result) throw new Error(result);
  });

  browserController = createBrowserController({
    getWindow: () => mainWindow,
    isTrustedSender,
    openExternal: openExternalUrl,
    downloadsDir,
    policyPath: path.join(dataDir, "api", "data", "browser-policy.json"),
  });
  browserController.registerIpc(ipcMain);
}

registerDesktopIpc();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: "#101114",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  appOrigin = `http://127.0.0.1:${backendPort}`;
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== appOrigin && !url.startsWith(`${appOrigin}/`)) {
      event.preventDefault();
      openExternalUrl(url);
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow && mainWindow.show());
  mainWindow.on("closed", () => {
    browserController?.destroy();
    mainWindow = null;
  });
  void mainWindow.loadURL(appOrigin);
}

if (lockAcquired) {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      await startBackend();
      createWindow();
      if (!browserAgentServer && browserController) {
        browserAgentServer = startBrowserAgentServer({
          controller: browserController,
          dataDir,
          logger: console,
        });
        await browserAgentServer.start();
      }
    } catch (error) {
      dialog.showErrorBox("MaxmaHere 启动失败", error instanceof Error ? error.message : String(error));
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && backendPort) createWindow();
  });
}

app.on("before-quit", () => {
  isQuitting = true;
  browserAgentServer?.stop();
  if (backend && backend.exitCode === null) backend.kill();
  if (backendLog) {
    backendLog.end();
    backendLog = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
