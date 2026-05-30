const crypto = require("crypto");
const supabase = require("./supabase");
const { ENCRYPTION_KEY } = require("../config");

const ALGORITHM = "aes-256-cbc";
const keyBuffer = ENCRYPTION_KEY ? Buffer.from(ENCRYPTION_KEY, "hex") : null;

function encrypt(text) {
  if (!keyBuffer) return text;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

function log(key, obj) {
  const chatId = obj.chatId || (obj.sessionId ? obj.sessionId.split("_")[0] : null);
  
  if (!supabase) {
    console.log(`[logger] ${key} (Chat: ${chatId}):`, obj);
    return;
  }
  
  const encryptedData = encrypt(JSON.stringify(obj));
  supabase.from("logs").insert([{ chat_id: chatId, log_type: key, encrypted_data: encryptedData }])
    .catch(err => console.error("[supabase logger error]", err.message));
}

module.exports = { log };
