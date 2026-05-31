const { google } = require("googleapis");
const { EMAIL_CACHE_TTL, CLIENT_ID, CLIENT_SECRET, KNOWN_SENDERS, MAX_THREADS, MAX_EMAILS } = require("../config");
const { toIST }       = require("../utils/helpers");
const { extractBody } = require("./bodyExtractor");
const { cleanBody }   = require("./bodyCleaner");
const redisClient     = require("../utils/redis");
const supabase        = require("../utils/supabase");

async function getGmailClient(chatId) {
  const { data, error } = await supabase.from("users").select("refresh_token").eq("chat_id", chatId).single();
  if (error || !data || !data.refresh_token) {
    throw new Error("User not authenticated or missing refresh token.");
  }
  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: data.refresh_token });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

const SENDER_NET   = KNOWN_SENDERS.join(" OR ");
const FINANCIAL_RE = /(\d+[.,]\d{2}|rs\.?|₹|inr|usd|debited|credited|spent|charged|payment|transaction|booking|order|bill|due|statement|invoice|alert|purchase|successful|approved|declined|zomato|swiggy|amazon|flipkart|netflix|spotify|uber|ola|blinkit|bigbasket|phonepe|gpay|paytm|hdfc|icici|sbi|axis|scapia|federal|indusind|kotak|citi|rbl|hsbc|standard\s*chartered|yes\s*bank|american\s*express|amex)/i;
const BOOKING_RE   = /(booking|ticket|reservation|confirmed|invitation|invite|itinerary|check-in|check-?out|flight|train|bus|movie|concert|event|meet|meeting|calendar|venue|seat|row|imax|pvr|inox|bookmyshow|irctc|makemytrip|cleartrip|ixigo|redbus|ipl|match|stadium|dtstart|vcalendar)/i;
const STATEMENT_RE  = /(statement|e-?statement|credit\s*card\s*statement|billing\s*statement|monthly\s*statement|your.*statement|statement.*period|amount\s*due|minimum\s*due|payment\s*due|total\s*due|outstanding|closing\s*balance)/i;

async function emailCacheGet(key) {
  try {
    const v = await redisClient.get(`email:${key}`);
    if (v) return JSON.parse(v);
  } catch (e) { console.error("Redis error", e); }
  return null;
}
async function emailCacheSet(key, data) {
  try {
    await redisClient.setEx(`email:${key}`, Math.floor(EMAIL_CACHE_TTL / 1000), JSON.stringify(data));
  } catch (e) { console.error("Redis error", e); }
}

async function getThreadFromCache(id, historyId) {
  try {
    const v = await redisClient.get(`thread:${id}:${historyId}`);
    if (v) return JSON.parse(v);
  } catch (e) { console.error("Redis error", e); }
  return null;
}
async function setThreadToCache(id, historyId, data) {
  try {
    // Cache heavily-detailed threads for 7 days
    await redisClient.setEx(`thread:${id}:${historyId}`, 7 * 24 * 60 * 60, JSON.stringify(data));
  } catch (e) { console.error("Redis error", e); }
}

const cachedUserEmails = new Map();
async function getUserEmail(chatId) {
  if (cachedUserEmails.has(chatId)) return cachedUserEmails.get(chatId);
  try {
    const gmail = await getGmailClient(chatId);
    const res = await gmail.users.getProfile({ userId: "me" });
    const email = res.data.emailAddress;
    cachedUserEmails.set(chatId, email);
    return email;
  } catch (e) {
    console.error("Error fetching user email:", e);
    return "the user";
  }
}

