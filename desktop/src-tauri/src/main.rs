#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
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

/// 轮询后端轻量就绪接口，直到返回 200 或超时。
fn wait_for_server() -> bool {
    let client = reqwest::blocking::Client::new();
    let url = "http://127.0.0.1:8000/api/auth/token";

    for i in 0..HEALTH_TIMEOUT_SECS {
        if let Ok(resp) = client.get(url).timeout(Duration::from_secs(1)).send() {
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
) {
    let sidecar = app
        .shell()
        .sidecar("maxma-server")
        .expect("Failed to get sidecar");

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
                    println!("[server] {}", line.trim_end());
                }
                CommandEvent::Stderr(line) => {
                    let line = String::from_utf8_lossy(&line);
                    eprintln!("[server] {}", line.trim_end());
                }
                CommandEvent::Error(err) => {
                    eprintln!("[tauri] sidecar 错误: {}", err);
                }
                CommandEvent::Terminated(status) => {
                    eprintln!("[tauri] 后端进程退出 (code={:?})", status.code);
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
                eprintln!("[tauri] 尝试重启后端 ({}/{})", count + 1, MAX_RESTARTS);
                let _ = app.emit(
                    "server-restarting",
                    serde_json::json!({
                        "attempt": count + 1,
                        "max": MAX_RESTARTS
                    }),
                );
                std::thread::sleep(Duration::from_secs(RESTART_DELAY_SECS));
                spawn_sidecar_with_monitor(app, restart_count, shutting_down, child_store);
            } else {
                eprintln!("[tauri] 已达最大重启次数 ({})，放弃重启", MAX_RESTARTS);
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![select_path])
        .setup(|app| {
            let shutting_down = Arc::new(AtomicBool::new(false));
            let restart_count = Arc::new(AtomicU32::new(0));
            let child_store: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));

            // 存入 managed state 以便 window event 访问
            app.manage(ShuttingDown(shutting_down.clone()));
            app.manage(SidecarChild(child_store.clone()));

            // 启动 sidecar + 监控
            spawn_sidecar_with_monitor(
                app.handle().clone(),
                restart_count,
                shutting_down,
                child_store,
            );

            // 后台等待后端就绪
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if !wait_for_server() {
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
