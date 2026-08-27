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
# Первый раз запускать ОТ ИМЕНИ АДМИНИСТРАТОРА и с ключом пульта (ключ
# есть на стенде /bro-dev):
#   powershell -ExecutionPolicy Bypass -File .\setup-brain-gpu.ps1 -PultKey <ключ>
# Ключ ложится в рабочую папку, дальше он не нужен: скрипт сам вписывает
# адрес мозга в продукт при каждом запуске и при каждой смене адреса.
# Без ключа всё работает по-прежнему — адрес придётся отнести руками.
#
# ---- Про автозапуск ---------------------------------------------------
#
# Мозг поднимается ПРИ ЗАГРУЗКЕ Windows и работает от имени SYSTEM. Это не
# придирка к настройке, а единственный способ пережить две обычные вещи:
# компьютер перезагрузили и никто ещё не вошёл в систему, и на компьютере
# сменили пользователя. Задача, привязанная к входу конкретного человека,
# в обоих случаях либо не стартует, либо умирает вместе с его сеансом — а
# гость в это время спрашивает BRO про сегодняшний вечер.
#
# Отсюда же фиксированная рабочая папка C:\gtr-brain вместо профиля
# пользователя: у SYSTEM профиль свой, и модель на 5 ГБ уехала бы качаться
# заново. Старую папку из профиля скрипт перенесёт сам.
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
    [switch]$Unattended,
    # Рабочая папка. Машинная, а не в профиле: под SYSTEM профиль другой.
    [string]$Dir = "C:\gtr-brain",
    # Имя для постоянного адреса. Пусто — просим у cloudflared метку
    # «brain» и берём то имя, которое он создаст в вашей зоне.
    [string]$BrainHost = ""
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

$dir = $Dir
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# Раньше всё лежало в профиле пользователя. Под SYSTEM это другая папка,
# поэтому переносим — иначе первый же запуск от SYSTEM пойдёт качать пять
# гигабайт модели заново. В пределах одного диска это переименование,
# то есть мгновенно.
$legacy = "$env:USERPROFILE\gtr-brain"
if ((Test-Path $legacy) -and $legacy -ne $dir) {
    Write-Host ">> Переношу $legacy -> $dir ..."
    foreach ($f in Get-ChildItem $legacy -Force) {
        $to = Join-Path $dir $f.Name
        if (Test-Path $to) { continue }
        try { Move-Item $f.FullName $to -Force } catch { Write-Host "   пропускаю $($f.Name): $_" }
    }
}

Set-Location $dir

# Под SYSTEM консоли нет и Write-Host уходит в пустоту. Без журнала любой
# отказ автозапуска неотличим от выключенного компьютера — ровно та беда,
# из-за которой мозг однажды лежал неделю. Пишем всё в файл.
if ($Unattended) {
    try { Start-Transcript -Path "$dir\brain.log" -Append -Force | Out-Null } catch { }
}

# Качаем потоково через WebClient: Invoke-WebRequest в PowerShell 5.1
# держит весь файл в памяти — на модели в 5 ГБ это конец.
function Get-File($url, $out) {
    (New-Object System.Net.WebClient).DownloadFile($url, $out)
}

