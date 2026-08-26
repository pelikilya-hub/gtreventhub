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
# ---- Про адрес --------------------------------------------------------
#
# Скрипт предпочитает ИМЕНОВАННЫЙ туннель на своём домене: адрес вида
# brain.gtr.events живёт вечно и переживает перезагрузку компьютера.
# Для него нужна разовая авторизация в браузере — скрипт её попросит.
#
# Если авторизации нет, поднимается quick-туннель trycloudflare.com. Он
# работает, но выдаёт НОВЫЙ адрес при каждом запуске, а старый перестаёт
# резолвиться. Именно на этом мозг однажды молча пропал из продукта на
# пять дней: адрес истёк, продукт откатился на Gemini, и снаружи всё
# выглядело исправным. Поэтому quick — только как временная мера.

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

# Сколько видеопамяти — от этого зависит, сколько гостей мозг обслужит
# разом. Слоты не бесплатны: контекст делится между ними, и каждый слот
# держит свой кэш внимания в той же памяти, где лежит сама модель.
$vram = 0
if ("$gpu" -match "(\d+)\s*MiB") { $vram = [int]$Matches[1] }
if ($vram -ge 16000) {
    $slots = 3; $ctx = 12288      # 4096 на слот
} elseif ($vram -ge 11000) {
    $slots = 3; $ctx = 9216       # 3072 на слот
} elseif ($vram -ge 8000) {
    $slots = 2; $ctx = 6144       # 3072 на слот
} else {
    $slots = 1; $ctx = 4096
    Write-Host "!! Видеопамяти меньше 8 ГБ — один слот. Второй одновременный"
    Write-Host "   гость встанет в очередь и не успеет за 26 секунд."
}
Write-Host ">> Видеопамять: $vram МБ -> слотов $slots, контекст $ctx

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

# Именованный туннель возможен, только если пользователь один раз вошёл в
# Cloudflare: вход кладёт сертификат в %USERPROFILE%\.cloudflared\cert.pem.
# Его наличие — единственный честный признак; спрашивать человека
# «вы авторизовались?» бессмысленно, он не обязан помнить.
$TUNNEL = "gtr-brain"
$HOSTNAME = "brain.gtr.events"
$cert = "$env:USERPROFILE\.cloudflared\cert.pem"

if (-not (Test-Path $cert)) {
    Write-Host ""
    Write-Host "==============================================================="
    Write-Host " ПОСТОЯННЫЙ АДРЕС — разовая настройка, дальше никогда"
    Write-Host ""
    Write-Host " Сейчас откроется браузер. Выберите домен gtr.events и"
    Write-Host " подтвердите. После этого запустите скрипт ещё раз — адрес"
    Write-Host " станет https://$HOSTNAME и больше меняться не будет."
    Write-Host ""
    Write-Host " Не хотите сейчас — закройте браузер, скрипт поднимет"
    Write-Host " временный адрес и продолжит работать."
    Write-Host "==============================================================="
    Write-Host ""
    & $cf tunnel login
}

$named = $false
if (Test-Path $cert) {
    # Создание туннеля и маршрута идемпотентно по сути, но не по коду
    # возврата: повторный вызов ругается «уже существует». Это не ошибка,
    # поэтому глушим вывод и смотрим только на итог — есть ли туннель.
    & $cf tunnel create $TUNNEL 2>&1 | Out-Null
    & $cf tunnel route dns --overwrite-dns $TUNNEL $HOSTNAME 2>&1 | Out-Null
    $list = (& $cf tunnel list 2>&1) -join "`n"
    if ($list -match [regex]::Escape($TUNNEL)) { $named = $true }
    if (-not $named) {
        Write-Host "!! Именованный туннель не поднялся. Вывод cloudflared:"
        Write-Host $list
        Write-Host "   Продолжаю на временном адресе."
    }
}

# ---- 6. Запуск сервера модели ----------------------------------------
# -ngl 99: все слои на GPU — ради этого видеокарта и нужна.
# --jinja: без него шаблон Qwen3 для вызова инструментов не
#   разворачивается, и мозг не сможет ни искать афишу, ни бронировать
#   стол — он будет просто болтать. Флаг обязателен, а не украшение.
# --parallel: сколько гостей обслуживаются одновременно. Без него
#   сервер держит ОДИН запрос за раз, и второй встаёт в очередь.
# --api-key: без токена открытый туннель станет бесплатным API для всех.
Write-Host ">> Запускаю llama-server (порт 8080, слотов $slots)..."
Get-Process llama-server -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process -FilePath $serverExe.FullName -ArgumentList @(
    "-m", $model, "-ngl", "99", "-c", "$ctx",
    "--parallel", "$slots", "--jinja",
    "--host", "127.0.0.1", "--port", "8080", "--api-key", $token
) -WindowStyle Minimized

# Ждём, пока модель разложится по видеопамяти. Туннель, поднятый раньше
# сервера, отдаёт 502 и путает диагностику: адрес есть, мозга нет.
Write-Host ">> Жду готовности модели..."
$ready = $false
foreach ($i in 1..60) {
    Start-Sleep -Seconds 2
    try {
        $h = Invoke-RestMethod "http://127.0.0.1:8080/health" -TimeoutSec 3
        if ($h.status -eq "ok") { $ready = $true; break }
    } catch { }
}
if (-not $ready) {
    Write-Host "!! Модель не поднялась за две минуты. Окно llama-server свёрнуто —"
    Write-Host "   разверните его и пришлите Claude последние строки."
    Read-Host "Enter — закрыть"
    exit 1
}
Write-Host ">> Модель готова."

# ---- 7. Автозапуск при перезагрузке -----------------------------------
# Домашний компьютер перезагружают. Без этой задачи мозг после каждой
# перезагрузки офлайн, и узнаём мы об этом от гостя, а не от техники.
$taskName = "GTR BRO brain"
try {
    if (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) {
        $act = New-ScheduledTaskAction -Execute "powershell.exe" `
            -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`""
        $trg = New-ScheduledTaskTrigger -AtLogOn
        Register-ScheduledTask -TaskName $taskName -Action $act -Trigger $trg `
            -Description "Мозг GTR BRO: llama-server и туннель" | Out-Null
        Write-Host ">> Автозапуск при входе в систему настроен."
    }
} catch {
    Write-Host "!! Автозапуск настроить не вышло ($_). Не критично: после"
    Write-Host "   перезагрузки запустите скрипт руками."
}

# ---- 8. Туннель наружу ------------------------------------------------
Write-Host ""
Write-Host "==============================================================="
if ($named) {
    Write-Host " АДРЕС МОЗГА (постоянный):  https://$HOSTNAME"
} else {
    Write-Host " ВРЕМЕННЫЙ адрес появится ниже строкой trycloudflare.com."
    Write-Host " Он умрёт при следующем запуске — это не поломка, а свойство."
}
Write-Host " ТОКЕН:   $token"
Write-Host " МОДЕЛЬ:  qwen3-8b"
Write-Host ""
Write-Host " Впишите на стенде /bro-dev -> Настройки -> 'Запасной мозг',"
Write-Host " либо отдайте эти три строки Claude — он впишет сам."
Write-Host ""
Write-Host " Окно не закрывать: закроете — мозг офлайн, BRO уйдёт на Gemini."
Write-Host "==============================================================="
Write-Host ""

if ($named) {
    & $cf tunnel run --url http://127.0.0.1:8080 $TUNNEL
} else {
    & $cf tunnel --url http://127.0.0.1:8080
}
