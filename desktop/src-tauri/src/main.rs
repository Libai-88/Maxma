#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod port_manager;

use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use windows::core::PCWSTR;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
    FileOpenDialog, IFileOpenDialog, FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
};

/// 最大崩溃重启次数
const MAX_RESTARTS: u32 = 3;
/// 后端健康检查超时（秒）
const HEALTH_TIMEOUT_SECS: u64 = 30;
/// 重启前等待（秒）
const RESTART_DELAY_SECS: u64 = 2;

/// 获取 sidecar 日志文件路径：%APPDATA%/MaxmaHere/logs/server.log
fn server_log_path() -> Option<PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    Some(PathBuf::from(appdata).join("MaxmaHere").join("logs").join("server.log"))
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
fn wait_for_server(port: u16) -> bool {
    let client = reqwest::blocking::Client::new();
    let url = format!("http://127.0.0.1:{}/api/health", port);

    for i in 0..HEALTH_TIMEOUT_SECS {
        if let Ok(resp) = client.get(&url).timeout(Duration::from_secs(1)).send() {
            if resp.status().is_success() {
                println!("[tauri] 后端就绪 ({}s)", i + 1);
                return true;
            }
        }
        std::thread::sleep(Duration::from_secs(1));
    }

    eprintln!("[tauri] 后端启动超时 ({}s)", HEALTH_TIMEOUT_SECS);
    false
}

/// 启动 sidecar 并在后台监控其生命周期（日志 + 崩溃检测）。
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
        .expect("Failed to get sidecar");

    // 通过环境变量将端口传给 sidecar（Python 端从 settings.maxma_api_port 读取）
    // 同时注入 MAXMA_RESOURCES_DIR 让 Python 后端能定位嵌入式运行时
    let resource_dir = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));

    let sidecar = sidecar
        .env("MAXMA_API_PORT", port.to_string())
        .env("MAXMA_RESOURCES_DIR", resource_dir.to_string_lossy().to_string());

    let (mut rx, child) = sidecar
        .spawn()
        .expect("Failed to start maxma-server sidecar");

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
                    eprintln!("[tauri] sidecar 错误: {}", err);
                    write_server_log(&log_writer, "[error] ", &err);
                }
                CommandEvent::Terminated(status) => {
                    let msg = format!("后端进程退出 (code={:?})", status.code);
                    eprintln!("[tauri] {}", msg);
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
                eprintln!("[tauri] {}", msg);
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
                eprintln!("[tauri] {}", msg);
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
    // 启动前选择可用端口（冲突时自动回退到 8001-8010）
    let selected_port = match port_manager::pick_available_port() {
        Some(p) => p,
        None => {
            eprintln!("[tauri] 无可用端口（8000-8010 全部被占用），退出");
            std::process::exit(1);
        }
    };
    println!("[tauri] 选中端口: {}", selected_port);

    // 打开 sidecar 日志文件
    let log_writer = Arc::new(Mutex::new(open_server_log()));

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
        .invoke_handler(tauri::generate_handler![select_path, get_api_port])
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

            // 启动 sidecar + 监控
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
                    eprintln!("[tauri] 后端启动失败，通知前端");
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
                        println!("[tauri] 窗口关闭，正在终止后端...");
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
