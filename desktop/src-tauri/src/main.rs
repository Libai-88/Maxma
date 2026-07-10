#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod port_manager;

use std::fs::{File, OpenOptions};
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
    JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows::Win32::System::Threading::OpenProcess;
use windows::Win32::System::Threading::{PROCESS_SET_QUOTA, PROCESS_TERMINATE};
use windows::Win32::UI::Shell::{
    FileOpenDialog, IFileOpenDialog, FileSaveDialog, IFileSaveDialog,
    FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
};

/// 最大崩溃重启次数
const MAX_RESTARTS: u32 = 3;
/// 后端健康检查超时（秒）。
/// PyInstaller onefile 第二次启动时需要解压 + 加载 SQLite/chromadb/ONNX 等数据，
/// 30s 不够，改为 90s 留足余量。
const HEALTH_TIMEOUT_SECS: u64 = 90;
/// 重启前等待（秒）
const RESTART_DELAY_SECS: u64 = 2;

/// 创建 Windows Job Object，设置 KILL_ON_JOB_CLOSE 标志。
/// 主进程任何原因退出（含被 NSIS/taskkill 强杀）时，Job 句柄关闭，
/// Windows 内核会自动终止 Job 内的所有子进程（sidecar）。
/// 这是比 WindowEvent::Destroyed 更可靠的子进程清理机制。
fn create_kill_on_close_job() -> Result<HANDLE, windows::core::Error> {
    unsafe {
        let job = CreateJobObjectW(None, None)?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )?;
        Ok(job)
    }
}

/// 将当前进程加入 Job Object。
/// 关键：加入 Job 后，**所有后代进程自动继承 Job 成员资格**，
/// 无需对 sidecar 单独 assign（避免了 PyInstaller bootloader 启动 Python 子进程
/// 与 assign_process_to_job 之间的竞态）。
fn assign_current_process_to_job(job: HANDLE) -> Result<(), windows::core::Error> {
    unsafe {
        let current_pid = std::process::id();
        let handle = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, current_pid)?;
        AssignProcessToJobObject(job, handle)?;
        let _ = CloseHandle(handle);
        Ok(())
    }
}

