# Arranca el servidor Next standalone de Lumen en 127.0.0.1:3847 si no está vivo.
$ErrorActionPreference = "SilentlyContinue"
$port = 3847
try {
  $probe = Invoke-WebRequest -Uri "http://127.0.0.1:$port" -UseBasicParsing -TimeoutSec 2
  if ($probe.StatusCode -ge 200) { exit 0 }
} catch {}

$resourceRoot = $env:LUMEN_RESOURCE_DIR
if (-not $resourceRoot -or -not (Test-Path $resourceRoot)) {
  $resourceRoot = $PSScriptRoot
}

$candidates = @(
  (Join-Path $resourceRoot "out-desktop\server.js"),
  (Join-Path $resourceRoot "out-desktop\out-desktop\server.js"),
  (Join-Path (Split-Path -Parent $resourceRoot) "out-desktop\server.js")
)

# Fallback desarrollo: repo root relativo al script
$devRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$candidates += (Join-Path $devRoot "out-desktop\server.js")

$standalone = $null
foreach ($c in $candidates) {
  if (Test-Path $c) { $standalone = $c; break }
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Error "Node.js no está instalado. Instálalo desde https://nodejs.org y vuelve a abrir Lumen."
  exit 1
}
if ($standalone) {
  Start-Process -FilePath $node.Source -ArgumentList "`"$standalone`"" -WorkingDirectory (Split-Path $standalone) -WindowStyle Hidden
} else {
  Start-Process -FilePath "npm" -ArgumentList "run","start","--","--hostname","127.0.0.1","--port","$port" -WorkingDirectory $devRoot -WindowStyle Hidden
}

try {
  Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/tags" -UseBasicParsing -TimeoutSec 2 | Out-Null
} catch {
  Write-Host "Ollama no responde. Abre la pantalla de configuración en Lumen."
}
