# Мозг GTR BRO на Hetzner (8 vCPU / 16 ГБ)

Самохостный текстовый мозг: Qwen3-8B (Apache 2.0) через llama.cpp (MIT).
Обслуживает командную строку `C:\GTR>` — понимание живой русской речи и
вызов инструментов афиши. Ни одного запроса к платным API.

## Запуск (один раз, ~10 минут)

```bash
# 1. Docker, если ещё нет
curl -fsSL https://get.docker.com | sh

# 2. Файлы
mkdir -p /opt/bro-brain && cd /opt/bro-brain
# скопируй сюда docker-compose.yml из репозитория (infra/bro-brain/)

# 3. Токен (тот же, что будет в KV setting:brain)
echo "BRAIN_TOKEN=<токен>" > .env

# 4. Старт: модель (~5 ГБ) скачается сама при первом запуске
docker compose up -d
docker compose logs -f   # ждать строку "server is listening"
```

## Проверка

```bash
curl -s http://127.0.0.1:8080/v1/chat/completions \
  -H "Authorization: Bearer <токен>" -H 'content-type: application/json' \
  -d '{"model":"qwen3-8b","messages":[{"role":"user","content":"Скажи одно слово: эфир"}],"max_tokens":10}'
```

## Подключение к продукту

KV-ключ `setting:brain` в неймспейсе GTR:

```json
{ "url": "http://<IP-сервера>:8080", "token": "<токен>", "model": "qwen3-8b" }
```

Убрать ключ — командная строка молча откатится на разбор правилами.

## Что важно знать

- Первый ответ после старта медленный (прогрев кэша промпта), дальше
  системный префикс закэширован и отвечает за секунды.
- Порт 8080 защищён токеном, но канал — plain HTTP. Секретов в трафике
  нет (реплики и афиша), для беты приемлемо; следующий шаг — Caddy с
  TLS на `<ip>.sslip.io`.
- Обновление модели: поменять `LLAMA_ARG_HF_REPO`, `docker compose up -d`.
- Голосовую связку (Whisper + Chatterbox) этот сервер не потянет: синтез
  речи на CPU медленнее самой речи. Для голоса — либо баланс OpenAI,
  либо GPU-сервер.
