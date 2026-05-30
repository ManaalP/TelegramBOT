const { createClient } = require("redis");
const { REDIS_URL } = require("../config");

const redisClient = createClient({
  url: REDIS_URL,
  pingInterval: 60000 // Send a background PING every 60 seconds to keep the socket alive
});

redisClient.on("error", (err) => console.error("❌ Redis Client Error:", err));
redisClient.on("connect", () => console.log("✅  Redis client connected"));
redisClient.on("ready", () => console.log("✅  Redis is active and ready to use"));

redisClient.connect().catch((err) => {
  console.error("❌ Failed to connect to Redis:", err.message);
  console.error("Please make sure your Redis server is running.");
});

module.exports = redisClient;