param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$WaitUrl = "",
    [int]$TimeoutSec = 30,
    [switch]$EmitCmdEnv,
    [switch]$Doctor
)

$ErrorActionPreference = "Stop"

function Get-ProjectRoot {
    param([string]$StartPath)

    $dir = Resolve-Path $StartPath
    while ($true) {
        $candidate = Join-Path $dir "main.py"
        if (Test-Path $candidate) {
            return $dir
        }

        $parent = Split-Path $dir -Parent
        if ($parent -eq $dir) {
            throw "Unable to locate project root from $StartPath"
        }
        $dir = $parent
    }
}

function Get-PythonExe {
    param([string]$Root)

    $venv = Join-Path $Root ".venv\Scripts\python.exe"
    if (Test-Path $venv) {
        return $venv
    }

    $fallback = (Get-Command python -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if ($fallback) {
        return $fallback
    }

    throw "Python not found. Create .venv first."
}

function Get-CommandPath {
    param([string]$Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) {
        return $command.Source
    }
    return $null
}

function Get-FirstExistingPath {
    param(
        [string[]]$Candidates,
        [string]$Leaf = ""
    )

    foreach ($candidate in $Candidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }

        $pathToCheck = $candidate
        if ($Leaf) {
            $pathToCheck = Join-Path $candidate $Leaf
        }

        if (Test-Path $pathToCheck) {
            if ($Leaf) {
                return (Resolve-Path $candidate).Path
            }
            return (Resolve-Path $pathToCheck).Path
        }
    }

    return $null
}

function Import-BatchEnvironment {
    param([string]$BatchPath)

    $output = & cmd.exe /d /s /c "`"call `"$BatchPath`" >nul && set`""
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to import environment from $BatchPath"
    }

    $map = @{}
    foreach ($line in $output) {
        $idx = $line.IndexOf("=")
        if ($idx -le 0) {
            continue
        }

        $key = $line.Substring(0, $idx)
        $value = $line.Substring($idx + 1)
        $map[$key] = $value
    }
    return $map
}

function Get-UniquePathList {
    param([string[]]$Entries)

    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $result = New-Object System.Collections.Generic.List[string]
    foreach ($entry in $Entries) {
        if ([string]::IsNullOrWhiteSpace($entry)) {
            continue
        }

        $normalized = $entry.Trim()
        if ($seen.Add($normalized)) {
            $result.Add($normalized) | Out-Null
        }
    }
    return $result
}

