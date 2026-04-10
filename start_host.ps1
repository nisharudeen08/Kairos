# kairos - LiteLLM Host Starter Script
# This script starts the LiteLLM proxy locally on Windows.

Write-Host "--- Starting Antigravity AI LiteLLM Host ---" -ForegroundColor Cyan

# 1. Load Environment Variables from .env
if (Test-Path ".env") {
    Write-Host "Loading .env file..." -ForegroundColor Gray
    Get-Content .env | Where-Object { $_ -match '=' -and $_ -notmatch '^#' } | ForEach-Object {
        $name, $value = $_.Split('=', 2)
        [System.Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim())
    }
} else {
    Write-Host "Error: .env file not found! Please create one with your API keys." -ForegroundColor Red
    exit
}

# 2. Add LITELLM_MASTER_KEY if missing to match extension
if (-not [System.Environment]::GetEnvironmentVariable("LITELLM_MASTER_KEY")) {
    Write-Host "Setting default Master Key (sk-KAIROS)..." -ForegroundColor Yellow
    [System.Environment]::SetEnvironmentVariable("LITELLM_MASTER_KEY", "sk-KAIROS")
}

# 3. Start LiteLLM
Write-Host "Proxy will be available at http://localhost:4000" -ForegroundColor Green
Write-Host "Using configuration: litellm/config.yaml" -ForegroundColor Gray

litellm --config "litellm/config.yaml" --port 4000 --detailed_debug
