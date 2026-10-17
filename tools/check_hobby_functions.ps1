# Auditoría local sin dependencias: ejecutar desde la raíz de Plataforma Jaguar.
$api = Join-Path (Get-Location) "api"
if (-not (Test-Path $api)) { Write-Error "No se encontró la carpeta api. Abre la raíz de Plataforma Jaguar."; exit 1 }
$files = @(Get-ChildItem -LiteralPath $api -File | Where-Object { $_.Extension -in '.js','.mjs','.ts' })
Write-Host "Funciones Serverless en api/: $($files.Count) / 12" -ForegroundColor Cyan
$files | ForEach-Object { Write-Host "  $($_.Name)" }
if ($files.Count -gt 12) { Write-Error "El proyecto aún supera el máximo de Hobby. Revisa los archivos antiguos."; exit 1 }
$mustNotExist = @('academic-tools.js','classroom.js','google-classroom.js','google-oauth.js','teacher.js','documentos.js','responsables.js')
$remaining = @($mustNotExist | Where-Object { Test-Path (Join-Path $api $_) })
if ($remaining.Count -gt 0) { Write-Error "Aún quedan rutas antiguas en api/: $($remaining -join ', '). Elimínalas después de comprobar que sus módulos están en routes/ o lib/."; exit 1 }
if (-not (Test-Path './vercel.json')) { Write-Error "Falta vercel.json"; exit 1 }
Write-Host "✓ Estructura Hobby correcta" -ForegroundColor Green
