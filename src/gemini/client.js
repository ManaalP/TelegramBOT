const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GEMINI_API_KEY, GEMINI_MODEL, FALLBACK_MODELS } = require("../config");
const { sleep } = require("../utils/helpers");

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Fallback array (defaulting to GEMINI_MODEL if the array isn't provided)
const modelsToTry = (FALLBACK_MODELS && FALLBACK_MODELS.length > 0) 
  ? FALLBACK_MODELS 
  : [GEMINI_MODEL];

async function gemini(prompt, maxRetries = modelsToTry.length) {
  let currentModelIndex = 0;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const currentModelName = modelsToTry[currentModelIndex];
      const model = genAI.getGenerativeModel({ model: currentModelName });
      const res = await model.generateContent(prompt);
      return res.response.text();
    } catch (err) {
      const is429 = err.status === 429 || String(err.message).includes("429");
      const is503 = err.status === 503 || String(err.message).includes("503");
      if ((is429 || is503) && attempt < maxRetries) {
        console.warn(`[Gemini] ${is429 ? '429 Quota Exceeded' : '503 High Demand'} on ${modelsToTry[currentModelIndex]}`);
        currentModelIndex = (currentModelIndex + 1) % modelsToTry.length;
        console.warn(`[Gemini] Switching to model: ${modelsToTry[currentModelIndex]} (attempt ${attempt}/${maxRetries})`);
        await sleep(1500); // Small delay before trying the new model
        continue;
      }
      throw err;
    }
  }
}

module.exports = { gemini };
