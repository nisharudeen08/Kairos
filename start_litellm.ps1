# start_litellm.ps1
$ErrorActionPreference = "Stop"
$baseDir = "d:\Downloads\PROJECT\extension"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

Write-Host "--- Stabilizing LiteLLM Environment ---" -ForegroundColor Cyan

# 1. Load Environment Variables
$envFiles = @("$baseDir\.env", "$baseDir\litellm\.env")
foreach ($file in $envFiles) {
    if (Test-Path $file) {
        Write-Host "Loading environment from $file..." -ForegroundColor Gray
        Get-Content $file | Where-Object { $_ -match '=' -and $_ -notmatch '^#' } | ForEach-Object {
            $name, $value = $_.Split('=', 2)
            [System.Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim())
        }
    }
}

# 2. Start LiteLLM
$configPath = "$baseDir\litellm\config.yaml"
Write-Host "Starting LiteLLM Proxy on port 4000..." -ForegroundColor Green
Write-Host "Config: $configPath" -ForegroundColor Gray

# Use absolute path to litellm if possible or just rely on path
& litellm --config "$configPath" --port 4000 --detailed_debug
