const { gemini } = require("./client");
const { nowIST, dateIST } = require("../utils/helpers");

const BOOKING_PROMPT = (userText, emailData) => `
You are a precise assistant that extracts upcoming bookings, events, and calendar invites from emails.
Current Date & Time (IST): ${nowIST()}
Today: ${dateIST()}

User Prompt: "${userText}"

EXTRACTION RULES:
1. Examine EVERY email block (between "--- EMAIL START ---" and "--- EMAIL END ---") AND the "--- GOOGLE CALENDAR EVENTS (Direct API) ---" block.
2. Look for: direct calendar events, movie tickets, IPL/sports tickets, flight/train/bus bookings, hotel reservations, and email calendar invites.
3. For each booking or event extract: Event/Movie/Match name, Date & Time (IST), Venue/Location, Seat/Row details if present, Booking ID if present, Organiser/Platform.
4. For calendar events: MUST extract ID, title, date+time, organiser, guests, and My RSVP.
5. Mark cancelled events clearly.
6. Ignore purely promotional emails with no actual booking.
7. Reply with clean bullet points grouped by date. No assumptions. No fabrications.

${emailData}
`.trim();

const STATEMENT_PROMPT = (userText, emailData) => `
You are a precise financial assistant that extracts credit card statement summaries from emails.
Current Date & Time (IST): ${nowIST()}
Today: ${dateIST()}

User Prompt: "${userText}"

EXTRACTION RULES:
1. Examine EVERY email block between "--- EMAIL START ---" and "--- EMAIL END ---" sequentially.
2. For each statement found, extract:
   - Card name & last 4 digits (e.g. "Scapia Federal RuPay CC ending 5541")
   - Statement period (from date – to date)
   - Total amount due
   - Minimum amount due
   - Payment due date
   - Total spends this cycle (if mentioned)
   - Top spending categories (if mentioned)
3. If the email contains a transaction list, extract each transaction:
   - Date, merchant name, amount, transaction type (debit/credit)
4. SKIP: OTP emails, promotional emails, emails with no financial figures. Do NOT skip emails that say "PDF STATEMENT ATTACHED".
5. Group output by card if multiple statements found.
6. If an email indicates a "PDF STATEMENT ATTACHED", mention at the very bottom of your response that these statements (e.g., from HDFC or HSBC) were found but might be password protected.
7. Reply with clean bullet points. No assumptions. No fabrications.

${emailData}
`.trim();

const FINANCIAL_PROMPT = (userText, emailData) => `
You are an exceptionally precise financial data extraction assistant.
Current Date & Time (IST): ${nowIST()}
Today: ${dateIST()}

User Prompt: "${userText}"

EXTRACTION RULES:
1. Examine EVERY block between "--- EMAIL START ---" and "--- EMAIL END ---" sequentially. Do not skip any.
2. Extract all transactions matching the user's intent and timeline.
3. DATE: Prefer the transaction date inside the body over the Date header.
4. For each expense: exact amount (Rs/INR), merchant name, payment mode (e.g. "Scapia Federal RuPay CC ending 5541", "UPI via HDFC account ending 1550").
5. For totals: sum accurately and double-check arithmetic.
6. SKIP: OTP emails, pure promotional emails, failed/declined transactions. Do NOT skip emails that say "PDF STATEMENT ATTACHED".
7. Use From/Subject headers to identify merchant when body is ambiguous.
8. If an email indicates a "PDF STATEMENT ATTACHED", mention at the very bottom of your response that these bills/statements (e.g., from HDFC or HSBC) were found but might be password protected.
9. Reply with clean bullet points. No assumptions. No fabrications.

${emailData}
`.trim();

const EMAIL_PROMPT = (userText, emailData) => `
You are a highly precise personal email and calendar assistant.
Current Date & Time (IST): ${nowIST()}
Today: ${dateIST()}

User Prompt: "${userText}"

EXTRACTION RULES:
1. Examine EVERY block between "--- EMAIL START ---" and "--- EMAIL END ---" sequentially. Also examine the "--- GOOGLE CALENDAR EVENTS (Direct API) ---" block. Do not skip any.
2. Group messages sharing the same Thread ID as an active mail thread (do not expose the actual Thread ID).
3. Ignore purely promotional emails, OTPs, or automated system notifications.
4. Reply with a clear, friendly summary using the user's requested format. No assumptions. No fabrications.

${emailData}
`.trim();

async function analyse(userText, emailData, intent) {
   const prompt =
    intent === 3 ? BOOKING_PROMPT(userText, emailData) :
    intent === 6 ? STATEMENT_PROMPT(userText, emailData) :
    (intent === 7 || intent === 8 || intent === 9 || intent === 10) ? EMAIL_PROMPT(userText, emailData) :
    FINANCIAL_PROMPT(userText, emailData);
  const answer = await gemini(prompt);
  return { answer: answer.trim(), prompt };
}

module.exports = { analyse };
