const express = require("express");
const { TELEGRAM_TOKEN, USER_DAILY_LIMIT } = require("../config");
const { resolveQuery } = require("../gemini/router");
const { analyse }      = require("../gemini/analyser");
const { fetchEmails, getUserEmail }  = require("../gmail/fetcher");
const { tg, HELP_TEXT } = require("../telegram/bot");
const { formatAnswer, formatEmpty, formatError } = require("../utils/formatter");
const { getUpcomingEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, rsvpCalendarEvent } = require("../config/calendarService");
const { sendEmail }    = require("../gmail/sender");
const { log }          = require("../utils/logger");
const { nowIST, dateIST } = require("../utils/helpers");
const redisClient      = require("../utils/redis");

const router = express.Router();

async function checkLimit(chatId) {
  const today = dateIST().replace(/\//g, "-");
  const key = `daily:${chatId}:${today}`;
  const count = await redisClient.incr(key);
  if (count === 1) await redisClient.expire(key, 86400 * 2); // 2 days TTL
  return count <= USER_DAILY_LIMIT;
}

const RATE_LIMIT_MS = 3000; // 3 seconds cooldown
async function checkRateLimit(chatId) {
  const key = `ratelimit:${chatId}`;
  const isLimited = await redisClient.get(key);
  if (isLimited) return false;
  await redisClient.setEx(key, Math.ceil(RATE_LIMIT_MS / 1000), "1");
  return true;
}

const PENDING_EMAILS = new Map();
const PENDING_EVENTS = new Map();
const LAST_FETCHED_DATA = new Map();

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

  // --- DRAFT INTERCEPTION LOGIC ---
  if (PENDING_EMAILS.has(chatId)) {
    const draft = PENDING_EMAILS.get(chatId);
    const lowerText = userText.trim().toLowerCase();
    if (['okay', 'ok', 'yes', 'send', 'send it', 'looks good'].includes(lowerText)) {
      try {
        await sendEmail(draft.to, draft.subject, draft.body, draft.threadId, draft.inReplyTo);
        await tg(chatId, `✅ Email sent successfully to ${draft.to}!`);
      } catch (err) {
        await tg(chatId, "❌ Failed to send email: " + err.message);
      }
      PENDING_EMAILS.delete(chatId);
      return;
    } else if (['cancel', 'abort', 'no', 'stop'].includes(lowerText)) {
      PENDING_EMAILS.delete(chatId);
      await tg(chatId, "🚫 Email cancelled.");
      return;
    } else {
      draft.body = userText.trim();
      PENDING_EMAILS.set(chatId, draft);
      await tg(chatId, `📧 **Email Draft Updated**\n\n**To:** ${draft.to}\n**Subject:** ${draft.subject}\n**Message:**\n${draft.body}\n\n*Reply 'okay' to send, 'cancel' to abort, or type another message to overwrite.*`);
      return;
    }
  }

  // --- CALENDAR DRAFT INTERCEPTION LOGIC ---
  if (PENDING_EVENTS.has(chatId)) {
    const draft = PENDING_EVENTS.get(chatId);
    const lowerText = userText.trim().toLowerCase();
    if (['okay', 'ok', 'yes', 'send', 'create', 'update', 'looks good'].includes(lowerText)) {
      try {
        let event;
        if (draft.eventId) {
          event = await updateCalendarEvent(draft.eventId, draft.summary, draft.startTime, draft.endTime, draft.guests, draft.description, draft.createMeet);
          await tg(chatId, `✅ Calendar event updated successfully!\nLink: ${event.htmlLink}`);
        } else {
          event = await createCalendarEvent(draft.summary, draft.startTime, draft.endTime, draft.guests, draft.description, draft.createMeet);
          await tg(chatId, `✅ Calendar event created successfully!\nLink: ${event.htmlLink}`);
        }
      } catch (err) {
        await tg(chatId, "❌ Failed to process calendar event: " + err.message);
      }
      PENDING_EVENTS.delete(chatId);
      return;
    } else if (['cancel', 'abort', 'no', 'stop'].includes(lowerText)) {
      PENDING_EVENTS.delete(chatId);
      await tg(chatId, "🚫 Calendar event action cancelled.");
      return;
    } else {
      PENDING_EVENTS.delete(chatId);
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
          await sendEmail(to, subject, body);
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
          const event = await createCalendarEvent(summary, startTime, endTime, guests);
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

    let router_result;
    try {
      router_result = await resolveQuery(userText);
    } catch (parseErr) {
      session.outcome = "error_router_parse";
      log("sessions", session);
      await tg(chatId, "⚠️ Couldn't understand your request. Please try rephrasing it.");
      return;
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
    if (intent === 8 && gmailSearchQuery === "label:^none" && LAST_FETCHED_DATA.has(chatId)) {
      const last = LAST_FETCHED_DATA.get(chatId);
      emailData = last.emailData;
      meta = last.meta;
    } else {
      const fetchRes = await fetchEmails(gmailSearchQuery, intent);
      emailData = fetchRes.emailData;
      meta = fetchRes.meta;
      if (intent !== 8 && intent !== 9 && intent !== 10) {
        LAST_FETCHED_DATA.set(chatId, { emailData, meta });
      }
    }

    let hasCalendarEvents = false;

    // Check for calendar events for Bookings (3) or Setup Invite (9)
    if (intent === 3 || intent === 9) {
      try {
        console.log("🔍 Fetching Google Calendar events...");
        const events = await getUpcomingEvents(10);
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
    let finalQuery = hasCalendarEvents
      ? `Based on the following email and calendar data, please answer this question: "${userText}"`
      : userText;
      
    const userEmail = await getUserEmail();

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

    const { answer, prompt } = await analyse(finalQuery, emailData, intent);
    session.finalAnswer = answer;
    session.outcome     = "success";

    log("aiOutputs", {
      sessionId, timestamp: nowIST(), userQuery: userText,
      source, intent, gmailQuery: meta.gmailQuery,
      emailsProcessed: meta.included, analysisPrompt: prompt, aiRawResponse: answer,
    });
    log("sessions", session);

    let replyText = formatAnswer(answer, intent, userText, meta.included);

    if (intent === 8 || intent === 9 || intent === 10) {
      replyText = answer;
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
          PENDING_EVENTS.set(chatId, { eventId, summary, startTime, endTime, description, createMeet, guests });
          const action = eventId ? "Update" : "Create";
          replyText = `📅 **Event Draft Preview (${action})**\n\n**Title:** ${summary}\n**Time:** ${startTime} to ${endTime}\n**Google Meet:** ${createMeet ? "Yes" : "No"}\n**Guests:** ${guests.join(", ") || "None"}\n**Description:**\n${description || "None"}\n\n*Reply 'okay' to confirm and save, or 'cancel' to abort.*`;
        }
      } else if (matchDelete) {
        try {
          await deleteCalendarEvent(matchDelete[1]);
          replyText = "✅ Event deleted successfully.";
        } catch (err) {
          replyText = "❌ Failed to delete event: " + err.message;
        }
      } else if (matchRsvp) {
        const parts = matchRsvp[1].split("|").map(s => s.trim().replace(/^["'*`]+|["'*`]+$/g, ""));
        if (parts.length >= 2) {
          try {
            await rsvpCalendarEvent(parts[0], parts[1].toLowerCase());
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
              await sendEmail(to, subject, body, threadId, inReplyTo);
              replyText = `✅ Email sent successfully to ${to}!`;
            } else if (command === "preview") {
              PENDING_EMAILS.set(chatId, { to, subject, body, threadId, inReplyTo });
              replyText = `📧 **Email Draft Preview**\n\n**To:** ${to}\n**Subject:** ${subject}\n**Message:**\n${body}\n\n*Reply 'okay' to send this email, 'cancel' to abort, or simply type a new message to overwrite the draft.*`;
            }
          } else if (parts.length >= 3) {
            const [to, subject, ...bodyParts] = parts;
            const body = bodyParts.join("|");
            if (command === "reply") {
              await sendEmail(to, subject, body);
              replyText = `✅ Email sent successfully to ${to}!`;
            } else if (command === "preview") {
              PENDING_EMAILS.set(chatId, { to, subject, body, threadId: null, inReplyTo: null });
              replyText = `📧 **Email Draft Preview**\n\n**To:** ${to}\n**Subject:** ${subject}\n**Message:**\n${body}\n\n*Reply 'okay' to send this email, 'cancel' to abort, or simply type a new message to overwrite the draft.*`;
            }
          }
        } catch (err) {
          replyText = "❌ Failed to process email: " + err.message;
        }
      }
    }

    await tg(chatId, replyText);

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
