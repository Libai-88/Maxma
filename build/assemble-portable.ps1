$PROJECT_ROOT = "D:\Maxma\MaxmaHere"
$PORTABLE_DIR = "D:\MaxmaHere-Portable"
$TAURI_RELEASE_DIR = "$PROJECT_ROOT\desktop\src-tauri\target\release"
$SIDECAR_BUILD_DIR = "$PROJECT_ROOT\desktop\src-tauri\dist"
$DIST_DIR = "$PROJECT_ROOT\web\dist"

Write-Host "[5/6] Assembling portable layout..."
if (Test-Path $PORTABLE_DIR) { Remove-Item -Path $PORTABLE_DIR -Recurse -Force }
New-Item -ItemType Directory -Path $PORTABLE_DIR -Force | Out-Null

Write-Host "Copying maxma-here.exe..."
Copy-Item -Path "$TAURI_RELEASE_DIR\maxma-here.exe" -Destination "$PORTABLE_DIR\maxma-here.exe" -Force

Write-Host "Copying maxma-server.exe..."
Copy-Item -Path "$SIDECAR_BUILD_DIR\maxma-server.exe" -Destination "$PORTABLE_DIR\maxma-server.exe" -Force

Write-Host "Copying _internal directory..."
Copy-Item -Path "$SIDECAR_BUILD_DIR\_internal" -Destination "$PORTABLE_DIR\_internal" -Recurse -Force

Write-Host "Copying frontend dist..."
Copy-Item -Path $DIST_DIR -Destination "$PORTABLE_DIR\dist" -Recurse -Force

Write-Host "Copying Tauri resources..."
Copy-Item -Path "$TAURI_RELEASE_DIR\resources" -Destination "$PORTABLE_DIR\resources" -Recurse -Force

Write-Host "[6/6] Creating portable mode marker and data directory..."
$marker = "MaxmaHere Portable Mode Marker`nversion=2.6.6`nbuilt=$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$marker | Out-File -FilePath "$PORTABLE_DIR\portable.flag" -Encoding UTF8

New-Item -ItemType Directory -Path "$PORTABLE_DIR\data" -Force | Out-Null
New-Item -ItemType Directory -Path "$PORTABLE_DIR\data\api\data" -Force | Out-Null

if (Test-Path "$PROJECT_ROOT\desktop\src-tauri\resources\default-config\mcp_servers.yaml") {
    Copy-Item -Path "$PROJECT_ROOT\desktop\src-tauri\resources\default-config\mcp_servers.yaml" -Destination "$PORTABLE_DIR\data\api\data\mcp_servers.yaml" -Force -ErrorAction SilentlyContinue
}

$readmeContent = "MaxmaHere Portable - See documentation for details"
$readmeContent | Out-File -FilePath "$PORTABLE_DIR\PORTABLE_README.txt" -Encoding UTF8

Write-Host "Portable build complete: $PORTABLE_DIR"
