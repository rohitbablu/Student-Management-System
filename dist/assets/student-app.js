const API_URL = "/api";
const fields = [
  { name: "studentId", label: "Student ID", placeholder: "Enter student ID" },
  { name: "name", label: "Full name", placeholder: "Enter student name" },
  { name: "email", label: "Email", type: "email", placeholder: "name@example.com" },
  { name: "phone", label: "Phone", type: "tel", placeholder: "Enter phone number" },
  { name: "address", label: "Address", placeholder: "Enter full address", wide: true },
  { name: "course", label: "Course", placeholder: "e.g. B.Tech" },
  { name: "branch", label: "Branch", placeholder: "e.g. Computer Science" },
  { name: "semester", label: "Semester", placeholder: "Select semester", select: true },
  { name: "enrollmentNo", label: "Enrollment no.", placeholder: "Enter enrollment number" },
];

const root = document.getElementById("root");
const THEME_STORAGE_KEY = "student-management-theme";
let currentTheme =
  localStorage.getItem(THEME_STORAGE_KEY) === "night" ? "night" : "day";
document.documentElement.dataset.theme = currentTheme;

function pageFromHash() {
  const page = window.location.hash.slice(2).split("/")[0];
  return ["signup", "signin", "forgot-password", "reset-password", "dashboard", "home", "students", "courses", "attendance", "analytics", "settings", "fees"].includes(page)
    ? page
    : "signup";
}
const AUTH_PAGES = ["signup", "signin", "forgot-password", "reset-password"];
const APP_PAGES = ["dashboard", "home", "students", "courses", "attendance", "analytics", "settings", "fees"];

let students = [];
let currentPage = pageFromHash();
let currentUser = null;
let authenticated = false;
let authNoticeMessage = "";
let authNoticeError = false;
let preserveAuthNoticeOnHashChange = false;
let editingId = null;
let photoData = "";
let searchText = "";
let messageTimer;
let attendanceDate = localDateString(new Date());
let attendanceMonth = attendanceDate.slice(0, 7);
let attendanceReport = null;
let attendanceEdits = {};
let feeMonth = localDateString(new Date()).slice(0, 7);
let feeRecords = [];
let feeEdits = {};

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function inputMarkup(field, student = {}) {
  const value = escapeHtml(student[field.name] ?? "");
  const common = `id="${field.name}" name="${field.name}" required`;
  if (field.select) {
    return `<select ${common}><option value="">Select semester</option>${Array.from(
      { length: 12 },
      (_, index) => `<option value="${index + 1}" ${value === String(index + 1) ? "selected" : ""}>${index + 1}${index === 0 ? "st" : index === 1 ? "nd" : index === 2 ? "rd" : "th"} semester</option>`
    ).join("")}</select>`;
  }
  if (field.name === "address") {
    return `<textarea ${common} rows="2" placeholder="${field.placeholder}">${value}</textarea>`;
  }
  return `<input ${common} type="${field.type || "text"}" value="${value}" placeholder="${field.placeholder}" />`;
}

function attendanceCounts() {
  const counts = { present: 0, absent: 0, leave: 0, unmarked: 0 };
  for (const student of students) {
    const status = attendanceEdits[String(student._id)] ?? "";
    if (status in counts && status) counts[status] += 1;
    else counts.unmarked += 1;
  }
  return counts;
}

function attendanceChartMarkup() {
  const monthDate = new Date(`${attendanceMonth}-01T00:00:00`);
  const daysInMonth = new Date(
    monthDate.getFullYear(),
    monthDate.getMonth() + 1,
    0
  ).getDate();
  const dailyTotals = new Map(
    (attendanceReport?.dailyTotals || []).map((day) => [day.date, day])
  );
  const maxCount = Math.max(
    1,
    ...[...dailyTotals.values()].map(
      (day) => day.present + day.absent + day.leave
    )
  );
  const chartWidth = 900;
  const chartHeight = 190;
  const plotHeight = 145;
  const slotWidth = chartWidth / daysInMonth;
  const barWidth = Math.max(5, slotWidth * 0.58);
  const bars = Array.from({ length: daysInMonth }, (_, index) => {
    const dayNumber = index + 1;
    const date = `${attendanceMonth}-${String(dayNumber).padStart(2, "0")}`;
    const totals = dailyTotals.get(date) || {
      present: 0,
      absent: 0,
      leave: 0,
    };
    const x = index * slotWidth + (slotWidth - barWidth) / 2;
    let y = plotHeight;
    const segments = ["present", "absent", "leave"].map((status) => {
      const height = (totals[status] / maxCount) * plotHeight;
      y -= height;
      return height
        ? `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${height.toFixed(1)}" rx="2" class="chart-${status}"><title>${escapeHtml(date)}: ${status} ${totals[status]}</title></rect>`
        : "";
    }).join("");
    return `${segments}<text x="${(x + barWidth / 2).toFixed(1)}" y="${plotHeight + 22}" text-anchor="middle" class="chart-label">${dayNumber % 3 === 1 || dayNumber === daysInMonth ? dayNumber : ""}</text>`;
  }).join("");

  return `<div class="chart-wrap"><svg class="attendance-chart" viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="Daily present, absent, and leave attendance for ${escapeHtml(attendanceMonth)}"><line x1="0" y1="${plotHeight}" x2="${chartWidth}" y2="${plotHeight}" class="chart-axis" />${bars}</svg></div>`;
}

