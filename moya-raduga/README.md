# Моя радуга

Детский мессенджер для своей компании: девять человек, один общий чат, общий
рисунок, маски и «чудо-мастерская». Отдельное приложение — с GTR Event из корня
репозитория его связывает только папка.

| Папка | Что там |
|---|---|
| `server/` | Cloudflare Worker + Durable Object: чат и рисунок в реальном времени, картинки в R2, генерация через OpenAI |
| `ios/` | Приложение для iPhone на SwiftUI (iOS 17+), маски и «рисунок в комнате» на ARKit |
| `tools/` | Скрипт, который рисует свои маски и иконку |

## Сервер

```sh
cd server
npm install
node scripts/gen-members.mjs Ева Мия Лёва Соня Тима Аня Марк Поля Даня   # первое имя — хозяйка
npx wrangler r2 bucket create moya-raduga-media
npx wrangler deploy
npx wrangler secret put MEMBERS < members.json
npx wrangler secret put OPENAI_API_KEY        # без него работает всё, кроме «чудес»
```

`gen-members.mjs` печатает код входа для каждого — его ребёнок один раз вводит в
приложении. `members.json` в git не попадает: это и есть все пароли.

Локально: `echo "MEMBERS='$(cat members.json)'" > .dev.vars && npm run dev`,
проверка — `npm test` (нужен запущенный `npm run dev`).

Что умеет сервер:

- `GET /ws` — WebSocket: чат, «печатает», кто в сети, общий рисунок. Свой штрих
  можно отменить, чистый лист делает только хозяйка.
- `POST /upload`, `GET /media/…` — картинки (PNG и JPEG до 6 МБ), только для своих.
- `POST /magic` — картинка по описанию. Перед генерацией просьба проходит
  модерацию OpenAI, к ней добавляется «детская» рамка, на каждого действует
  суточный лимит (`MAGIC_DAILY_LIMIT` в `wrangler.jsonc`).

## Приложение

Нужен Mac с Xcode 16+.

```sh
cd ios
brew install xcodegen
xcodegen                 # делает MoyaRaduga.xcodeproj из project.yml
open MoyaRaduga.xcodeproj
```

Перед сборкой впиши адрес своего воркера в `project.yml` (`RadugaServer`) и
выбери свою команду разработчика в Signing & Capabilities. Раздать девяти
людям — через TestFlight.

Маски на лице работают на iPhone с Face ID; на остальных вкладка честно это
говорит, всё прочее работает.

## Маски

Свои маски — SVG в `tools/make-assets.mjs`; `node tools/make-assets.mjs`
перерисовывает PNG и иконку. Лист маски — квадрат 32 см вокруг лица, разметка
описана в начале скрипта.
