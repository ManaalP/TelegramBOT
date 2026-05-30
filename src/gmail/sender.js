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

const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

async function sendEmail(to, subject, text, threadId = null, inReplyTo = null) {
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