# Ищем ассет по списку релизов, а не через /releases/latest.
#
# Все сборки llama.cpp помечены пре-релизом, а /releases/latest в API
# пре-релизы ИСКЛЮЧАЕТ: он отдавал отдельный релиз v0.3.0 с тремя файлами,
# где Windows-бинарников нет вовсе. Отсюда «не нашёл ассет» на ровном
# месте, хотя файл лежит в соседней сборке.
#
# Шаблоны идут списком по убыванию предпочтения. Приоритет у шаблона, а не
# у свежести: сборка с нужным ускорителем позавчерашняя лучше вчерашней
# без него. Внутри одного шаблона берём самый свежий релиз.
function Find-GithubAsset($repo, $patterns, $take = 15) {
    try {
        $rels = Invoke-RestMethod "https://api.github.com/repos/$repo/releases?per_page=$take"
    } catch {
        # У API GitHub без токена лимит 60 запросов в час на адрес. При
        # превышении приходит 403, и «ассет не найден» означало бы совсем
        # не то, что написано. Отличаем явно.
        throw "GitHub API не ответил ($_). Если это 403 — исчерпан часовой лимит запросов, подожди час и повтори."
    }
    foreach ($pat in $patterns) {
        foreach ($r in $rels) {
            $a = $r.assets | Where-Object { $_.name -match $pat } | Select-Object -First 1
            if ($a) { return @{ asset = $a; release = $r; pattern = $pat } }
        }
    }
    # Отказ обязан быть разбираемым с первого раза: показываем, что именно
    # искали и что при этом видели. Иначе разбор идёт по третьему кругу.
    Write-Host ""
    Write-Host "!! Ни один шаблон не совпал. Искали:" -ForegroundColor Yellow
    foreach ($pat in $patterns) { Write-Host "   $pat" }
    Write-Host "!! Просмотрено релизов: $($rels.Count). Файлы под Windows в них:" -ForegroundColor Yellow
    $seen = $rels | ForEach-Object { $_.assets } | Where-Object { $_.name -match "win" } |
        Select-Object -Expand name -Unique
    if ($seen) { foreach ($n in $seen) { Write-Host "   $n" } } else { Write-Host "   (ни одного)" }
    Write-Host ""
    return $null
}

