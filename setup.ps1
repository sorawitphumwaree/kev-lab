$ErrorActionPreference = 'Stop'
$uv = Join-Path $PSScriptRoot '.tools\uv.exe'
$env:UV_CACHE_DIR = Join-Path $PSScriptRoot '.runtime\uv-cache'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $PSScriptRoot '.runtime\python'
$sha = '2ecafc49fe1e8945cd600443e6c04c1cf0b3a78f'
$source = Join-Path $PSScriptRoot ".runtime\kev-$sha"
New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot '.tools'),(Join-Path $PSScriptRoot '.runtime') -Force | Out-Null
if (-not (Test-Path -LiteralPath $uv)) {
    $uvArchive = Join-Path $PSScriptRoot '.runtime\uv.zip'
    Invoke-WebRequest -Uri 'https://github.com/astral-sh/uv/releases/download/0.12.10/uv-x86_64-pc-windows-msvc.zip' -OutFile $uvArchive
    $expectedHash = 'f65744f94072152b1f86ba2aace4d01f1124d9a8ecb235805039e3718c36cac2'
    if ((Get-FileHash -LiteralPath $uvArchive -Algorithm SHA256).Hash -ne $expectedHash) { throw 'uv archive checksum mismatch.' }
    Expand-Archive -LiteralPath $uvArchive -DestinationPath (Join-Path $PSScriptRoot '.tools') -Force
}
if (-not (Test-Path -LiteralPath "$source\pyproject.toml")) {
    $sourceArchive = Join-Path $PSScriptRoot '.runtime\upstream.zip'
    Invoke-WebRequest -Uri "https://github.com/jaredpalmer/kev/archive/$sha.zip" -OutFile $sourceArchive
    Expand-Archive -LiteralPath $sourceArchive -DestinationPath (Join-Path $PSScriptRoot '.runtime') -Force
}
$sha | Set-Content -LiteralPath (Join-Path $PSScriptRoot '.runtime\upstream-commit.txt') -Encoding utf8
& $uv python install 3.13.15 --no-registry --no-bin --no-config
if ($LASTEXITCODE -ne 0) { throw 'Python installation failed.' }
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    & $uv venv (Join-Path $PSScriptRoot '.venv') --python 3.13.15 --managed-python --no-config
    if ($LASTEXITCODE -ne 0) { throw 'Virtual environment creation failed.' }
}
& $uv pip install --python $python --torch-backend cu128 --no-config -r (Join-Path $PSScriptRoot 'requirements.txt') "$source[serve]"
if ($LASTEXITCODE -ne 0) { throw 'Package installation failed.' }
Write-Host 'Ready. Run ./start.ps1 and open http://127.0.0.1:8018.'
