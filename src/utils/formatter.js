const INTENT_ICONS = { 1: "💰", 2: "🧾", 3: "📅", 4: "💳", 5: "📦", 6: "📊" };

function formatAnswer(rawAnswer, intent, userQuery, emailCount) {
  const icon  = INTENT_ICONS[intent] || "🤖";
  const lines = [];

  lines.push(`${icon} Results for: "${userQuery}"`);
  lines.push(`─────────────────────`);

  const cleaned = rawAnswer
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/^(\s*)[•◦▸▹→\-–]\s+/gm, "$1• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  lines.push(cleaned);
  lines.push(`─────────────────────`);
  lines.push(`📬 Scanned ${emailCount} email${emailCount !== 1 ? "s" : ""}`);

  return lines.join("\n");
}

function formatEmpty(intent) {
  const icon = INTENT_ICONS[intent] || "🤖";
  return (
    `${icon} No relevant emails found for your request.\n\n` +
    `💡 Tips:\n` +
    `• Try a longer range — e.g. "last 7 days"\n` +
    `• For calendar invites, ensure Google Calendar\n  sends email notifications to your Gmail`
  );
}

function formatError(is429) {
  if (is429) {
    return (
      `⚠️ AI quota exceeded for today.\n\n` +
      `Free tier allows 20 requests/day.\n` +
      `Please try again tomorrow or upgrade at:\n` +
      `https://ai.dev`
    );
  }
  return `❌ Something went wrong. Please try again.`;
}

module.exports = { formatAnswer, formatEmpty, formatError };
