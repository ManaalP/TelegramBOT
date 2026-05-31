require("dotenv").config();
const express      = require("express");
const { google }   = require("googleapis");
const { PORT, CLIENT_ID, CLIENT_SECRET, BASE_URL } = require("./src/config");
const webhookRoute = require("./src/routes/webhook");
const supabase     = require("./src/utils/supabase");

const app = express();
app.use(express.json());
app.use(webhookRoute);

app.get("/oauth2callback", async (req, res) => {
  const { code, state: chatId } = req.query;
  if (!code || !chatId) return res.status(400).send("Missing code or state (chatId).");

  try {
    const redirectUri = `${BASE_URL}/oauth2callback`;
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, redirectUri);
    
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      return res.send("Error: No refresh token returned. Please revoke access in your Google Account and try again.");
    }

    const { error } = await supabase.from("users").upsert({ chat_id: chatId, refresh_token: tokens.refresh_token });
    
    if (error) {
      console.error("Supabase Save Error:", error);
      return res.status(500).send(`❌ Failed to save to database: ${error.message}`);
    }
    
    res.send("✅ Authentication successful! You can close this window and return to Telegram.");
  } catch (err) {
    console.error("OAuth Error:", err);
    res.status(500).send("Authentication failed.");
  }
});

app.listen(PORT, () => {
  console.log(`✅  Bot running on port ${PORT}`);
  console.log(`☁️   Logs → Routing to Supabase (Encrypted)`);
  console.log(`🔐  Multi-tenant OAuth callback ready at /oauth2callback`);
});
