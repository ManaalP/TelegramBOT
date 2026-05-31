const { gemini } = require("./client");
const { CACHE_TTL } = require("../config");

const RAM_ROUTER_CACHE = new Map();

async function cacheGet(key) {
  const k = key.toLowerCase().trim();
  return RAM_ROUTER_CACHE.get(k) || null;
}
async function cacheSet(key, intent, query) {
  const k = key.toLowerCase().trim();
  RAM_ROUTER_CACHE.set(k, { intent, query });
  setTimeout(() => RAM_ROUTER_CACHE.delete(k), CACHE_TTL);
}

function rulesQuery(text) {
  const t = text.toLowerCase();

  let time = "";
  
  // Dynamically extract arbitrary numbers of days, months, or years
  const dynamicDays = t.match(/\b(?:last|past|in\s*the\s*last)?\s*(\d+)\s*days?\b/);
  const dynamicMonths = t.match(/\b(?:last|past|in\s*the\s*last)?\s*(\d+)\s*months?\b/);
  const dynamicYears = t.match(/\b(?:last|past|in\s*the\s*last)?\s*(\d+)\s*years?\b/);

  if (dynamicDays) {
    time = `newer_than:${parseInt(dynamicDays[1]) + 1}d`;
  } else if (dynamicMonths) {
    time = `newer_than:${parseInt(dynamicMonths[1]) * 30 + 2}d`;
  } else if (dynamicYears) {
    time = `newer_than:${parseInt(dynamicYears[1]) * 365 + 1}d`;
  } else if (/\b(today|24\s*h(ours?)?|last\s*24)\b/.test(t)) time = "newer_than:2d";
  else if (/\b(48\s*h(ours?)?|last\s*48|yesterday)\b/.test(t)) time = "newer_than:3d";
  else if (/\b(week|last\s*week)\b/.test(t)) time = "newer_than:8d";
  else if (/\b(month|this\s*month|last\s*month)\b/.test(t)) time = "newer_than:32d";
  else if (/\b(quarter)\b/.test(t)) time = "newer_than:92d";
  else if (/\b(half\s*year)\b/.test(t)) time = "newer_than:183d";
  else if (/\b(year|last\s*year)\b/.test(t)) time = "newer_than:366d";

  const BROAD_TXN     = `(subject:debited OR subject:credited OR subject:transaction OR subject:payment OR subject:"transaction was successful" OR subject:alert OR subject:UPI)`;
  const BROAD_BOOKING = `(subject:booking OR subject:ticket OR subject:reservation OR subject:confirmed OR subject:invitation OR subject:"your booking" OR subject:"trip details" OR from:calendar-notification@google.com)`;

  const defaultTime = time || "newer_than:8d";
  const statementTime = time || "newer_than:180d";

  if (/^\/reply\s*$/i.test(t) || /\b(reply|replt|respond)\s+to\s+(email|thread|message)\s*\d+/i.test(t))
    return { intent: 8, query: "label:^none" };
  if (/\b(send|write|compose|draft)\b.*\b(email|mail|message)\b/i.test(t))
    return { intent: 8, query: "label:^none" };
  if (/^\/invite/i.test(t) || /\b(setup|create|new|schedule|update|edit|change|delete|cancel|remove|rsvp|accept|decline|maybe|yes|no)\b.*\b(invite|meeting|calendar|event)\b/i.test(t))
    return { intent: 9, query: "label:^none" };
  if (/\b(cache|delay|refresh|missing|fast|slow|update|sync|how long)\b/i.test(t))
    return { intent: 10, query: "label:^none" };

  if (/\b(credit\s*card\s*statements?|cc\s*statements?)\b/.test(t))
    return { intent: 6, query: `("credit card" (subject:statement OR subject:e-statement OR subject:estatement OR subject:"billing statement" OR subject:"monthly statement")) OR subject:"credit card statement" ${statementTime}` };
  if (/\b(statements?|monthly\s*statements?|billing\s*statements?|e-?statements?)\b/.test(t))
    return { intent: 6, query: `(subject:statement OR subject:e-statement OR subject:estatement OR subject:"billing statement" OR subject:"monthly statement") ${statementTime}` };
  if (/\b(credit\s*cards?|bills?|due|payment\s*due)\b/.test(t))
    return { intent: 4, query: `(subject:"payment due" OR subject:bill OR subject:statement) ${defaultTime}` };

  if (/\bzomato\b/.test(t))                return { intent: 5, query: `from:noreply@zomato.com ${defaultTime}` };
  if (/\bswiggy\b/.test(t))                return { intent: 5, query: `from:noreply@swiggy.in ${defaultTime}` };
  if (/\bamazon\b/.test(t))                return { intent: 5, query: `from:auto-confirm@amazon.in ${defaultTime}` };
  if (/\bflipkart\b/.test(t))              return { intent: 5, query: `from:noreply@flipkart.com ${defaultTime}` };
  if (/\bhdfc\b/.test(t))                  return { intent: 2, query: `from:alerts@hdfcbank.bank.in ${defaultTime}` };
  if (/\bscapia|federal\s*bank\b/.test(t)) return { intent: 2, query: `from:scapiacards@federalbank.co.in ${defaultTime}` };
  if (/\bicici\b/.test(t))                 return { intent: 2, query: `from:alerts@icicibank.com ${defaultTime}` };
  if (/\bsbi\b/.test(t))                   return { intent: 2, query: `from:sbicard.com ${defaultTime}` };
  if (/\baxis\b/.test(t))                  return { intent: 2, query: `from:alerts@axisbank.com ${defaultTime}` };
  if (/\bbookmyshow|bms\b/.test(t))        return { intent: 3, query: `from:bookmyshow.com ${defaultTime}` };
  if (/\bpvr\b/.test(t))                   return { intent: 3, query: `from:pvrinemas.com ${defaultTime}` };
  if (/\birctc\b/.test(t))                 return { intent: 3, query: `from:irctc.co.in ${defaultTime}` };

  if (/\b(book|booking|ticket|reservation|movie|travel|flight|hotel|event|invite|invitation|calendar|meet|meeting|upcoming)\b/.test(t))
    return { intent: 3, query: `${BROAD_BOOKING} ${defaultTime}` };
  if (/\b(expense|spend|spent|transaction|debit|credit|payment|upi|transfer|list)\b/.test(t))
    return { intent: 2, query: `${BROAD_TXN} ${defaultTime}` };
  if (/\b(total|how\s*much|sum)\b/.test(t))
    return { intent: 1, query: `${BROAD_TXN} ${defaultTime}` };
  if (/\b(order|orders|frequency|how\s*many)\b/.test(t))
    return { intent: 5, query: `(subject:order OR subject:delivered OR subject:shipped) ${defaultTime}` };
  if (/\b(important|personal)\b.*\b(emails?|messages?|mails?)\b/.test(t) || /\b(emails?|messages?|mails?)\b.*\b(important|personal)\b/.test(t))
    return { intent: 7, query: `is:important -category:promotions -category:social ${time || "newer_than:2d"}` };
  return null;
}

