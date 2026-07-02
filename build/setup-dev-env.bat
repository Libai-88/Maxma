@echo off
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-tools.ps1" -EmitCmdEnv`) do %%I
