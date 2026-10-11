$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot '.venv\Scripts\python.exe') (Join-Path $PSScriptRoot 'stop.py')
if ($LASTEXITCODE -ne 0) { throw 'Could not stop the local playground.' }
