# 📬 Gmail Telegram Assistant

A personal Telegram bot that reads your Gmail inbox and answers questions about your finances, bookings, and orders using Gemini AI.

---

## Features

| # | Feature |
|---|---------|
| 1 | Total expenses in a custom duration |
| 2 | Detailed expense list (merchant + payment mode) |
| 3 | Upcoming bookings, events & Google Calendar invites |
| 4 | Credit card bills due soon |
| 5 | Order frequency from food/e-commerce platforms |

---

## Project Structure

```
├── index.js                    ← Entry point
├── src/
│   ├── config/index.js         ← All env vars & constants
│   ├── gemini/
│   │   ├── client.js           ← Gemini model + retry wrapper
│   │   ├── router.js           ← Cache → Rules → Gemini resolver
│   │   └── analyser.js         ← Intent-aware AI prompts
│   ├── gmail/
│   │   ├── fetcher.js          ← Thread-aware Gmail fetch
│   │   ├── bodyExtractor.js    ← Recursive MIME parser
│   │   ├── icsParser.js        ← Zero-dep iCalendar parser
│   │   └── bodyCleaner.js      ← Regex noise removal
│   ├── telegram/
│   │   └── bot.js              ← tg() sender + help text
│   ├── routes/
│   │   └── webhook.js          ← Main request handler
│   └── utils/
│       ├── helpers.js          ← sleep, nowIST, dateIST, toIST
│       ├── logger.js           ← JSONL log files
│       └── formatter.js        ← Clean Telegram output
└── logs/                       ← Auto-created at runtime
```

---

## Setup

```bash
cp .env.example .env
# Fill in your tokens in .env
npm install
npm start
```

---

## Adding New Features

1. **New intent?** → `src/gemini/router.js` + `src/gemini/analyser.js`
2. **New sender?** → `src/config/index.js` → `KNOWN_SENDERS`
3. **New command?** → `src/routes/webhook.js` + `src/telegram/bot.js`

---

## Model Choice

Set `GEMINI_MODEL` in `src/config/index.js`:

| Model | Free RPD | Speed |
|---|---|---|
| `gemini-2.0-flash-lite` ✅ default | 1,500 | Fastest |
| `gemini-2.0-flash` | 1,500 | Fast |
| `gemini-2.5-flash` | 500 | Best quality |
| `gemini-2.5-pro` | 25 | Highest quality |