const ROUTER_PROMPT = (userText) =>
`You are a query router. Classify the user's request into an intent (0-11) and generate a Gmail search query.
Intents: 1:Total expenses, 2:List expenses, 3:Bookings/events, 4:CC bills due, 5:Order frequency, 6:CC statement summary, 7:Important personal emails, 8:Send/Reply to email, 9:Setup calendar invite, 10:Bot caching/delay query, 11:Conversational Confirmation or Follow-up response to the assistant, 0:Out of scope.

Return ONLY valid JSON: {"intent": <intent_number>, "query": "<gmail_search_query>"}

GMAIL QUERY RULES:
- Use only subject:, from:, newer_than:, is:important, -category:promotions, -category:social, label:^none.
- Timeframes should accurately reflect the user's request (e.g., newer_than:2d for "yesterday", newer_than:32d for "last month").
- Intent 3 must include from:calendar-notification@google.com.
- Intent 6 query: ("credit card" (subject:statement OR subject:e-statement)) OR subject:"credit card statement".
- Broad transactions query: (subject:debited OR subject:credited OR subject:transaction OR subject:payment OR subject:"transaction was successful" OR subject:UPI).
- Intent 7 query: is:important -category:promotions -category:social (unless a specific sender is requested).
- Intent 8 query: If replying to an email from the displayed list (e.g. "reply to email 1" or "reply to thread 2"), use exactly label:^none. If asking to reply to a specific email by describing it (e.g. "reply to the latest email from Siddhant"), generate a search query. If it's a completely new email, use label:^none.
- Intents 9 and 10 query: label:^none

User: "${userText}"
`.trim();

async function resolveQuery(userText) {
  const cached = await cacheGet(userText);
  if (cached) return { intent: cached.intent, query: cached.query, source: "cache" };

  const ruled = rulesQuery(userText);
  if (ruled) { await cacheSet(userText, ruled.intent, ruled.query); return { ...ruled, source: "rules" }; }

  const raw    = await gemini(ROUTER_PROMPT(userText));
  const result = JSON.parse(raw.replace(/```json|```/g, "").trim());
  await cacheSet(userText, result.intent, result.query);
  return { ...result, source: "gemini" };
}

module.exports = { resolveQuery };
