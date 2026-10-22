const express = require("express");
const { Student } = require("../model/db.model");
const dbConnect = require("../model/db.connection");

const router = express.Router();
const ATTENDANCE_STATUSES = new Set(["present", "absent", "leave"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(date) {
  if (!DATE_PATTERN.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function getAttendanceRecords(student) {
  return Array.isArray(student.attendance)
    ? student.attendance.map(({ date, status }) => ({ date, status }))
    : [];
}

function getFeeRecords(student) {
  return Array.isArray(student.feeRecords) ? student.feeRecords : [];
}

router.get("/fees", async (req, res) => {
  const month = req.query.month;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "")) {
    return res.status(400).json({ message: "A valid fee month is required." });
  }
  try {
    await dbConnect();
    const allStudents = await Student.find();
    const records = allStudents.map((student) => {
      const fee = getFeeRecords(student).find((record) => record.month === month);
      return {
        studentId: String(student._id),
        studentNumber: student.studentId || "",
        name: student.name || "",
        course: student.course || "",
        branch: student.branch || "",
        fee: fee
          ? {
              dueAmount: fee.dueAmount,
              paidAmount: fee.paidAmount,
              dueDate: fee.dueDate || "",
            }
          : null,
      };
    });
    res.status(200).json({ status: 200, data: { month, records } });
  } catch (err) {
    console.error("Error fetching fee records:", err);
    res.status(500).json({
      message: "Server error",
      error: err.message,
      status: 500,
    });
  }
});

router.put("/fees", async (req, res) => {
  const { month, records } = req.body;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "") || !Array.isArray(records)) {
    return res.status(400).json({
      message: "A valid month and fee records are required.",
    });
  }
  const recordIds = new Set();
  for (const record of records) {
    if (
      !record ||
      typeof record.studentId !== "string" ||
      recordIds.has(record.studentId)
    ) {
      return res.status(400).json({
        message: "Each student can have only one fee record per month.",
      });
    }
    recordIds.add(record.studentId);
    const hasDue = record.dueAmount !== "" && record.dueAmount !== null;
    const hasPaid = record.paidAmount !== "" && record.paidAmount !== null;
    if (
      (hasDue &&
        (!Number.isFinite(Number(record.dueAmount)) ||
          Number(record.dueAmount) <= 0)) ||
      (hasPaid &&
        (!Number.isFinite(Number(record.paidAmount)) ||
          Number(record.paidAmount) < 0)) ||
      (hasDue && hasPaid && Number(record.paidAmount) > Number(record.dueAmount)) ||
      (record.dueDate && !isValidDate(record.dueDate)) ||
      (!hasDue && hasPaid)
    ) {
      return res.status(400).json({
        message: "Enter a valid due amount, paid amount, and due date.",
      });
    }
  }

  try {
    await dbConnect();
    const allStudents = await Student.find();
    const studentsById = new Map(
      allStudents.map((student) => [String(student._id), student])
    );
    if (records.some((record) => !studentsById.has(record.studentId))) {
      return res.status(404).json({ message: "One or more students were not found." });
    }

    for (const record of records) {
      const student = studentsById.get(record.studentId);
      const feeRecords = getFeeRecords(student).filter(
        (fee) => fee.month !== month
      );
      const hasDue = record.dueAmount !== "" && record.dueAmount !== null;
      if (hasDue) {
        feeRecords.push({
          month,
          dueAmount: Number(record.dueAmount),
          paidAmount:
            record.paidAmount === "" || record.paidAmount === null
              ? 0
              : Number(record.paidAmount),
          dueDate: record.dueDate || "",
          updatedAt: new Date(),
        });
      }
      student.feeRecords = feeRecords;
      await student.save();
    }
    res.status(200).json({
      status: 200,
      message: "Fee records saved successfully.",
    });
  } catch (err) {
    console.error("Error saving fee records:", err);
    res.status(500).json({
      message: "Server error",
      error: err.message,
      status: 500,
    });
  }
});