function getCourseGroups() {
  const courses = new Map();
  for (const student of students) {
    const courseName = (student.course || "Unassigned").trim();
    const branchName = (student.branch || "Unassigned").trim();
    const key = `${courseName.toLowerCase()}|${branchName.toLowerCase()}`;
    const course = courses.get(key) || {
      name: courseName,
      branch: branchName,
      students: [],
    };
    course.students.push(student);
    courses.set(key, course);
  }
  return [...courses.values()].sort((a, b) =>
    `${a.name} ${a.branch}`.localeCompare(`${b.name} ${b.branch}`)
  );
}

function formatAmount(value) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function getFeeTotals() {
  return feeRecords.reduce(
    (totals, record) => {
      if (!record.fee) return totals;
      totals.due += Number(record.fee.dueAmount) || 0;
      totals.paid += Number(record.fee.paidAmount) || 0;
      return totals;
    },
    { due: 0, paid: 0 }
  );
}

function navigateTo(page) {
  if (page === "home") page = "dashboard";
  currentPage = page;
  authNoticeMessage = "";
  const hash = `#/${page}`;
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  } else {
    render();
  }
}

function renderAuthPage() {
  const isSignup = currentPage === "signup";
  const isSignin = currentPage === "signin";
  const isForgot = currentPage === "forgot-password";
  const isReset = currentPage === "reset-password";
  const resetToken = window.location.hash.split("/")[2] || "";
  const title = isSignup
    ? "Create your account"
    : isSignin
      ? "Welcome back"
      : isForgot
        ? "Reset your password"
        : "Choose a new password";
  const subtitle = isSignup
    ? "Sign up first to access student records and attendance."
    : isSignin
      ? "Sign in to continue to your student management portal."
      : isForgot
        ? "Enter your registered email address. We'll send a secure password reset link to your inbox."
        : "Set a new password for your account.";
  let form;
  if (isSignup) {
    form = `<form id="auth-form" data-action="signup">
      <label class="auth-field" for="auth-name"><span>Full name</span><input id="auth-name" name="name" type="text" maxlength="100" autocomplete="name" placeholder="Your full name" required /></label>
      <label class="auth-field" for="auth-email"><span>Email address</span><input id="auth-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required /></label>
      <label class="auth-field" for="auth-password"><span>Password</span><input id="auth-password" name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" placeholder="At least 8 characters" required /></label>
      <label class="auth-field" for="auth-confirm-password"><span>Confirm password</span><input id="auth-confirm-password" name="confirmPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" placeholder="Re-enter your password" required /></label>
      <button class="button button-primary auth-submit" type="submit">Create account</button>
    </form>`;
  } else if (isSignin) {
    form = `<form id="auth-form" data-action="signin">
      <label class="auth-field" for="auth-email"><span>Email address</span><input id="auth-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required /></label>
      <label class="auth-field" for="auth-password"><span>Password</span><input id="auth-password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required /></label>
      <div class="auth-form-links"><a href="#/forgot-password">Forgot password?</a></div>
      <button class="button button-primary auth-submit" type="submit">Sign in</button>
    </form>`;
  } else if (isForgot) {
    form = `<form id="auth-form" data-action="forgot-password">
      <label class="auth-field" for="auth-email"><span>Email address</span><input id="auth-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required /></label>
      <button class="button button-primary auth-submit" type="submit">Send reset email</button>
    </form>`;
  } else {
    form = `<form id="auth-form" data-action="reset-password">
      <input name="token" type="hidden" value="${escapeHtml(resetToken)}" />
      <label class="auth-field" for="auth-password"><span>New password</span><input id="auth-password" name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" placeholder="At least 8 characters" required /></label>
      <label class="auth-field" for="auth-confirm-password"><span>Confirm new password</span><input id="auth-confirm-password" name="confirmPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" placeholder="Re-enter your password" required /></label>
      <button class="button button-primary auth-submit" type="submit" ${resetToken ? "" : "disabled"}>Reset password</button>
    </form>`;
  }

  root.innerHTML = `<main class="auth-page">
    <section class="auth-card" aria-labelledby="auth-title">
      <a class="auth-brand" href="#/signup"><span class="auth-brand-mark">S</span> Student Management</a>
      <p class="eyebrow">${isSignup ? "GET STARTED" : isSignin ? "SIGN IN" : "ACCOUNT RECOVERY"}</p>
      <h1 id="auth-title">${title}</h1>
      <p class="auth-subtitle">${subtitle}</p>
      <div id="auth-notice" class="notice ${authNoticeMessage ? `visible ${authNoticeError ? "notice-error" : "notice-success"}` : ""}" role="status" aria-live="polite">${escapeHtml(authNoticeMessage)}</div>
      ${form}
      <div class="auth-footer">${isSignup
        ? 'Already have an account? <a href="#/signin">Sign in</a>'
        : isSignin
          ? 'New here? <a href="#/signup">Create an account</a>'
          : 'Remembered your password? <a href="#/signin">Go to sign in</a>'}</div>
    </section>
  </main>`;
  document.getElementById("auth-form").addEventListener("submit", handleAuthSubmit);
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const action = form.dataset.action;
  const values = Object.fromEntries(new FormData(form).entries());
  if (
    (action === "signup" || action === "reset-password") &&
    values.password !== values.confirmPassword
  ) {
    authNoticeMessage = "The passwords do not match.";
    authNoticeError = true;
    render();
    return;
  }

  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  button.textContent = action === "signin" ? "Signing in..." : "Please wait...";
  try {
    const result = await apiRequest(`/auth/${action}`, {
      method: "POST",
      body: JSON.stringify(values),
    });
    authNoticeError = false;
    authNoticeMessage = result.message || "Request completed.";
    if (action === "signup") {
      navigateTo("signin");
      authNoticeMessage = "Account created successfully. Sign in to continue.";
      preserveAuthNoticeOnHashChange = true;
      render();
    } else if (action === "signin") {
      authenticated = true;
      currentUser = result.data;
      authNoticeMessage = "";
      navigateTo("dashboard");
      await loadStudents();
    } else if (action === "forgot-password") {
      render();
    } else if (action === "reset-password") {
      navigateTo("signin");
      authNoticeMessage = "Password reset successfully. Sign in with your new password.";
      preserveAuthNoticeOnHashChange = true;
      render();
    }
  } catch (error) {
    authNoticeMessage = error.message;
    authNoticeError = true;
    render();
  }
}

