require("dotenv").config();

const express = require("express");
const cors = require("cors");

// 1. Config & Utilities
// const { corsOptions, handlePreflight } = require("./config/corsOptions");
const { connectDB } = require("./config/db");
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
// app.use(handlePreflight);
app.use(express.json());

async function run() {
  try {
    // Database Connection (স্বয়ংক্রিয় রিট্রাই সহ)
    const { database, collections } = await connectDB();

    // অথেনটিকেশন ও আরবেক (RBAC) হেল্পার
    const authHelpers = createAuthHelpers(collections);

    // Mount Modular Domain Feature Routers
    app.use(studentRoutes(collections, authHelpers, database));
    app.use(admissionRoutes(collections, authHelpers, database));
    app.use(admitCardRoutes(collections, authHelpers, database));
    app.use(attendanceRoutes(collections, authHelpers, database));
    app.use(examRoutes(collections, authHelpers, database));
    app.use(galleryRoutes(collections, authHelpers, database));
    app.use(financeRoutes(collections, authHelpers, database));
    app.use(teacherRoutes(collections, authHelpers, database));
    app.use(staffRoutes(collections, authHelpers, database));
    app.use(userRoutes(collections, authHelpers, database));
    app.use(authRoutes(collections, authHelpers, database));
    app.use(routineRoutes(collections, authHelpers, database));
    app.use(syllabusRoutes(collections, authHelpers, database));
    app.use(resultRoutes(collections, authHelpers, database));

    // Mount Existing Domain Modules
    administrationRoutes(app, database);
    noticeRoutes(app, database);
    smartClassroomRoutes(app, database);
    parentRoutes(app, database);

    // মূল রুট
    app.get("/", (req, res) => {
      res.send("As-Salam Ideal Madrasah (AIM) Purbachal Server is Running!");
    });

    // গ্লোবাল এরর হ্যান্ডলার (CORS ত্রুটি সহ) ও 404 Fallback
    app.use(notFoundHandler);
    app.use(errorHandler);

    // সার্ভার চালুকরণ (MongoDB কানেকশনের পর)
    app.listen(port, () => {
      console.log(`Server is running on port: ${port}`);
    });
  } catch (error) {
    console.error("MongoDB কানেকশন ত্রুটি:", error);
  }
}

run().catch(console.dir);