async function fetchEmails(chatId, rawQuery, intent) {
  const cacheKey = `${chatId}:${intent}:${rawQuery}`;
  const cached = await emailCacheGet(cacheKey);
  if (cached) {
    console.log(`[fetch] cache hit for intent:${intent}`);
    return cached;
  }
  const q = rawQuery.replace(/\bcategory:\S+/gi, "").trim();
  const fullQuery = q;
  console.log(`[fetch] ${fullQuery}`);

  const gmail = await getGmailClient(chatId);
  const maxThreads = Math.max(MAX_THREADS, 200);
  const maxEmails = Math.max(MAX_EMAILS, 100);
  const listRes = await gmail.users.threads.list({ userId: "me", q: fullQuery, maxResults: maxThreads });
  const threads = listRes.data.threads || [];
  console.log(`[fetch] threads: ${threads.length}`);
  if (!threads.length) return { emailData: "--- GLOBAL AI INSTRUCTION ---\nNo results found. Say exactly: no results.\n", meta: { totalFetched: 0, included: 0, skipped: 0, emails: [] } };

  const threadFull = await Promise.all(
    threads.map(async (th) => {
      const cached = await getThreadFromCache(th.id, th.historyId);
      if (cached) return cached;
      const res = await gmail.users.threads.get({
        userId: "me", id: th.id, format: "full",
        fields: "id,messages(id,internalDate,payload(headers,parts,body,mimeType),snippet)",
      });
      await setThreadToCache(th.id, th.historyId, res);
      return res;
    })
  );

  let emailData = "", included = 0, skipped = 0;
  const meta = [];
const RE =
  intent === 3 ? BOOKING_RE :
  intent === 6 ? STATEMENT_RE :
  (intent === 7 || intent === 8 || intent === 9 || intent === 10) ? /.*/i :
  FINANCIAL_RE;

  for (let idx = 0; idx < threadFull.length; idx++) {
    if (included >= maxEmails) break;
    const th = threadFull[idx];
    const threadId = threads[idx].id;
    const threadMsgs = th.data.messages || [];

    const sortedMsgs = [...threadMsgs].sort((a, b) => parseInt(a.internalDate) - parseInt(b.internalDate));

    for (const msg of sortedMsgs) {
      if (included >= maxEmails) break;
      const pl = msg.payload;
      if (!pl) continue;

      const hdrs    = pl.headers || [];
      const date    = toIST(hdrs.find((h) => h.name === "Date")?.value || "", msg.internalDate);
      const subject = hdrs.find((h) => h.name === "Subject")?.value || "";
      const from    = hdrs.find((h) => h.name === "From")?.value    || "";
      const to      = hdrs.find((h) => h.name === "To")?.value      || "";
      const messageId = hdrs.find((h) => h.name.toLowerCase() === "message-id")?.value || "";

    const { text: rawText, calendarData } = extractBody(pl);
    const body       = cleanBody(rawText || msg.snippet || "");
    const isRelevant = RE.test(`${subject} ${from} ${body} ${calendarData}`);

    meta.push({ id: msg.id, date, from, subject,
      snippet: (msg.snippet || "").substring(0, 120),
      hasCalendar: !!calendarData,
      decision: isRelevant ? "included" : "skipped_not_relevant" });

    if (!isRelevant) { skipped++; continue; }

    const minLen = (intent === 7 || intent === 8 || intent === 9 || intent === 10) ? 2 : 20;
    let block = [calendarData, body.length >= minLen ? body : ""].filter(Boolean).join("\n").trim();
    
    if (block.length <= 10 && (intent === 4 || intent === 6)) {
      block = "PDF STATEMENT ATTACHED. AI Instruction: At the bottom of your response, list the sender and subject and state that this statement/bill was found but couldn't be parsed (likely password protected).";
    }

    const validBlockLen = (intent === 7 || intent === 8 || intent === 9 || intent === 10) ? 2 : 10;
    if (block.length >= validBlockLen) {
      emailData +=
        `--- EMAIL START ---\n` +
        `Thread Index: ${idx + 1}\n` +
        `Thread ID: ${threadId}\n` +
        `Message ID: ${messageId}\nDate: ${date}\nFrom: ${from}\nTo: ${to}\nSubject: ${subject}\nContent:\n${block}\n` +
        `--- EMAIL END ---\n\n`;
      included++;
      meta.at(-1).cleanedBodyLength = block.length;
    } else {
      meta.at(-1).decision = "skipped_empty_body";
    }
    }
  }

  if (included === 0) {
    emailData = "--- GLOBAL AI INSTRUCTION ---\nNo results found. Say exactly: no results.\n";
  } else {
    emailData += `\n--- GLOBAL AI INSTRUCTION ---\nAnswer only from the emails provided. If no answer is found, say exactly: no results.\n`;
    if (intent === 4 || intent === 6) {
      emailData += `For credit card bills/statements, omit "Total Spends This Cycle" or "Top Spending Categories" if the data is not present.\n`;
    }
  }

  const finalResult = { emailData, meta: { gmailQuery: fullQuery, totalFetched: meta.length, included, skipped, emails: meta } };
  await emailCacheSet(cacheKey, finalResult);
  console.log(`[fetch] included: ${included} | skipped: ${skipped}`);
  return finalResult;
}

module.exports = { fetchEmails, getUserEmail };
