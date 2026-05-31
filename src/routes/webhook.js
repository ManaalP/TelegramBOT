const express = require("express");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { SystemMessage } = require("@langchain/core/messages");
const { TELEGRAM_TOKEN, USER_DAILY_LIMIT, CLIENT_ID, CLIENT_SECRET, BASE_URL, GEMINI_API_KEY, GEMINI_MODEL, FALLBACK_MODELS } = require("../config");
const { resolveQuery } = require("../gemini/router");
const { analyse }      = require("../gemini/analyser");
const { fetchEmails, getUserEmail }  = require("../gmail/fetcher");
const { tg, HELP_TEXT } = require("../telegram/bot");
const { formatAnswer, formatEmpty, formatError } = require("../utils/formatter");
const { getUpcomingEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, rsvpCalendarEvent } = require("../config/calendarService");
const { sendEmail }    = require("../gmail/sender");
const { log }          = require("../utils/logger");
const { nowIST, dateIST } = require("../utils/helpers");
const supabase         = require("../utils/supabase");
const { google }       = require("googleapis");

const router = express.Router();

const RAM_DAILY = new Map();
const RAM_RATE = new Map();
const RAM_MEMORY = new Map();

async function checkLimit(chatId) {
    const today = dateIST().replace(/\//g, "-");
    const key = `daily:${chatId}:${today}`;
    const count = (RAM_DAILY.get(key) || 0) + 1;
    RAM_DAILY.set(key, count);
    return count <= USER_DAILY_LIMIT;
}

const RATE_LIMIT_MS = 3000; // 3 seconds cooldown
async function checkRateLimit(chatId) {
    const key = `ratelimit:${chatId}`;
    if (RAM_RATE.has(key)) return false;
    RAM_RATE.set(key, true);
    setTimeout(() => RAM_RATE.delete(key), RATE_LIMIT_MS);
    return true;
}

const MAX_HISTORY = 6;

// Helper functions for RAM Session Memory
async function getMemory(key, chatId, defaultVal) {
  const v = RAM_MEMORY.get(`${key}:${chatId}`);
  return v !== undefined ? v : defaultVal;
}
async function setMemory(key, chatId, val, ttl = 3600) {
  const fullKey = `${key}:${chatId}`;
  RAM_MEMORY.set(fullKey, val);
  setTimeout(() => RAM_MEMORY.delete(fullKey), ttl * 1000); // Auto-clear after TTL
}
async function delMemory(key, chatId) {
  RAM_MEMORY.delete(`${key}:${chatId}`);
}

const GREETINGS = new Set(["/start", "hi", "hello", "help"]);

router.post(`/webhook/${TELEGRAM_TOKEN}`, async (req, res) => {
  res.sendStatus(200);

  const msg = req.body.message;
  if (!msg?.text) return;

  const chatId    = msg.chat.id;
  const userText  = msg.text;
  const sessionId = `${chatId}_${Date.now()}`;

  const session = {
    sessionId, timestamp: nowIST(), chatId, userQuery: userText,
    intent: null, querySource: null, gmailQueryUsed: null,
    emailFetchMeta: null, finalAnswer: null,
    outcome: "unknown", errorMessage: null,
  };

  try {
  if (!(await checkRateLimit(chatId))) {
    await tg(chatId, "⏳ Please wait a few seconds before sending another message.");
    return;
  }

  if (GREETINGS.has(userText.toLowerCase().trim())) {
    await tg(chatId, HELP_TEXT);
    return;
  }

  // --- MULTI-TENANT AUTHENTICATION CHECK ---
  const { data: userAuth } = await supabase.from("users").select("refresh_token").eq("chat_id", chatId).single();
  
  if (!userAuth || !userAuth.refresh_token) {
    const redirectUri = `${BASE_URL}/oauth2callback`;
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, redirectUri);
    const SCOPES = [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/calendar.events"
    ];
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
      prompt: "consent",
      state: chatId.toString(),
    });

    const replyMarkup = {
      inline_keyboard: [[{ text: "🔐 Login with Google", url: authUrl }]]
    };
    
    await tg(chatId, `Welcome! To use this bot, please connect your Google account by clicking the button below:`, replyMarkup);
    return;
  }

  // --- DRAFT INTERCEPTION LOGIC ---
  const pendingEmail = await getMemory("draft_email", chatId, null);
  if (pendingEmail) {
    const draft = pendingEmail;
    const lowerText = userText.trim().toLowerCase();
    if (['okay', 'ok', 'yes', 'send', 'send it', 'looks good'].includes(lowerText)) {
      try {
        await sendEmail(chatId, draft.to, draft.subject, draft.body, draft.threadId, draft.inReplyTo);
        await tg(chatId, `✅ Email sent successfully to ${draft.to}!`);
      } catch (err) {
        await tg(chatId, "❌ Failed to send email: " + err.message);
      }
      await delMemory("draft_email", chatId);
      return;
    } else if (['cancel', 'abort', 'no', 'stop'].includes(lowerText)) {
      await delMemory("draft_email", chatId);
      await tg(chatId, "🚫 Email cancelled.");
      return;
    } else {
      draft.body = userText.trim();
      await setMemory("draft_email", chatId, draft);
      await tg(chatId, `📧 *Email Draft Updated*\n\n*To:* ${draft.to}\n*Subject:* ${draft.subject}\n*Message:*\n${draft.body}\n\n_Reply 'okay' to send, 'cancel' to abort, or type another message to overwrite._`);
      return;
    }
  }

  // --- CALENDAR DRAFT INTERCEPTION LOGIC ---
  const pendingEvent = await getMemory("draft_event", chatId, null);
  if (pendingEvent) {
    const draft = pendingEvent;
    const lowerText = userText.trim().toLowerCase();
    if (['okay', 'ok', 'yes', 'send', 'create', 'update', 'looks good'].includes(lowerText)) {
      try {
        let event;
        if (draft.eventId) {
          event = await updateCalendarEvent(chatId, draft.eventId, draft.summary, draft.startTime, draft.endTime, draft.guests, draft.description, draft.createMeet);
          await tg(chatId, `✅ Calendar event updated successfully!\nLink: ${event.htmlLink}`);
        } else {
          event = await createCalendarEvent(chatId, draft.summary, draft.startTime, draft.endTime, draft.guests, draft.description, draft.createMeet);
          await tg(chatId, `✅ Calendar event created successfully!\nLink: ${event.htmlLink}`);
        }
      } catch (err) {
        await tg(chatId, "❌ Failed to process calendar event: " + err.message);
      }
      await delMemory("draft_event", chatId);
      return;
    } else if (['cancel', 'abort', 'no', 'stop'].includes(lowerText)) {
      await delMemory("draft_event", chatId);
      await tg(chatId, "🚫 Calendar event action cancelled.");
      return;
    } else {
      await delMemory("draft_event", chatId);
      await tg(chatId, "⏳ Re-drafting event based on new instructions...");
      // Fallthrough to AI to re-evaluate userText
    }
  }

  if (userText.toLowerCase().startsWith("/reply ")) {
    if (userText.includes("|")) {
      try {
        const parts = userText.substring(7).split("|").map(s => s.trim());
        if (parts.length >= 3) {
          const [to, subject, ...bodyParts] = parts;
          const body = bodyParts.join("|");
          await sendEmail(chatId, to, subject, body);
          await tg(chatId, `✅ Email sent successfully to ${to}!`);
          return;
        }
      } catch (err) {
        await tg(chatId, "❌ Failed to send email: " + err.message);
        return;
      }
    }
    // Fallthrough to AI if format is not strict
  }

  if (userText.toLowerCase().startsWith("/invite ")) {
    if (userText.includes("|")) {
      try {
        const parts = userText.substring(8).split("|").map(s => s.trim());
        if (parts.length >= 3) {
          const summary = parts[0];
          const startTime = parts[1];
          const endTime = parts[2];
          const guests = parts.length > 3 && parts[3] ? parts[3].split(",") : [];
          const event = await createCalendarEvent(chatId, summary, startTime, endTime, guests);
          await tg(chatId, `✅ Calendar invite created successfully!\nLink: ${event.htmlLink}`);
          return;
        }
      } catch (err) {
        await tg(chatId, "❌ Failed to create calendar invite: " + err.message);
        return;
      }
    }
    // Fallthrough to AI if format is not strict
  }

  let history = await getMemory("chat_history", chatId, []);
  let lastFetchedData = await getMemory("last_data", chatId, null);
  let isFollowUp = false;
  let standaloneQuery = userText;

  // LangChain Conversation Context Interceptor
  if (history.length > 0 && lastFetchedData) {
    try {
      let contextStr = history.map(h => `${h.role === 'user' ? 'User' : 'Bot'}: ${h.content}`).join("\n");
      const followUpPrompt = `
You are a context-routing AI. You decide if a user's new message can be answered using the data already fetched in the previous turn, or if new data needs to be fetched.

Recent conversation history:
---
${contextStr}
---

User's new message: "${userText}"

Rules:
1. If the user is asking to filter, count, summarize, or analyze the items just discussed (e.g., "out of them how many X", "total for Y", "which ones are Z"), you MUST reuse the data.
2. If the user uses pronouns referencing the previous data ("them", "those", "these"), you MUST reuse the data.
3. If the user asks to perform an action (send an email, create/update an event), you MUST NOT reuse the data.
4. If it's a completely new topic or requires fetching different dates/items, you MUST NOT reuse the data.

Output Format:
- If you should reuse the data, output EXACTLY the word: REUSE
- If you must fetch new data, rewrite the message into a standalone search query and output: NEW: <standalone_query>
`;

      const modelsToTry = (FALLBACK_MODELS && FALLBACK_MODELS.length > 0) ? FALLBACK_MODELS : [GEMINI_MODEL || "gemini-3.5-flash"];
      let aiResponse = null;

      for (let i = 0; i < modelsToTry.length; i++) {
        try {
          const llm = new ChatGoogleGenerativeAI({
            modelName: modelsToTry[i],
            apiKey: GEMINI_API_KEY,
            temperature: 0.1
          });
          aiResponse = await llm.invoke(followUpPrompt);
          break; // Break the loop on success
        } catch (err) {
          console.warn(`[LangChain Memory] Model ${modelsToTry[i]} failed: ${err.message}`);
          if (i === modelsToTry.length - 1) throw err;
          await new Promise(r => setTimeout(r, 1500)); // Delay before trying next fallback model
        }
      }

      const textResponse = aiResponse.content.trim();
      
      if (textResponse.toUpperCase().includes("REUSE")) {
        isFollowUp = true;
        console.log(`[LangChain Memory] Chat ${chatId}: Detected Follow-Up. Reusing data.`);
      } else if (textResponse.toUpperCase().includes("NEW:")) {
        const matchIdx = textResponse.toUpperCase().indexOf("NEW:");
        standaloneQuery = textResponse.substring(matchIdx + 4).trim();
        console.log(`[LangChain Memory] Chat ${chatId}: Standalone Query -> ${standaloneQuery}`);
      }
    } catch (err) {
      console.error("LangChain context analysis error:", err.message);
    }
  }

    let router_result;
  if (isFollowUp) {
    router_result = { intent: lastFetchedData.intent, query: "REUSE_DATA", source: "langchain_memory" };
  } else {
    try {
      router_result = await resolveQuery(standaloneQuery);
    } catch (parseErr) {
      session.outcome = "error_router_parse";
      log("sessions", session);
      await tg(chatId, "⚠️ Couldn't understand your request. Please try rephrasing it.");
      return;
    }
  }

  let { intent, query, source } = router_result;
    session.intent      = intent;
    session.querySource = source;

    log("queries", { sessionId, timestamp: nowIST(), userQuery: userText, source, intent, query });

    if (intent === 0 || query === "OUT_OF_SCOPE") {
      session.outcome = "out_of_scope";
      log("sessions", session);
      await tg(chatId,
        "🚫 I can only assist with:\n\n" +
        "• Expenses & transactions\n• Bookings & events\n" +
        "• Credit card bills\n• Order history\n" +
        "• Reading & replying to emails\n• Creating calendar invites\n\n" +
        "Please adjust your request."
      );
      return;
    }

    if (source === "gemini" && !(await checkLimit(chatId))) {
      await tg(chatId,
        `⚠️ You've reached your daily query limit (${USER_DAILY_LIMIT} requests).\n` +
        `Please try again tomorrow.`
      );
      return;
    }

    let gmailSearchQuery = query;
    if (intent === 7) {
      if (gmailSearchQuery === "OUT_OF_SCOPE" || !gmailSearchQuery || gmailSearchQuery === "label:^none") {
        gmailSearchQuery = `is:important newer_than:2d -category:promotions -category:social`;
      }
    } else if (intent === 9 || intent === 10) {
      gmailSearchQuery = "label:^none";
    } else if (intent === 8) {
      if (gmailSearchQuery === "OUT_OF_SCOPE" || !gmailSearchQuery) {
        gmailSearchQuery = "label:^none";
      }
    }

    let emailData, meta;
  if (isFollowUp) {
    emailData = lastFetchedData.emailData;
    meta = lastFetchedData.meta;
  } else if (intent === 8 && gmailSearchQuery === "label:^none" && lastFetchedData) {
      emailData = lastFetchedData.emailData;
      meta = lastFetchedData.meta;
    } else {
      const fetchRes = await fetchEmails(chatId, gmailSearchQuery, intent);
      emailData = fetchRes.emailData;
      meta = fetchRes.meta;
    }

    let hasCalendarEvents = false;

    // Check for calendar events for Bookings (3) or Setup Invite (9)
  if (!isFollowUp && (intent === 3 || intent === 9)) {
      try {
        console.log("🔍 Fetching Google Calendar events...");
        const events = await getUpcomingEvents(chatId, 10);
        console.log(`✅ Found ${events.length} upcoming events.`);
        
        if (events.length > 0) {
          hasCalendarEvents = true;
          const calendarText = events.map(event => {
            const start = event.start?.dateTime || event.start?.date;
          const end = event.end?.dateTime || event.end?.date;
            const title = event.summary || "Busy / Untitled Event";
          const desc = (event.description || "None").replace(/\n/g, " ");
          const org = event.organizer?.displayName || event.organizer?.email || "Unknown";
          const guests = (event.attendees || []).map(a => a.email).join(", ");
          const myRsvp = (event.attendees || []).find(a => a.self)?.responseStatus || "needsAction";
          const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
          return `📅 ID: ${event.id} | Title: ${title} | Start: ${new Date(start).toLocaleString(undefined, { timeZone: systemTimeZone })} | End: ${new Date(end).toLocaleString(undefined, { timeZone: systemTimeZone })} | Org: ${org} | Guests: ${guests} | My RSVP: ${myRsvp} | Desc: ${desc}`;
          }).join("\n");
        emailData = (emailData || "") + `\n\n--- GOOGLE CALENDAR EVENTS (Direct API) ---\n${calendarText}`;
        }
      } catch (error) {
        console.error("❌ Failed to fetch calendar events:", error.message);
      }
  } else if (isFollowUp) {
    hasCalendarEvents = lastFetchedData.hasCalendarEvents || false;
  }

  if (!isFollowUp && intent !== 8 && intent !== 9 && intent !== 10) {
    await setMemory("last_data", chatId, { emailData, meta, intent, hasCalendarEvents }, 3600);
  }

    session.gmailQueryUsed = meta.gmailQuery;
    session.emailFetchMeta = meta;

    log("emailData", {
      sessionId, timestamp: nowIST(), userQuery: userText,
      intent, gmailQuery: meta.gmailQuery,
      emailsIncluded: meta.included, emailsSkipped: meta.skipped,
      emailDecisions: meta.emails, fullEmailDataSentToAI: emailData,
    });

    if (hasCalendarEvents || intent === 8 || intent === 9 || intent === 10) {
      emailData = emailData.replace(/--- GLOBAL AI INSTRUCTION ---\nNo results found\. Say exactly: no results\.\n/g, "");
    }

    if (!emailData.trim() && intent !== 8 && intent !== 9 && intent !== 10 && intent !== 3) {
      session.outcome = "no_emails_found";
      log("sessions", session);
      await tg(chatId, formatEmpty(intent));
      return;
    }

    // If we have calendar data, we need to give the AI a more specific prompt
    // so it knows to look at both emails and calendar events.
  let finalQuery = isFollowUp
    ? `Conversation History:\n${history.map(h => `${h.role === 'user' ? 'User' : 'Bot'}: ${h.content}`).join("\n")}\n\nBased on the previously provided email and calendar data and the conversation history above, answer this follow-up question: "${userText}"`
    : (hasCalendarEvents
      ? `Based on the following email and calendar data, please answer this question: "${standaloneQuery}"`
      : standaloneQuery);
      
    const userEmail = await getUserEmail(chatId);

    if (intent === 7) {
      finalQuery += `\n\nAnalyze the provided emails. Identify any important emails that are from a personal sender (not automated, no-reply, business, or marketing).
You are managing the inbox of ${userEmail}.
If the 'From' field contains ${userEmail}, the email was sent by the user, so the 'Correspondent' is the person in the 'To' field. If the 'From' field is someone else, they are the Correspondent.

ALWAYS use this STRICT output template for your response, numbering the threads by their Thread Index:

**Important Personal Emails:**
1. [Correspondent Name] ([Correspondent Email]): [Brief Summary]
(If it's a thread: 1. **Active Mail Thread with [Correspondent Name] ([Correspondent Email]):** [Summary of latest messages])
2. ...

**Reply Instruction:**
To reply to any of these, you can simply say:
"Reply to email 1 with [your message]"

*(Note: Automated system notifications and calendar invitations are excluded.)*

Do not deviate from this format and do not output the internal Thread ID.`;
    }

    if (intent === 3 || intent === 9) {
      finalQuery += `\n\nIf the user is managing calendar events, evaluate their request against the provided Google Calendar events (use the provided IDs).
If they ask to update, RSVP, or delete an event without providing the exact ID (e.g., "Change my 2pm meeting"), find the matching event from the calendar data.
- If multiple events match the description (e.g., clashing events at the same time), DO NOT output the command. Instead, list the matching events with their details and ask the user to clarify which one they mean.
- If exactly one event matches, use its ID to output the command.

If they are asking to see their schedule or upcoming events, ALWAYS use this STRICT output template for your response:

**Upcoming Events & Bookings:**
• [Title]
  - 📅 [Start Time] to [End Time]
  - 👤 Organiser: [Organiser]
  - 👥 Guests: [Guests]
  - ✉️ My RSVP: [RSVP Status]
  - 🔑 ID: [Event ID] (Use this ID to update/delete/RSVP)

**⚠️ Schedule Conflicts:**
[Analyze the start and end times of all events. If any events overlap in time, explicitly list the overlapping events here and warn the user. If there are no overlaps, state "No overlapping events detected."]

**Available Actions:**
To manage your calendar, you can ask me to:
- **Update/Create:** "Update my 3PM meeting to add bob@example.com" or "Create a meeting tomorrow at 4PM"
- **Delete:** "Delete the meeting with ID [Event ID]" (if you are the organiser)
- **RSVP:** "RSVP yes to the design review"

If the user's prompt is a request to ACTUALLY PERFORM an action (create/update/delete/rsvp), output EXACTLY the corresponding command format as the VERY LAST thing in your response:
- Create/Update: "/preview_event eventId | Title | Start Time (YYYY-MM-DDTHH:mm:ss) | End Time (YYYY-MM-DDTHH:mm:ss) | Description | true_or_false_for_google_meet | guest1,guest2" (Leave eventId blank for new events)
- Delete: "/delete_event eventId"
- RSVP: "/rsvp_event eventId | accepted/declined/tentative"
Do not add conversational text after the command.`;
    }

    if (intent === 8) {
      finalQuery += `\n\nIf the user is asking to send an email or reply to one (e.g. "reply to email 1" or "reply to thread 2"), look at the provided emails. Match the requested email/thread to the correct one in the provided data using the 'Thread Index'.
You MUST extract the Correspondent's exact email address (the person who is NOT ${userEmail}) to use as the 'to_email'.
Extract the exact 'Thread ID', 'Message ID', and 'Subject' from the VERY LATEST message in that thread (the last one listed with that Thread Index).
Draft a suitable message based on their prompt.
Then, you MUST output the following exact command format to trigger a preview for the user:
"/preview to_email | threadId | messageId | subject | message"

If this is a new email and NOT a reply, use "none" for both threadId and messageId (e.g. "/preview to_email | none | none | subject | message").

The /preview command must be the VERY LAST thing in your response. Do not add any conversational text after the message body.`;
    }

    // Give the AI knowledge of the cache mechanism
    finalQuery += `\n\n[SYSTEM NOTE: The email and calendar data provided to you is temporarily cached for 60 seconds to improve speed. If the user asks about data freshness, mentions that a recent item is missing, or asks how the cache works, politely inform them about this 1-minute synchronization delay.]`;

    finalQuery += `\n\n[SYSTEM NOTE: Do NOT use markdown formatting like asterisks (**), underscores (_), or backticks (\`) in your conversational text, as it frequently causes Telegram API parsing errors. Provide plain text answers whenever possible.]`;

    const { answer, prompt } = await analyse(finalQuery, emailData, intent);
    session.finalAnswer = answer;
    session.outcome     = "success";

    log("aiOutputs", {
      sessionId, timestamp: nowIST(), userQuery: userText,
      source, intent, gmailQuery: meta.gmailQuery,
      emailsProcessed: meta.included, analysisPrompt: prompt, aiRawResponse: answer,
    });
    log("sessions", session);

    let replyText;
    if (isFollowUp) {
      replyText = `🧠 *Answered from recent context:*\n\n${answer}`;
    } else {
      replyText = formatAnswer(answer, intent, userText, meta.included);
      if (intent === 8 || intent === 9 || intent === 10) {
        replyText = answer;
      }
    }

    // Auto-execute AI generated commands
    if (intent === 9 || intent === 3) {
      const matchPreview = answer.match(/\/preview_event\s+([\s\S]+)/i);
      const matchDelete = answer.match(/\/delete_event\s+([^\s\n`]+)/i);
      const matchRsvp = answer.match(/\/rsvp_event\s+([\s\S]+)/i);

      if (matchPreview) {
        const parts = matchPreview[1].split("|").map(s => s.trim().replace(/^["'*`]+|["'*`]+$/g, ""));
        if (parts.length >= 7) {
          const eventId = parts[0];
          const summary = parts[1];
          const startTime = parts[2];
          const endTime = parts[3];
          const description = parts[4];
          const createMeet = parts[5] === 'true';
          const guests = parts[6] ? parts[6].split(",").map(g => g.trim()).filter(Boolean) : [];
          await setMemory("draft_event", chatId, { eventId, summary, startTime, endTime, description, createMeet, guests }, 3600);
          const action = eventId ? "Update" : "Create";
          replyText = `📅 *Event Draft Preview (${action})*\n\n*Title:* ${summary}\n*Time:* ${startTime} to ${endTime}\n*Google Meet:* ${createMeet ? "Yes" : "No"}\n*Guests:* ${guests.join(", ") || "None"}\n*Description:*\n${description || "None"}\n\n_Reply 'okay' to confirm and save, or 'cancel' to abort._`;
        }
      } else if (matchDelete) {
        try {
        await deleteCalendarEvent(chatId, matchDelete[1]);
          replyText = "✅ Event deleted successfully.";
        } catch (err) {
          replyText = "❌ Failed to delete event: " + err.message;
        }
      } else if (matchRsvp) {
        const parts = matchRsvp[1].split("|").map(s => s.trim().replace(/^["'*`]+|["'*`]+$/g, ""));
        if (parts.length >= 2) {
          try {
          await rsvpCalendarEvent(chatId, parts[0], parts[1].toLowerCase());
            replyText = `✅ RSVP updated to ${parts[1].toLowerCase()}.`;
          } catch (err) {
            replyText = "❌ Failed to update RSVP: " + err.message;
          }
        }
      }
    } else if (intent === 8) {
      const match = answer.match(/\/(reply|preview)\s+([\s\S]+)/i);
      if (match) {
        const command = match[1].toLowerCase();
        try {
          const parts = match[2].split("|").map(s => s.trim().replace(/^["'*`]+|["'*`]+$/g, ""));
          if (parts.length >= 5 && (parts[1] === "none" || parts[1].length > 10)) {
            const to = parts[0];
            const threadId = parts[1] === "none" ? null : parts[1];
            const inReplyTo = parts[2] === "none" ? null : parts[2];
            const subject = parts[3];
            const body = parts.slice(4).join("|");
            if (command === "reply") {
              await sendEmail(chatId, to, subject, body, threadId, inReplyTo);
              replyText = `✅ Email sent successfully to ${to}!`;
            } else if (command === "preview") {
              await setMemory("draft_email", chatId, { to, subject, body, threadId, inReplyTo }, 3600);
              replyText = `📧 *Email Draft Preview*\n\n*To:* ${to}\n*Subject:* ${subject}\n*Message:*\n${body}\n\n_Reply 'okay' to send this email, 'cancel' to abort, or simply type a new message to overwrite the draft._`;
            }
          } else if (parts.length >= 3) {
            const [to, subject, ...bodyParts] = parts;
            const body = bodyParts.join("|");
            if (command === "reply") {
              await sendEmail(chatId, to, subject, body);
              replyText = `✅ Email sent successfully to ${to}!`;
            } else if (command === "preview") {
              await setMemory("draft_email", chatId, { to, subject, body, threadId: null, inReplyTo: null }, 3600);
              replyText = `📧 *Email Draft Preview*\n\n*To:* ${to}\n*Subject:* ${subject}\n*Message:*\n${body}\n\n_Reply 'okay' to send this email, 'cancel' to abort, or simply type a new message to overwrite the draft._`;
            }
          }
        } catch (err) {
          replyText = "❌ Failed to process email: " + err.message;
        }
      }
    }

    if (intent === 4 || intent === 6) {
      replyText += "\n\n💡 *Note:* _This analysis is based solely on fetched email receipts. Transactions (like direct UPI payments) that do not generate an email alert cannot be counted._";
    }

    try {
      await tg(chatId, replyText);
    } catch (err) {
      if (err.message && err.message.includes("parse entities")) {
        console.log(`[Telegram] Stripping formatting due to parse error for chat ${chatId}`);
        await tg(chatId, replyText.replace(/[*_`\[\]]/g, ""));
      } else {
        throw err;
      }
    }

  // Record state to memory store after a successful response
  history.push({ role: 'user', content: userText });
  history.push({ role: 'bot', content: answer });
  if (history.length > MAX_HISTORY) history = history.slice(history.length - MAX_HISTORY);
  await setMemory("chat_history", chatId, history, 3600);

  } catch (err) {
    console.error("[webhook]", err);
    session.outcome      = "error_unhandled";
    session.errorMessage = err.message;
    log("sessions", session);
    const is429 = err.status === 429 || String(err.message).includes("429");
    try {
      await tg(chatId, formatError(is429));
    } catch (tgErr) {
      console.error("[Telegram Fallback Error]", tgErr);
    }
  }
});

module.exports = router;
