param([switch]$NoBrowser, [int]$Port = 8770)
$ErrorActionPreference = 'Stop'
$appUrl = 'http://127.0.0.1:' + $Port + '/'
function Test-Splatitude {
  try { return (Invoke-RestMethod -Uri ($appUrl + 'health') -TimeoutSec 2).app -eq 'splatitude' }
  catch { return $false }
}
if (-not (Test-Splatitude)) {
  $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
  if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\@sparkjsdev\spark'))) {
    Push-Location $PSScriptRoot
    try { & npm.cmd ci --ignore-scripts --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' } }
    finally { Pop-Location }
  }
  $appLogs = Join-Path $PSScriptRoot '.local'
  New-Item -ItemType Directory -Path $appLogs -Force | Out-Null
  $serverFile = Join-Path $PSScriptRoot 'server.mjs'
  Start-Process -FilePath $nodePath -ArgumentList ('"' + $serverFile + '" ' + $Port) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $appLogs 'server.log') -RedirectStandardError (Join-Path $appLogs 'server-error.log') | Out-Null
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) { if (Test-Splatitude) { $ready = $true; break }; Start-Sleep -Milliseconds 250 }
  if (-not $ready) { throw 'Could not start Splatitude. See .local/server-error.log.' }
}
if (-not $NoBrowser) {
  $browserExe = @('C:\Program Files\Google\Chrome\Application\chrome.exe', 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe') | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if ($browserExe) { Start-Process -FilePath $browserExe -ArgumentList $appUrl }
  else { Start-Process $appUrl }
}
Write-Output $appUrl
