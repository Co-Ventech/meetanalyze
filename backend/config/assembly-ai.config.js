const { AssemblyAI } = require("assemblyai");
require('dotenv').config();

const client = new AssemblyAI({
    apiKey: process.env.ASSEMBLYAI_API_KEY
});
  
module.exports = { client };

  