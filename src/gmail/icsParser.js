function parseICS(raw) {
  if (!raw) return null;
  const unfolded = raw.replace(/\r?\n[ \t]/g, "");

  const get = (key) => {
    const match = unfolded.match(new RegExp(`^${key}[;:][^\r\n]*`, "mi"));
    if (!match) return "";
    return match[0].replace(new RegExp(`^${key}[^:]*:`, "i"), "").trim();
  };

  const summary     = get("SUMMARY")     || "(No Subject)";
  const location    = get("LOCATION")    || "";
  const description = get("DESCRIPTION") || "";
  const method      = get("METHOD")      || "REQUEST";
  const organizer   = get("ORGANIZER").replace(/^.*CN=/, "").replace(/;.*/, "") || "";

  const parseDateTime = (raw) => {
    const m = raw.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
    if (!m) return raw;
    const [, yr, mo, dy, hh = "00", mm = "00"] = m;
    const d = new Date(`${yr}-${mo}-${dy}T${hh}:${mm}:00`);
    if (isNaN(d)) return raw;
    const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return d.toLocaleString(undefined, {
      timeZone: systemTimeZone,
      weekday: "short", day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
  };

  const parseTime = (raw) => {
    const m = raw.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
    if (!m) return "";
    const [, yr, mo, dy, hh = "00", mm = "00"] = m;
    const d = new Date(`${yr}-${mo}-${dy}T${hh}:${mm}:00`);
    if (isNaN(d)) return "";
    const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return d.toLocaleString(undefined, { timeZone: systemTimeZone, hour: "2-digit", minute: "2-digit", hour12: true });
  };

  const dtStart   = get("DTSTART");
  const dtEnd     = get("DTEND");
  const eventDate = dtStart ? parseDateTime(dtStart) : "";
  const eventEnd  = dtEnd   ? parseTime(dtEnd)        : "";

  if (!summary && !eventDate) return null;

  let out = `[CALENDAR EVENT]\n`;
  out += `Status: ${method === "CANCEL" ? "CANCELLED" : "Upcoming"}\n`;
  out += `Title: ${summary}\n`;
  if (eventDate) out += `When: ${eventDate}${eventEnd ? ` – ${eventEnd}` : ""}\n`;
  if (location)  out += `Where: ${location}\n`;
  if (organizer) out += `Organiser: ${organizer}\n`;
  if (description) out += `Details: ${description.substring(0, 300).replace(/\\n/g, " ")}\n`;
  return out;
}

module.exports = { parseICS };