/// 启动前清理可能残留的旧版 maxma-server.exe 进程。
/// 场景：旧版本（无 Job Object）被 NSIS 强杀后 sidecar 成为孤儿进程，
/// 或主进程崩溃后 sidecar 残留。新版启动时先 taskkill 清理。
/// 使用 /T 标志同时杀死子进程树（PyInstaller onefile bootloader 会启动 Python 子进程）。
/// 清理后等待端口释放，避免 pick_available_port 误判端口被占用。
fn cleanup_stale_sidecar() {
    let output = std::process::Command::new("taskkill")
        .args(["/T", "/F", "/IM", "maxma-server.exe"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output();

    // 如果确实 kill 了进程（taskkill 返回 0），等待端口释放
    if let Ok(o) = output {
        if o.status.success() {
            write_startup_log("[tauri] cleanup_stale_sidecar: killed stale maxma-server.exe, waiting for port release...");
            // 等待最多 5 秒让内核释放 socket 端口
            for _ in 0..50 {
                if port_manager::is_port_available(port_manager::DEFAULT_API_PORT) {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
    }
}

/// 获取 sidecar 日志文件路径：%APPDATA%/MaxmaHere/logs/server.log
fn server_log_path() -> Option<PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    Some(PathBuf::from(appdata).join("MaxmaHere").join("logs").join("server.log"))
}

/// 获取 Tauri 主进程启动日志路径：%APPDATA%/MaxmaHere/logs/tauri.log
fn tauri_log_path() -> Option<PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    Some(PathBuf::from(appdata).join("MaxmaHere").join("logs").join("tauri.log"))
}

/// 打开 Tauri 启动日志文件（追加模式）。
/// 每次启动在文件头部写入分隔线。如果文件超过 5MB，自动轮转（保留 1 个备份）。
fn open_tauri_log() -> Option<BufWriter<File>> {
    let path = tauri_log_path()?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // 轮转：超过 5MB 时重命名旧文件
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > 5 * 1024 * 1024 {
            let backup = path.with_extension("log.old");
            let _ = std::fs::rename(&path, &backup);
        }
    }
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .ok()?;
    let mut writer = BufWriter::new(file);
    // 写入启动分隔线
    use std::io::Write;
    let sep = "=".repeat(60);
    let _ = writeln!(
        writer,
        "\n{}\nMaxmaHere Tauri 启动 @ {}\n{}",
        sep, chrono_now_string(), sep
    );
    let _ = writer.flush();
    Some(writer)
}

/// 获取当前时间的简单字符串（不依赖 chrono crate）。
fn chrono_now_string() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 简单格式：Unix 时间戳
    format!("epoch:{}", secs)
}

/// 全局启动日志 writer（线程安全）。
/// 所有 println!/eprintln! 替换为 write_startup_log，确保即使 panic 也有记录。
static STARTUP_LOG: std::sync::OnceLock<std::sync::Mutex<Option<BufWriter<File>>>> =
    std::sync::OnceLock::new();

/// 写入一行启动日志。如果日志未初始化则静默丢弃（不 panic）。
fn write_startup_log(msg: &str) {
    if let Some(mutex) = STARTUP_LOG.get() {
        if let Ok(mut guard) = mutex.lock() {
            if let Some(w) = guard.as_mut() {
                use std::io::Write;
                let _ = writeln!(w, "{}", msg);
                let _ = w.flush();
            }
        }
    }
}

/// 安装 panic hook：panic 时将信息写入启动日志，然后调用默认 hook。
fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = format!("[PANIC] {}", info);
        write_startup_log(&msg);
        // 同时写入 server.log 位置（方便统一查看）
        if let Some(path) = server_log_path() {
            use std::io::Write;
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
                let _ = writeln!(f, "[tauri-panic] {}", info);
            }
        }
        default_hook(info);
    }));
}

/// 打开 sidecar 日志文件（追加模式）。失败则返回 None，日志仅打印到控制台。
fn open_server_log() -> Option<BufWriter<File>> {
    let path = server_log_path()?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .ok()
        .map(BufWriter::new)
}

/// Tauri 命令：返回 sidecar 实际监听的端口（供前端动态获取，支持端口冲突回退）。
#[tauri::command]
fn get_api_port(state: tauri::State<'_, AppState>) -> u16 {
    state.port.load(Ordering::Relaxed)
}

/// 打开 Windows 原生文件/文件夹选择对话框。
#[tauri::command]
fn select_path(kind: String) -> Option<String> {
    open_windows_file_dialog(kind == "folder").ok().flatten()
}

/// 打开 Windows 原生保存文件对话框，将文本内容写入用户选择的路径。
/// 返回保存的文件路径；用户取消时返回 None；出错时返回 Err。
#[tauri::command]
fn save_text_file(content: String, default_filename: String) -> Result<Option<String>, String> {
    save_text_file_dialog(&content, &default_filename)
}

