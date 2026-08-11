# Деплой GTR Event

## Текущий прод
https://gtr-event-hub.netlify.app — Netlify, сайт `gtr-event-hub`
(id eefd39cc-1467-4599-903b-7137410f841b).

## Нормальная схема (после снятия кредитного блока)
Сборка локально, на Netlify уходят только готовые файлы — билд-минуты
не тратятся:

```bash
npm run build                       # пресет netlify из netlify.toml
NETLIFY_AUTH_TOKEN=<PAT> npx netlify deploy --prod \
  --site eefd39cc-1467-4599-903b-7137410f841b --dir dist
```

PAT: app.netlify.com/user/applications → New access token.
ВАЖНО: пока на аккаунте «credit usage exceeded», Netlify отклоняет
и это — сначала биллинг (upgrade или сброс месячного цикла).

## Запасной путь: Cloudflare Workers
Сборка уже проверена: `NITRO_PRESET=cloudflare_module npm run build`
генерирует .output + .wrangler/deploy/config.json.

```bash
CLOUDFLARE_API_TOKEN=<token> npx wrangler deploy
```

Токен: dash.cloudflare.com → My Profile → API Tokens →
шаблон «Edit Cloudflare Workers». Переменные окружения
(GTR_ACCESS_PASSWORD, GTR_SESSION_SECRET) задать в дашборде воркера.

## Из песочницы Claude Code
Node fetch не видит HTTPS_PROXY — перед деплой-командами ставить
`NODE_USE_ENV_PROXY=1` (подробнее в README).
