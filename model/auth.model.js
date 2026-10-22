const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getDatabaseState } = require("./db.connection");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "users.json");

function readLocalUsers() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2), "utf8");
  }
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  const users = JSON.parse(raw);
  if (!Array.isArray(users)) {
    throw new Error("User storage must contain a JSON array.");
  }
  return users;
}

function writeLocalUsers(users) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2), "utf8");
}

function matchesQuery(user, query) {
  return Object.entries(query).every(([path, value]) => {
    const parts = path.split(".");
    let current = user;
    for (const part of parts) {
      if (Array.isArray(current)) {
        return current.some((entry) => entry[part] === value);
      }
      current = current?.[part];
    }
    return current === value;
  });
}

function createLocalUser(data) {
  const user = {
    ...data,
    _id: String(data._id || crypto.randomBytes(12).toString("hex")),
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
  };

  user.save = async function () {
    const users = readLocalUsers();
    const storedUser = { ...user };
    delete storedUser.save;
    const index = users.findIndex(
      (candidate) => String(candidate._id) === String(user._id)
    );
    if (index === -1) users.push(storedUser);
    else users[index] = storedUser;
    writeLocalUsers(users);
    return user;
  };

  return user;
}

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    passwordHash: { type: String, required: true, select: false },
    passwordSalt: { type: String, required: true, select: false },
    sessions: {
      type: [
        {
          tokenHash: { type: String, required: true },
          expiresAt: { type: Date, required: true },
        },
      ],
      default: [],
      select: false,
    },
    resetTokenHash: { type: String, select: false },
    resetExpiresAt: { type: Date, select: false },
  },
  { timestamps: true }
);

const MongooseUser =
  mongoose.models.User || mongoose.model("User", UserSchema);

const User = {
  findOne: async function (query = {}) {
    const state = getDatabaseState();
    if (state.isConnected) {
      return MongooseUser.findOne(query).select(
        "+passwordHash +passwordSalt +sessions +resetTokenHash +resetExpiresAt"
      );
    }
    const match = readLocalUsers().find((user) =>
      matchesQuery(user, query)
    );
    return match ? createLocalUser(match) : null;
  },

  findById: async function (id) {
    const state = getDatabaseState();
    if (state.isConnected) {
      return MongooseUser.findById(id).select(
        "+passwordHash +passwordSalt +sessions +resetTokenHash +resetExpiresAt"
      );
    }
    const match = readLocalUsers().find(
      (user) => String(user._id) === String(id)
    );
    return match ? createLocalUser(match) : null;
  },

  create: async function (data) {
    const state = getDatabaseState();
    if (state.isConnected) return MongooseUser.create(data);
    const user = createLocalUser(data);
    await user.save();
    return user;
  },
};

module.exports = { User };
