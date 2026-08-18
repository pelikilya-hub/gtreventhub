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

# Качаем потоково через WebClient: Invoke-WebRequest в PowerShell 5.1
# держит весь файл в памяти — на модели в 5 ГБ это конец.
function Get-File($url, $out) {
    (New-Object System.Net.WebClient).DownloadFile($url, $out)
}

function Get-GithubAsset($repo, $pattern, $out) {
    if (Test-Path $out) { return }
    Write-Host ">> Скачиваю $pattern из $repo ..."
    $rel = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest"
    $asset = $rel.assets | Where-Object { $_.name -match $pattern } | Select-Object -First 1
    if (-not $asset) { throw "Не нашёл ассет $pattern в $repo — проверьте вручную." }
    Get-File $asset.browser_download_url $out
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
# Ничего не перемещаем: находим llama-server.exe где бы он ни лежал в
# распакованном архиве и запускаем прямо оттуда; cudart-DLL кладём рядом.
# Чужие папки, случайно перенесённые с C:\ первым (багованным) прогоном —
# возвращаем на место, чтобы не мешали и не потерялись.
$stray = Get-ChildItem "$dir\llama" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "^[0-9a-f]{16,}$" -or $_.Name -in @("Cakewalk", "common_attachment", "inetpub", "PerfLogs", "Intel") }
foreach ($s in $stray) {
    Write-Host ">> Возвращаю на C:\ случайно перенесённую папку: $($s.Name)"
    try { Move-Item $s.FullName "C:\" -Force } catch { Write-Host "   не вышло ($_) — верни вручную" }
}

$find = { Get-ChildItem "$dir\llama" -Recurse -Filter "llama-server.exe" -Force -ErrorAction SilentlyContinue |
    Select-Object -First 1 }
$serverExe = & $find
if (-not $serverExe) {
    # Старые архивы могли скачаться не те (шаблон цеплял cudart вместо
    # сервера) — сносим кэш и качаем заново по точным именам.
    Remove-Item "$dir\llama-cuda.zip", "$dir\cudart.zip" -Force -ErrorAction SilentlyContinue
    Get-GithubAsset "ggml-org/llama.cpp" "^llama-.*bin-win-cuda-12\.4-x64\.zip$" "$dir\llama-cuda.zip"
    Expand-Archive "$dir\llama-cuda.zip" -DestinationPath "$dir\llama" -Force
    $serverExe = & $find
    if (-not $serverExe) {
        Write-Host "Содержимое архива:"
        Get-ChildItem "$dir\llama" -Recurse -ErrorAction SilentlyContinue | Select-Object -Expand FullName
        throw "llama-server.exe не найден в скачанном архиве — пришли Claude список выше."
    }
    Get-GithubAsset "ggml-org/llama.cpp" "^cudart-.*cuda-12\.4-x64\.zip$" "$dir\cudart.zip"
    Expand-Archive "$dir\cudart.zip" -DestinationPath $serverExe.DirectoryName -Force
}

# ---- 3. Модель: Qwen3-8B Q4_K_M (~5 ГБ) ------------------------------
$model = "$dir\Qwen3-8B-Q4_K_M.gguf"
if (-not (Test-Path $model)) {
    Write-Host ">> Скачиваю Qwen3-8B Q4_K_M (~5 ГБ, один раз — наберись терпения)..."
    Get-File "https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf" $model
}

# ---- 4. Токен доступа -------------------------------------------------
$tokenFile = "$dir\token.txt"
if (-not (Test-Path $tokenFile)) {
    # RNGCryptoServiceProvider — работает и в старом Windows PowerShell 5.1,
    # где у RandomNumberGenerator ещё нет статического Fill().
    $bytes = New-Object byte[] 24
    (New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($bytes)
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
Start-Process -FilePath $serverExe.FullName -ArgumentList @(
    "-m", $model, "-ngl", "99", "-c", "6144",
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