fn save_text_file_dialog(content: &str, default_filename: &str) -> Result<Option<String>, String> {
    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let initialized = hr.is_ok();
        if !initialized && hr.0 != 0x80010106u32 as i32 {
            hr.ok().map_err(|e| format!("COM 初始化失败: {}", e))?;
        }

        let result = (|| {
            let dialog: IFileSaveDialog =
                CoCreateInstance(&FileSaveDialog, None, CLSCTX_INPROC_SERVER)
                    .map_err(|e| format!("创建保存对话框失败: {}", e))?;

            let title = wide("保存错误日志");
            dialog.SetTitle(PCWSTR(title.as_ptr()))
                .map_err(|e| format!("设置标题失败: {}", e))?;

            let options = dialog.GetOptions()
                .map_err(|e| format!("获取选项失败: {}", e))?
                | FOS_FORCEFILESYSTEM;
            dialog.SetOptions(options)
                .map_err(|e| format!("设置选项失败: {}", e))?;

            let filename = wide(default_filename);
            dialog.SetFileName(PCWSTR(filename.as_ptr()))
                .map_err(|e| format!("设置文件名失败: {}", e))?;

            let ext = wide("txt");
            dialog.SetDefaultExtension(PCWSTR(ext.as_ptr()))
                .map_err(|e| format!("设置扩展名失败: {}", e))?;

            if dialog.Show(None).is_err() {
                return Ok(None); // 用户取消
            }

            let item = dialog.GetResult()
                .map_err(|e| format!("获取结果失败: {}", e))?;
            let display_name = item.GetDisplayName(SIGDN_FILESYSPATH)
                .map_err(|e| format!("获取路径失败: {}", e))?;
            let path = pwstr_to_string(display_name.as_ptr());
            CoTaskMemFree(Some(display_name.as_ptr() as _));

            std::fs::write(&path, content.as_bytes())
                .map_err(|e| format!("写入文件失败: {}", e))?;

            Ok(Some(path))
        })();

        if initialized {
            CoUninitialize();
        }
        result
    }
}

