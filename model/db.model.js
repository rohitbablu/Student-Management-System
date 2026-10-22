const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getDatabaseState } = require("./db.connection");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "students.json");
const STUDENT_FIELDS = [
  "studentId",
  "name",
  "email",
  "phone",
  "profilePhoto",
  "address",
  "course",
  "branch",
  "semester",
  "enrollmentNo",
];

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2), "utf8");
  }
}

function readLocalStudents() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw) || [];
  } catch {
    return [];
  }
}

function writeLocalStudents(students) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(students, null, 2), "utf8");
}

function createLocalDoc(studentData) {
  const doc = {
    _id: String(studentData._id || crypto.randomBytes(12).toString("hex")),
    ...Object.fromEntries(
      STUDENT_FIELDS.filter((field) => studentData[field] !== undefined).map(
        (field) => [field, studentData[field]]
      )
    ),
    attendance: Array.isArray(studentData.attendance)
      ? studentData.attendance.map(({ date, status }) => ({ date, status }))
      : [],
    feeRecords: Array.isArray(studentData.feeRecords)
      ? studentData.feeRecords.map((record) => ({ ...record }))
      : [],
    age: studentData.age,
    city: studentData.city,
    createdAt: studentData.createdAt || new Date().toISOString(),
    updatedAt: studentData.updatedAt || new Date().toISOString(),
  };

  const toStoredStudent = () => ({
    _id: doc._id,
    ...Object.fromEntries(
      [...STUDENT_FIELDS, "age", "city"]
        .filter((field) => doc[field] !== undefined)
        .map((field) => [field, doc[field]])
    ),
    attendance: doc.attendance,
    feeRecords: doc.feeRecords,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  });

  doc.save = async function () {
    const students = readLocalStudents();
    const idx = students.findIndex((s) => String(s._id) === String(doc._id));
    doc.updatedAt = new Date().toISOString();
    if (idx !== -1) {
      students[idx] = toStoredStudent();
    } else {
      students.push(toStoredStudent());
    }
    writeLocalStudents(students);
    return doc;
  };

  doc.deleteOne = async function () {
    const students = readLocalStudents();
    const filtered = students.filter((s) => String(s._id) !== String(doc._id));
    writeLocalStudents(filtered);
    return { acknowledged: true, deletedCount: 1 };
  };

  return doc;
}

const studentSchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true, trim: true },
    name: { type: String, required: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    profilePhoto: { type: String, default: "" },
    address: { type: String, required: true, trim: true },
    course: { type: String, required: true },
    branch: { type: String, required: true, trim: true },
    semester: { type: String, required: true, trim: true },
    enrollmentNo: { type: String, required: true, trim: true },
    attendance: [
      {
        date: { type: String, required: true },
        status: {
          type: String,
          enum: ["present", "absent", "leave"],
          required: true,
        },
      },
    ],
    feeRecords: [
      {
        month: { type: String, required: true },
        dueAmount: { type: Number, required: true, min: 0 },
        paidAmount: { type: Number, required: true, min: 0 },
        dueDate: { type: String, default: "" },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
    age: { type: String },
    city: { type: String },
  },
  { timestamps: true }
);

const MongooseStudent =
  mongoose.models.Student || mongoose.model("Student", studentSchema);

const Student = {
  find: async function (query = {}) {
    const state = getDatabaseState();
    if (state.isConnected) {
      return await MongooseStudent.find(query);
    }
    const students = readLocalStudents();
    return students.map((s) => createLocalDoc(s));
  },

  create: async function (data) {
    const state = getDatabaseState();
    if (state.isConnected) {
      return await MongooseStudent.create(data);
    }
    const doc = createLocalDoc(data);
    await doc.save();
    return doc;
  },

  findById: async function (id) {
    const state = getDatabaseState();
    if (state.isConnected) {
      return await MongooseStudent.findById(id);
    }
    const students = readLocalStudents();
    const match = students.find((s) => String(s._id) === String(id));
    if (!match) return null;
    return createLocalDoc(match);
  },

  findByIdAndUpdate: async function (id, update, options = {}) {
    const state = getDatabaseState();
    if (state.isConnected) {
      return await MongooseStudent.findByIdAndUpdate(id, update, options);
    }
    const student = await Student.findById(id);
    if (!student) return null;
    Object.assign(student, update);
    return await student.save();
  },

  findByIdAndDelete: async function (id) {
    const state = getDatabaseState();
    if (state.isConnected) {
      return await MongooseStudent.findByIdAndDelete(id);
    }
    const student = await Student.findById(id);
    if (!student) return null;
    await student.deleteOne();
    return student;
  },
};

module.exports = {
  Student,
};