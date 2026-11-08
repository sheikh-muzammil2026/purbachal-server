// ডিফল্ট সিলেবাস ডাটা (সকল বিভাগ ও শ্রেণিভিত্তিক বিষয়সমূহ)
const DEFAULT_SYLLABUS = [
  {
    department: "প্রি-হিফজ",
    class: "কায়দা/আমপারা",
    order: 1,
    subjects: [
      "কুরআন",
      "তাজভীদ ও দোয়া",
      "আরবি",
      "ইংরেজি",
      "বাংলা",
      "গণিত",
    ],
  },
  {
    department: "প্রি-হিফজ",
    class: "নাজেরা",
    order: 2,
    subjects: [
      "কুরআন",
      "তাজভীদ ও দোয়া",
      "আরবি",
      "ইংরেজি",
      "বাংলা",
      "গণিত",
    ],
  },
  {
    department: "হিফজ",
    class: "সবক",
    order: 3,
    subjects: ["কুরআন", "তাজভীদ ও দোয়া"],
  },
  {
    department: "হিফজ",
    class: "শুনানি",
    order: 4,
    subjects: ["কুরআন", "তাজভীদ ও দোয়া"],
  },
  {
    department: "প্রাক-প্রাথমিক",
    class: "প্লে",
    order: 5,
    subjects: ["আরবি-০১", "ইংরেজি", "বাংলা", "গণিত"],
  },
  {
    department: "প্রাক-প্রাথমিক",
    class: "নার্সারি",
    order: 6,
    subjects: ["আরবি-০২", "ইংরেজি", "বাংলা", "গণিত"],
  },
  {
    department: "প্রাথমিক",
    class: "প্রথম",
    order: 7,
    subjects: [
      "কুরআন ও তাজভীদ-০১",
      "আরবি",
      "তাওহীদ ও ফিকহ-১",
      "ইংরেজি",
      "স্পোকেন ইংলিশ",
      "বাংলা",
      "গণিত",
      "সাধারণ জ্ঞান",
    ],
  },
  {
    department: "প্রাথমিক",
    class: "দ্বিতীয়",
    order: 8,
    subjects: [
      "কুরআন ও তাজভীদ-০২",
      "আরবি",
      "তাওহীদ ও ফিকহ-২",
      "ইংরেজি",
      "স্পোকেন ইংলিশ",
      "বাংলা",
      "গণিত",
      "সাধারণ জ্ঞান",
    ],
  },
  {
    department: "প্রাথমিক",
    class: "তৃতীয়",
    order: 9,
    subjects: [
      "কুরআন ও তাজভীদ-০৩",
      "আরবি",
      "আদব ও দোয়া",
      "তাওহীদ ও ফিকহ-৩",
      "ইংরেজি",
      "স্পোকেন ইংলিশ",
      "বাংলা",
      "গণিত",
      "বাংলাদেশ ও বিশ্বপরিচয়",
      "বিজ্ঞান",
      "হাতের লেখা",
    ],
  },
  {
    department: "প্রাথমিক",
    class: "চতুর্থ",
    order: 10,
    subjects: [
      "কুরআন ও তাজভীদ-০৪",
      "এসো আরবি শিখি",
      "এসো তামরিন শিখি",
      "আদাব ও দোয়া",
      "তাওহীদ ও ফিকহ-৪",
      "ইংরেজি",
      "স্পোকেন ইংলিশ",
      "বাংলা",
      "গণিত",
      "বিজ্ঞান",
    ],
  },
  {
    department: "প্রাথমিক",
    class: "পঞ্চম",
    order: 11,
    subjects: [
      "কুরআন ও তাজভীদ-০৫",
      "এসো আরবি শিখি",
      "এসো তামরিন শিখি",
      "সরফ",
      "তাওহীদ ও ফিকহ-৫",
      "ইংরেজি",
      "স্পোকেন ইংলিশ",
      "বাংলা",
      "গণিত",
      "বিজ্ঞান",
    ],
  },
  {
    department: "মাধ্যমিক",
    class: "ষষ্ঠ",
    order: 12,
    subjects: [
      "হিফজুল কুরআন ও তাজভীদ-০১",
      "কুরআন অনুবাদ-০১",
      "হাদিস আরবাঈন",
      "আরবি",
      "সরফ",
      "নাহু",
      "তাওহীদ ও ফিকহ-৫",
      "ইংরেজি ১ম ও ২য়",
      "স্পোকেন ইংলিশ",
      "বাংলা ১ম ও ২য়",
      "গণিত",
      "বিজ্ঞান",
    ],
  },
  {
    department: "মাধ্যমিক",
    class: "সপ্তম",
    order: 13,
    subjects: [
      "হিফজুল কুরআন ও তাজভীদ-০২",
      "কুরআন অনুবাদ-০২",
      "হাদিস",
      "আরবি",
      "সরফ",
      "নাহু",
      "তাওহীদ",
      "ফিকহ",
      "ইংরেজি ১ম ও ২য়",
      "স্পোকেন ইংলিশ",
      "বাংলা ১ম ও ২য়",
      "গণিত",
      "বিজ্ঞান",
    ],
  },
  {
    department: "মাধ্যমিক",
    class: "অষ্টম",
    order: 14,
    subjects: [
      "হিফজুল কুরআন ও তাজভীদ-০৩",
      "কুরআন অনুবাদ-০৩",
      "হাদিস",
      "উসুলুল হাদিস",
      "আরবি",
      "সরফ",
      "নাহু",
      "তাওহীদ",
      "ফিকহ",
      "ইংরেজি ১ম ও ২য়",
      "স্পোকেন ইংলিশ",
      "বাংলা ১ম ও ২য়",
      "গণিত",
      "বিজ্ঞান",
    ],
  },
  {
    department: "মাধ্যমিক",
    class: "নবম",
    order: 15,
    subjects: [
      "বাংলা ১ম ও ২য়",
      "ইংরেজি ১ম ও ২য়",
      "গণিত",
      "বিজ্ঞান",
      "বাংলাদেশ ও বিশ্বপরিচয়",
      "ইসলাম ও নৈতিক শিক্ষা",
      "আরবি",
      "ফিকহ",
    ],
  },
  {
    department: "মাধ্যমিক",
    class: "দশম",
    order: 16,
    subjects: [
      "বাংলা ১ম ও ২য়",
      "ইংরেজি ১ম ও ২য়",
      "গণিত",
      "বিজ্ঞান",
      "বাংলাদেশ ও বিশ্বপরিচয়",
      "ইসলাম ও নৈতিক শিক্ষা",
      "আরবি",
      "ফিকহ",
    ],
  },
];

