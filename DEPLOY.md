# Деплой GTR Event

## Текущий прод — Cloudflare Workers
https://gtr-event-hub.gtr-event.workers.dev — воркер `gtr-event-hub`,
аккаунт `2e3f6f6ab8e81085ca7022ebeb583868` (поддомен gtr-event.workers.dev).
Тариф Workers Free: 100 000 запросов в день, кредитов и карты не требует.

```bash
NITRO_PRESET=cloudflare_module npm run build
CLOUDFLARE_API_TOKEN=<токен> CLOUDFLARE_ACCOUNT_ID=2e3f6f6ab8e81085ca7022ebeb583868 \
  npx wrangler deploy --name gtr-event-hub
```

Токен — аккаунт-токен (`cfat_…`), создан по шаблону «Edit Cloudflare Workers».
В репозитории его не храним; проверка живости:
`curl https://api.cloudflare.com/client/v4/accounts/<acc>/tokens/verify -H "Authorization: Bearer <токен>"`.

Секреты воркера уже заданы (`wrangler secret put <NAME> --name gtr-event-hub`):
GTR_ACCESS_PASSWORD (пароль стенда), GTR_SESSION_SECRET (подпись сессий).
process.env в воркере наполняется автоматически: nodejs_compat +
compatibility_date ≥ 2025-04-01.

Имя воркера передаём флагом `--name`: сгенерированный
.output/server/wrangler.json называет его `pelikilya-hub-gtreventhub`.

## Запасной прод — Netlify
https://gtr-event-hub.netlify.app (id eefd39cc-1467-4599-903b-7137410f841b).
Заблокирован «credit usage exceeded» до сброса месячного цикла тарифа.
После сброса: `npm run build` (пресет netlify) + деплой готовой папки:

```bash
NETLIFY_AUTH_TOKEN=<PAT> npx netlify deploy --prod \
  --site eefd39cc-1467-4599-903b-7137410f841b --dir dist
```

## Из песочницы Claude Code
Node fetch не видит HTTPS_PROXY — перед деплой-командами ставить
`NODE_USE_ENV_PROXY=1` (подробнее в README). Свежесозданный поддомен
workers.dev поднимает TLS-сертификат несколько минут — «handshake failure»
сразу после первого деплоя это норма, просто подождать.
