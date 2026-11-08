const express = require("express");

function attendanceRoutes(collections, helpers) {
  const router = express.Router();
  const { studentAttendanceCollection } = collections;
  const { sanitizeYear } = helpers;

  /**
   * ১. শ্রেণিভিত্তিক দৈনিক হাজিরা সেভ অথবা আপডেট করা (POST/PUT)
   * Endpoint: POST /api/students-attendance
   */
  router.post("/api/students-attendance", async (req, res) => {
    try {
      const {
        date,
        className,
        sessionYear,
        division,
        records = [],
        recordedBy,
      } = req.body;

      if (!date || !className) {
        return res.status(400).json({
          success: false,
          message: "তারিখ এবং শ্রেণি নির্বাচন করা আবশ্যক।",
        });
      }

      const cleanSessionYear = sanitizeYear(sessionYear, "২০২৬");

      // পরিসংখ্যান গণনা
      let presentCount = 0;
      let absentCount = 0;
      let lateCount = 0;

      const sanitizedRecords = records.map((r) => {
        const status = (r.status || "present").toLowerCase();
        if (status === "present") presentCount++;
        else if (status === "absent") absentCount++;
        else if (status === "late") lateCount++;

        return {
          studentId: r.studentId || "",
          studentName: r.studentName || "",
          roll: r.roll || "",
          status: status, // "present" | "absent" | "late"
          remarks: r.remarks || "",
          updatedAt: new Date(),
        };
      });

      const filter = {
        date,
        className,
        sessionYear: cleanSessionYear,
      };

      const updateDoc = {
        $set: {
          date,
          className,
          sessionYear: cleanSessionYear,
          division: division || "সাধারণ",
          records: sanitizedRecords,
          totalStudents: sanitizedRecords.length,
          presentCount,
          absentCount,
          lateCount,
          attendanceRate:
            sanitizedRecords.length > 0
              ? Math.round(
                  ((presentCount + lateCount) / sanitizedRecords.length) *
                    100,
                )
              : 0,
          recordedBy: recordedBy || "admin",
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      };

      const result = await studentAttendanceCollection.updateOne(
        filter,
        updateDoc,
        { upsert: true },
      );

      res.status(200).json({
        success: true,
        message: "হাজিরা সফলভাবে সংরক্ষিত ও আপডেট হয়েছে!",
        data: {
          date,
          className,
          presentCount,
          absentCount,
          lateCount,
          totalStudents: sanitizedRecords.length,
        },
      });
    } catch (error) {
      console.error("Save Student Attendance Error:", error);
      res.status(500).json({
        success: false,
        message: "হাজিরা সংরক্ষণ করতে ব্যর্থ হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * ২. নির্দিষ্ট তারিখ ও শ্রেণির হাজিরা রেকর্ড লোড করা (GET)
   * Endpoint: GET /api/students-attendance
   */
  router.get("/api/students-attendance", async (req, res) => {
    try {
      const { date, class: className, sessionYear } = req.query;

      if (!date || !className) {
        return res.status(400).json({
          success: false,
          message: "তারিখ ও শ্রেণি প্যারামিটার প্রয়োজন।",
        });
      }

      const cleanSessionYear = sanitizeYear(sessionYear, "২০২৬");

      const attendance = await studentAttendanceCollection.findOne({
        date,
        className,
        sessionYear: { $regex: new RegExp(`^${cleanSessionYear}`) },
      });

      res.status(200).json({
        success: true,
        data: attendance || null,
      });
    } catch (error) {
      console.error("Fetch Student Attendance Error:", error);
      res.status(500).json({
        success: false,
        message: "হাজিরা তথ্য লোড করতে ব্যর্থ হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * ৩. শ্রেণিভিত্তিক সামগ্রিক উপস্থিতি রিপোর্ট ও পরিসংখ্যান (GET Report)
   * Endpoint: GET /api/students-attendance/report
   */
  router.get("/api/students-attendance/report", async (req, res) => {
    try {
      const { class: className, sessionYear, startDate, endDate } = req.query;

      const filter = {};
      if (className && className !== "all") {
        filter.className = className;
      }

      if (sessionYear && sessionYear !== "all") {
        const cleanSessionYear = sanitizeYear(sessionYear);
        filter.sessionYear = { $regex: new RegExp(`^${cleanSessionYear}`) };
      }

      if (startDate && endDate) {
        filter.date = { $gte: startDate, $lte: endDate };
      } else if (startDate) {
        filter.date = { $gte: startDate };
      }

      const history = await studentAttendanceCollection
        .find(filter)
        .sort({ date: -1 })
        .limit(100)
        .toArray();

      let totalSessions = history.length;
      let sumPresent = 0;
      let sumAbsent = 0;
      let sumLate = 0;
      let sumTotalEnrolled = 0;

      history.forEach((h) => {
        sumPresent += h.presentCount || 0;
        sumAbsent += h.absentCount || 0;
        sumLate += h.lateCount || 0;
        sumTotalEnrolled += h.totalStudents || 0;
      });

      const overallRate =
        sumTotalEnrolled > 0
          ? Math.round(((sumPresent + sumLate) / sumTotalEnrolled) * 100)
          : 0;

      res.status(200).json({
        success: true,
        metrics: {
          totalSessions,
          sumPresent,
          sumAbsent,
          sumLate,
          sumTotalEnrolled,
          overallRate,
        },
        history,
      });
    } catch (error) {
      console.error("Attendance Report API Error:", error);
      res.status(500).json({
        success: false,
        message: "হাজিরা রিপোর্ট লোড করতে ব্যর্থ হয়েছে।",
        error: error.message,
      });
    }
  });

  return router;
}

module.exports = attendanceRoutes;
