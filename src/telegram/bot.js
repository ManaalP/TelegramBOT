const { TELEGRAM_TOKEN } = require("../config");

async function tg(chatId, text, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Telegram API Error: ${response.status} ${response.statusText} - ${errText}`);
      }
      return; // Success
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`[Telegram] Retry ${attempt}/${retries} failed:`, err.message);
      await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }
}

const HELP_TEXT =
  `👋 Hello! I'm your personal email assistant.\n\n` +
  `I can help you with:\n\n` +
  `1️⃣  Total expenses in a specific duration\n` +
  `2️⃣  Detailed list of expenses (merchant & payment mode)\n` +
  `3️⃣  Upcoming bookings, reservations & calendar invites\n` +
  `4️⃣  Credit card bills due in a specific duration\n` +
  `5️⃣  Order frequency from platforms (Zomato, Swiggy, Amazon…)\n`+
  `6️⃣  Credit card statement summary\n` +
  `7️⃣  Important personal emails in a specific duration\n` +
  `8️⃣  Send/Reply to emails directly\n` +
  `9️⃣  Manage calendar events (create, update title/time/desc/guests, delete, RSVP yes/no/maybe)\n\n` +    
  `💬 Example prompts:\n` +
  `• "List all my expenses in the last 48 hours"\n` +
  `• "Total Zomato spend this month"\n` +
  `• "Do I have any upcoming meetings or bookings?"\n` +
  `• "Any movie or IPL tickets booked?"\n` +
  `• "Are any credit card bills due soon?"\n` +
  `• "Show my credit card statement for the last 30 days"\n` +
  `• "Any important personal emails from last week?"\n` +
  `• "Set up a calendar invite for a team meeting tomorrow at 3 PM"\n` +
  `• "Change my 3 PM meeting title to 'Project Sync' and add bob@example.com"\n` +
  `• "RSVP yes to the design review"\n` +
  `• "Delete my meeting with John"\n` +
  `• "I want to send an email to bob@example.com"\n\n` +
  `⏱️ *Note:* To ensure fast replies, your emails and calendar events are temporarily cached for 60 seconds.`;

module.exports = { tg, HELP_TEXT };