function Get-GithubAsset($repo, $pattern, $out) {
    if (Test-Path $out) { return }
    Write-Host ">> Скачиваю $pattern из $repo ..."
    $hit = Find-GithubAsset $repo @($pattern)
    if (-not $hit) { throw "Не нашёл ассет $pattern в $repo — проверьте вручную." }
    Get-File $hit.asset.browser_download_url $out
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

# ---- 2. llama.cpp: сборка под нужную архитектуру ---------------------
# Официальные Windows-сборки llama.cpp собраны с CUDA 12.4, а первая CUDA
# с поддержкой Blackwell (RTX 50xx, sm_120) — 12.8. Значит, на RTX 5060 Ti
# CUDA 12.4 не заработает, и нужен Vulkan: он лежит в тех же релизах и
# работает на Blackwell через штатный драйвер NVIDIA, без CUDA-тулкита.
#
# Список шаблонов, а не один: набор ассетов от сборки к сборке разный
# (в b10649 Vulkan под Windows нет, в b10648 есть). Порядок — по убыванию
# предпочтения; если однажды появится CUDA 12.8+ или 13 под Windows, она
# возьмётся сама и без правки скрипта.
$blackwell = "$gpu" -match "RTX\s*50[0-9]{2}"
$patterns = if ($blackwell) {
    @(
        "^llama-.*bin-win-cuda-1[3-9].*x64\.zip$",
        "^llama-.*bin-win-cuda-12\.(?:[89]|[1-9][0-9]).*x64\.zip$",
        "^llama-.*bin-win-vulkan-x64\.zip$"
    )
} else {
    @(
        "^llama-.*bin-win-cuda-12\.4-x64\.zip$",
        "^llama-.*bin-win-vulkan-x64\.zip$"
    )
}

Write-Host ">> Подбираю сборку llama.cpp..."
$pick = Find-GithubAsset "ggml-org/llama.cpp" $patterns
if (-not $pick) {
    throw "Не нашёл ни одной подходящей сборки llama.cpp под Windows — пришли этот текст Claude."
}
$backend = if ($pick.asset.name -match "vulkan") { "vulkan" } else { "cuda" }
Write-Host ">> Сборка: $($pick.asset.name) (релиз $($pick.release.tag_name), бэкенд $backend)"
if ($blackwell -and $backend -eq "vulkan") {
    Write-Host "   Карта Blackwell: CUDA-сборки под Windows пока только 12.4,"
    Write-Host "   а она эти карты не умеет. Vulkan — это тоже GPU."
}

# Папка своя на каждый бэкенд: иначе после смены карты найдётся старый
# llama-server.exe от прошлой сборки и молча не заведётся на GPU.
$llamaDir = "$dir\llama-$backend"

# Чужие папки, случайно перенесённые с C:\ первым (багованным) прогоном —
# возвращаем на место, чтобы не мешали и не потерялись.
$stray = Get-ChildItem "$dir\llama" -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "^[0-9a-f]{16,}$" -or $_.Name -in @("Cakewalk", "common_attachment", "inetpub", "PerfLogs", "Intel") }
foreach ($s in $stray) {
    Write-Host ">> Возвращаю на C:\ случайно перенесённую папку: $($s.Name)"
    try { Move-Item $s.FullName "C:\" -Force } catch { Write-Host "   не вышло ($_) — верни вручную" }
}

$find = { Get-ChildItem $llamaDir -Recurse -Filter "llama-server.exe" -Force -ErrorAction SilentlyContinue |
    Select-Object -First 1 }
$serverExe = & $find
if (-not $serverExe) {
    $zip = "$dir\llama-$backend.zip"
    Remove-Item $zip, "$dir\cudart.zip" -Force -ErrorAction SilentlyContinue
    Write-Host ">> Скачиваю $($pick.asset.name) ..."
    Get-File $pick.asset.browser_download_url $zip
    Expand-Archive $zip -DestinationPath $llamaDir -Force
    $serverExe = & $find
    if (-not $serverExe) {
        Write-Host "Содержимое архива:"
        Get-ChildItem $llamaDir -Recurse -ErrorAction SilentlyContinue | Select-Object -Expand FullName
        throw "llama-server.exe не найден в скачанном архиве — пришли Claude список выше."
    }
    # cudart строго из того же релиза: версии рантайма и сервера обязаны
    # совпадать, иначе сервер стартует и падает на первом же запросе.
    if ($backend -eq "cuda") {
        $cudart = $pick.release.assets | Where-Object { $_.name -match "^cudart-.*x64\.zip$" } | Select-Object -First 1
        if ($cudart) {
            Write-Host ">> Скачиваю $($cudart.name) ..."
            Get-File $cudart.browser_download_url "$dir\cudart.zip"
            Expand-Archive "$dir\cudart.zip" -DestinationPath $serverExe.DirectoryName -Force
        } else {
            Write-Host "!! cudart в релизе $($pick.release.tag_name) нет — если сервер не стартует, пришли Claude."
        }
    }
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
$cert = "$env:USERPROFILE\.cloudflared\cert.pem"

# cloudflared пишет свой обычный лог в stderr. При $ErrorActionPreference
# = "Stop" и перенаправлении 2>&1 PowerShell превращает такую строку в
# ТЕРМИНИРУЮЩУЮ ошибку — и скрипт падал на строке вида
# «INF Added CNAME … which will route to this tunnel», то есть на
# сообщении об успехе. Зовём cloudflared только через эту обёртку.
function Invoke-Cf {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CfArgs)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $out = & $cf @CfArgs 2>&1 | ForEach-Object { "$_" }
    } finally {
        $ErrorActionPreference = $prev
    }
    return ($out -join "`n")
}

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
    Write-Host " Сейчас откроется браузер. Выберите свой домен и подтвердите."
    Write-Host " После этого запустите скрипт ещё раз — у мозга появится"
    Write-Host " постоянный адрес, который не меняется при перезапуске."
    Write-Host ""
    Write-Host " Ни одного домена в списке? Значит, серверы имён не"
    Write-Host " Cloudflare, и постоянный адрес пока невозможен. Закройте"
    Write-Host " браузер: скрипт поднимет временный адрес и продолжит."
    Write-Host "==============================================================="
    Write-Host ""
    if (-not $Unattended) { Invoke-Cf tunnel login | Out-Null }
}