function render(preserveForm = false) {
  if (!authenticated) {
    renderAuthPage();
    return;
  }
  const existingForm = preserveForm && document.getElementById("student-form");
  const formValues = existingForm
    ? Object.fromEntries(new FormData(existingForm).entries())
    : {};
  const currentStudent = students.find(
    (student) => String(student._id) === String(editingId)
  ) || {};
  const formStudent = { ...currentStudent, ...formValues };
  const filteredStudents = students.filter((student) =>
    [
      student.studentId, student.name, student.email, student.phone, student.address,
      student.course, student.branch, student.semester, student.enrollmentNo,
    ].join(" ").toLowerCase().includes(searchText.toLowerCase())
  );
  const counts = attendanceCounts();
  const attendancePercentage =
    counts.present + counts.absent
      ? Math.round((counts.present / (counts.present + counts.absent)) * 100)
      : 0;
  const reportStudents = attendanceReport?.students || [];
  const courseGroups = getCourseGroups();
  const monthlyTotals = attendanceReport?.monthly || {
    present: 0,
    absent: 0,
    leave: 0,
    percentage: null,
  };
  const feeTotals = getFeeTotals();
  const feeOutstanding = feeTotals.due - feeTotals.paid;
  const pageTitles = {
    dashboard: "Dashboard",
    home: "Dashboard",
    students: "Students",
    courses: "Courses",
    attendance: "Attendance",
    analytics: "Analytics",
    settings: "Settings",
    fees: "Fees",
  };

  root.innerHTML = `
    <div class="dashboard-layout">
      <aside class="dashboard-sidebar">
        <button type="button" class="sidebar-brand" data-page="dashboard" aria-label="Student Management dashboard"><span class="menu-mark" aria-hidden="true"><i></i><i></i><i></i></span><span class="sidebar-brand-label">Dashboard</span></button>
        <div class="sidebar-caption">WORKSPACE</div>
        <nav class="sidebar-nav" aria-label="Application sections">
          <button type="button" class="sidebar-link ${currentPage === "dashboard" ? "sidebar-active" : ""}" data-page="dashboard"><span class="sidebar-icon">⌂</span>Dashboard</button>
          <button type="button" class="sidebar-link ${currentPage === "students" ? "sidebar-active" : ""}" data-page="students"><span class="sidebar-icon">♙</span>Students</button>
          <button type="button" class="sidebar-link ${currentPage === "courses" ? "sidebar-active" : ""}" data-page="courses"><span class="sidebar-icon">▤</span>Courses</button>
          <button type="button" class="sidebar-link ${currentPage === "attendance" ? "sidebar-active" : ""}" data-page="attendance"><span class="sidebar-icon">◷</span>Attendance</button>
          <button type="button" class="sidebar-link ${currentPage === "analytics" ? "sidebar-active" : ""}" data-page="analytics"><span class="sidebar-icon">▥</span>Analytics</button>
          <button type="button" class="sidebar-link ${currentPage === "fees" ? "sidebar-active" : ""}" data-page="fees"><span class="sidebar-icon">◈</span>Fees</button>
          <button type="button" class="sidebar-link ${currentPage === "settings" ? "sidebar-active" : ""}" data-page="settings"><span class="sidebar-icon">⚙</span>Settings</button>
        </nav>
        <div class="sidebar-bottom">
          <div class="sidebar-user"><span class="user-avatar">${escapeHtml((currentUser?.name || "U").slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(currentUser?.name || "User")}</strong><small>${escapeHtml(currentUser?.email || "")}</small></span></div>
          <button type="button" class="sidebar-signout" id="signout">Sign out</button>
          <button type="button" class="theme-toggle" id="theme-toggle" aria-pressed="${currentTheme === "night"}"><span class="theme-toggle-icon" aria-hidden="true">${currentTheme === "night" ? "☀" : "☾"}</span><span class="theme-toggle-copy"><strong>${currentTheme === "night" ? "Switch to day mode" : "Switch to night mode"}</strong><small>${currentTheme === "night" ? "Bright and refreshing" : "Easy on the eyes"}</small></span></button>
        </div>
      </aside>
      <div class="dashboard-main">
        <header class="dashboard-topbar">
          <div><p class="eyebrow">STUDENT PORTAL</p><h1>${pageTitles[currentPage] || "Home"}</h1></div>
          <div class="topbar-date">${escapeHtml(localDateString(new Date()))}</div>
        </header>
        <main class="page-content">
      <section class="page-view" ${currentPage !== "dashboard" ? "hidden" : ""} aria-labelledby="overview-title">
        <div class="overview-welcome"><div><p class="eyebrow">OVERVIEW</p><h2 id="overview-title">Welcome back, ${escapeHtml(currentUser?.name || "User")}</h2><p class="section-hint">Here's what's happening across your student records.</p></div><button class="button button-primary" type="button" data-page="students">+ Add student</button></div>
        <div class="overview-stats">
          <button type="button" class="overview-card" data-page="students"><span class="overview-card-label">Total students</span><strong>${students.length}</strong><small>View student records →</small></button>
          <button type="button" class="overview-card" data-page="courses"><span class="overview-card-label">Courses</span><strong>${courseGroups.length}</strong><small>View course groups →</small></button>
          <button type="button" class="overview-card" data-page="attendance"><span class="overview-card-label">Present today</span><strong>${attendanceReport?.today.present ?? 0}</strong><small>${attendanceReport?.today.absent ?? 0} absent · ${attendanceReport?.today.unmarked ?? students.length} unmarked</small></button>
          <button type="button" class="overview-card" data-page="analytics"><span class="overview-card-label">Monthly attendance</span><strong>${monthlyTotals.percentage ?? 0}%</strong><small>${escapeHtml(attendanceMonth)} performance →</small></button>
        </div>
        <div class="overview-panels">
          <section class="panel overview-panel"><div class="panel-heading"><div><p class="eyebrow">ATTENDANCE</p><h2>Monthly performance</h2></div><button type="button" class="text-button" data-page="analytics">View analytics →</button></div><div class="overview-chart">${attendanceChartMarkup()}</div></section>
          <section class="panel overview-panel fees-overview"><div class="panel-heading"><div><p class="eyebrow">FEES</p><h2>This month's collection</h2></div><button type="button" class="text-button" data-page="fees">Manage fees →</button></div><div class="fee-overview-row"><span>Amount paid</span><strong>${formatAmount(feeTotals.paid)}</strong></div><div class="fee-overview-row"><span>Outstanding</span><strong>${formatAmount(feeOutstanding)}</strong></div><p class="section-hint">${escapeHtml(feeMonth)} · amounts are entered manually</p></section>
        </div>
        <section class="panel recent-panel"><div class="panel-heading"><div><p class="eyebrow">DIRECTORY</p><h2>Recent students</h2></div><button type="button" class="text-button" data-page="students">View all →</button></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Student ID</th><th>Course</th><th>Semester</th></tr></thead><tbody>${students.slice(0, 5).map((student) => `<tr><td class="student-name">${escapeHtml(student.name)}</td><td>${escapeHtml(student.studentId)}</td><td>${escapeHtml(student.course)}</td><td>${escapeHtml(student.semester)}</td></tr>`).join("") || '<tr><td colspan="4" class="empty-state">No students yet.</td></tr>'}</tbody></table></div></section>
      </section>

      <div class="page-view" ${currentPage !== "attendance" ? "hidden" : ""}>
      <section class="attendance-summary" aria-label="Attendance overview for ${escapeHtml(attendanceDate)}">
        <div class="attendance-summary-heading">
          <div><p class="eyebrow">ATTENDANCE OVERVIEW</p><h2>Attendance for selected day</h2></div>
          <span class="summary-date">${escapeHtml(attendanceDate)}</span>
        </div>
        <div class="stat-grid">
          <article class="stat-card stat-present"><span>Present</span><strong>${counts.present}</strong></article>
          <article class="stat-card stat-absent"><span>Absent</span><strong>${counts.absent}</strong></article>
          <article class="stat-card stat-leave"><span>On leave</span><strong>${counts.leave}</strong></article>
          <article class="stat-card stat-percentage"><span>Attendance rate</span><strong>${attendancePercentage}%</strong><small>Present ÷ (present + absent); leave excluded</small></article>
        </div>
      </section>

      <section class="panel attendance-panel" aria-labelledby="attendance-title">
        <div class="attendance-heading">
          <div><p class="eyebrow">DAILY ATTENDANCE</p><h2 id="attendance-title">Mark attendance</h2><p class="section-hint">Choose a date, set each student's status, then save the day.</p></div>
          <label class="date-control">Attendance date<input id="attendance-date" type="date" value="${escapeHtml(attendanceDate)}" /></label>
        </div>
        <div class="attendance-toolbar">
          <div class="status-legend">
            <span><i class="legend-dot dot-present"></i>Present <b>${counts.present}</b></span>
            <span><i class="legend-dot dot-absent"></i>Absent <b>${counts.absent}</b></span>
            <span><i class="legend-dot dot-leave"></i>Leave <b>${counts.leave}</b></span>
            <span class="unmarked-count">${counts.unmarked} not marked</span>
          </div>
          <button id="save-attendance" class="button button-primary" type="button" ${students.length ? "" : "disabled"}>Save daily attendance</button>
        </div>
        <div id="attendance-notice" class="notice" role="status" aria-live="polite"></div>
        <div class="table-wrap attendance-table-wrap">
          <table class="attendance-table">
            <thead><tr><th>Student</th><th>Student ID</th><th>Course / branch</th><th>Attendance status</th></tr></thead>
            <tbody>
              ${students.length ? students.map((student) => {
                const id = String(student._id);
                const status = attendanceEdits[id] ?? "";
                return `<tr>
                  <td class="student-name">${escapeHtml(student.name || "—")}</td>
                  <td>${escapeHtml(student.studentId || "—")}</td>
                  <td>${escapeHtml(student.course || "—")}<small class="cell-subtitle">${escapeHtml(student.branch || "")}</small></td>
                  <td><select class="status-select ${status ? `status-${status}` : ""}" data-attendance="${escapeHtml(id)}" aria-label="Attendance status for ${escapeHtml(student.name || "student")}">
                    <option value="" ${status === "" ? "selected" : ""}>Not marked</option>
                    <option value="present" ${status === "present" ? "selected" : ""}>Present</option>
                    <option value="absent" ${status === "absent" ? "selected" : ""}>Absent</option>
                    <option value="leave" ${status === "leave" ? "selected" : ""}>Leave</option>
                  </select></td>
                </tr>`;
              }).join("") : '<tr><td colspan="4" class="empty-state">Add students below before marking attendance.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>

      </div>
      <div class="page-view" ${currentPage !== "analytics" ? "hidden" : ""}>
      <section class="panel monthly-panel" aria-labelledby="monthly-title">
        <div class="attendance-heading">
          <div><p class="eyebrow">MONTHLY REPORT</p><h2 id="monthly-title">Attendance performance</h2><p class="section-hint">Monthly percentage excludes leave days from the calculation.</p></div>
          <label class="date-control">Report month<input id="attendance-month" type="month" value="${escapeHtml(attendanceMonth)}" /></label>
        </div>
        <div class="monthly-summary">
          <span>Present <b class="text-present">${attendanceReport?.monthly.present || 0}</b></span>
          <span>Absent <b class="text-absent">${attendanceReport?.monthly.absent || 0}</b></span>
          <span>Leave <b class="text-leave">${attendanceReport?.monthly.leave || 0}</b></span>
          <span>Overall rate <b class="text-rate">${attendanceReport?.monthly.percentage ?? 0}%</b></span>
        </div>
        <div class="chart-heading"><h3>Daily attendance trend</h3><div class="chart-legend"><span><i class="legend-dot dot-present"></i>Present</span><span><i class="legend-dot dot-absent"></i>Absent</span><span><i class="legend-dot dot-leave"></i>Leave</span></div></div>
        ${attendanceChartMarkup()}
        <div class="table-wrap report-table-wrap">
          <table>
            <thead><tr><th>Student</th><th>Student ID</th><th>Present</th><th>Absent</th><th>Leave</th><th>Attendance %</th></tr></thead>
            <tbody>
              ${reportStudents.length ? reportStudents.map((student) => `<tr>
                <td class="student-name">${escapeHtml(student.name || "—")}</td>
                <td>${escapeHtml(student.studentId || "—")}</td>
                <td><span class="report-number text-present">${student.totals.present}</span></td>
                <td><span class="report-number text-absent">${student.totals.absent}</span></td>
                <td><span class="report-number text-leave">${student.totals.leave}</span></td>
                <td>${student.percentage === null ? '<span class="percentage-empty">No records</span>' : `<span class="percentage-pill ${student.percentage < 75 ? "percentage-low" : "percentage-good"}">${student.percentage}%</span>`}</td>
              </tr>`).join("") : '<tr><td colspan="6" class="empty-state">No student records available for this month.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
      </div>

      <div class="page-view" ${currentPage !== "students" ? "hidden" : ""}>
      <section class="panel" aria-labelledby="form-title">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">${editingId ? "UPDATE RECORD" : "NEW RECORD"}</p>
            <h2 id="form-title">${editingId ? "Edit student details" : "Add a student"}</h2>
          </div>
          ${editingId ? '<button class="button button-quiet" id="cancel-edit" type="button">Cancel</button>' : ""}
        </div>
        <div id="notice" class="notice" role="status" aria-live="polite"></div>
        <form id="student-form">
          <div class="form-grid">
            ${fields.map((field) => `
              <label class="field ${field.wide ? "field-wide" : ""}" for="${field.name}">
                <span>${field.label}<span class="required-mark"> *</span></span>
                ${inputMarkup(field, formStudent)}
              </label>
            `).join("")}
            <div class="field field-wide">
              <span>Profile photo</span>
              <div class="photo-control">
                <img id="photo-preview" class="photo-preview ${photoData ? "" : "is-empty"}" src="${photoData || ""}" alt="Profile photo preview" />
                <div class="photo-actions">
                  <input id="profilePhoto" type="file" accept="image/png,image/jpeg,image/gif,image/webp" />
                  <small>PNG, JPG, GIF, or WebP. Maximum 4 MB.</small>
                  ${photoData ? '<button class="text-button" id="remove-photo" type="button">Remove photo</button>' : ""}
                </div>
              </div>
            </div>
          </div>
          <div class="form-actions">
            <button class="button button-primary" type="submit">${editingId ? "Save changes" : "Add student"}</button>
          </div>
        </form>
      </section>

      <section class="panel records-panel" aria-labelledby="records-title">
        <div class="records-heading">
          <div><p class="eyebrow">DIRECTORY</p><h2 id="records-title">Student records</h2></div>
          <input id="student-search" class="search-input" type="search" value="${escapeHtml(searchText)}" placeholder="Search students..." aria-label="Search students" />
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Student</th><th>Student ID</th><th>Email / phone</th><th>Course / branch</th>
              <th>Semester</th><th>Enrollment no.</th><th>Address</th><th>Actions</th>
            </tr></thead>
            <tbody>
              ${filteredStudents.length ? filteredStudents.map((student) => `
                <tr>
                  <td><div class="student-cell">
                    ${student.profilePhoto
                      ? `<img class="avatar" src="${escapeHtml(student.profilePhoto)}" alt="" />`
                      : `<span class="avatar avatar-placeholder">${escapeHtml((student.name || "?").slice(0, 1).toUpperCase())}</span>`}
                    <span class="student-name">${escapeHtml(student.name || "—")}</span>
                  </div></td>
                  <td>${escapeHtml(student.studentId || "—")}</td>
                  <td>${escapeHtml(student.email || "—")}<small class="cell-subtitle">${escapeHtml(student.phone || "")}</small></td>
                  <td>${escapeHtml(student.course || "—")}<small class="cell-subtitle">${escapeHtml(student.branch || "")}</small></td>
                  <td>${escapeHtml(student.semester ? `Semester ${student.semester}` : "—")}</td>
                  <td>${escapeHtml(student.enrollmentNo || "—")}</td>
                  <td class="address-cell">${escapeHtml(student.address || "—")}</td>
                  <td><div class="row-actions">
                    <button type="button" class="button button-small button-secondary" data-edit="${escapeHtml(student._id)}">Edit</button>
                    <button type="button" class="button button-small button-danger" data-delete="${escapeHtml(student._id)}">Delete</button>
                  </div></td>
                </tr>
              `).join("") : `<tr><td colspan="8" class="empty-state">${students.length ? "No students match your search." : "No students yet. Add your first student above."}</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
      </div>
      
      <section class="page-view" ${currentPage !== "courses" ? "hidden" : ""} aria-labelledby="courses-title">
        <div class="section-page-heading"><div><p class="eyebrow">ACADEMIC PROGRAMS</p><h2 id="courses-title">Courses</h2><p class="section-hint">Course and branch groups based on the student records.</p></div><span class="section-count">${courseGroups.length} course groups</span></div>
        <div class="course-grid">${courseGroups.map((course) => `<article class="panel course-card"><div class="course-card-top"><span class="course-mark">${escapeHtml(course.name.slice(0, 1).toUpperCase())}</span><span class="course-student-count">${course.students.length} students</span></div><h3>${escapeHtml(course.name)}</h3><p>${escapeHtml(course.branch)} branch</p><div class="course-card-footer"><span>Students enrolled</span><strong>${course.students.length}</strong></div><button type="button" class="text-button" data-page="students">View student directory →</button></article>`).join("") || '<div class="panel empty-state">No courses yet. Add students with a course to see them here.</div>'}</div>
      </section>

      <section class="page-view" ${currentPage !== "fees" ? "hidden" : ""} aria-labelledby="fees-title">
        <div class="section-page-heading"><div><p class="eyebrow">PAYMENTS</p><h2 id="fees-title">Student fees</h2><p class="section-hint">Record monthly fee amounts manually. No fee amount is assumed.</p></div><label class="date-control">Fee month<input id="fee-month" type="month" value="${escapeHtml(feeMonth)}" /></label></div>
        <div class="overview-stats fee-stats"><article class="overview-card"><span class="overview-card-label">Total due</span><strong>${formatAmount(feeTotals.due)}</strong><small>${escapeHtml(feeMonth)}</small></article><article class="overview-card"><span class="overview-card-label">Amount paid</span><strong>${formatAmount(feeTotals.paid)}</strong><small>Recorded payments</small></article><article class="overview-card"><span class="overview-card-label">Outstanding</span><strong>${formatAmount(feeOutstanding)}</strong><small>Due minus paid</small></article><article class="overview-card"><span class="overview-card-label">Students with fee records</span><strong>${feeRecords.filter((record) => record.fee).length}</strong><small>For selected month</small></article></div>
        <section class="panel fees-panel"><div class="panel-heading"><div><p class="eyebrow">MONTHLY FEE REGISTER</p><h2>Fee records</h2></div><button class="button button-primary" type="button" id="save-fees" ${students.length ? "" : "disabled"}>Save fee records</button></div><div id="fees-notice" class="notice" role="status" aria-live="polite"></div><div class="table-wrap"><table class="fees-table"><thead><tr><th>Student</th><th>Student ID</th><th>Course</th><th>Amount due</th><th>Amount paid</th><th>Due date</th><th>Status</th></tr></thead><tbody>${students.map((student) => {
          const fee = feeEdits[String(student._id)] || { dueAmount: "", paidAmount: "", dueDate: "" };
          const due = Number(fee.dueAmount) || 0;
          const paid = Number(fee.paidAmount) || 0;
          const balance = Math.max(0, due - paid);
          const status = !fee.dueAmount ? "Not set" : balance === 0 ? "Paid" : paid > 0 ? "Partial" : "Unpaid";
          return `<tr><td class="student-name">${escapeHtml(student.name)}</td><td>${escapeHtml(student.studentId)}</td><td>${escapeHtml(student.course)}</td><td><input class="fee-input" type="number" min="0.01" step="0.01" placeholder="Enter amount" data-fee-kind="dueAmount" data-fee-student="${escapeHtml(student._id)}" value="${escapeHtml(fee.dueAmount)}" aria-label="Amount due for ${escapeHtml(student.name)}" /></td><td><input class="fee-input" type="number" min="0" step="0.01" placeholder="0" data-fee-kind="paidAmount" data-fee-student="${escapeHtml(student._id)}" value="${escapeHtml(fee.paidAmount)}" aria-label="Amount paid for ${escapeHtml(student.name)}" /></td><td><input class="fee-date" type="date" data-fee-kind="dueDate" data-fee-student="${escapeHtml(student._id)}" value="${escapeHtml(fee.dueDate)}" aria-label="Fee due date for ${escapeHtml(student.name)}" /></td><td><span class="fee-status ${status.toLowerCase().replace(" ", "-")}">${status}${fee.dueAmount && balance > 0 ? ` · ${formatAmount(balance)} balance` : ""}</span></td></tr>`;
        }).join("") || '<tr><td colspan="7" class="empty-state">Add students before recording fees.</td></tr>'}</tbody></table></div></section>
      </section>

      <section class="page-view" ${currentPage !== "settings" ? "hidden" : ""} aria-labelledby="settings-title">
        <div class="section-page-heading"><div><p class="eyebrow">PREFERENCES</p><h2 id="settings-title">Settings</h2><p class="section-hint">Review your account and session details.</p></div></div>
        <div class="settings-grid"><section class="panel settings-card"><p class="eyebrow">ACCOUNT PROFILE</p><h3>Signed-in account</h3><div class="settings-profile"><span class="user-avatar settings-avatar">${escapeHtml((currentUser?.name || "U").slice(0, 1).toUpperCase())}</span><div><strong>${escapeHtml(currentUser?.name || "User")}</strong><small>${escapeHtml(currentUser?.email || "")}</small></div></div><div class="settings-detail"><span>Account name</span><strong>${escapeHtml(currentUser?.name || "—")}</strong></div><div class="settings-detail"><span>Email address</span><strong>${escapeHtml(currentUser?.email || "—")}</strong></div></section><section class="panel settings-card"><p class="eyebrow">SECURITY</p><h3>Session</h3><p class="section-hint">Your account is currently signed in on this browser. Signing out will end this session.</p><button type="button" class="button button-danger settings-signout" id="settings-signout">Sign out</button></section></div>
      </section>
      <footer>Student records are securely managed in your connected student database.</footer>
        </main>
      </div>
    </div>`;

  root.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => navigateTo(button.dataset.page));
  });
  document.getElementById("signout").addEventListener("click", signOut);
  document.getElementById("theme-toggle").addEventListener("click", () => {
    currentTheme = currentTheme === "night" ? "day" : "night";
    localStorage.setItem(THEME_STORAGE_KEY, currentTheme);
    document.documentElement.dataset.theme = currentTheme;
    render();
  });
  document.getElementById("settings-signout")?.addEventListener("click", signOut);
  document.getElementById("student-form").addEventListener("submit", saveStudent);
  document.getElementById("attendance-date").addEventListener("change", (event) => {
    attendanceDate = event.target.value;
    if (!attendanceDate) return;
    attendanceMonth = attendanceDate.slice(0, 7);
    attendanceEdits = {};
    render(true);
    loadAttendance();
  });
  document.getElementById("fee-month").addEventListener("change", (event) => {
    feeMonth = event.target.value;
    if (!feeMonth) return;
    render(true);
    loadFees();
  });
  root.querySelectorAll("[data-fee-student]").forEach((input) => {
    input.addEventListener("change", () => {
      const id = input.dataset.feeStudent;
      feeEdits[id] = {
        ...(feeEdits[id] || { dueAmount: "", paidAmount: "", dueDate: "" }),
        [input.dataset.feeKind]: input.value,
      };
      render(true);
    });
  });
  document.getElementById("save-fees").addEventListener("click", saveFees);
  document.getElementById("attendance-month").addEventListener("change", (event) => {
    attendanceMonth = event.target.value;
    if (!attendanceMonth) return;
    if (!attendanceDate.startsWith(`${attendanceMonth}-`)) {
      attendanceDate = `${attendanceMonth}-01`;
    }
    attendanceEdits = {};
    render(true);
    loadAttendance();
  });
  root.querySelectorAll("[data-attendance]").forEach((select) => {
    select.addEventListener("change", () => {
      attendanceEdits[select.dataset.attendance] = select.value;
      render(true);
    });
  });
  document.getElementById("save-attendance").addEventListener("click", saveAttendance);
  document.getElementById("student-search").addEventListener("input", (event) => {
    searchText = event.target.value;
    const position = event.target.selectionStart;
    render(true);
    const search = document.getElementById("student-search");
    search.focus();
    search.setSelectionRange(position, position);
  });
  document.getElementById("profilePhoto").addEventListener("change", selectPhoto);
  document.getElementById("remove-photo")?.addEventListener("click", () => {
    photoData = "";
    render(true);
  });
  document.getElementById("cancel-edit")?.addEventListener("click", () => {
    editingId = null;
    photoData = "";
    render();
  });
  root.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      editingId = button.dataset.edit;
      const student = students.find((item) => String(item._id) === String(editingId));
      photoData = student?.profilePhoto || "";
      render();
      document.getElementById("form-title").scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
  root.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteStudent(button.dataset.delete));
  });
}

function showNotice(text, isError = false) {
  const notice = document.getElementById("notice");
  if (!notice) return;
  clearTimeout(messageTimer);
  notice.textContent = text;
  notice.className = `notice visible ${isError ? "notice-error" : "notice-success"}`;
  messageTimer = setTimeout(() => {
    notice.className = "notice";
    notice.textContent = "";
  }, 5000);
}

function showAttendanceNotice(text, isError = false) {
  const notice = document.getElementById("attendance-notice");
  if (!notice) return;
  clearTimeout(messageTimer);
  notice.textContent = text;
  notice.className = `notice visible ${isError ? "notice-error" : "notice-success"}`;
  messageTimer = setTimeout(() => {
    notice.className = "notice";
    notice.textContent = "";
  }, 5000);
}

async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Cannot reach the application server. Check that it is running, then try again.");
    }
    throw error;
  }
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.message || "The request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return result;
}

async function signOut() {
  try {
    await apiRequest("/auth/signout", { method: "POST", body: "{}" });
    authenticated = false;
    currentUser = null;
    students = [];
    attendanceReport = null;
    currentPage = "signin";
    window.location.hash = "#/signin";
    render();
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function startApplication() {
  render();
  try {
    const result = await apiRequest("/auth/me");
    authenticated = true;
    currentUser = result.data;
    if (AUTH_PAGES.includes(currentPage)) {
      currentPage = "dashboard";
      window.location.hash = "#/dashboard";
    }
    if (currentPage === "home") {
      currentPage = "dashboard";
      window.location.hash = "#/dashboard";
    }
    render();
    await loadStudents();
  } catch (error) {
    authenticated = false;
    currentUser = null;
    if (APP_PAGES.includes(currentPage)) {
      currentPage = "signin";
      window.location.hash = "#/signin";
    }
    if (error.status !== 401) {
      authNoticeMessage = error.message;
      authNoticeError = true;
    }
    render();
  }
}

async function loadStudents() {
  try {
    const result = await apiRequest("/students");
    students = result.data || [];
    render();
    await Promise.all([loadAttendance(), loadFees()]);
    return true;
  } catch (error) {
    render();
    showNotice(`Unable to load students: ${error.message}`, true);
    return false;
  }
}

async function loadFees() {
  try {
    const result = await apiRequest(`/fees?month=${encodeURIComponent(feeMonth)}`);
    feeRecords = result.data.records || [];
    feeEdits = Object.fromEntries(
      feeRecords.map((record) => [
        String(record.studentId),
        record.fee
          ? {
              dueAmount: String(record.fee.dueAmount),
              paidAmount: String(record.fee.paidAmount),
              dueDate: record.fee.dueDate || "",
            }
          : { dueAmount: "", paidAmount: "", dueDate: "" },
      ])
    );
    render(true);
    return true;
  } catch (error) {
    const notice = document.getElementById("fees-notice");
    if (notice) {
      notice.textContent = `Unable to load fee records: ${error.message}`;
      notice.className = "notice visible notice-error";
    }
    return false;
  }
}

async function saveFees() {
  const button = document.getElementById("save-fees");
  if (!button) return;
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    await apiRequest("/fees", {
      method: "PUT",
      body: JSON.stringify({
        month: feeMonth,
        records: students.map((student) => ({
          studentId: String(student._id),
          ...(feeEdits[String(student._id)] || {
            dueAmount: "",
            paidAmount: "",
            dueDate: "",
          }),
        })),
      }),
    });
    if (await loadFees()) {
      const notice = document.getElementById("fees-notice");
      if (notice) {
        notice.textContent = "Fee records saved successfully.";
        notice.className = "notice visible notice-success";
      }
    }
  } catch (error) {
    const notice = document.getElementById("fees-notice");
    if (notice) {
      notice.textContent = error.message;
      notice.className = "notice visible notice-error";
    }
  } finally {
    const saveButton = document.getElementById("save-fees");
    if (saveButton) {
      saveButton.disabled = !students.length;
      saveButton.textContent = "Save fee records";
    }
  }
}

async function loadAttendance() {
  try {
    const query = new URLSearchParams({
      date: attendanceDate,
      month: attendanceMonth,
    });
    const result = await apiRequest(`/attendance?${query}`);
    attendanceReport = result.data;
    attendanceEdits = Object.fromEntries(
      attendanceReport.students.map((student) => [
        String(student._id),
        student.status,
      ])
    );
    render(true);
    return true;
  } catch (error) {
    showAttendanceNotice(`Unable to load attendance: ${error.message}`, true);
    return false;
  }
}

async function saveAttendance() {
  const button = document.getElementById("save-attendance");
  if (!button) return;
  if (!Object.values(attendanceEdits).some(Boolean)) {
    showAttendanceNotice("Select at least one attendance status before saving.", true);
    return;
  }
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    await apiRequest("/attendance", {
      method: "PUT",
      body: JSON.stringify({
        date: attendanceDate,
        records: students.map((student) => ({
          studentId: String(student._id),
          status: attendanceEdits[String(student._id)] || "",
        })),
      }),
    });
    if (await loadAttendance()) {
      showAttendanceNotice("Daily attendance saved successfully.");
    }
  } catch (error) {
    showAttendanceNotice(error.message, true);
  } finally {
    const saveButton = document.getElementById("save-attendance");
    if (saveButton) {
      saveButton.disabled = !students.length;
      saveButton.textContent = "Save daily attendance";
    }
  }
}

function selectPhoto(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.type)) {
    showNotice("Choose a PNG, JPG, GIF, or WebP image.", true);
    event.target.value = "";
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    showNotice("Profile photos must be 4 MB or smaller.", true);
    event.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    photoData = reader.result;
    render(true);
  };
  reader.onerror = () => showNotice("The selected photo could not be read.", true);
  reader.readAsDataURL(file);
}

async function saveStudent(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const student = Object.fromEntries(new FormData(form).entries());
  student.profilePhoto = photoData;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  button.textContent = editingId ? "Saving..." : "Adding...";
  try {
    if (editingId) {
      await apiRequest(`/student/${encodeURIComponent(editingId)}`, {
        method: "PUT",
        body: JSON.stringify(student),
      });
      editingId = null;
    } else {
      await apiRequest("/add/student", {
        method: "POST",
        body: JSON.stringify(student),
      });
    }
    photoData = "";
    if (await loadStudents()) showNotice("Student record saved successfully.");
  } catch (error) {
    button.disabled = false;
    button.textContent = editingId ? "Save changes" : "Add student";
    showNotice(error.message, true);
  }
}

async function deleteStudent(id) {
  if (!window.confirm("Delete this student record? This cannot be undone.")) return;
  try {
    await apiRequest(`/student/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (String(editingId) === String(id)) {
      editingId = null;
      photoData = "";
    }
    if (await loadStudents()) showNotice("Student record deleted.");
  } catch (error) {
    showNotice(error.message, true);
  }
}

window.addEventListener("hashchange", () => {
  currentPage = pageFromHash();
  if (preserveAuthNoticeOnHashChange) {
    preserveAuthNoticeOnHashChange = false;
  } else {
    authNoticeMessage = "";
  }
  if (authenticated && AUTH_PAGES.includes(currentPage)) {
    currentPage = "dashboard";
    window.location.hash = "#/dashboard";
  } else if (authenticated && currentPage === "home") {
    currentPage = "dashboard";
    window.location.hash = "#/dashboard";
  } else if (!authenticated && APP_PAGES.includes(currentPage)) {
    currentPage = "signin";
    window.location.hash = "#/signin";
  }
  render();
});
startApplication();
