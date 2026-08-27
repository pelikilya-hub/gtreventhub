# Мозг GTR BRO на домашнем GPU (Windows, NVIDIA).
#
# Один скрипт: ставит llama.cpp (CUDA-сборка), качает Qwen3-8B (Q4_K_M,
# ~5 ГБ), генерирует токен доступа, запускает сервер, выводит его в
# интернет через Cloudflare Tunnel, САМ прописывает адрес в продукт и
# дальше присматривает за обоими процессами. Повторный запуск ничего не
# скачивает заново — просто поднимает всё обратно.
#
# Запуск: правый клик по файлу -> "Выполнить с помощью PowerShell",
# либо в PowerShell:  powershell -ExecutionPolicy Bypass -File .\setup-brain-gpu.ps1
#
# Первый раз стоит передать ключ пульта — он есть на стенде /bro-dev:
#   powershell -ExecutionPolicy Bypass -File .\setup-brain-gpu.ps1 -PultKey <ключ>
# Ключ ложится рядом со скриптом, дальше он не нужен: скрипт сам вписывает
# адрес мозга в продукт при каждом запуске и при каждой смене адреса.
# Без ключа всё работает по-прежнему — адрес придётся отнести руками.
#
# ---- Про адрес --------------------------------------------------------
#
# Скрипт предпочитает ИМЕНОВАННЫЙ туннель на своём домене: адрес вида
# brain.gtr.events живёт вечно и переживает перезагрузку компьютера.
# Для него нужны две вещи: разовая авторизация в браузере (скрипт её
# попросит) и домен, который обслуживают серверы имён Cloudflare.
#
# Если чего-то из этого нет, поднимается quick-туннель trycloudflare.com.
# Он работает, но выдаёт НОВЫЙ адрес при каждом запуске, а старый
# перестаёт резолвиться. Именно на этом мозг однажды молча пропал из
# продукта на пять дней: адрес истёк, продукт откатился на Gemini, и
# снаружи всё выглядело исправным. Теперь смена адреса не страшна —
# скрипт замечает её сам и относит новый адрес в продукт.

param(
    # Ключ пульта со стенда /bro-dev. Достаточно передать один раз.
    [string]$PultKey = "",
    # Режим автозапуска: не задавать вопросов, которых некому услышать.
    [switch]$Unattended
)

$ErrorActionPreference = "Stop"
# Windows PowerShell 5.1 по умолчанию может ходить по старому TLS — тогда
# github.com и huggingface.co отваливаются мгновенно. Включаем TLS 1.2.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
# Прогресс-бар Invoke-WebRequest замедляет скачивание в разы — глушим.
$ProgressPreference = "SilentlyContinue"

# Под автозапуском окна нет: Read-Host там повиснет навсегда, и мозг
# будет «запущен» ровно до первой заминки, о которой никто не узнает.
function Wait-Enter($text) {
    if ($Unattended) { return }
    Read-Host $text
}

