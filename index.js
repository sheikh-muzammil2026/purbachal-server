require("dotenv").config();

const express = require("express");
const cors = require("cors");

// 1. Config & Utilities
const { connectDB, dbProxy, collectionsProxy } = require("./config/db");
const { createAuthHelpers } = require("./utils/authHelpers");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");

// 2. Modular Feature Routers
const studentRoutes = require("./routes/studentRoutes");
const admissionRoutes = require("./routes/admissionRoutes");
const admitCardRoutes = require("./routes/admitCardRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");
const examRoutes = require("./routes/examRoutes");
const galleryRoutes = require("./routes/galleryRoutes");
const financeRoutes = require("./routes/financeRoutes");
const teacherRoutes = require("./routes/teacherRoutes");
const staffRoutes = require("./routes/staffRoutes");
const userRoutes = require("./routes/userRoutes");
const authRoutes = require("./routes/authRoutes");
const routineRoutes = require("./routes/routineRoutes");
const syllabusRoutes = require("./routes/syllabusRoutes");
const resultRoutes = require("./routes/resultRoutes");

// 3. Domain Modules
const administrationRoutes = require("./routes/administrationRoutes");
const noticeRoutes = require("./routes/noticeRoutes");
const smartClassroomRoutes = require("./routes/smartClassroomRoutes");
const parentRoutes = require("./routes/parentRoutes");

const app = express();
const port = process.env.PORT || 8000;

// Global Middleware Configurations
app.use(cors());
app.use(express.json());

// Serverless Database Connection Boundary Middleware
app.use(async (req, res, next) => {
  // Skip DB connection for root health check endpoint
  if (req.path === "/" || req.path === "/health") {
    return next();
  }
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error("Database connection middleware error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Database connection failed",
      error: err.message,
    });
  }
});

// Authentication & RBAC Helpers using dynamic collections proxy
const authHelpers = createAuthHelpers(collectionsProxy);

// Mount Modular Domain Feature Routers synchronously
app.use(studentRoutes(collectionsProxy, authHelpers, dbProxy));
app.use(admissionRoutes(collectionsProxy, authHelpers, dbProxy));
app.use(admitCardRoutes(collectionsProxy, authHelpers, dbProxy));
app.use(attendanceRoutes(collectionsProxy, authHelpers, dbProxy));
app.use(examRoutes(collectionsProxy, authHelpers, dbProxy));
app.use(galleryRoutes(collectionsProxy, authHelpers, dbProxy));
app.use(financeRoutes(collectionsProxy, authHelpers, dbProxy));
app.use(teacherRoutes(collectionsProxy, authHelpers, dbProxy));
app.use(staffRoutes(collectionsProxy, authHelpers, dbProxy));
app.use(userRoutes(collectionsProxy, authHelpers, dbProxy));
app.use(authRoutes(collectionsProxy, authHelpers, dbProxy));
app.use(routineRoutes(collectionsProxy, authHelpers, dbProxy));
app.use(syllabusRoutes(collectionsProxy, authHelpers, dbProxy));
app.use(resultRoutes(collectionsProxy, authHelpers, dbProxy));

// Mount Existing Domain Modules
administrationRoutes(app, dbProxy);
noticeRoutes(app, dbProxy);
smartClassroomRoutes(app, dbProxy);
parentRoutes(app, dbProxy);

// Root Health & Verification Route
app.get("/", (req, res) => {
  return res.status(200).send("As-Salam Ideal Madrasah (AIM) Purbachal Server is Running!");
});

app.get("/health", (req, res) => {
  return res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Global Error Handling & 404 Fallback
app.use(notFoundHandler);
app.use(errorHandler);

// Standalone Server Startup (only in non-serverless local environments)
if (require.main === module && !process.env.VERCEL) {
  connectDB()
    .then(() => {
      app.listen(port, () => {
        console.log(`Server is running on port: ${port}`);
      });
    })
    .catch((err) => {
      console.error("Local MongoDB connection error:", err.message);
      app.listen(port, () => {
        console.log(`Server is running on port: ${port} (awaiting database connection)`);
      });
    });
}

// Export default app for Vercel Serverless Function bridge
module.exports = app;
