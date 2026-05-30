const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const nowIST = () =>
  new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

const dateIST = () =>
  new Date().toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
  });

function toIST(rawDate, epochMs) {
  const src = epochMs || rawDate;
  if (src && /^\d{10,}$/.test(String(src).trim())) {
    return new Date(parseInt(src)).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
  }
  if (rawDate && rawDate !== "Unknown Date") {
    const d = new Date(rawDate);
    if (!isNaN(d))
      return d.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: true,
      });
    return rawDate;
  }
  return "Unknown Date";
}

module.exports = { sleep, nowIST, dateIST, toIST };
