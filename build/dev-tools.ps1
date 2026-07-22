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

function Resolve-VsEnvironmentScript {
    $explicitCandidates = @($env:MAXMA_VCVARS, $env:VSDEVCMD)
    foreach ($candidate in $explicitCandidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    $vswhereCandidates = @()
    $vswhereFromPath = Get-CommandPath "vswhere"
    if ($vswhereFromPath) {
        $vswhereCandidates += $vswhereFromPath
    }
    if (${env:ProgramFiles(x86)}) {
        $vswhereCandidates += Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    }
    if ($env:ProgramFiles) {
        $vswhereCandidates += Join-Path $env:ProgramFiles "Microsoft Visual Studio\Installer\vswhere.exe"
    }

    foreach ($vswhere in ($vswhereCandidates | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $vswhere -PathType Leaf)) {
            continue
        }

        $installationPath = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null | Select-Object -First 1)
        if ($installationPath) {
            $installationPath = $installationPath.Trim()
            foreach ($candidate in @(
                (Join-Path $installationPath "VC\Auxiliary\Build\vcvars64.bat"),
                (Join-Path $installationPath "Common7\Tools\VsDevCmd.bat")
            )) {
                if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                    return (Resolve-Path -LiteralPath $candidate).Path
                }
            }
        }
    }

    throw "Unable to locate Visual Studio build environment. Set MAXMA_VCVARS or install VS Build Tools with the C++ workload."
}

function Resolve-WindowsSdkBin {
    param([hashtable]$VsEnvironment)

    $candidates = @()
    foreach ($base in @($VsEnvironment["WindowsSdkVerBinPath"], $VsEnvironment["WindowsSdkBinPath"])) {
        if ($base) {
            $candidates += $base
            $candidates += Join-Path $base "x64"
        }
    }

    if (${env:ProgramFiles(x86)}) {
        $sdkBinRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
        if (Test-Path -LiteralPath $sdkBinRoot -PathType Container) {
            $candidates += Get-ChildItem -LiteralPath $sdkBinRoot -Directory |
                Sort-Object Name -Descending |
                ForEach-Object { Join-Path $_.FullName "x64" }
        }
    }

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (Test-Path (Join-Path $candidate "rc.exe") -PathType Leaf) {
            return (Resolve-Path $candidate).Path
        }
    }

    throw "Unable to locate Windows SDK x64 tools. Install the Windows 10/11 SDK with VS Build Tools."
}

function Resolve-DevEnvironment {
    param([string]$Root)

    $cargoFromPath = Get-CommandPath "cargo"
    $rustupFromPath = Get-CommandPath "rustup"

    $cargoPath = $null
    if ($cargoFromPath -and (Test-Path -LiteralPath $cargoFromPath -PathType Leaf)) {
        $cargoPath = (Resolve-Path -LiteralPath $cargoFromPath).Path
    } elseif ($env:CARGO_HOME) {
        $candidate = Join-Path $env:CARGO_HOME "bin\cargo.exe"
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $cargoPath = (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    if (-not $cargoPath) {
        throw "Unable to locate cargo.exe. Add Rust's cargo\bin to PATH or set CARGO_HOME."
    }

    $cargoBin = Split-Path $cargoPath -Parent
    $cargoHome = if ($env:CARGO_HOME -and (Test-Path -LiteralPath $env:CARGO_HOME -PathType Container)) {
        (Resolve-Path $env:CARGO_HOME).Path
    } else {
        (Split-Path $cargoBin -Parent)
    }

    $rustupCandidates = @()
    if ($env:RUSTUP_HOME) {
        $rustupCandidates += $env:RUSTUP_HOME
    }
    if ($rustupFromPath) {
        $reportedRustupHome = (& $rustupFromPath show home 2>$null | Select-Object -First 1)
        if ($reportedRustupHome) {
            $rustupCandidates += $reportedRustupHome.Trim()
        }
    }
    if ($env:USERPROFILE) {
        $rustupCandidates += Join-Path $env:USERPROFILE ".rustup"
    }
    $rustupHome = Get-FirstExistingPath -Candidates $rustupCandidates

    if (-not $rustupHome) {
        throw "Unable to locate RUSTUP_HOME. Add rustup to PATH or set RUSTUP_HOME."
    }

    $vcvars64 = Resolve-VsEnvironmentScript

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

    $winSdkBin = Resolve-WindowsSdkBin -VsEnvironment $vsEnv

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
