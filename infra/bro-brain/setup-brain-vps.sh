#!/usr/bin/env bash
# Мозг GTR BRO на VPS — постоянный адрес с настоящим HTTPS.
#
# Зачем этот скрипт вообще есть. Прошлая схема жила на quick-туннеле
# trycloudflare: он выдаёт новый адрес при каждом перезапуске, а старый
# перестаёт резолвиться — воркер получал «530 error code: 1016» и мозг
# молча пропадал из продукта. Здесь адрес привязан к IP сервера и не
# меняется никогда.
#
# Как получается постоянный адрес без покупки домена: sslip.io — публичный
# DNS, который резолвит имя вида 1-2-3-4.sslip.io в IP 1.2.3.4. Имя
# настоящее, сертификат Let's Encrypt на него выдаётся штатно. Пока у
# сервера тот же IP — адрес живёт.
#
# Запуск на сервере (одной строкой, от root):
#   bash setup-brain-vps.sh
#
# На выходе печатает URL и токен — их вписать на стенде /bro-dev ->
# Настройки -> «Запасной мозг», либо прислать Claude, он впишет сам.
#
# Требования: Ubuntu/Debian VPS, открытые порты 80 и 443 (80 нужен
# Let's Encrypt для проверки владения именем), ~10 ГБ свободного диска.

set -euo pipefail

DIR=/opt/bro-brain
say() { printf '\n\033[1m>> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m!! %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "Запусти от root: sudo bash $0"

# ---- 1. Docker -------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  say "Ставлю Docker (это один раз, пара минут)..."
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "Нет docker compose v2 — обнови Docker и повтори."

mkdir -p "$DIR"
cd "$DIR"

# ---- 2. Публичный IP и постоянное имя --------------------------------
# Спрашиваем у двух независимых сервисов: если один прилёг, второй ответит.
IP="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
[ -n "$IP" ] || IP="$(curl -fsS --max-time 10 https://ifconfig.me 2>/dev/null || true)"
[ -n "$IP" ] || die "Не удалось определить публичный IP сервера — проверь сеть."
echo "$IP" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || die "Странный IP: $IP"

HOST="${IP//./-}.sslip.io"
say "Публичный IP: $IP  ->  постоянный адрес: https://$HOST"

# Порт 80 обязан быть свободен: без него Let's Encrypt не подтвердит имя.
if ss -ltn 2>/dev/null | grep -qE ':80\s' && ! docker ps --format '{{.Names}}' | grep -q '^bro-brain-caddy'; then
  die "Порт 80 занят другим процессом — освободи его, иначе не выпустится сертификат."
fi

# ---- 3. Токен доступа ------------------------------------------------
# Постоянный: перевыпуск означал бы поход на стенд за новой строкой.
if [ -f .env ]; then
  TOKEN="$(sed -n 's/^BRAIN_TOKEN=//p' .env | head -1)"
fi
if [ -z "${TOKEN:-}" ]; then
  TOKEN="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi
printf 'BRAIN_TOKEN=%s\nBRAIN_HOST=%s\n' "$TOKEN" "$HOST" > .env
chmod 600 .env

# ---- 4. Конфиги ------------------------------------------------------
# Модель наружу не смотрит: порт 8080 остаётся внутри docker-сети, а
# наружу торчит только Caddy с TLS. Токен — второй рубеж, не первый.
cat > docker-compose.yml <<'YAML'
services:
  brain:
    image: ghcr.io/ggml-org/llama.cpp:server
    container_name: bro-brain
    restart: unless-stopped
    expose:
      - "8080"
    volumes:
      - ./cache:/root/.cache
    environment:
      - LLAMA_ARG_HF_REPO=Qwen/Qwen3-8B-GGUF:Q4_K_M
    # --parallel 3: три слота вместо одного. Без этого флага сервер держит
    # ОДИН запрос за раз, и второй одновременный гость встаёт в очередь,
    # не успевая в 26-секундный дедлайн воркера. -c делится между слотами
    # поровну: 12288 / 3 = 4096 на слот — хватает на системный промпт с
    # инструментами и пару кругов вызовов.
    command: >
      --host 0.0.0.0 --port 8080
      -c 12288 -t 8 --parallel 3 --jinja
      --api-key ${BRAIN_TOKEN:?задай BRAIN_TOKEN в .env}
    deploy:
      resources:
        limits:
          memory: 13g

  caddy:
    image: caddy:2-alpine
    container_name: bro-brain-caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    environment:
      - BRAIN_HOST=${BRAIN_HOST:?задай BRAIN_HOST в .env}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - brain

volumes:
  caddy_data:
  caddy_config:
YAML

# Caddy сам выпускает и продлевает сертификат Let's Encrypt — сертификаты
# лежат в томе caddy_data и переживают перезапуск контейнера.
#
# Таймауты не трогаем намеренно: у Caddy по умолчанию их нет, а модель на
# CPU думает по 20-40 секунд и заголовки ответа отдаёт только в конце.
# Любое наше число здесь было бы строже умолчания и рубило бы длинные ответы.
# Срок ответа держит воркер (26 секунд) — он тут единственный judge.
cat > Caddyfile <<'CADDY'
{$BRAIN_HOST} {
	reverse_proxy brain:8080
}
CADDY

# ---- 5. Старт --------------------------------------------------------
say "Поднимаю мозг и прокси (при первом запуске качается модель ~5 ГБ)..."
docker compose up -d

say "Жду, пока модель загрузится и сервер ответит..."
OK=""
for i in $(seq 1 120); do
  if curl -fsS --max-time 5 -H "Authorization: Bearer $TOKEN" \
       "https://$HOST/v1/models" >/dev/null 2>&1; then
    OK=1
    break
  fi
  sleep 10
  printf '.'
done
printf '\n'

if [ -z "$OK" ]; then
  say "Пока не отвечает. Это нормально, если модель ещё качается."
  echo "Смотри лог:      docker compose -f $DIR/docker-compose.yml logs -f brain"
  echo "Проверь вручную: curl -H 'Authorization: Bearer $TOKEN' https://$HOST/v1/models"
  echo
fi

cat <<EOF

===============================================================
 МОЗГ GTR BRO ${OK:+ГОТОВ}${OK:-ПОДНИМАЕТСЯ}

   URL:    https://$HOST
   токен:  $TOKEN
   модель: qwen3-8b

 Впиши это на стенде /bro-dev -> Настройки -> «Запасной мозг»,
 либо пришли Claude — он впишет сам.

 Адрес постоянный: привязан к IP сервера, при перезапуске не
 меняется. Контейнеры поднимаются сами после перезагрузки.

 Полезное:
   лог мозга:     docker compose -f $DIR/docker-compose.yml logs -f brain
   перезапуск:    docker compose -f $DIR/docker-compose.yml restart
   остановить:    docker compose -f $DIR/docker-compose.yml down
===============================================================

EOF