# Любая ошибка: показать её и НЕ закрывать окно, чтобы было что прислать.
trap {
    Write-Host ""
    Write-Host "!! ОШИБКА: $_" -ForegroundColor Red
    Write-Host ($_.ScriptStackTrace)
    Wait-Enter "Скопируй текст ошибки и пришли Claude. Enter — закрыть"
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
    Wait-Enter "Enter — закрыть"
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
Write-Host ">> Видеопамять: $vram МБ -> слотов $slots, контекст $ctx"

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

# ---- 5. Ключ пульта: чтобы адрес доезжал до продукта сам --------------
# Раньше адрес относил человек: скрипт печатал строку, BOSS копировал её в
# чат, Claude вписывал в KV. Каждое звено — место, где цепочка встанет, и
# она вставала. Ключ пульта разрывает эту зависимость: скрипт вписывает
# адрес сам, той же ручкой pult.brain, что и Claude.
$keyFile = "$dir\pult-key.txt"
if ($PultKey) { $PultKey.Trim() | Set-Content $keyFile -NoNewline }
elseif (Test-Path $keyFile) { $PultKey = (Get-Content $keyFile -Raw).Trim() }

$api = "https://gtr-event-hub.gtr-event.workers.dev/api/bro-dev"

function Publish-Address($url) {
    if (-not $PultKey) {
        Write-Host "   Ключа пульта нет — адрес отнеси сам: $url" -ForegroundColor Yellow
        return $false
    }
    $body = @{ action = "pult.brain"; key = $PultKey; url = $url; token = $token; model = "qwen3-8b" } |
        ConvertTo-Json -Compress
    try {
        $r = Invoke-RestMethod $api -Method Post -ContentType "application/json" `
            -Body $body -UserAgent "gtr-brain-setup" -TimeoutSec 30
        if ($r.ok) {
            Write-Host ">> Адрес прописан в продукте: $url" -ForegroundColor Green
            return $true
        }
        Write-Host "!! Продукт не принял адрес: $($r | ConvertTo-Json -Compress)" -ForegroundColor Yellow
    } catch {
        Write-Host "!! Не вышло прописать адрес ($_)." -ForegroundColor Yellow
        Write-Host "   Вот он, отнеси руками: $url" -ForegroundColor Yellow
    }
    return $false
}

# ---- 6. cloudflared ---------------------------------------------------
$cf = "$dir\cloudflared.exe"
if (-not (Test-Path $cf)) {
    Get-GithubAsset "cloudflare/cloudflared" "windows-amd64\.exe$" $cf
}

$TUNNEL = "gtr-brain"
$brainHost = "brain.gtr.events"
$brainZone = "gtr.events"
$cert = "$env:USERPROFILE\.cloudflared\cert.pem"

# Резолвится ли имя в мире, а не только в наших намерениях. Спрашиваем
# публичный DoH, а не системный резолвер: у него свой кэш и свои сюрпризы.
function Test-PublicDns($name) {
    try {
        $r = Invoke-RestMethod "https://cloudflare-dns.com/dns-query?name=$name&type=A" `
            -Headers @{ accept = "application/dns-json" } -TimeoutSec 15
        return ($r.Status -eq 0 -and $r.Answer)
    } catch {
        return $false
    }
}

if (-not (Test-Path $cert)) {
    Write-Host ""
    Write-Host "==============================================================="
    Write-Host " ПОСТОЯННЫЙ АДРЕС — разовая настройка, дальше никогда"
    Write-Host ""
    Write-Host " Сейчас откроется браузер. Выберите домен $brainZone и"
    Write-Host " подтвердите. После этого запустите скрипт ещё раз — адрес"
    Write-Host " станет https://$brainHost и больше меняться не будет."
    Write-Host ""
    Write-Host " Домена нет в списке? Значит, его серверы имён — не"
    Write-Host " Cloudflare, и постоянный адрес пока невозможен. Закройте"
    Write-Host " браузер: скрипт поднимет временный адрес и продолжит."
    Write-Host "==============================================================="
    Write-Host ""
    if (-not $Unattended) { & $cf tunnel login }
}

$named = $false
if (Test-Path $cert) {
    # Создание туннеля и маршрута идемпотентно по сути, но не по коду
    # возврата: повторный вызов ругается «уже существует». Это не ошибка,
    # поэтому смотрим не на код, а на итог.
    & $cf tunnel create $TUNNEL 2>&1 | Out-Null
    $route = (& $cf tunnel route dns --overwrite-dns $TUNNEL $brainHost 2>&1) -join "`n"
    $listed = ((& $cf tunnel list 2>&1) -join "`n") -match [regex]::Escape($TUNNEL)
    # Доказательство постоянного адреса — DNS-запись, а не наличие
    # туннеля в списке. Если зона $brainZone живёт не в Cloudflare,
    # маршрут не создастся, но сам туннель создастся прекрасно — и
    # прежняя версия скрипта на этом основании объявляла постоянным
    # адрес, которого нет в природе.
    $named = $listed -and (Test-PublicDns $brainHost)
    if (-not $named) {
        Write-Host "!! Постоянный адрес не получился. Ответ cloudflared:"
        Write-Host $route
        Write-Host "   Обычная причина: домен $brainZone обслуживают не серверы"
        Write-Host "   имён Cloudflare. Пока работаем на временном адресе."
    }
}

# ---- 7. Сервер модели -------------------------------------------------
# -ngl 99: все слои на GPU — ради этого видеокарта и нужна.
# --jinja: без него шаблон Qwen3 для вызова инструментов не
#   разворачивается, и мозг не сможет ни искать афишу, ни бронировать
#   стол — он будет просто болтать. Флаг обязателен, а не украшение.
# --parallel: сколько гостей обслуживаются одновременно. Без него
#   сервер держит ОДИН запрос за раз, и второй встаёт в очередь.
# --api-key: без токена открытый туннель станет бесплатным API для всех.
function Start-Brain {
    Get-Process llama-server -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Process -FilePath $serverExe.FullName -ArgumentList @(
        "-m", $model, "-ngl", "99", "-c", "$ctx",
        "--parallel", "$slots", "--jinja",
        "--host", "127.0.0.1", "--port", "8080", "--api-key", $token
    ) -WindowStyle Minimized
}

function Test-Brain {
    try { return (Invoke-RestMethod "http://127.0.0.1:8080/health" -TimeoutSec 5).status -eq "ok" }
    catch { return $false }
}

# Ждём, пока модель разложится по видеопамяти. Туннель, поднятый раньше
# сервера, отдаёт 502 и путает диагностику: адрес есть, мозга нет.
function Wait-Brain {
    foreach ($i in 1..60) {
        Start-Sleep -Seconds 2
        if (Test-Brain) { return $true }
    }
    return $false
}

Write-Host ">> Запускаю llama-server (порт 8080, слотов $slots)..."
Start-Brain
Write-Host ">> Жду готовности модели..."
if (-not (Wait-Brain)) {
    Write-Host "!! Модель не поднялась за две минуты. Окно llama-server свёрнуто —"
    Write-Host "   разверните его и пришлите Claude последние строки."
    Wait-Enter "Enter — закрыть"
    exit 1
}
Write-Host ">> Модель готова."

# ---- 8. Автозапуск при перезагрузке -----------------------------------
# Домашний компьютер перезагружают. Без этой задачи мозг после каждой
# перезагрузки офлайн, и узнаём мы об этом от гостя, а не от техники.
# Регистрируем всегда через -Force: задача, заведённая прошлой версией
# скрипта, не знает про -Unattended и под автозапуском повиснет на первом
# же Read-Host в невидимом окне.
$taskName = "GTR BRO brain"
try {
    $act = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Unattended"
    $trg = New-ScheduledTaskTrigger -AtLogOn
    Register-ScheduledTask -TaskName $taskName -Action $act -Trigger $trg -Force `
        -Description "Мозг GTR BRO: llama-server и туннель" | Out-Null
    Write-Host ">> Автозапуск при входе в систему настроен."
} catch {
    Write-Host "!! Автозапуск настроить не вышло ($_). Не критично: после"
    Write-Host "   перезагрузки запустите скрипт руками."
}

# ---- 9. Туннель наружу ------------------------------------------------
# cloudflared уходит в фон с логом в файл: адрес quick-туннеля он
# печатает только туда, а нам этот адрес нужен, чтобы отнести его в
# продукт. Заодно освобождается передний план — под присмотр.
$outLog = "$dir\tunnel.out.log"
$errLog = "$dir\tunnel.err.log"

function Start-Tunnel {
    Remove-Item $outLog, $errLog -Force -ErrorAction SilentlyContinue
    $a = if ($named) {
        @("--no-autoupdate", "tunnel", "run", "--url", "http://127.0.0.1:8080", $TUNNEL)
    } else {
        @("--no-autoupdate", "tunnel", "--url", "http://127.0.0.1:8080")
    }
    return Start-Process -FilePath $cf -ArgumentList $a -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog
}

# Берём ПОСЛЕДНИЙ адрес из лога: при переподключении cloudflared печатает
# новый, а первый остаётся в файле и уже никуда не ведёт.
function Get-TunnelUrl {
    $txt = ""
    foreach ($f in @($outLog, $errLog)) {
        if (Test-Path $f) { $txt += (Get-Content $f -Raw -ErrorAction SilentlyContinue) }
    }
    $m = [regex]::Matches($txt, "https://[a-z0-9-]+\.trycloudflare\.com")
    if ($m.Count -gt 0) { return $m[$m.Count - 1].Value }
    return ""
}

function Wait-TunnelUrl {
    foreach ($i in 1..45) {
        Start-Sleep -Seconds 2
        $u = Get-TunnelUrl
        if ($u) { return $u }
    }
    return ""
}

Write-Host ">> Поднимаю туннель..."
$tunnel = Start-Tunnel
$address = if ($named) { "https://$brainHost" } else { Wait-TunnelUrl }
if (-not $address) {
    Write-Host "!! Туннель не назвал адрес за полторы минуты. Лог:"
    Write-Host (Get-Content $errLog -Raw -ErrorAction SilentlyContinue)
    Wait-Enter "Пришли лог Claude. Enter — закрыть"
    exit 1
}
Publish-Address $address | Out-Null

Write-Host ""
Write-Host "==============================================================="
if ($named) {
    Write-Host " АДРЕС МОЗГА (постоянный):  $address"
} else {
    Write-Host " АДРЕС МОЗГА (временный):   $address"
    Write-Host " Он сменится при следующем запуске — это свойство quick-"
    Write-Host " туннеля, а не поломка. Новый адрес скрипт отнесёт сам."
}
Write-Host " ТОКЕН:   $token"
Write-Host " МОДЕЛЬ:  qwen3-8b"
Write-Host ""
Write-Host " Окно не закрывать: закроете — мозг офлайн, BRO уйдёт на Gemini."
Write-Host "==============================================================="
Write-Host ""

# ---- 10. Присмотр -----------------------------------------------------
# Раньше скрипт здесь заканчивался вызовом cloudflared на переднем плане:
# пока процесс жив — мозг в сети, упал — мозг офлайн до тех пор, пока
# кто-нибудь не заметит. Замечали через сутки. Теперь оба процесса под
# присмотром, а смена адреса сама доезжает до продукта.
$beat = 0
try {
    while ($true) {
        Start-Sleep -Seconds 15
        $beat++

        if ($tunnel.HasExited) {
            Write-Host ">> Туннель упал — поднимаю заново..."
            $tunnel = Start-Tunnel
            if (-not $named) {
                $new = Wait-TunnelUrl
                if ($new) { $address = $new; Publish-Address $address | Out-Null }
            }
            continue
        }

        # Quick-туннель умеет переподключиться под новым адресом, не падая.
        if (-not $named) {
            $cur = Get-TunnelUrl
            if ($cur -and $cur -ne $address) {
                Write-Host ">> Адрес сменился."
                $address = $cur
                Publish-Address $address | Out-Null
            }
        }

        if (-not (Test-Brain)) {
            Write-Host ">> Модель не отвечает — перезапускаю llama-server..."
            Start-Brain
            if (-not (Wait-Brain)) { Write-Host "!! Модель не поднялась. Пробую дальше." }
        }

        # Раз в десять минут переписываем адрес заново: если его затёрли со
        # стенда или KV разъехался, само вернётся на место без человека.
        if ($beat % 40 -eq 0) { Publish-Address $address | Out-Null }
    }
} finally {
    Write-Host ""
    Write-Host ">> Останавливаю туннель и модель..."
    if ($tunnel -and -not $tunnel.HasExited) {
        Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
    }
    Get-Process llama-server -ErrorAction SilentlyContinue | Stop-Process -Force
}