const express = require("express");

function syllabusRoutes(collectionsOrApp, helpers, database) {
  let app = null;
  let collections = collectionsOrApp;
  let authHelpers = helpers;

  if (
    collectionsOrApp &&
    typeof collectionsOrApp.use === "function" &&
    helpers &&
    helpers.syllabusCollection
  ) {
    app = collectionsOrApp;
    collections = helpers;
    authHelpers = database;
  }

  const router = express.Router();
  const { syllabusCollection } = collections;
  const { getAuthUser, isAdminUser } = authHelpers;

  // সিলেবাস কালেকশন অটো-সিড ফাংশন
  const ensureSyllabusData = async () => {
    try {
      const count = await syllabusCollection.countDocuments();
      if (count === 0) {
        await syllabusCollection.insertMany(DEFAULT_SYLLABUS);
        console.log("Initial syllabus collection seeded successfully.");
      } else {
        for (const item of DEFAULT_SYLLABUS) {
          await syllabusCollection.updateOne(
            { class: item.class },
            { $setOnInsert: item },
            { upsert: true },
          );
        }
      }
    } catch (err) {
      console.error("Error ensuring syllabus data:", err);
    }
  };

  ensureSyllabusData();

  /**
   * শ্রেণি ও বিষয় সম্পর্কিত সিলেবাস পাওয়ার API
   * Endpoint: GET /api/syllabus
   * Query Params: ?class=... (ঐচ্ছিক)
   */
  router.get("/api/syllabus", async (req, res) => {
    try {
      await ensureSyllabusData();
      const { class: className } = req.query;

      if (className) {
        const item = await syllabusCollection.findOne({ class: className });
        if (item) {
          return res.status(200).json({
            success: true,
            data: item,
            subjects: item.subjects || [],
          });
        }
        return res.status(404).json({
          success: false,
          message: `শ্রেণি "${className}"-এর জন্য কোনো সিলেবাস পাওয়া যায়নি।`,
          subjects: [],
        });
      }

      const allSyllabus = await syllabusCollection
        .find({})
        .sort({ order: 1 })
        .toArray();

      // সহজ ব্যবহারের জন্য classSubjects অবজেক্ট তৈরি
      const classSubjects = {};
      const categories = {};
      allSyllabus.forEach((item) => {
        classSubjects[item.class] = item.subjects || [];
        const dept = item.department || "অন্যান্য";
        if (!categories[dept]) categories[dept] = [];
        categories[dept].push(item.class);
      });

      res.status(200).json({
        success: true,
        data: allSyllabus,
        classSubjects: classSubjects,
        categories: categories,
      });
    } catch (error) {
      console.error("Get syllabus error:", error);
      res.status(500).json({
        success: false,
        message: "সিলেবাস লোড করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * নির্দিষ্ট শ্রেণির সিলেবাস ও বিষয় আপডেট করার API
   * Endpoint: POST /api/syllabus
   */
  router.post("/api/syllabus", async (req, res) => {
    try {
      const { class: className, department, subjects, order } = req.body;
      if (!className || !Array.isArray(subjects)) {
        return res.status(400).json({
          success: false,
          message: "Class এবং Subjects অ্যারে আবশ্যক।",
        });
      }

      const authUser = await getAuthUser(req);
      if (!isAdminUser(authUser)) {
        return res.status(403).json({
          success: false,
          message: "শুধুমাত্র অ্যাডমিন সিলেবাস পরিবর্তন করতে পারেন।",
        });
      }

      const updateDoc = {
        $set: {
          class: className,
          department: department || "অন্যান্য",
          subjects: subjects,
          order: order !== undefined ? Number(order) : 99,
          updatedAt: new Date(),
        },
      };

      const result = await syllabusCollection.updateOne(
        { class: className },
        updateDoc,
        { upsert: true },
      );

      res.status(200).json({
        success: true,
        message: "সিলেবাস সফলভাবে সংরক্ষিত হয়েছে।",
        result: result,
      });
    } catch (error) {
      console.error("Save syllabus error:", error);
      res.status(500).json({
        success: false,
        message: "সিলেবাস সংরক্ষণে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  if (app) {
    app.use(router);
  }

  return router;
}

module.exports = syllabusRoutes;