router.get("/attendance", async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const month = req.query.month || date.slice(0, 7);
    if (!isValidDate(date) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ message: "A valid date and month are required." });
    }

    await dbConnect();
    const allStudents = await Student.find();
    const reportStudents = allStudents.map((student) => {
      const records = getAttendanceRecords(student);
      const monthlyRecords = records.filter((record) =>
        record.date.startsWith(`${month}-`)
      );
      const totals = { present: 0, absent: 0, leave: 0 };
      for (const { status } of monthlyRecords) totals[status] += 1;
      const eligibleDays = totals.present + totals.absent;
      return {
        _id: student._id,
        studentId: student.studentId || "",
        name: student.name || "",
        course: student.course || "",
        branch: student.branch || "",
        status: records.find((record) => record.date === date)?.status || "",
        attendance: monthlyRecords,
        totals,
        percentage: eligibleDays
          ? Math.round((totals.present / eligibleDays) * 100)
          : null,
      };
    });

    const dayMap = new Map();
    const monthlyTotals = { present: 0, absent: 0, leave: 0 };
    const todayTotals = { present: 0, absent: 0, leave: 0, unmarked: 0 };
    for (const student of reportStudents) {
      if (student.status) {
        todayTotals[student.status] += 1;
      } else {
        todayTotals.unmarked += 1;
      }
      for (const record of student.attendance) {
        const dayTotals = dayMap.get(record.date) || {
          date: record.date,
          present: 0,
          absent: 0,
          leave: 0,
        };
        dayTotals[record.status] += 1;
        dayMap.set(record.date, dayTotals);
        monthlyTotals[record.status] += 1;
      }
    }

    const monthlyEligibleDays =
      monthlyTotals.present + monthlyTotals.absent;
    res.status(200).json({
      data: {
        date,
        month,
        today: todayTotals,
        monthly: {
          ...monthlyTotals,
          percentage: monthlyEligibleDays
            ? Math.round((monthlyTotals.present / monthlyEligibleDays) * 100)
            : null,
        },
        dailyTotals: [...dayMap.values()].sort((a, b) =>
          a.date.localeCompare(b.date)
        ),
        students: reportStudents,
      },
      status: 200,
    });
  } catch (err) {
    console.error("Error generating attendance report:", err);
    res.status(500).json({
      message: "Server error",
      error: err.message,
      status: 500,
    });
  }
});

router.put("/attendance", async (req, res) => {
  const { date, records } = req.body;
  if (!isValidDate(date) || !Array.isArray(records)) {
    return res.status(400).json({
      message: "A valid date and attendance records are required.",
    });
  }

  const recordIds = new Set();
  for (const record of records) {
    if (
      !record ||
      typeof record.studentId !== "string" ||
      recordIds.has(record.studentId) ||
      (record.status !== "" && !ATTENDANCE_STATUSES.has(record.status))
    ) {
      return res.status(400).json({
        message: "Each student must have one valid attendance status.",
      });
    }
    recordIds.add(record.studentId);
  }

  try {
    await dbConnect();
    const allStudents = await Student.find();
    const studentsById = new Map(
      allStudents.map((student) => [String(student._id), student])
    );
    if (records.some((record) => !studentsById.has(record.studentId))) {
      return res.status(404).json({ message: "One or more students were not found." });
    }

    for (const record of records) {
      const student = studentsById.get(record.studentId);
      student.attendance = getAttendanceRecords(student).filter(
        (entry) => entry.date !== date
      );
      if (record.status) {
        student.attendance.push({ date, status: record.status });
      }
      await student.save();
    }
    res.status(200).json({
      status: 200,
      message: "Daily attendance saved successfully.",
    });
  } catch (err) {
    console.error("Error saving attendance:", err);
    res.status(500).json({
      message: "Server error",
      error: err.message,
      status: 500,
    });
  }
});

router.get("/students", async (req, res) => {
  try {
    await dbConnect();
    const allStudents = await Student.find();
    res.status(200).json({
      data: allStudents,
      status: 200,
    });
  } catch (err) {
    console.error("Error fetching students:", err);
    res.status(500).json({
      message: "Server error",
      error: err.message,
      status: 500,
    });
  }
});

