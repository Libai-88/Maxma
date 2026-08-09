@echo off
setlocal

REM Set MSVC paths manually
set "MAXMA_VCVARS=D:\VSBuildTools\VC\Auxiliary\Build\vcvars64.bat"
set "MAXMA_MSVC_BIN=D:\VSBuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64"
set "CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER=D:\VSBuildTools\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64\link.exe"

REM Import the MSVC environment properly
call "%MAXMA_VCVARS%" >nul 2>&1

REM Verify
echo VCToolsInstallDir=%VCToolsInstallDir%
echo MSVC=%MAXMA_MSVC_BIN%
echo LINKER=%CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER%
where cl
where link

REM Run the portable build
call build-portable.bat
