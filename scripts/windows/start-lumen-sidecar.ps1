# Arranca el servidor Next standalone de Lumen en 127.0.0.1:3847 si no está vivo.
$ErrorActionPreference = "SilentlyContinue"
$port = 3847
try {
  $probe = Invoke-WebRequest -Uri "http://127.0.0.1:$port" -UseBasicParsing -TimeoutSec 2
  if ($probe.StatusCode -ge 200) { exit 0 }
} catch {}

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path $root)) {
  $root = Join-Path $PSScriptRoot "..\.."
}
$standalone = Join-Path $root "out-desktop\server.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error "Node.js no está instalado. Instálalo desde https://nodejs.org y vuelve a abrir Lumen."
  exit 1
}
if (Test-Path $standalone) {
  Start-Process -FilePath $node.Source -ArgumentList $standalone -WorkingDirectory (Split-Path $standalone) -WindowStyle Hidden
} else {
  # Fallback desarrollo
  Start-Process -FilePath "npm" -ArgumentList "run","start","--","--hostname","127.0.0.1","--port","$port" -WorkingDirectory $root -WindowStyle Hidden
}

# Comprueba Ollama (no bloquea si falta: la UI de primera configuración guía).
try {
  Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 2 | Out-Null
} catch {
  Write-Host "Ollama no responde. Abre la pantalla de configuración en Lumen."
}
