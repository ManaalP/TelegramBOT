const { BODY_BUDGET } = require("../config");

// Noise patterns — strip legal/tracking/instructional content
const NOISE = [
  /this e-?mail is confidential[\s\S]{0,600}/gi,
  /please do not reply[\s\S]{0,200}/gi,
  /save paper[\s\S]{0,100}/gi,
  /unsubscribe[\s\S]{0,150}?(click here|link|here)/gi,
  /privacy policy[\s\S]{0,80}?terms/gi,
  /copyright\s*©[\s\S]{0,60}/gi,
  /view (this |in )?(email|browser)[\s\S]{0,80}/gi,
  /how (to make payments|do i access|to access)[\s\S]{0,800}/gi,  // strips payment instructions block
  /option [12]:[\s\S]{0,300}/gi,                                   // strips password instruction examples
  /for (security|safety) reasons[\s\S]{0,300}/gi,
  /you (are advised|need adobe|will need)[\s\S]{0,200}/gi,
  /please (ensure|note that|find enclosed|find attached)[\s\S]{0,150}/gi,
  /\bhttps?:\/\/[^\s]{50,}/g,       // long tracking URLs only
  /[=]{3,}/g, /[-]{8,}/g,
  /\*{3,}/g,  /_{3,}/g,
  /dear (customer|cardholder|card holder),?/gi,
  /thank you for (using|your continued)[\s\S]{0,100}/gi,
  /warm regards[\s\S]{0,100}/gi,
  /best regards[\s\S]{0,100}/gi,
  /team \w+ bank[\s\S]{0,50}/gi,
  /you can reach us[\s\S]{0,200}/gi,
  /contact us[\s\S]{0,100}/gi,
  /follow us on[\s\S]{0,100}/gi,
  /download app[\s\S]{0,100}/gi,
  /RBI (never|states)[\s\S]{0,300}/gi,
  /disclaimer[\s\S]{0,400}/gi,
];

// Keep ONLY lines that contain financial signals
const FINANCIAL_LINE_RE = /(\d+[.,]\d{2}|₹|inr|rs\.?|due|amount|minimum|statement|period|date|reward|coin|balance|outstanding|closing|opening|credit|debit|paid|payment|upi|neft|transaction)/i;

function cleanBody(raw) {
  if (!raw) return "";

  // Step 1: Strip HTML
  let t = raw
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]*>/gm, " ")
    .replace(/\r\n|\r|\n|\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .trim();

  // Step 2: Apply noise patterns
  for (const re of NOISE) t = t.replace(re, " ");
  t = t.replace(/[ ]{2,}/g, " ").trim();

  // Step 3: Line-level filter — split by sentences, keep only financial lines
  const sentences = t.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter(s => FINANCIAL_LINE_RE.test(s));

  // If aggressive filter removes everything, fall back to full cleaned text
  const result = kept.length >= 2 ? kept.join(" ") : t;

  // Step 4: Smart budget truncation
  if (result.length <= BODY_BUDGET) return result;
  const trunc = result.substring(0, BODY_BUDGET);
  const cut   = Math.max(trunc.lastIndexOf(". "), trunc.lastIndexOf("! "), trunc.lastIndexOf("? "));
  return cut > 300 ? trunc.substring(0, cut + 1) : trunc;
}

module.exports = { cleanBody };