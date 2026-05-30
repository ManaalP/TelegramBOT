const { tool } = require("@langchain/core/tools");
const { z } = require("zod");
const { sendEmail } = require("../gmail/sender");
const { getUpcomingEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, rsvpCalendarEvent } = require("../config/calendarService");
const { fetchEmails } = require("../gmail/fetcher");

const sendEmailTool = tool(
  async ({ to, subject, body, threadId, inReplyTo }) => {
    try {
      await sendEmail(to, subject, body, threadId, inReplyTo);
      return `Success: Email sent successfully to ${to}.`;
    } catch (e) {
      return `Error sending email: ${e.message}`;
    }
  },
  {
    name: "send_email",
    description: "Sends an email. USE ONLY AFTER drafting the email and getting explicit confirmation ('yes', 'okay') from the user.",
    schema: z.object({
      to: z.string().describe("Recipient's email address"),
      subject: z.string().describe("Subject of the email"),
      body: z.string().describe("Body content of the email"),
      threadId: z.string().optional().describe("Optional thread ID if replying to an existing email thread"),
      inReplyTo: z.string().optional().describe("Optional Message-ID of the email you are replying to (required if threadId is provided)"),
    }),
  }
);

const getUpcomingEventsTool = tool(
  async () => {
    try {
      const events = await getUpcomingEvents(10);
      if (!events.length) return "No upcoming events found.";
      return events.map(e => `ID: ${e.id} | Title: ${e.summary} | Time: ${e.start.dateTime || e.start.date} | Guests: ${(e.attendees || []).map(a => a.email).join(", ")}`).join("\n");
    } catch (e) {
      return `Error fetching events: ${e.message}`;
    }
  },
  {
    name: "get_upcoming_events",
    description: "Fetches the user's upcoming Google Calendar events. Always use this to find the Event ID before updating, deleting, or RSVPing.",
    schema: z.object({}),
  }
);

const manageCalendarTool = tool(
  async ({ action, eventId, summary, startTime, endTime, description, guests, rsvpStatus, createMeet }) => {
    try {
      if (action === "create") return `Success. Event Link: ${(await createCalendarEvent(summary, startTime, endTime, guests, description, createMeet)).htmlLink}`;
      if (action === "update") return `Success. Event Link: ${(await updateCalendarEvent(eventId, summary, startTime, endTime, guests, description, createMeet)).htmlLink}`;
      if (action === "delete") { await deleteCalendarEvent(eventId); return "Success: Event deleted."; }
      if (action === "rsvp")   { await rsvpCalendarEvent(eventId, rsvpStatus); return `Success: RSVP updated to ${rsvpStatus}.`; }
    } catch (e) { return `Error: ${e.message}`; }
  },
  {
    name: "manage_calendar",
    description: "Creates, updates, deletes, or RSVPs to an event. USE ONLY AFTER drafting details and confirming with the user.",
    schema: z.object({ action: z.enum(["create", "update", "delete", "rsvp"]), eventId: z.string().optional(), summary: z.string().optional(), startTime: z.string().optional(), endTime: z.string().optional(), description: z.string().optional(), guests: z.array(z.string()).optional(), rsvpStatus: z.enum(["accepted", "declined", "tentative"]).optional(), createMeet: z.boolean().optional() })
  }
);

const searchEmailsTool = tool(
  async ({ query }) => {
    try {
      const res = await fetchEmails(query, 7); // Using intent 7 bypasses strict financial filters
      if (!res.emailData || res.emailData.includes("No results found")) {
        return "No emails found matching the query.";
      }
      return res.emailData;
    } catch (e) {
      return `Error fetching emails: ${e.message}`;
    }
  },
  {
    name: "search_emails",
    description: "Searches the user's Gmail. Use this to find a person's email address or get context on a recent email thread. Provide a valid Gmail search query like 'from:Siddhant' or 'newer_than:2d'.",
    schema: z.object({ query: z.string().describe("Gmail search query") }),
  }
);

module.exports = { tools: [sendEmailTool, getUpcomingEventsTool, manageCalendarTool, searchEmailsTool] };