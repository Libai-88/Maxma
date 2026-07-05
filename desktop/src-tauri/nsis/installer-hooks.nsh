; =============================================================================
; Tauri NSIS Installer Hooks
;
; 用途：在安装/卸载前杀死运行中的 maxma-server.exe（sidecar）和
;       maxma-here.exe（主程序），避免文件被占用导致安装/卸载失败。
;
; 背景：Tauri 默认 NSIS 模板只会杀死主程序（MAINBINARYNAME），
;       不知道 externalBin 引入的 sidecar（maxma-server.exe）。
;       当主程序被强杀时 WindowEvent::Destroyed 不触发，sidecar
;       成为孤儿进程持续占用自身 exe 文件句柄，导致 NSIS 在收尾
;       阶段写入 maxma-server.exe 时报"无法打开要写入的文件"。
;
; 此 hook 是修复该问题的第三层保险（最先执行）：
;   层 3（本文件）：NSIS 安装前 taskkill，让安装流程从一开始就干净
;   层 2（main.rs Job Object）：主进程退出时内核自动 kill sidecar
;   层 1（main.rs cleanup_stale_sidecar）：主程序启动时清理残留
; =============================================================================

; ----- 辅助宏：安全 taskkill -----
; taskkill 找不到进程时返回 128，我们用 Pop 接住并丢弃，不视为错误。
; nsExec::ExecToLog 会把命令输出打到安装日志（用户点 Show details 可见）。
!macro _SafeTaskKill exe
  nsExec::ExecToLog 'taskkill /F /IM "${exe}"'
  Pop $0   ; $0 = exitcode（0=成功 kill，128=进程不存在，其他=错误）
  DetailPrint "taskkill ${exe} -> exitcode=$0"
!macroend

; -----------------------------------------------------------------------------
; 安装前：在文件复制之前调用
; -----------------------------------------------------------------------------
!macro NSIS_HOOK_PREINSTALL
  DetailPrint "NSIS_HOOK_PREINSTALL: killing running Maxma processes..."

  ; 1) 先杀 sidecar（maxma-server.exe）—— 这是关键，Tauri 默认模板不会杀它
  !insertmacro _SafeTaskKill "maxma-server.exe"

  ; 2) 再杀主程序（maxma-here.exe）—— 双保险，Tauri 默认模板也会杀，但提前杀更稳
  !insertmacro _SafeTaskKill "maxma-here.exe"

  ; 3) 等待 800ms 让 Windows 释放文件句柄
  ;    EXE 文件被占用往往是句柄未释放，而非进程未退出。PyInstaller onefile
  ;    的 bootloader 会把自身 exe 映射到内存，进程退出后 OS 释放句柄有延迟。
  Sleep 800
!macroend

; -----------------------------------------------------------------------------
; 安装后：目前无操作
; -----------------------------------------------------------------------------
!macro NSIS_HOOK_POSTINSTALL
!macroend

; -----------------------------------------------------------------------------
; 卸载前：在删除文件之前调用
; -----------------------------------------------------------------------------
!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "NSIS_HOOK_PREUNINSTALL: killing running Maxma processes..."

  !insertmacro _SafeTaskKill "maxma-server.exe"
  !insertmacro _SafeTaskKill "maxma-here.exe"
  Sleep 800
!macroend

; -----------------------------------------------------------------------------
; 卸载后：目前无操作
; 注意：不要在这里删除 %APPDATA%\MaxmaHere 用户数据，会让用户丢失会话/记忆
; -----------------------------------------------------------------------------
!macro NSIS_HOOK_POSTUNINSTALL
!macroend
