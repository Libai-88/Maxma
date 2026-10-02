const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

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
const runtimeDirs = [
  dataDir,
  path.join(dataDir, "electron"),
  path.join(dataDir, "session"),
  path.join(dataDir, "cache"),
  path.join(dataDir, "temp"),
  backendLogDir,
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
      MAXMA_SERVE_WEB: "1",
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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  const appOrigin = `http://127.0.0.1:${backendPort}`;
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
  mainWindow.on("closed", () => { mainWindow = null; });
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
  if (backend && backend.exitCode === null) backend.kill();
  if (backendLog) {
    backendLog.end();
    backendLog = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