router.put("/student/:id", async (req, res) => {
  const { id } = req.params;
  const studentFields = [
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

  try {
    await dbConnect();
    const student = await Student.findById(id);
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const updates = Object.fromEntries(
      studentFields
        .filter((field) => req.body[field] !== undefined)
        .map((field) => [field, req.body[field]])
    );
    const invalidField = Object.entries(updates).find(
      ([field, value]) =>
        field !== "profilePhoto" &&
        (typeof value !== "string" || !value.trim())
    );
    if (invalidField) {
      return res.status(400).json({ message: "Student fields cannot be empty." });
    }
    if (
      updates.profilePhoto !== undefined &&
      typeof updates.profilePhoto !== "string"
    ) {
      return res.status(400).json({ message: "Profile photo must be an image." });
    }
    for (const field of Object.keys(updates)) {
      if (field !== "profilePhoto") updates[field] = updates[field].trim();
    }
    const allStudents = await Student.find();
    const duplicate = allStudents.find(
      (candidate) =>
        String(candidate._id) !== String(student._id) &&
        ((updates.studentId &&
          candidate.studentId === updates.studentId.trim()) ||
          (updates.enrollmentNo &&
            candidate.enrollmentNo === updates.enrollmentNo.trim()))
    );
    if (duplicate) {
      return res.status(409).json({
        message: "Student ID and enrollment number must be unique.",
      });
    }
    if (
      updates.email !== undefined &&
      (typeof updates.email !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email))
    ) {
      return res.status(400).json({ message: "Enter a valid email address." });
    }
    if (
      updates.profilePhoto &&
      (typeof updates.profilePhoto !== "string" ||
        !/^data:image\/(?:jpeg|png|gif|webp);base64,/.test(
          updates.profilePhoto
        ))
    ) {
      return res.status(400).json({ message: "Profile photo must be an image." });
    }

    Object.assign(student, updates);
    if (updates.email) student.email = updates.email.toLowerCase();

    const updatedStudent = await student.save();
    res.status(200).json({ data: updatedStudent, status: 200, message: "Student updated successfully." });
  } catch (err) {
    console.error("Error updating student:", err);
    res.status(500).json({ message: "Server error", error: err.message, status: 500 });
  }
});

router.delete("/student/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await dbConnect();
    const student = await Student.findById(id);
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    await student.deleteOne();
    res.status(200).json({ message: "Student deleted successfully", _id: id, status: 200 });
  } catch (err) {
    console.error("Error deleting student:", err);
    res.status(500).json({ message: "Server error", error: err.message, status: 500 });
  }
});

router.post("/add/student", async (req, res) => {
  const {
    studentId,
    name,
    email,
    phone,
    profilePhoto = "",
    address,
    course,
    branch,
    semester,
    enrollmentNo,
  } = req.body;

  try {
    await dbConnect();

    const requiredFields = {
      studentId,
      name,
      email,
      phone,
      address,
      course,
      branch,
      semester,
      enrollmentNo,
    };
    if (
      Object.values(requiredFields).some(
        (value) => typeof value !== "string" || !value.trim()
      )
    ) {
      return res.status(400).json({
        message: "All fields are required.",
        status: 400,
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "Enter a valid email address." });
    }
    if (
      profilePhoto !== "" &&
      (typeof profilePhoto !== "string" ||
        !/^data:image\/(?:jpeg|png|gif|webp);base64,/.test(profilePhoto))
    ) {
      return res.status(400).json({ message: "Profile photo must be an image." });
    }

    const normalizedStudent = Object.fromEntries(
      Object.entries(requiredFields).map(([field, value]) => [field, value.trim()])
    );
    normalizedStudent.email = normalizedStudent.email.toLowerCase();
    const allStudents = await Student.find();
    if (
      allStudents.some(
        (student) =>
          student.studentId === normalizedStudent.studentId ||
          student.enrollmentNo === normalizedStudent.enrollmentNo
      )
    ) {
      return res.status(409).json({
        message: "Student ID and enrollment number must be unique.",
        status: 409,
      });
    }

    const student = await Student.create({
      ...normalizedStudent,
      profilePhoto,
    });
    res.status(201).json({ data: student, status: 201, message: "New student created." });
  } catch (error) {
    console.error("Error adding student:", error);
    res.status(500).json({
      message: "Server error.",
      error: error.message,
      status: 500,
    });
  }
});

module.exports = router;