# Имя не выдумываем. Раньше здесь было зашито brain.gtr.events, но зона в
# аккаунте называется иначе, и cloudflared приклеил её к нашему имени,
# получив brain.gtr.events.gtrevent.com. Поэтому просим короткую метку и
# СЧИТЫВАЕМ то имя, которое cloudflared реально создал.
$brainHost = ""
$named = $false
if (Test-Path $cert) {
    # Создание туннеля и маршрута идемпотентно по сути, но не по коду
    # возврата: повторный вызов ругается «уже существует». Это не ошибка,
    # поэтому смотрим не на код, а на итог.
    Invoke-Cf tunnel create $TUNNEL | Out-Null
    $label = if ($BrainHost) { $BrainHost } else { "brain" }
    $route = Invoke-Cf tunnel route dns --overwrite-dns $TUNNEL $label

    # cloudflared сам называет созданную запись — берём имя оттуда.
    $m = [regex]::Match($route, "(?:Added CNAME|record for)\s+([A-Za-z0-9._-]+\.[A-Za-z]{2,})")
    if ($m.Success) { $brainHost = $m.Groups[1].Value.TrimEnd(".") }
    elseif ($BrainHost) { $brainHost = $BrainHost }

    $listed = (Invoke-Cf tunnel list) -match [regex]::Escape($TUNNEL)
    # Доказательство постоянного адреса — живая DNS-запись, а не наличие
    # туннеля в списке: tunnel create проходит и без зоны в Cloudflare.
    if ($brainHost -and $listed) {
        # Свежесозданной записи нужно несколько секунд, чтобы разойтись.
        foreach ($i in 1..6) {
            if (Test-PublicDns $brainHost) { $named = $true; break }
            Start-Sleep -Seconds 5
        }
    }
    if (-not $named) {
        Write-Host "!! Постоянный адрес не получился. Ответ cloudflared:"
        Write-Host $route
        Write-Host "   Пока работаем на временном адресе."
    } else {
        Write-Host ">> Постоянный адрес: https://$brainHost"
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
function Test-Brain {
    try { return (Invoke-RestMethod "http://127.0.0.1:8080/health" -TimeoutSec 5).status -eq "ok" }
    catch { return $false }
}

# Настоящая проверка токена — рабочим запросом. /health и /v1/models у
# llama.cpp открыты без авторизации, поэтому два зелёных ответа не
# доказывают, что наш токен подходит: ровно так и выглядел 401 в продукте
# над «живым» мозгом.
function Test-BrainToken {
    $body = @{
        model = "qwen3-8b"
        messages = @(@{ role = "user"; content = "ping" })
        max_tokens = 1
    } | ConvertTo-Json -Depth 5 -Compress
    try {
        Invoke-RestMethod "http://127.0.0.1:8080/v1/chat/completions" -Method Post `
            -Headers @{ authorization = "Bearer $token" } -ContentType "application/json" `
            -Body $body -TimeoutSec 90 | Out-Null
        return $true
    } catch {
        return $false
    }
}

# Останавливаем свои процессы, но не падаем на чужих: llama-server,
# запущенный из-под другой учётной записи (или с правами администратора),
# не убивается — «Отказано в доступе», и раньше на этом падал весь скрипт.
function Stop-Brain {
    $left = @()
    foreach ($p in @(Get-Process llama-server -ErrorAction SilentlyContinue)) {
        try { Stop-Process -Id $p.Id -Force -ErrorAction Stop }
        catch { $left += $p.Id }
    }
    if ($left) { Start-Sleep -Seconds 1 }
    return $left
}

function Start-Brain {
    $stuck = Stop-Brain
    if ($stuck -and (Test-Brain)) {
        # Порт занят чужим сервером, погасить который мы не вправе.
        if (Test-BrainToken) {
            Write-Host ">> На 8080 уже работает llama-server (PID $($stuck -join ', ')) и принимает"
            Write-Host "   наш токен — беру его как есть, второй не запускаю."
            return
        }
        Write-Host ""
        Write-Host "!! На порту 8080 работает ЧУЖОЙ llama-server (PID $($stuck -join ', '))." -ForegroundColor Yellow
        Write-Host "   Остановить его не вышло — он запущен от другой учётной записи"
        Write-Host "   или с правами администратора. И токен у него другой: именно"
        Write-Host "   поэтому продукт получает 401 над живым с виду мозгом."
        Write-Host ""
        Write-Host "   Что сделать: открыть PowerShell ОТ ИМЕНИ АДМИНИСТРАТОРА и"
        Write-Host "   выполнить одну строку, потом запустить скрипт заново:"
        Write-Host ""
        Write-Host "       Stop-Process -Name llama-server -Force"
        Write-Host ""
        throw "Порт 8080 занят чужим llama-server — см. инструкцию выше."
    }
    Start-Process -FilePath $serverExe.FullName -ArgumentList @(
        "-m", $model, "-ngl", "99", "-c", "$ctx",
        "--parallel", "$slots", "--jinja",
        "--host", "127.0.0.1", "--port", "8080", "--api-key", $token
    ) -WindowStyle Minimized
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

# ---- 8. Автозапуск: при загрузке Windows, от имени SYSTEM -------------
# Прошлая версия вешала задачу на вход пользователя. Это ломалось дважды:
# компьютер перезагрузили и никто ещё не вошёл — мозга нет; сменили
# пользователя — сеанс закрылся и мозг умер вместе с ним. Оба раза снаружи
# это выглядит одинаково: гость спрашивает, BRO не отвечает.
#
# Поэтому триггер AtStartup, а исполнитель — SYSTEM: он не привязан ни к
# чьему сеансу и живёт, пока включён компьютер.
$taskName = "GTR BRO brain"

# Задача от SYSTEM регистрируется только с правами администратора.
$admin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# Задача зовёт копию скрипта из рабочей папки, а не тот файл, откуда его
# запустили: скачанный в Downloads он однажды переедет в корзину, и
# автозапуск будет ссылаться в пустоту.
$selfCopy = Join-Path $dir "setup-brain-gpu.ps1"
if ($PSCommandPath -and (Resolve-Path $PSCommandPath).Path -ne (Join-Path $dir "setup-brain-gpu.ps1")) {
    try { Copy-Item $PSCommandPath $selfCopy -Force } catch { Write-Host "!! Не скопировал скрипт в $dir ($_)" }
}

if (-not $admin) {
    Write-Host ""
    Write-Host "!! Автозапуск НЕ настроен: нужны права администратора." -ForegroundColor Yellow
    Write-Host "   Мозг сейчас поднимется и будет работать, пока открыто это окно,"
    Write-Host "   но после перезагрузки не вернётся."
    Write-Host "   Чтобы починить: закрой окно, открой PowerShell от имени"
    Write-Host "   администратора и запусти скрипт ещё раз."
    Write-Host ""
} elseif (Test-Path $selfCopy) {
    try {
        $act = New-ScheduledTaskAction -Execute "powershell.exe" `
            -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$selfCopy`" -Unattended -Dir `"$dir`""
        $trg = New-ScheduledTaskTrigger -AtStartup
        # SYSTEM: не зависит от того, кто вошёл и вошёл ли вообще.
        $prn = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
        # ExecutionTimeLimit 0 — без него планировщик убьёт задачу через
        # трое суток, и мозг тихо пропадёт в среду ночью.
        # IgnoreNew — второй экземпляр не полезет драться за порт 8080.
        # RestartCount — если процесс всё-таки умрёт, задача поднимется.
        $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
            -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
        Register-ScheduledTask -TaskName $taskName -Action $act -Trigger $trg -Principal $prn `
            -Settings $set -Force -Description "Мозг GTR BRO: llama-server и туннель" | Out-Null
        Write-Host ">> Автозапуск настроен: старт при загрузке Windows, от имени SYSTEM."
        Write-Host "   Смена пользователя и выход из системы мозг больше не гасят."
    } catch {
        Write-Host "!! Автозапуск настроить не вышло ($_)." -ForegroundColor Yellow
        Write-Host "   Мозг работает, но после перезагрузки его придётся поднять руками."
    }
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
    # Через Stop-Brain: на чужом процессе прямой Stop-Process бросает
    # «Отказано в доступе», и выход из скрипта превращается в ошибку.
    Stop-Brain | Out-Null
}
