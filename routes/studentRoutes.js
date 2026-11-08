const express = require("express");
const { ObjectId } = require("mongodb");

function studentRoutes(collections, helpers) {
  const router = express.Router();
  const { studentsCollection, admissionCollection } = collections;
  const { sanitizeYear } = helpers;

  /**
   * নির্দিষ্ট ক্লাস এবং স্ট্যাটাস অনুযায়ী শিক্ষার্থীদের তালিকা নিয়ে আসার API
   * Endpoint: GET /api/students?class=প্লে&status=approved
   */
  router.get("/api/students", async (req, res) => {
    try {
      const {
        class: className,
        status,
        search,
        sessionYear,
        division,
        academyType,
        type,
        feeCategory,
        activity,
        page,
        limit,
      } = req.query;

      // ১. ডায়নামিক ফিল্টার অবজেক্ট
      const andClauses = [];

      // অ্যাক্টিভিটি ফিল্টার (গ্লোবাল ডিফল্ট: শুধুমাত্র active শিক্ষার্থী)
      if (activity && activity !== "all") {
        if (activity === "inactive") {
          andClauses.push({
            activity: { $in: ["permanent_inactive", "temporary_inactive"] },
          });
        } else {
          andClauses.push({
            activity: { $regex: new RegExp(`^${activity.trim()}$`, "i") },
          });
        }
      } else if (!activity) {
        // STRICT GLOBAL DEFAULT: শুধুমাত্র active শিক্ষার্থীরা আসবে
        andClauses.push({ activity: "active" });
      }

      if (status) {
        andClauses.push({
          status: { $regex: new RegExp(`^${status}$`, "i") },
        });
      }

      if (sessionYear && sessionYear !== "all") {
        const cleanSessionYear = sanitizeYear(sessionYear);
        andClauses.push({
          sessionYear: { $regex: new RegExp(`^${cleanSessionYear}`) },
        });
      }

      if (division && division !== "all") {
        if (division === "preHifz") {
          andClauses.push({ "divisionPreHifz.active": true });
        } else if (division === "hifz") {
          andClauses.push({ "divisionHifz.active": true });
        } else if (division === "academy") {
          andClauses.push({ "divisionAcademy.active": true });
        }
      }

      if (academyType && academyType !== "all") {
        andClauses.push({
          "divisionAcademy.active": true,
          "divisionAcademy.academyType": academyType,
        });
      }

      if (className && className !== "all" && className) {
        andClauses.push({
          $or: [
            { "divisionAcademy.class": className },
            { "divisionHifz.class": className },
            { "divisionPreHifz.class": className },
          ],
        });
      }

      if (type && type !== "all") {
        andClauses.push({
          $or: [
            { "divisionPreHifz.active": true, "divisionPreHifz.type": type },
            { "divisionHifz.active": true, "divisionHifz.type": type },
            { "divisionAcademy.active": true, "divisionAcademy.type": type },
          ],
        });
      }

      if (feeCategory && feeCategory !== "all") {
        andClauses.push({ "officeUse.feeCategory": feeCategory });
      }

      if (search) {
        const searchRegex = { $regex: search, $options: "i" };
        andClauses.push({
          $or: [
            { studentNameBangla: searchRegex },
            { studentNameEnglish: searchRegex },
            { studentId: searchRegex },
          ],
        });
      }

      const filter = andClauses.length > 0 ? { $and: andClauses } : {};

      // ২. ডাটাবেজ থেকে ডাটা খোঁজা এবং রোল নম্বর অনুযায়ী গাণিতিক সর্টিং (numeric ordering)
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, parseInt(limit, 10) || 20);
      const skip = (pageNum - 1) * limitNum;

      const total = await studentsCollection.countDocuments(filter);
      const totalPages = Math.ceil(total / limitNum) || 1;

      const students = await studentsCollection
        .find(filter)
        .sort({ roll: 1, studentId: 1 })
        .collation({ locale: "en", numericOrdering: true })
        .skip(skip)
        .limit(limitNum)
        .toArray();

      // ৩. ফ্রন্টএন্ডের প্রত্যাশিত ফরম্যাটে রেসপন্স পাঠানো
      res.status(200).json({
        success: true,
        data: students,
        total: total,
        page: pageNum,
        limit: limitNum,
        totalPages: totalPages,
        totalCount: total,
        count: students.length,
        currentPage: pageNum,
      });
    } catch (error) {
      console.error("Fetch Students API Error:", error);
      res.status(500).json({
        success: false,
        message: "শিক্ষার্থীদের তথ্য লোড করতে ব্যর্থ হয়েছে।",
      });
    }
  });

  /**
   * সিট প্ল্যান আপডেট করার API
   * Endpoint: PATCH /api/students/:id/seat-plan
   */
  router.patch("/api/students/:id/seat-plan", async (req, res) => {
    try {
      const { id } = req.params;
      const { hallNo, seatNo } = req.body;

      let filter;
      try {
        filter = { _id: new ObjectId(id) };
      } catch (e) {
        filter = { studentId: id };
      }

      const updateDoc = {
        $set: {
          "seatPlan.hallNo": hallNo,
          "seatPlan.seatNo": seatNo,
          hallNo: hallNo,
          seatNo: seatNo,
          updatedAt: new Date(),
        },
      };

      const result = await studentsCollection.updateOne(filter, updateDoc);

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "শিক্ষার্থী পাওয়া যায়নি।",
        });
      }

      res.status(200).json({
        success: true,
        message: "সিট প্ল্যান সফলভাবে আপডেট করা হয়েছে।",
      });
    } catch (error) {
      console.error("Update Seat Plan Error:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভারে সিট প্ল্যান আপডেট করতে সমস্যা হয়েছে।",
      });
    }
  });

  /**
   * ১. স্টুডেন্টের নির্দিষ্ট তথ্য লোড করার জন্য (GET API)
   * Endpoint: GET /api/students/edit/:id
   */
  router.get("/api/students/edit/:id", async (req, res) => {
    try {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "অকার্যকর আইডি ফর্ম্যাট।",
        });
      }

      const student = await studentsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (student) {
        res.json({ success: true, data: student });
      } else {
        res.status(404).json({
          success: false,
          message: "শিক্ষার্থীর কোনো তথ্য পাওয়া যায়নি।",
        });
      }
    } catch (error) {
      console.error("GET Student Error:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভারে সমস্যা হয়েছে।",
      });
    }
  });

  /**
   * ২. স্টুডেন্টের আপডেটকৃত তথ্য সেভ করার জন্য (PUT API)
   * Endpoint: PUT /api/students/edit/:id
   */
  router.put("/api/students/edit/:id", async (req, res) => {
    try {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "অকার্যকর আইডি ফর্ম্যাট।",
        });
      }

      // ক্লায়েন্ট পেজ থেকে পাঠানো ডেটা
      const updatedData = req.body;

      if (updatedData.sessionYear) {
        updatedData.sessionYear = sanitizeYear(
          updatedData.sessionYear,
          "২০২৬",
        );
      }

      // আপডেট করার সময় MongoDB-র ডিফল্ট `_id` ফিল্ডটি বাদ রাখা সুরক্ষিত
      delete updatedData._id;

      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          ...updatedData,
          updatedAt: new Date(), // আপডেট করার সময় রেকর্ড রাখার জন্য
        },
      };

      const result = await studentsCollection.updateOne(filter, updateDoc);

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "আপডেট করার জন্য শিক্ষার্থীর তথ্য পাওয়া যায়নি।",
        });
      }

      // Sync back to admissionCollection if studentId exists
      const updatedStudent = await studentsCollection.findOne(filter);
      if (updatedStudent && updatedStudent.studentId) {
        const admissionFilter = { studentId: updatedStudent.studentId };
        const admissionDoc = { ...updatedStudent };
        delete admissionDoc._id; // Ensure we don't try to change original _id

        await admissionCollection.updateOne(admissionFilter, {
          $set: admissionDoc,
        });
      }

      res.json({
        success: true,
        message: "শিক্ষার্থীর তথ্য সফলভাবে আপডেট করা হয়েছে।",
        modifiedCount: result.modifiedCount,
      });
    } catch (error) {
      console.error("PUT Student Error:", error);
      res.status(500).json({
        success: false,
        message: "তথ্য আপডেট করার সময় সার্ভারে সমস্যা হয়েছে।",
      });
    }
  });

  /**
   * ৩. শিক্ষার্থীর অ্যাক্টিভিটি স্ট্যাটাস (active, permanent_inactive, temporary_inactive) আপডেট করার API
   * Endpoint: PATCH /api/students/:id/activity
   */
  router.patch("/api/students/:id/activity", async (req, res) => {
    try {
      const { id } = req.params;
      const { activity } = req.body;

      const allowedActivities = [
        "active",
        "permanent_inactive",
        "temporary_inactive",
      ];

      if (!activity || !allowedActivities.includes(activity)) {
        return res.status(400).json({
          success: false,
          message: `অকার্যকর অ্যাক্টিভিটি স্ট্যাটাস। গ্রহণযোগ্য মান: ${allowedActivities.join(", ")}`,
        });
      }

      let filter;
      if (ObjectId.isValid(id)) {
        filter = {
          $or: [{ _id: new ObjectId(id) }, { studentId: String(id) }],
        };
      } else {
        filter = { studentId: String(id) };
      }

      const student = await studentsCollection.findOne(filter);
      if (!student) {
        return res.status(404).json({
          success: false,
          message: "শিক্ষার্থী পাওয়া যায়নি।",
        });
      }

      const updateDoc = {
        $set: {
          activity,
          updatedAt: new Date(),
        },
      };

      await studentsCollection.updateOne({ _id: student._id }, updateDoc);

      // Sync to admissionCollection if studentId exists
      if (student.studentId) {
        await admissionCollection.updateOne(
          { studentId: student.studentId },
          { $set: { activity, updatedAt: new Date() } },
        );
      }

      res.status(200).json({
        success: true,
        message: `শিক্ষার্থীর স্ট্যাটাস সফলভাবে '${activity}' করা হয়েছে।`,
        activity,
        studentId: student.studentId,
      });
    } catch (error) {
      console.error("Student Activity Update Error:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভারে স্ট্যাটাস পরিবর্তন করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  return router;
}

module.exports = studentRoutes;
