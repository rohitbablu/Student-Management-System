const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const path = require("path");

// Load environment variables FIRST
dotenv.config({ path: ".env" });

const dbConnect = require("./model/db.connection.js");
const router = require("./routes/route.js");
const authRouter = require("./routes/auth.route.js");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: "6mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve React build
app.use(express.static(path.join(__dirname, "dist")));

// API routes
app.use("/api/auth", authRouter);
app.use("/api", authRouter.requireAuth, router);

// Catch-all for React Router
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, async () => {
  console.log(`Server started on port: ${PORT}`);
  await dbConnect();
});