function Resolve-DevEnvironment {
    param([string]$Root)

    $cargoFromPath = Get-CommandPath "cargo"
    $rustupFromPath = Get-CommandPath "rustup"

    $cargoCandidates = @()
    if ($env:CARGO_HOME) {
        $cargoCandidates += Join-Path $env:CARGO_HOME "bin"
    }
    $cargoCandidates += "D:\Rust\cargo\bin"
    if ($cargoFromPath) {
        $cargoCandidates += Split-Path $cargoFromPath -Parent
    }
    $cargoBin = Get-FirstExistingPath -Candidates $cargoCandidates -Leaf "cargo.exe"

    if (-not $cargoBin) {
        throw "Unable to locate cargo.exe. Checked CARGO_HOME, D:\Rust\cargo\bin, and PATH."
    }

    $cargoHome = Split-Path $cargoBin -Parent

    $rustupCandidates = @()
    if ($env:RUSTUP_HOME) {
        $rustupCandidates += $env:RUSTUP_HOME
    }
    $rustupCandidates += "D:\Rust\rustup"
    if ($rustupFromPath) {
        $rustupCandidates += Join-Path (Split-Path (Split-Path $rustupFromPath -Parent) -Parent) "rustup"
    }
    $rustupHome = Get-FirstExistingPath -Candidates $rustupCandidates

    if (-not $rustupHome) {
        throw "Unable to locate RUSTUP_HOME. Checked RUSTUP_HOME, D:\Rust\rustup, and PATH."
    }

    $vcvars64 = Get-FirstExistingPath -Candidates @(
        "D:\VSBuildTools\VC\Auxiliary\Build\vcvars64.bat",
        "D:\VSBuildTools\Common7\Tools\VsDevCmd.bat"
    )

    if (-not $vcvars64) {
        throw "Unable to locate Visual Studio build environment script under D:\VSBuildTools."
    }

    $vsEnv = Import-BatchEnvironment -BatchPath $vcvars64
    $vcToolsInstallDir = $vsEnv["VCToolsInstallDir"]
    if (-not $vcToolsInstallDir) {
        throw "VCToolsInstallDir missing after importing $vcvars64"
    }

    $msvcBin = Join-Path $vcToolsInstallDir "bin\Hostx64\x64"
    $linker = Join-Path $msvcBin "link.exe"
    if (-not (Test-Path $linker)) {
        throw "MSVC linker not found: $linker"
    }

    $winSdkBase = $vsEnv["WindowsSdkBinPath"]
    $winSdkBin = if ($winSdkBase) { Join-Path $winSdkBase "x64" } else { $null }
    if (-not $winSdkBin -or -not (Test-Path (Join-Path $winSdkBin "rc.exe"))) {
        $winSdkBin = Get-FirstExistingPath -Candidates @(
            "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64"
        ) -Leaf "rc.exe"
    }

    if (-not $winSdkBin) {
        throw "Unable to locate Windows SDK x64 bin directory."
    }

    $systemPathEntries = @(
        (Join-Path $env:SystemRoot "System32"),
        $env:SystemRoot,
        (Join-Path $env:SystemRoot "System32\Wbem"),
        (Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0"),
        (Join-Path $env:SystemRoot "System32\OpenSSH")
    )

    $pathEntries = Get-UniquePathList (
        @($cargoBin, $msvcBin, $winSdkBin) +
        $systemPathEntries +
        ($vsEnv["Path"] -split ";") +
        ($env:Path -split ";")
    )

    return [ordered]@{
        MAXMA_DEV_ENV_READY = "1"
        PROJECT_ROOT = $Root
        PYTHON_EXE = (Get-PythonExe -Root $Root)
        CARGO_HOME = $cargoHome
        RUSTUP_HOME = $rustupHome
        MAXMA_VCVARS = $vcvars64
        MAXMA_MSVC_BIN = $msvcBin
        MAXMA_WINSDK_BIN = $winSdkBin
        CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = $linker
        PATH = ($pathEntries -join ";")
    }
}

function Write-CmdEnvironment {
    param($EnvironmentMap)

    foreach ($entry in $EnvironmentMap.GetEnumerator()) {
        Write-Output ("set `"{0}={1}`"" -f $entry.Key, [string]$entry.Value)
    }
}

function Invoke-Doctor {
    param($EnvironmentMap)

    $checks = [ordered]@{
        python = $EnvironmentMap["PYTHON_EXE"]
        cargo = (Join-Path $EnvironmentMap["CARGO_HOME"] "bin\cargo.exe")
        rustc = (Join-Path $EnvironmentMap["CARGO_HOME"] "bin\rustc.exe")
        rustup = (Join-Path $EnvironmentMap["CARGO_HOME"] "bin\rustup.exe")
        linker = $EnvironmentMap["CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER"]
        rc = (Join-Path $EnvironmentMap["MAXMA_WINSDK_BIN"] "rc.exe")
        mt = (Join-Path $EnvironmentMap["MAXMA_WINSDK_BIN"] "mt.exe")
        node = (Get-CommandPath "node")
        npm = (Get-CommandPath "npm")
    }

    Write-Host "[doctor] Project root: $($EnvironmentMap["PROJECT_ROOT"])"
    Write-Host "[doctor] VC vars: $($EnvironmentMap["MAXMA_VCVARS"])"
    Write-Host "[doctor] MSVC bin: $($EnvironmentMap["MAXMA_MSVC_BIN"])"
    Write-Host "[doctor] Windows SDK bin: $($EnvironmentMap["MAXMA_WINSDK_BIN"])"

    foreach ($entry in $checks.GetEnumerator()) {
        if ($entry.Value -and (Test-Path $entry.Value -ErrorAction SilentlyContinue)) {
            Write-Host ("[ok] {0}: {1}" -f $entry.Key, $entry.Value)
        } elseif ($entry.Value) {
            Write-Host ("[warn] {0}: {1}" -f $entry.Key, $entry.Value)
        } else {
            Write-Host ("[warn] {0}: not found" -f $entry.Key)
        }
    }
}

function Test-HttpHealth {
    param(
        [string]$Url,
        [int]$TimeoutSec = 30
    )

    for ($i = 1; $i -le $TimeoutSec; $i++) {
        try {
            $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
            if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400) {
                return $true
            }
        } catch {
        }
        Start-Sleep -Seconds 1
    }

    return $false
}

if ($WaitUrl) {
    if (Test-HttpHealth -Url $WaitUrl -TimeoutSec $TimeoutSec) {
        Write-Host "[OK] Service is ready: $WaitUrl"
        exit 0
    }

    Write-Host "[ERROR] Timed out waiting for: $WaitUrl"
    exit 1
}

$resolvedRoot = Get-ProjectRoot -StartPath $ProjectRoot
$devEnv = Resolve-DevEnvironment -Root $resolvedRoot

if ($EmitCmdEnv) {
    Write-CmdEnvironment -EnvironmentMap $devEnv
    exit 0
}

if ($Doctor) {
    Invoke-Doctor -EnvironmentMap $devEnv
    exit 0
}
