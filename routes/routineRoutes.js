const express = require("express");

function routineRoutes(collections, helpers) {
  let app, actualCollections;
  if (collections && typeof collections.use === "function") {
    app = collections;
    actualCollections = helpers;
  } else {
    actualCollections = collections;
  }

  const router = express.Router();
  const { routinesCollection } = actualCollections;

  /**
   * রুটিন সেভ ও আপডেট করার API
   * Endpoint: POST /api/admin/routine
   */
  router.post("/api/admin/routine", async (req, res) => {
    try {
      const {
        examTitle,
        hijriYear,
        gregorianYear,
        note,
        dates,
        routineData,
        division,
        academyType,
      } = req.body;

      // ১. ভ্যালিডেশন চেক
      if (
        !examTitle ||
        !Array.isArray(dates) ||
        dates.length === 0 ||
        !Array.isArray(routineData) ||
        routineData.length === 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "প্রয়োজনীয় তথ্য (Exam Title, Dates এবং Routine Data) সঠিকভাবে দেওয়া হয়নি।",
        });
      }

      // ২. ফিল্টার অবজেক্ট তৈরি (পরীক্ষার নাম, বিভাগ ও হিজরী বছরকে ইউনিক আইডেন্টিফায়ার হিসেবে ধরা হয়েছে)
      const filter = {
        examTitle: examTitle,
        hijriYear: hijriYear || "",
        division: division || "all",
      };

      // ৩. আপডেট ডাটা অবজেক্ট
      const updateDoc = {
        $set: {
          examTitle,
          hijriYear: hijriYear || "",
          gregorianYear: gregorianYear || "",
          note: note || "",
          dates,
          routineData,
          division: division || "all",
          academyType: academyType || "all",
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      };

      // ৪. MongoDB তে Upsert (Save or Update) করা
      const result = await routinesCollection.updateOne(filter, updateDoc, {
        upsert: true,
      });

      // ৫. সফল রেসপন্স
      res.status(200).json({
        success: true,
        message: "রুটিন ডেটাবেসে সফলভাবে সেভ ও আপডেট করা হয়েছে।",
        data: result,
      });
    } catch (error) {
      console.error("Routine save error:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভারে রুটিন সেভ করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * পরীক্ষার রুটিন লোড করার API
   * Endpoint: GET /api/admin/routine
   */
  router.get("/api/admin/routine", async (req, res) => {
    try {
      const { examTitle, hijriYear, division } = req.query;

      if (!examTitle || !examTitle.trim()) {
        return res
          .status(400)
          .json({ success: false, message: "examTitle প্রয়োজন" });
      }

      const cleanTitle = examTitle.trim();
      const filter = {
        examTitle: { $regex: new RegExp(`^${cleanTitle}$`, "i") },
      };

      // শুধুমাত্র hijriYear পাঠানো হলে ফিল্টারে যোগ হবে (ডিফল্ট ফাঁকা স্ট্রিং দিয়ে রুটিন বাদ দেওয়া যাবে না)
      if (hijriYear && hijriYear.trim()) {
        filter.hijriYear = hijriYear.trim();
      }

      if (division && division.trim() && division.trim() !== "all") {
        filter.division = division.trim();
      }

      // সর্বশেষ আপডেটেড রুটিন খোঁজা
      const existingRoutine = await routinesCollection.findOne(filter, {
        sort: { updatedAt: -1, _id: -1 },
      });

      if (existingRoutine) {
        return res.status(200).json({ success: true, data: existingRoutine });
      } else {
        // রুটিন না থাকলে 404 এর বদলে 200 সহ data: null ফেরত দেওয়া যাতে ব্রাউজারে লাল নেটওয়ার্ক এরর না ওঠে
        return res.status(200).json({
          success: false,
          data: null,
          message: "এই পরীক্ষার কোনো রুটিন পাওয়া যায়নি।",
        });
      }
    } catch (error) {
      console.error("GET /api/admin/routine error:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  if (app) {
    app.use(router);
  }
  return router;
}

module.exports = routineRoutes;
