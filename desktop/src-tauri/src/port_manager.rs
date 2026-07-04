//! 端口分配与冲突检测。
//!
//! 启动 sidecar 前选可用端口：优先使用 MAXMA_API_PORT 环境变量指定的端口，
//! 被占用则从 DEFAULT_API_PORT 起逐个尝试，直到 PORT_RANGE_END。
//! 选中的端口通过环境变量传给 sidecar（Python 端从 settings.maxma_api_port 读取）。

use std::net::TcpListener;

/// 默认起始端口
pub const DEFAULT_API_PORT: u16 = 8000;
/// 端口扫描上限（含），共 10 个候选端口
pub const PORT_RANGE_END: u16 = 8010;

/// 检测端口是否可用（未被占用）。
pub fn is_port_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// 选择可用端口。
///
/// 优先级：
/// 1. 环境变量 `MAXMA_API_PORT` 指定的端口（若可用）
/// 2. `DEFAULT_API_PORT`（8000）起逐个尝试至 `PORT_RANGE_END`（8010）
///
/// 返回选中的端口号；若全部被占用则返回 None。
pub fn pick_available_port() -> Option<u16> {
    // 1. 优先使用环境变量指定的端口
    if let Ok(s) = std::env::var("MAXMA_API_PORT") {
        if let Ok(port) = s.parse::<u16>() {
            if is_port_available(port) {
                return Some(port);
            }
            eprintln!(
                "[port_manager] 环境变量 MAXMA_API_PORT={} 已被占用，尝试自动选择",
                port
            );
        }
    }

    // 2. 从默认端口起逐个尝试
    for port in DEFAULT_API_PORT..=PORT_RANGE_END {
        if is_port_available(port) {
            return Some(port);
        }
    }

    eprintln!(
        "[port_manager] 端口 {}-{} 全部被占用",
        DEFAULT_API_PORT, PORT_RANGE_END
    );
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_port_available_for_unused_port() {
        // 49152 起为动态端口范围，未被占用概率极高
        assert!(is_port_available(49152));
    }

    #[test]
    fn test_is_port_unavailable_when_bound() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let bound_port = listener.local_addr().unwrap().port();
        assert!(!is_port_available(bound_port));
    }

    #[test]
    fn test_pick_available_port_returns_some() {
        // 在测试环境中应总能找到一个可用端口
        assert!(pick_available_port().is_some());
    }
}
