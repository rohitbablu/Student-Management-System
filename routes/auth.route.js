const express = require("express");
const crypto = require("crypto");
const { promisify } = require("util");
const nodemailer = require("nodemailer");
const { User } = require("../model/auth.model");
const dbConnect = require("../model/db.connection");

const router = express.Router();
const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = "student_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_DURATION_MS = 30 * 60 * 1000;
const SESSION_COOKIE_NAME = SESSION_COOKIE;

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function createPasswordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = await scrypt(password, salt, 64);
  return { salt, hash: hash.toString("hex") };
}

async function passwordMatches(password, salt, storedHash) {
  const { hash } = await createPasswordHash(password, salt);
  const actual = Buffer.from(hash, "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createResetMailer() {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const username = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASS;
  const placeholderValue = /^(your[-_ ]|change[-_ ]|replace[-_ ]|<.*>)/i;

  if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }
  if ([host, from, username, password].some((value) => value && placeholderValue.test(value))) {
    return null;
  }
  if (Boolean(username) !== Boolean(password)) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    ...(username ? { auth: { user: username, pass: password } } : {}),
  });
}

function getApplicationUrl() {
  const configuredUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 8080}`;
  const appUrl = new URL(configuredUrl);
  if (!["http:", "https:"].includes(appUrl.protocol)) {
    throw new Error("APP_URL must use HTTP or HTTPS.");
  }
  return appUrl.origin;
}

function escapeEmailHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function getCookie(req, cookieName) {
  const cookies = (req.headers.cookie || "").split(";");
  const cookie = cookies.find((entry) => entry.trim().startsWith(`${cookieName}=`));
  return cookie ? cookie.trim().slice(cookieName.length + 1) : "";
}

function setSessionCookie(res, token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`
  );
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`
  );
}

function publicUser(user) {
  return { id: String(user._id), name: user.name, email: user.email };
}

router.post("/signup", async (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const email = normalizeEmail(req.body.email);
  const password = req.body.password;

  if (!name || name.length > 100) {
    return res.status(400).json({ message: "Enter your name (up to 100 characters)." });
  }
  if (!validEmail(email)) {
    return res.status(400).json({ message: "Enter a valid email address." });
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return res.status(400).json({
      message: "Password must be between 8 and 128 characters.",
    });
  }

  try {
    await dbConnect();
    if (await User.findOne({ email })) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }
    const { salt, hash } = await createPasswordHash(password);
    const user = await User.create({
      name,
      email,
      passwordHash: hash,
      passwordSalt: salt,
      sessions: [],
    });
    res.status(201).json({
      status: 201,
      message: "Account created. Sign in to continue.",
      data: publicUser(user),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "An account with this email already exists." });
    }
    console.error("Error creating account:", error);
    res.status(500).json({ message: "Unable to create account.", error: error.message });
  }
});

router.post("/signin", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = req.body.password;
  if (!validEmail(email) || typeof password !== "string") {
    return res.status(400).json({ message: "Enter a valid email and password." });
  }

  try {
    await dbConnect();
    const user = await User.findOne({ email });
    if (
      !user ||
      !(await passwordMatches(password, user.passwordSalt, user.passwordHash))
    ) {
      return res.status(401).json({ message: "Email or password is incorrect." });
    }

    const now = new Date();
    user.sessions = (user.sessions || []).filter(
      (session) => new Date(session.expiresAt).getTime() > now.getTime()
    );
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
    user.sessions.push({ tokenHash: hashToken(token), expiresAt });
    await user.save();
    setSessionCookie(res, token, expiresAt);
    res.status(200).json({
      status: 200,
      message: "Signed in successfully.",
      data: publicUser(user),
    });
  } catch (error) {
    console.error("Error signing in:", error);
    res.status(500).json({ message: "Unable to sign in.", error: error.message });
  }
});

router.get("/me", async (req, res) => {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return res.status(401).json({ message: "Sign in is required." });

  try {
    await dbConnect();
    const tokenHash = hashToken(token);
    const user = await User.findOne({ "sessions.tokenHash": tokenHash });
    const session = user?.sessions?.find(
      (entry) => entry.tokenHash === tokenHash
    );
    if (!user || !session || new Date(session.expiresAt).getTime() <= Date.now()) {
      return res.status(401).json({ message: "Your session has expired. Sign in again." });
    }
    res.status(200).json({ status: 200, data: publicUser(user) });
  } catch (error) {
    console.error("Error checking session:", error);
    res.status(500).json({ message: "Unable to verify the session.", error: error.message });
  }
});

router.post("/signout", async (req, res) => {
  const token = getCookie(req, SESSION_COOKIE);
  try {
    if (token) {
      await dbConnect();
      const tokenHash = hashToken(token);
      const user = await User.findOne({ "sessions.tokenHash": tokenHash });
      if (user) {
        user.sessions = user.sessions.filter(
          (session) => session.tokenHash !== tokenHash
        );
        await user.save();
      }
    }
    clearSessionCookie(res);
    res.status(200).json({ status: 200, message: "Signed out successfully." });
  } catch (error) {
    console.error("Error signing out:", error);
    res.status(500).json({ message: "Unable to sign out.", error: error.message });
  }
});

router.post("/forgot-password", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!validEmail(email)) {
    return res.status(400).json({ message: "Enter a valid email address." });
  }
  if (process.env.SMTP_HOST?.trim().toLowerCase() === "sandbox.smtp.mailtrap.io") {
    return res.status(503).json({
      message: "Mailtrap sandbox only captures test messages. To email your registered address, configure a live SMTP provider and restart the server.",
    });
  }
  const mailer = createResetMailer();
  if (!mailer) {
    return res.status(503).json({
      message: "Email settings are missing or still contain example values. Add your real SMTP settings to .env and restart the server.",
    });
  }

  try {
    const appUrl = getApplicationUrl();
    await dbConnect();
    const user = await User.findOne({ email });
    if (user) {
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashToken(token);
      user.resetTokenHash = tokenHash;
      user.resetExpiresAt = new Date(Date.now() + RESET_DURATION_MS);
      await user.save();
      const resetUrl = `${appUrl}/#/reset-password/${token}`;
      try {
        await mailer.sendMail({
          from: process.env.SMTP_FROM,
          to: user.email,
          subject: "Reset your Student Management password",
          text: `Hello ${user.name},\n\nUse this link to reset your password. It expires in 30 minutes:\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
          html: `<p>Hello ${escapeEmailHtml(user.name)},</p><p>Use the link below to reset your password. It expires in 30 minutes.</p><p><a href="${escapeEmailHtml(resetUrl)}">Reset your password</a></p><p>If you did not request this, you can ignore this email.</p>`,
        });
      } catch (error) {
        const pendingReset = await User.findOne({ resetTokenHash: tokenHash });
        if (pendingReset) {
          pendingReset.resetTokenHash = undefined;
          pendingReset.resetExpiresAt = undefined;
          await pendingReset.save();
        }
        error.mailDeliveryFailed = true;
        throw error;
      }
    }
    res.status(200).json({
      status: 200,
      message: "If an account exists for that email, a password reset email has been sent.",
    });
  } catch (error) {
    console.error("Error requesting password reset:", error);
    if (error.mailDeliveryFailed) {
      return res.status(503).json({
        message: "We couldn't send the reset email. Check the email service configuration and try again.",
      });
    }
    res.status(500).json({ message: "Unable to request a password reset.", error: error.message });
  }
});

router.post("/reset-password", async (req, res) => {
  const token = typeof req.body.token === "string" ? req.body.token : "";
  const password = req.body.password;
  if (!token || typeof password !== "string" || password.length < 8 || password.length > 128) {
    return res.status(400).json({
      message: "Enter a valid reset link and a password between 8 and 128 characters.",
    });
  }

  try {
    await dbConnect();
    const user = await User.findOne({ resetTokenHash: hashToken(token) });
    if (
      !user ||
      !user.resetExpiresAt ||
      new Date(user.resetExpiresAt).getTime() <= Date.now()
    ) {
      return res.status(400).json({ message: "This password reset link is invalid or expired." });
    }
    const { salt, hash } = await createPasswordHash(password);
    user.passwordSalt = salt;
    user.passwordHash = hash;
    user.resetTokenHash = undefined;
    user.resetExpiresAt = undefined;
    user.sessions = [];
    await user.save();
    clearSessionCookie(res);
    res.status(200).json({
      status: 200,
      message: "Password reset successfully. Sign in with your new password.",
    });
  } catch (error) {
    console.error("Error resetting password:", error);
    res.status(500).json({ message: "Unable to reset your password.", error: error.message });
  }
});

async function requireAuth(req, res, next) {
  const token = getCookie(req, SESSION_COOKIE_NAME);
  if (!token) {
    return res.status(401).json({ message: "Sign in is required." });
  }
  try {
    await dbConnect();
    const tokenHash = hashToken(token);
    const user = await User.findOne({ "sessions.tokenHash": tokenHash });
    const session = user?.sessions?.find(
      (entry) => entry.tokenHash === tokenHash
    );
    if (!user || !session || new Date(session.expiresAt).getTime() <= Date.now()) {
      clearSessionCookie(res);
      return res.status(401).json({ message: "Your session has expired. Sign in again." });
    }
    req.authUser = publicUser(user);
    next();
  } catch (error) {
    console.error("Error authorizing request:", error);
    res.status(500).json({ message: "Unable to verify the session.", error: error.message });
  }
}

module.exports = router;
module.exports.requireAuth = requireAuth;
