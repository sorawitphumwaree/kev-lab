param([ValidateRange(1024, 65535)][int]$Port = 8018)
$ErrorActionPreference = 'Stop'
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'Runtime missing. Run setup.ps1 first.' }
$existing = $null
$modelRun = 'jaredpalmer/kev-0.8b@bf75a6a8848ea6960ff2ed108d9ed44c2941174f'
try { $existing = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/lab/info" -TimeoutSec 2 } catch { }
if ($existing -and $existing.application -eq 'kev-local-lab' -and $existing.model_run -eq $modelRun) {
    Write-Host "Kev Local Lab is already running. Open http://127.0.0.1:$Port."
    return
}
$probe = [System.Net.Sockets.TcpClient]::new()
try {
    $connection = $probe.ConnectAsync('127.0.0.1', $Port)
    try { $null = $connection.Wait(500) } catch { }
    if ($probe.Connected) { throw "Port $Port is occupied by another service. Stop it or use -Port with a different port." }
} finally { $probe.Dispose() }
$env:HF_HOME = Join-Path $PSScriptRoot '.runtime\model-cache'
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = '1'
$env:PYTHONUNBUFFERED = '1'
$env:KEV_FUSED = '0'
$env:KEV_CUDA_GRAPHS = '0'
$env:KEV_PREFIX_CACHE = '2'
$env:KEV_PREFIX_MAX_TOKENS = '4096'
$env:KEV_BACKEND = 'torch'
$env:KEV_DTYPE = 'bf16'
$env:KEV_TRUNCATE_STATES = '0'
$env:KEV_DATE_FACTS = '0'
if ($env:KEV_API_KEY) { throw 'Unset KEV_API_KEY in this shell before starting the local browser lab.' }
& $python (Join-Path $PSScriptRoot 'lab.py') --run $modelRun --device cuda --host 127.0.0.1 --port $Port
if ($LASTEXITCODE -ne 0) { throw "Kev exited with code $LASTEXITCODE" }