/// Tauri 命令：切换 Quick Chat 窗口可见性
#[tauri::command]
fn toggle_quick_chat(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("quick-chat") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.center();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn open_windows_file_dialog(pick_folder: bool) -> windows::core::Result<Option<String>> {
    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let initialized = hr.is_ok();
        if !initialized && hr.0 != 0x80010106u32 as i32 {
            hr.ok()?;
        }

        let result = (|| {
            let dialog: IFileOpenDialog =
                CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
            let title = if pick_folder {
                wide("选择要引用的文件夹")
            } else {
                wide("选择要引用的文件")
            };

            dialog.SetTitle(PCWSTR(title.as_ptr()))?;
            let mut options = dialog.GetOptions()? | FOS_FORCEFILESYSTEM;
            if pick_folder {
                options |= FOS_PICKFOLDERS;
            }
            dialog.SetOptions(options)?;

            if dialog.Show(None).is_err() {
                return Ok(None);
            }

            let item = dialog.GetResult()?;
            let display_name = item.GetDisplayName(SIGDN_FILESYSPATH)?;
            let path = pwstr_to_string(display_name.as_ptr());
            CoTaskMemFree(Some(display_name.as_ptr() as _));
            Ok(Some(path))
        })();

        if initialized {
            CoUninitialize();
        }
        result
    }
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe fn pwstr_to_string(ptr: *const u16) -> String {
    if ptr.is_null() {
        return String::new();
    }

    let mut len = 0;
    while *ptr.add(len) != 0 {
        len += 1;
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
}

/// 轮询后端健康检查接口，直到返回 200 或超时。
/// 关键：必须用 .no_proxy() 禁用系统代理，否则 Clash/V2Ray 等本地代理
/// 会拦截对 127.0.0.1 的请求，导致健康检查永远超时，应用闪退。
fn wait_for_server(port: u16) -> bool {
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()
        .expect("Failed to build reqwest client");
    let url = format!("http://127.0.0.1:{}/api/health", port);

    for i in 0..HEALTH_TIMEOUT_SECS {
        if let Ok(resp) = client.get(&url).send() {
            if resp.status().is_success() {
                write_startup_log(&format!("[tauri] 后端就绪 ({}s)", i + 1));
                return true;
            }
        }
        std::thread::sleep(Duration::from_secs(1));
    }

    write_startup_log(&format!("[tauri] 后端启动超时 ({}s)", HEALTH_TIMEOUT_SECS));
    false
}

/// 启动 sidecar 并在后台监控其生命周期（日志 + 崩溃检测）。
/// 注意：主进程已在 main() 中加入 Job Object，sidecar 作为后代进程自动继承 Job 成员资格，
/// 无需在此处单独 assign（避免了 PyInstaller bootloader 启动 Python 子进程的竞态）。
fn spawn_sidecar_with_monitor(
    app: tauri::AppHandle,
    restart_count: Arc<AtomicU32>,
    shutting_down: Arc<AtomicBool>,
    child_store: Arc<Mutex<Option<CommandChild>>>,
    port: u16,
    log_writer: Arc<Mutex<Option<BufWriter<File>>>>,
) {
    let sidecar = app
        .shell()
        .sidecar("maxma-server")
        .unwrap_or_else(|e| {
            write_startup_log(&format!("[tauri] FATAL: 获取 sidecar 失败: {}", e));
            panic!("Failed to get sidecar: {}", e);
        });

    // 通过环境变量将端口传给 sidecar（Python 端从 settings.maxma_api_port 读取）
    // 同时注入 MAXMA_RESOURCES_DIR 让 Python 后端能定位嵌入式运行时
    let resource_dir = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));

    write_startup_log(&format!("[tauri] sidecar resource_dir={}", resource_dir.display()));

    let sidecar = sidecar
        .env("MAXMA_API_PORT", port.to_string())
        .env("MAXMA_RESOURCES_DIR", resource_dir.to_string_lossy().to_string())
        // 注入 Tauri 主进程 PID，供 Python sidecar 守护线程监控。
        // PyInstaller onefile 模式下 os.getppid() 返回的是 bootloader PID 而非 Tauri，
        // 当 Job Object 失效且 Tauri 退出时，bootloader 可能仍存活，
        // 因此必须让 sidecar 监控 Tauri PID 而非直接父进程。
        .env("MAXMA_PARENT_PID", std::process::id().to_string());

    let (mut rx, child) = sidecar
        .spawn()
        .unwrap_or_else(|e| {
            write_startup_log(&format!("[tauri] FATAL: 启动 sidecar 失败: {}", e));
            panic!("Failed to start maxma-server sidecar: {}", e);
        });

    write_startup_log(&format!("[tauri] sidecar (pid={}) 已启动，自动继承 Job Object", child.pid()));

    // 存储 child handle 以便窗口关闭时 kill
    {
        let mut store = child_store.lock().unwrap();
        *store = Some(child);
    }

    // 后台线程：消费 sidecar 事件流（stdout/stderr/exit）
    std::thread::spawn(move || {
        let mut exited = false;
        loop {
            let event = match tauri::async_runtime::block_on(rx.recv()) {
                Some(ev) => ev,
                None => break,
            };
            match event {
                CommandEvent::Stdout(line) => {
                    let line = String::from_utf8_lossy(&line);
                    let trimmed = line.trim_end();
                    println!("[server] {}", trimmed);
                    write_server_log(&log_writer, "[stdout] ", trimmed);
                }
                CommandEvent::Stderr(line) => {
                    let line = String::from_utf8_lossy(&line);
                    let trimmed = line.trim_end();
                    eprintln!("[server] {}", trimmed);
                    write_server_log(&log_writer, "[stderr] ", trimmed);
                }
                CommandEvent::Error(err) => {
                    write_startup_log(&format!("[tauri] sidecar 错误: {}", err));
                    write_server_log(&log_writer, "[error] ", &err);
                }
                CommandEvent::Terminated(status) => {
                    let msg = format!("后端进程退出 (code={:?})", status.code);
                    write_startup_log(&format!("[tauri] {}", msg));
                    write_server_log(&log_writer, "[exit] ", &msg);
                    exited = true;
                    let _ = app.emit(
                        "server-disconnected",
                        serde_json::json!({
                            "code": status.code
                        }),
                    );
                    break;
                }
                _ => {}
            }
        }

        // 非正常退出且未达重启上限时自动重启
        if exited && !shutting_down.load(Ordering::Relaxed) {
            let count = restart_count.fetch_add(1, Ordering::Relaxed);
            if count < MAX_RESTARTS {
                let msg = format!("尝试重启后端 ({}/{})", count + 1, MAX_RESTARTS);
                write_startup_log(&format!("[tauri] {}", msg));
                write_server_log(&log_writer, "[restart] ", &msg);
                let _ = app.emit(
                    "server-restarting",
                    serde_json::json!({
                        "attempt": count + 1,
                        "max": MAX_RESTARTS
                    }),
                );
                std::thread::sleep(Duration::from_secs(RESTART_DELAY_SECS));
                spawn_sidecar_with_monitor(app, restart_count, shutting_down, child_store, port, log_writer);
            } else {
                let msg = format!("已达最大重启次数 ({})，放弃重启", MAX_RESTARTS);
                write_startup_log(&format!("[tauri] {}", msg));
                write_server_log(&log_writer, "[restart] ", &msg);
                let _ = app.emit(
                    "server-disconnected-permanent",
                    serde_json::json!({
                        "max_restarts": MAX_RESTARTS
                    }),
                );
            }
        }
    });
}

