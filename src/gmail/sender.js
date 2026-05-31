const { google } = require("googleapis");
const config = require("../config");
const supabase = require("../utils/supabase");

async function getGmailClient(chatId) {
  const { data, error } = await supabase.from("users").select("refresh_token").eq("chat_id", chatId).single();
  if (error || !data || !data.refresh_token) {
    throw new Error("User not authenticated or missing refresh token.");
  }
  const oAuth2Client = new google.auth.OAuth2(config.CLIENT_ID, config.CLIENT_SECRET);
  oAuth2Client.setCredentials({ refresh_token: data.refresh_token });
  return google.gmail({ version: "v1", auth: oAuth2Client });
}

async function sendEmail(chatId, to, subject, text, threadId = null, inReplyTo = null) {
  const gmail = await getGmailClient(chatId);
  const messageParts = [
    `To: ${to}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${subject}`,
  ];

  if (inReplyTo) {
    messageParts.push(`In-Reply-To: ${inReplyTo}`);
    messageParts.push(`References: ${inReplyTo}`);
  }

  messageParts.push('');
  messageParts.push(text.replace(/\n/g, '<br>'));

  const message = messageParts.join('\n');
  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const requestBody = { raw: encodedMessage };
  if (threadId) {
    requestBody.threadId = threadId;
  }

  const res = await gmail.users.messages.send({ userId: 'me', requestBody });
  return res.data;
}

module.exports = { sendEmail };