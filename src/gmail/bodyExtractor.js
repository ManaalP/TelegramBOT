const { parseICS } = require("./icsParser");

function extractBody(payload, depth = 0) {
  if (!payload || depth > 8) return { text: "", calendarData: "" };
  const mime = payload.mimeType || "";

  if (!payload.parts?.length) {
    if (!payload.body?.data) return { text: "", calendarData: "" };
    const raw = Buffer.from(payload.body.data, "base64").toString("utf-8");
    if (mime === "text/calendar") return { text: "", calendarData: parseICS(raw) || "" };
    if (mime === "text/plain")    return { text: raw, calendarData: "" };
    if (mime === "text/html") {
      const t = raw
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]*>/gm, " ");
      return { text: t, calendarData: "" };
    }
    return { text: "", calendarData: "" };
  }

  if (mime === "multipart/alternative") {
    let calendarData = "";
    for (const part of payload.parts) {
      if (part.mimeType === "text/calendar" && part.body?.data)
        calendarData = parseICS(Buffer.from(part.body.data, "base64").toString("utf-8")) || "";
    }
    const plain = payload.parts.find((p) => p.mimeType === "text/plain");
    if (plain) { const r = extractBody(plain, depth + 1); return { text: r.text, calendarData: calendarData || r.calendarData }; }
    const html  = payload.parts.find((p) => p.mimeType === "text/html");
    if (html)  { const r = extractBody(html,  depth + 1); return { text: r.text, calendarData: calendarData || r.calendarData }; }
    return { text: "", calendarData };
  }

  let textOut = "", calendarData = "";
  for (const part of payload.parts) {
    const pm = part.mimeType || "";
    if (pm === "text/calendar" && part.body?.data) {
      calendarData += (parseICS(Buffer.from(part.body.data, "base64").toString("utf-8")) || "") + "\n";
      continue;
    }
    if (pm === "text/plain" && part.body?.data) {
      if (!textOut) textOut = Buffer.from(part.body.data, "base64").toString("utf-8");
      continue;
    }
    if (pm.startsWith("multipart/")) {
      const r = extractBody(part, depth + 1);
      if (!textOut && r.text) textOut = r.text;
      if (r.calendarData) calendarData += r.calendarData + "\n";
      continue;
    }
    if (pm === "text/html" && part.body?.data && !textOut) {
      let h = Buffer.from(part.body.data, "base64").toString("utf-8");
      h = h.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]*>/gm, " ");
      textOut = h;
    }
  }
  return { text: textOut, calendarData: calendarData.trim() };
}

module.exports = { extractBody };
