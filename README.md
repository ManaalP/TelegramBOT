# 📬 Gmail Telegram Assistant

A personal Telegram bot that reads your Gmail inbox and answers questions about your finances, bookings, and orders using Gemini AI.

---

## Features

| # | Feature |
|---|---------|
| 1 | Total expenses in a custom duration |
| 2 | Detailed expense list (merchant + payment mode) |
| 3 | Bookings, flights, trains & Google Calendar invites |
| 4 | Credit card bills due soon |
| 5 | Order frequency from food/e-commerce platforms |

**Example Prompts:**
- *"How much did I spend on food last month?"*
- *"How many trains did I take?"*
- *"What are my upcoming meetings?"*

⚠️ **Important Note:** This assistant relies strictly on parsing your email receipts and calendar events. Financial transactions (such as direct UPI transfers or cash payments) that do not generate an email alert cannot be traced or accounted for.

---

## How It Works (LangGraph Architecture)

This project utilizes a structured **LangGraph** workflow to handle requests with persistent state, observability, and human-in-the-loop approval:

1. **Telegram Input**: The user sends a message, which initializes the workflow state.
2. **Intent Node**: Gemini categorizes the request (e.g., finance, calendar, email search) and generates an exact Gmail/Calendar search query.
3. **Retrieval Node**: Fetches relevant payload from the Gmail API and Google Calendar API based on the resolved intent.
4. **Data Cleaning Node**: Strips unnecessary noise and normalizes the fetched payload to optimize AI context windows.
5. **Analysis Node**: Evaluates the cleaned data using Gemini to generate a response, or formats a pending action command (e.g., drafting an email).
6. **Human Approval Node**: Pauses the execution graph if an action is pending (like sending an email or updating a calendar) and waits for user confirmation in Telegram.
7. **Execution Node**: Upon human approval, the bot carries out the confirmed action via Google APIs and finalizes the state.

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

Set `GEMINI_MODEL` in `src/config/index.js`. The application uses models that can switch based on requirements.
