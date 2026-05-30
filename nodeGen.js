// generate-token.js
require("dotenv").config();
const { google } = require("googleapis");
const http = require("http");
const url = require("url");

// Load from your .env
const { CLIENT_ID, CLIENT_SECRET } = process.env;

// Define both scopes we need for the bot
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events"
];

// We will spin up a temporary local server on port 3000 to catch the redirect
const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// Force consent to ensure we get a new refresh token
const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent",
});

const server = http.createServer(async (req, res) => {
  const qs = new url.URL(req.url, `http://localhost:${PORT}`).searchParams;
  const code = qs.get("code");

  if (qs.get("error")) {
    res.end("Authentication failed: " + qs.get("error"));
    server.close();
  } else if (code) {
    res.end("Authentication successful! You can close this tab and check your terminal.");
    server.close();
    
    try {
      const { tokens } = await oauth2Client.getToken(code);
      console.log("\n✅ --- SUCCESS ---\n");
      console.log("Replace the REFRESH_TOKEN in your .env file with this new one:\n");
      console.log(tokens.refresh_token);
      console.log("\n");
    } catch (err) {
      console.error("❌ Error retrieving access token:", err);
    }
  } else {
    res.end("Listening for OAuth2 callback...");
  }
});

server.listen(PORT, () => {
  console.log("1. Add the following redirect URI to your Google Cloud Console OAuth Client settings:");
  console.log(`   ${REDIRECT_URI}\n`);
  console.log("2. Authorize this app by visiting this url in your browser:\n");
  console.log(authUrl);
});