/// 将一行日志写入 sidecar 日志文件（若 writer 可用）。
fn write_server_log(writer: &Arc<Mutex<Option<BufWriter<File>>>>, prefix: &str, line: &str) {
    let mut guard = match writer.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if let Some(w) = guard.as_mut() {
        use std::io::Write;
        let _ = writeln!(w, "{}{}", prefix, line);
        let _ = w.flush();
    }
}

/// 应用全局状态：持有 sidecar 端口供 Tauri 命令查询。
struct AppState {
    port: AtomicU16,
}

fn main() {
    // ── 最先初始化启动日志 + panic hook ──
    // 无论后续步骤成功与否，日志文件都会有记录。
    let startup_log = open_tauri_log();
    let _ = STARTUP_LOG.set(std::sync::Mutex::new(startup_log));
    install_panic_hook();
    write_startup_log("[tauri] === 进程启动 ===");

    // 关键：禁用系统代理对本地回环的拦截。
    // Clash/V2Ray 等本地代理软件会拦截 127.0.0.1 的请求，导致
    // Tauri 主进程的健康检查、Tauri HTTP 插件、Python sidecar 的请求全部失败。
    // 设置 NO_PROXY 环境变量后，所有遵循标准的环境变量代理约定的 HTTP 客户端
    //（reqwest、Python requests/httpx、Tauri HTTP 插件）都会绕过代理访问本地。
    // 这必须在任何 HTTP 客户端初始化之前执行。
    let no_proxy = "127.0.0.1,localhost,::1";
    if let Ok(existing) = std::env::var("NO_PROXY") {
        // 合并已有的 NO_PROXY，保留用户/系统原有配置
        let merged = format!("{},{}", existing, no_proxy);
        std::env::set_var("NO_PROXY", merged);
    } else {
        std::env::set_var("NO_PROXY", no_proxy);
    }
    // 同时设置小写版本（部分库只认小写）
    if let Ok(existing) = std::env::var("no_proxy") {
        let merged = format!("{},{}", existing, no_proxy);
        std::env::set_var("no_proxy", merged);
    } else {
        std::env::set_var("no_proxy", no_proxy);
    }
    write_startup_log(&format!("[tauri] NO_PROXY={}", no_proxy));

    // 启动前清理可能残留的旧版 maxma-server.exe 进程
    // 场景：旧版本（无 Job Object）被 NSIS 强杀后 sidecar 成为孤儿进程，
    // 或主进程崩溃后 sidecar 残留。新版启动时先 taskkill 清理，避免端口/文件冲突。
    cleanup_stale_sidecar();
    write_startup_log("[tauri] 清理残留 sidecar 完成");

    // 启动前选择可用端口（冲突时自动回退到 8001-8010）
    let selected_port = match port_manager::pick_available_port() {
        Some(p) => p,
        None => {
            write_startup_log("[tauri] FATAL: 无可用端口（8000-8010 全部被占用），退出");
            std::process::exit(1);
        }
    };
    write_startup_log(&format!("[tauri] 选中端口: {}", selected_port));

    // 打开 sidecar 日志文件
    let log_writer = Arc::new(Mutex::new(open_server_log()));

    // 创建 Windows Job Object（KILL_ON_JOB_CLOSE）并将主进程自身加入 Job。
    // 关键改进：主进程加入 Job 后，所有后代进程（含 PyInstaller bootloader 启动的
    // Python 子进程）自动继承 Job 成员资格，无需事后 assign，避免了竞态条件。
    // 主进程任何原因退出（含被 NSIS/taskkill 强杀）时，Job 句柄被 OS 关闭，
    // 内核自动终止 Job 内的所有后代进程，避免 sidecar 成为孤儿占用文件句柄。
    // 注意：HANDLE 是 Copy 类型，没有 Drop 实现，离开作用域不会调用 CloseHandle，
    // 句柄会一直保持开放，直到进程退出时被 OS 回收（触发 KILL_ON_JOB_CLOSE）。
    // 用 `static` 绑定确保 Job 句柄存活到进程退出（防止编译器优化掉）。
    static JOB_HANDLE_RAW: std::sync::OnceLock<isize> = std::sync::OnceLock::new();
    match create_kill_on_close_job() {
        Ok(job) => {
            match assign_current_process_to_job(job) {
                Ok(()) => write_startup_log("[tauri] 主进程已加入 Job Object，后代进程将自动继承"),
                Err(e) => write_startup_log(&format!("[tauri] 警告：主进程加入 Job Object 失败: {}，sidecar 清理将依赖窗口事件", e)),
            }
            // 存入 static 变量，确保 Job 句柄存活到进程退出
            let _ = JOB_HANDLE_RAW.set(job.0 as isize);
        }
        Err(e) => {
            write_startup_log(&format!("[tauri] 警告：创建 Job Object 失败: {}，sidecar 清理将依赖窗口事件", e));
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // 第二次启动时聚焦到主窗口
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut(Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space))
                .expect("Failed to create shortcut")
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("quick-chat") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                // 居中显示并聚焦
                                let _ = window.center();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build()
        )
        .invoke_handler(tauri::generate_handler![select_path, get_api_port, toggle_quick_chat, save_text_file])
        .setup(move |app| {
            let shutting_down = Arc::new(AtomicBool::new(false));
            let restart_count = Arc::new(AtomicU32::new(0));
            let child_store: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));

            // 存入 managed state 以便 window event 访问
            app.manage(ShuttingDown(shutting_down.clone()));
            app.manage(SidecarChild(child_store.clone()));
            app.manage(AppState {
                port: AtomicU16::new(selected_port),
            });

            // 启动 sidecar + 监控（sidecar 作为主进程后代自动继承 Job Object）
            spawn_sidecar_with_monitor(
                app.handle().clone(),
                restart_count,
                shutting_down,
                child_store,
                selected_port,
                log_writer.clone(),
            );

            // 后台等待后端就绪
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if !wait_for_server(selected_port) {
                    write_startup_log("[tauri] 后端启动失败，通知前端");
                    let _ = handle.emit("server-startup-failed", serde_json::Value::Null);
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // 标记正在关闭，防止触发重启逻辑
                let state = window.state::<ShuttingDown>();
                state.0.store(true, Ordering::Relaxed);

                // 显式 kill sidecar 进程
                let child_state = window.state::<SidecarChild>();
                if let Ok(mut guard) = child_state.0.lock() {
                    if let Some(child) = guard.take() {
                        write_startup_log("[tauri] 窗口关闭，正在终止后端...");
                        child.kill().ok();
                    }
                };
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ── Managed state 包装 ──

struct ShuttingDown(Arc<AtomicBool>);
struct SidecarChild(Arc<Mutex<Option<CommandChild>>>);
