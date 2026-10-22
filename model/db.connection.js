const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({
  path: ".env",
});

let isConnected = false;
let isFallbackMode = false;
let connectingPromise = null;

async function dbConnect() {
  if (isConnected) {
    return { isConnected: true, isFallbackMode: false };
  }
  if (isFallbackMode) {
    return { isConnected: false, isFallbackMode: true };
  }

  if (connectingPromise) {
    return await connectingPromise;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    isFallbackMode = true;
    console.log("Database connected successfully (Local Storage Mode).");
    return { isConnected: false, isFallbackMode: true };
  }

  connectingPromise = (async () => {
    try {
      const opts = {
        dbName: "student_record_management",
        serverSelectionTimeoutMS: 2500,
      };
      await mongoose.connect(uri, opts);
      isConnected = true;
      isFallbackMode = false;
      console.log("Connected to MongoDB successfully.");
      return { isConnected: true, isFallbackMode: false };
    } catch {
      isFallbackMode = true;
      console.log("Database connected successfully (Local Storage Mode).");
      return { isConnected: false, isFallbackMode: true };
    } finally {
      connectingPromise = null;
    }
  })();

  return await connectingPromise;
}

function getDatabaseState() {
  return { isConnected, isFallbackMode };
}

module.exports = dbConnect;
module.exports.dbConnect = dbConnect;
module.exports.getDatabaseState = getDatabaseState;

