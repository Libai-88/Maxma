#!/usr/bin/env bash
cd /d/Maxma/MaxmaHere || exit 1
export MSYS_NO_PATHCONV=1
export MAXMA_VCVARS='D:\VSBuildTools\VC\Auxiliary\Build\vcvars64.bat'
powershell -NoProfile -ExecutionPolicy Bypass -Command 'Set-Location "D:\Maxma\MaxmaHere"; & .\build-portable.bat; exit $LASTEXITCODE' > build_portable.log 2>&1
echo "EXIT_CODE=$?"
