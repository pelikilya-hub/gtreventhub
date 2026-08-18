# Мозг GTR BRO на домашнем GPU (Windows, NVIDIA).
#
# Один скрипт: ставит llama.cpp (CUDA-сборка), качает Qwen3-8B (Q4_K_M,
# ~5 ГБ), генерирует токен доступа, запускает сервер и выводит его в
# интернет через Cloudflare Tunnel. Повторный запуск ничего не скачивает
# заново — просто стартует сервер и туннель.
#
# Запуск: правый клик по файлу -> "Выполнить с помощью PowerShell",
# либо в PowerShell:  powershell -ExecutionPolicy Bypass -File .\setup-brain-gpu.ps1
#
# На выходе печатает URL туннеля и токен — их вписать на стенде
# /bro-dev -> Настройки -> "Запасной мозг" (или отдать Claude).
#
# ВАЖНО: quick-туннель trycloudflare.com меняет адрес при каждом
# перезапуске — после рестарта обновите URL на стенде. Для постоянного
# адреса нужен именованный туннель на своём домене в Cloudflare.

$ErrorActionPreference = "Stop"
# Windows PowerShell 5.1 по умолчанию может ходить по старому TLS — тогда
# github.com и huggingface.co отваливаются мгновенно. Включаем TLS 1.2.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
# Прогресс-бар Invoke-WebRequest замедляет скачивание в разы — глушим.
$ProgressPreference = "SilentlyContinue"

# Любая ошибка: показать её и НЕ закрывать окно, чтобы было что прислать.
trap {
    Write-Host ""
    Write-Host "!! ОШИБКА: $_" -ForegroundColor Red
    Write-Host ($_.ScriptStackTrace)
    Read-Host "Скопируй текст ошибки и пришли Claude. Enter — закрыть"
    exit 1
}

$dir = "$env:USERPROFILE\gtr-brain"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Set-Location $dir

function Get-GithubAsset($repo, $pattern, $out) {
    if (Test-Path $out) { return }
    Write-Host ">> Скачиваю $pattern из $repo ..."
    $rel = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
    $asset = $rel.assets | Where-Object { $_.name -match $pattern } | Select-Object -First 1
    if (-not $asset) { throw "Не нашёл ассет $pattern в $repo — проверьте вручную." }
    Invoke-WebRequest $asset.browser_download_url -OutFile $out
}

# ---- 1. Проверка GPU --------------------------------------------------
try {
    $gpu = & nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
    Write-Host ">> GPU: $gpu"
} catch {
    Write-Host "!! nvidia-smi не найден — поставьте драйвер NVIDIA и повторите."
    Read-Host "Enter — закрыть"
    exit 1
}

# ---- 2. llama.cpp (CUDA) ---------------------------------------------
if (-not (Test-Path "$dir\llama\llama-server.exe")) {
    Get-GithubAsset "ggml-org/llama.cpp" "bin-win-cuda.*x64\.zip$" "$dir\llama-cuda.zip"
    Get-GithubAsset "ggml-org/llama.cpp" "cudart-.*win.*x64\.zip$" "$dir\cudart.zip"
    Expand-Archive "$dir\llama-cuda.zip" -DestinationPath "$dir\llama" -Force
    Expand-Archive "$dir\cudart.zip"     -DestinationPath "$dir\llama" -Force
    # В некоторых релизах бинарники лежат во вложенной папке — поднимаем.
    $exe = Get-ChildItem "$dir\llama" -Recurse -Filter "llama-server.exe" | Select-Object -First 1
    if ($exe.DirectoryName -ne "$dir\llama") {
        Move-Item "$($exe.DirectoryName)\*" "$dir\llama" -Force
    }
}

# ---- 3. Модель: Qwen3-8B Q4_K_M (~5 ГБ) ------------------------------
$model = "$dir\Qwen3-8B-Q4_K_M.gguf"
if (-not (Test-Path $model)) {
    Write-Host ">> Скачиваю Qwen3-8B Q4_K_M (~5 ГБ, один раз)..."
    Invoke-WebRequest "https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf" -OutFile $model
}

# ---- 4. Токен доступа -------------------------------------------------
$tokenFile = "$dir\token.txt"
if (-not (Test-Path $tokenFile)) {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    ([System.BitConverter]::ToString($bytes) -replace "-", "").ToLower() | Set-Content $tokenFile -NoNewline
}
$token = Get-Content $tokenFile

# ---- 5. cloudflared ---------------------------------------------------
$cf = "$dir\cloudflared.exe"
if (-not (Test-Path $cf)) {
    Get-GithubAsset "cloudflare/cloudflared" "windows-amd64\.exe$" $cf
}

# ---- 6. Запуск сервера модели ----------------------------------------
# -ngl 99: вся модель на GPU; -c 8192: контекст; --api-key: без токена
# сервер не отвечает — публичный туннель не станет бесплатным API для всех.
Write-Host ">> Запускаю llama-server (порт 8080, вся модель на GPU)..."
Start-Process -FilePath "$dir\llama\llama-server.exe" -ArgumentList @(
    "-m", $model, "-ngl", "99", "-c", "8192",
    "--host", "127.0.0.1", "--port", "8080", "--api-key", $token
) -WindowStyle Minimized

Start-Sleep -Seconds 5

# ---- 7. Туннель наружу ------------------------------------------------
Write-Host ">> Поднимаю Cloudflare Tunnel (адрес появится ниже)..."
Write-Host ""
Write-Host "==============================================================="
Write-Host " КОГДА НИЖЕ ПОЯВИТСЯ АДРЕС https://…trycloudflare.com :"
Write-Host ""
Write-Host " 1. Открой стенд /bro-dev -> Настройки -> 'Запасной мозг'"
Write-Host "    URL:    (адрес туннеля из строки ниже)"
Write-Host "    токен:  $token"
Write-Host "    модель: qwen3-8b"
Write-Host " 2. Или пришли адрес Claude — он впишет сам."
Write-Host ""
Write-Host " Окно не закрывать: закроешь — мозг офлайн (BRO откатится на"
Write-Host " Gemini). Адрес меняется при каждом перезапуске туннеля."
Write-Host "==============================================================="
Write-Host ""
& $cf tunnel --url http://127.0.0.1:8080
