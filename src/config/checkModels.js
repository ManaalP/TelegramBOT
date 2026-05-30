require("dotenv").config();
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });
const API_KEY = process.env.GEMINI_API_KEY;
console.log(API_KEY,'CHECKKKKKK');

fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`)
  .then(res => res.json())
  .then(data => {
      console.log("Your available Flash models:");
      data.models.forEach(m => {
          // Filtering for 'flash' models to keep the list clean
          if (m.name.includes('flash')) console.log(m.name); 
      });
  })
  .catch(err => console.error("Error fetching models:", err));