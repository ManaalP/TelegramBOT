const { google } = require("googleapis");
const config = require("../config");

// Initialize the OAuth2 client using the existing credentials
const oAuth2Client = new google.auth.OAuth2(
  config.CLIENT_ID,
  config.CLIENT_SECRET
);

oAuth2Client.setCredentials({
  refresh_token: config.REFRESH_TOKEN,
});

// Create the calendar client
const calendar = google.calendar({ version: "v3", auth: oAuth2Client });

/**
 * Fetches upcoming events from the user's primary Google Calendar.
 * @param {number} maxResults - Maximum number of events to return.
 * @returns {Promise<Array>} List of upcoming events.
 */
async function getUpcomingEvents(maxResults = 10) {
  try {
    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: new Date().toISOString(),
      maxResults: maxResults,
      singleEvents: true,
      orderBy: "startTime",
    });
    return response.data.items || [];
  } catch (error) {
    console.error("❌ Error fetching calendar events:", error);
    throw error;
  }
}

/**
 * Creates a new event in the user's primary Google Calendar.
 * @param {string} summary - The title of the event.
 * @param {string} startTime - ISO string for the event start time.
 * @param {string} endTime - ISO string for the event end time.
 * @param {Array<string>} attendees - Array of email addresses to invite.
 * @param {string} description - The event description.
 * @param {boolean} createMeet - Whether to generate a Google Meet link.
 * @returns {Promise<Object>} The created event.
 */
async function createCalendarEvent(summary, startTime, endTime, attendees = [], description = "", createMeet = false) {
  try {
    const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
    const event = {
      summary: summary,
      description: description,
      start: { dateTime: startTime, timeZone: systemTimeZone },
      end: { dateTime: endTime, timeZone: systemTimeZone },
      attendees: attendees.map(email => ({ email: email.trim() })),
    };
    if (createMeet) {
      event.conferenceData = { createRequest: { requestId: "req-" + Date.now() } };
    }
    const response = await calendar.events.insert({
      calendarId: "primary",
      sendUpdates: "all",
      conferenceDataVersion: 1,
      resource: event,
    });
    return response.data;
  } catch (error) {
    console.error("❌ Error creating calendar event:", error);
    throw error;
  }
}

async function updateCalendarEvent(eventId, summary, startTime, endTime, attendees = [], description = "", createMeet = false) {
  try {
    const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
    const event = {};
    if (summary) event.summary = summary;
    if (description) event.description = description;
    if (startTime) event.start = { dateTime: startTime, timeZone: systemTimeZone };
    if (endTime) event.end = { dateTime: endTime, timeZone: systemTimeZone };
    if (attendees && attendees.length > 0) {
      event.attendees = attendees.map(email => ({ email: email.trim() }));
    } else if (attendees && attendees.length === 0) {
      event.attendees = [];
    }
    if (createMeet) {
      event.conferenceData = { createRequest: { requestId: "req-" + Date.now() } };
    }
    const response = await calendar.events.patch({
      calendarId: "primary",
      eventId: eventId,
      sendUpdates: "all",
      conferenceDataVersion: 1,
      resource: event,
    });
    return response.data;
  } catch (error) {
    console.error("❌ Error updating calendar event:", error);
    throw error;
  }
}

async function deleteCalendarEvent(eventId) {
  try {
    await calendar.events.delete({
      calendarId: "primary",
      eventId: eventId,
      sendUpdates: "all",
    });
  } catch (error) {
    console.error("❌ Error deleting calendar event:", error);
    throw error;
  }
}

async function rsvpCalendarEvent(eventId, responseStatus) {
  try {
    const eventRes = await calendar.events.get({ calendarId: "primary", eventId: eventId });
    const event = eventRes.data;
    const attendees = event.attendees || [];
    const me = attendees.find(a => a.self);
    if (me) {
      me.responseStatus = responseStatus;
    } else {
      throw new Error("You are not on the guest list for this event.");
    }
    const response = await calendar.events.patch({
      calendarId: "primary",
      eventId: eventId,
      sendUpdates: "all",
      resource: { attendees: attendees },
    });
    return response.data;
  } catch (error) {
    console.error("❌ Error updating RSVP:", error);
    throw error;
  }
}

module.exports = {
  getUpcomingEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  rsvpCalendarEvent,
};