const express = require("express");

function resultRoutes(collectionsOrApp, helpers, database) {
  let app = null;
  let collections = collectionsOrApp;
  let authHelpers = helpers;

  if (
    collectionsOrApp &&
    typeof collectionsOrApp.use === "function" &&
    helpers &&
    helpers.marksCollection
  ) {
    app = collectionsOrApp;
    collections = helpers;
    authHelpers = database;
  }

  const router = express.Router();
  const { marksCollection, studentsCollection, admissionCollection } =
    collections;
  const { getAuthUser, isAdminUser, sanitizeYear } = authHelpers;

  const getStudentClass = (s) => {
    if (!s) return "N/A";
    if (s.divisionAcademy?.active && s.divisionAcademy?.class)
      return s.divisionAcademy.class;
    if (s.divisionHifz?.active && s.divisionHifz?.class)
      return s.divisionHifz.class;
    if (s.divisionPreHifz?.active && s.divisionPreHifz?.class)
      return s.divisionPreHifz.class;
    return (
      s.divisionHifz?.class ||
      s.divisionPreHifz?.class ||
      s.divisionAcademy?.class ||
      s.officeUse?.recommendedClass ||
      s.class ||
      "N/A"
    );
  };

  /**
   * ডুপ্লিকেট সাবজেক্ট মার্কস রিমুভ করার হেল্পার।
   * একই বিষয়ে একাধিক রেকর্ড থাকলে বর্তমান ক্লাস, পাবলিশড স্ট্যাটাস এবং সর্বশেষ আপডেটকৃত এন্ট্রিটি রাখা হয়।
   */
  const deduplicateSubjectMarks = (marksArray = [], preferredClass = "") => {
    if (!Array.isArray(marksArray) || marksArray.length <= 1) {
      return Array.isArray(marksArray) ? marksArray : [];
    }

    const getScore = (item) => {
      let score = 0;
      if (
        preferredClass &&
        preferredClass !== "N/A" &&
        item.class === preferredClass
      ) {
        score += 100;
      }
      if (
        item.isPublished ||
        item.term1?.isPublished ||
        item.term2?.isPublished ||
        item.annual?.isPublished
      ) {
        score += 50;
      }
      return score;
    };

    const getTimestamp = (item) => {
      const t = new Date(item.updatedAt || item.createdAt || 0).getTime();
      return Number.isFinite(t) ? t : 0;
    };

    const sorted = [...marksArray].sort((a, b) => {
      const scoreDiff = getScore(a) - getScore(b);
      if (scoreDiff !== 0) return scoreDiff;
      return getTimestamp(a) - getTimestamp(b);
    });

    const uniqueSubjects = Array.from(
      new Map(
        sorted.map((item) => [
          String(
            item.subjectCode ||
              item.subjectId ||
              item.subjectName ||
              item.subject ||
              "",
          ).trim(),
          item,
        ]),
      ).values(),
    );

    return uniqueSubjects;
  };

  /**
   * অ্যাডমিন ওয়ান-টাইম রেজাল্ট পাবলিশ ফিল্ড মাইগ্রেশন API
   * Endpoint: POST /api/admin/results/migrate-publish-status
   */
  router.post("/api/admin/results/migrate-publish-status", async (req, res) => {
    try {
      const authUser = await getAuthUser(req);
      if (!isAdminUser(authUser)) {
        return res.status(403).json({
          success: false,
          message:
            "অননুমোদিত অনুরোধ। শুধুমাত্র অ্যাডমিন মাইগ্রেশন প্রক্রিয়া সম্পন্ন করতে পারেন।",
        });
      }

      const filter = {
        $or: [{ isPublished: { $exists: false } }, { isPublished: null }],
      };

      const updateDoc = {
        $set: {
          isPublished: false,
          "term1.isPublished": false,
          "term2.isPublished": false,
          "annual.isPublished": false,
          updatedAt: new Date(),
        },
      };

      const result = await marksCollection.updateMany(filter, updateDoc);

      res.status(200).json({
        success: true,
        message:
          "রেজাল্ট ডকুমেন্টে isPublished সফলভাবে মাইগ্রেট ও সেট করা হয়েছে।",
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
      });
    } catch (error) {
      console.error("Migration endpoint error:", error);
      res.status(500).json({
        success: false,
        message: "মাইগ্রেশন প্রক্রিয়া সম্পন্ন করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * রেজাল্ট প্রকাশ / অপ্রকাশিত (Publish / Unpublish) করার API (শুধুমাত্র অ্যাডমিন)
   * Endpoint: PATCH /api/results/publish or POST /api/results/publish
   */
  const handlePublishToggle = async (req, res) => {
    try {
      const authUser = await getAuthUser(req);
      if (!isAdminUser(authUser)) {
        return res.status(403).json({
          success: false,
          message:
            "অননুমোদিত অ্যাক্সেস। শুধুমাত্র অ্যাডমিন ফলাফল প্রকাশ বা অপ্রকাশিত করতে পারেন।",
        });
      }

      const { class: studentClass, examType, year, isPublished } = req.body;

      if (isPublished === undefined) {
        return res.status(400).json({
          success: false,
          message: "isPublished মান প্রদান করা আবশ্যক।",
        });
      }

      const targetPublished = Boolean(isPublished);
      const academicYear = sanitizeYear(year, "২০২৬");

      const filter = {
        year: { $regex: new RegExp(`^${academicYear}`) },
      };

      if (
        studentClass &&
        studentClass !== "all" &&
        studentClass !== "সকল" &&
        studentClass !== "সকল শ্রেণি"
      ) {
        filter.class = studentClass;
      }

      const updateSet = {
        isPublished: targetPublished,
        updatedAt: new Date(),
        publishedBy: authUser?.email || "admin",
        publishedAt: targetPublished ? new Date() : null,
      };

      if (examType) {
        updateSet[`${examType}.isPublished`] = targetPublished;
      }

      const updateDoc = {
        $set: updateSet,
      };

      const result = await marksCollection.updateMany(filter, updateDoc);

      // ২. ফলাফল প্রকাশ হলে শিক্ষার্থীদের রোল নম্বর মেধাভিত্তিক (মেধাস্থান) ডায়নামিকভাবে আপডেট করা
      let rollsUpdatedCount = 0;
      if (
        targetPublished &&
        Array.isArray(req.body.rollUpdates) &&
        req.body.rollUpdates.length > 0
      ) {
        const validRollUpdates = req.body.rollUpdates.filter(
          (u) =>
            u &&
            u.studentId &&
            u.roll !== undefined &&
            u.roll !== null &&
            u.roll !== "",
        );

        if (validRollUpdates.length > 0) {
          const studentBulkOps = validRollUpdates.map(
            ({ studentId, roll }) => ({
              updateOne: {
                filter: { studentId: String(studentId) },
                update: {
                  $set: {
                    roll: String(roll),
                    "officeUse.rollNumber": String(roll),
                    updatedAt: new Date(),
                  },
                },
              },
            }),
          );

          const admissionBulkOps = validRollUpdates.map(
            ({ studentId, roll }) => ({
              updateOne: {
                filter: { studentId: String(studentId) },
                update: {
                  $set: {
                    roll: String(roll),
                    "officeUse.rollNumber": String(roll),
                    updatedAt: new Date(),
                  },
                },
              },
            }),
          );

          const [studentBulkRes] = await Promise.all([
            studentsCollection
              .bulkWrite(studentBulkOps, { ordered: false })
              .catch((err) => {
                console.error(
                  "Student bulkWrite error during result publish:",
                  err,
                );
                return { modifiedCount: 0 };
              }),
            admissionCollection
              .bulkWrite(admissionBulkOps, { ordered: false })
              .catch((err) => {
                console.error(
                  "Admission bulkWrite error during result publish:",
                  err,
                );
                return { modifiedCount: 0 };
              }),
          ]);

          rollsUpdatedCount = studentBulkRes.modifiedCount || 0;
        }
      }

      res.status(200).json({
        success: true,
        message: `ফলাফল সফলভাবে ${
          targetPublished ? "প্রকাশ" : "অপ্রকাশিত"
        } করা হয়েছে।${
          rollsUpdatedCount > 0
            ? ` এবং ${rollsUpdatedCount} জন শিক্ষার্থীর রোল মেধাস্থান অনুযায়ী আপডেট করা হয়েছে।`
            : ""
        }`,
        isPublished: targetPublished,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        rollsUpdatedCount,
      });
    } catch (error) {
      console.error("Result publish toggle error:", error);
      res.status(500).json({
        success: false,
        message: "ফলাফল স্ট্যাটাস পরিবর্তন করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  };

  router.patch("/api/results/publish", handlePublishToggle);
  router.post("/api/results/publish", handlePublishToggle);

  /**
   * নির্দিষ্ট শ্রেণি ও পরীক্ষার পাবলিশ স্ট্যাটাস চেক API
   * Endpoint: GET /api/results/status?class=...&examType=...&year=...
   */
  router.get("/api/results/status", async (req, res) => {
    try {
      const { class: studentClass, examType, term, year } = req.query;
      const currentExam = examType || term;
      const academicYear = sanitizeYear(year, "২০২৬");

      const filter = {
        year: { $regex: new RegExp(`^${academicYear}`) },
      };

      if (
        studentClass &&
        studentClass !== "all" &&
        studentClass !== "সকল" &&
        studentClass !== "সকল শ্রেণি"
      ) {
        filter.class = studentClass;
      }

      const sampleDoc = await marksCollection.findOne(filter);

      let isPublished = false;
      if (sampleDoc) {
        if (
          currentExam &&
          sampleDoc[currentExam] &&
          typeof sampleDoc[currentExam].isPublished === "boolean"
        ) {
          isPublished = sampleDoc[currentExam].isPublished;
        } else {
          isPublished = Boolean(sampleDoc.isPublished);
        }
      }

      res.status(200).json({
        success: true,
        isPublished: isPublished,
      });
    } catch (error) {
      console.error("Status check error:", error);
      res.status(500).json({
        success: false,
        isPublished: false,
        error: error.message,
      });
    }
  });

  /**
   * ২. নির্দিষ্ট শ্রেণি ও বিষয়ের ইনপুট করা মার্কস চেক/লোড করার API
   * Endpoint: GET /api/marks/get
   * Query Params: ?class=...&subject=...&year=...&examType=...
   */
  router.get("/api/marks/get", async (req, res) => {
    try {
      const {
        class: studentClass,
        subject,
        year,
        examType,
        term,
      } = req.query;
      const currentExam = examType || term;

      if (!studentClass || !subject) {
        return res.status(400).json({
          success: false,
          message: "শ্রেণি (Class) এবং বিষয় (Subject) প্রয়োজনীয়।",
        });
      }

      const cleanYear = sanitizeYear(year, "২০২৬");
      const query = {
        class: studentClass,
        subject: subject,
        year: { $regex: new RegExp(`^${cleanYear}`) },
      };

      const marks = await marksCollection.find(query).toArray();

      // এই শ্রেণি ও বিষয়ের জন্য রেজাল্ট পাবলিশ স্ট্যাটাস যাচাই
      let isPublished = false;
      if (marks.length > 0) {
        isPublished = marks.some((m) => {
          if (
            currentExam &&
            m[currentExam] &&
            typeof m[currentExam].isPublished === "boolean"
          ) {
            return m[currentExam].isPublished;
          }
          return Boolean(m.isPublished);
        });
      } else {
        // যদি এই বিষয়ের মার্কস এখনো এন্ট্রি না হয়ে থাকে, তবে ক্লাসের ওভারঅল বা অন্য বিষয়ের পাবলিশ স্ট্যাটাস চেক
        const classFilter = {
          class: studentClass,
          year: { $regex: new RegExp(`^${cleanYear}`) },
        };
        if (currentExam) {
          classFilter[`${currentExam}.isPublished`] = true;
        } else {
          classFilter.isPublished = true;
        }
        const publishedInClass = await marksCollection.findOne(classFilter);
        if (publishedInClass) {
          isPublished = true;
        }
      }

      res.status(200).json({
        success: true,
        isPublished: isPublished,
        data: marks,
      });
    } catch (error) {
      console.error("Get Marks Error:", error);
      res.status(500).json({
        success: false,
        message: "মার্কস লোড করতে সার্ভারে সমস্যা হয়েছে।",
      });
    }
  });

  /**
   * ৩. নির্দিষ্ট ক্লাসের সকল শিক্ষার্থীর রেজাল্ট / মেরিট লিস্ট দেখার API (পেজিনেটেড)
   * Endpoint: GET /api/results/class
   * Query Params: ?class=...&year=...&term=...&page=1&limit=20
   */
  router.get("/api/results/class", async (req, res) => {
    try {
      const {
        class: className,
        year,
        term,
        examType,
        page,
        limit,
      } = req.query;
      const currentExam = examType || term;

      if (!className) {
        return res.status(400).json({
          success: false,
          message: "শ্রেণি (Class) প্রয়োজনীয়।",
        });
      }

      const targetYear = sanitizeYear(year, "২০২৬");

      // ১. ডায়নামিক ফিল্টার অবজেক্ট দিয়ে ওই ক্লাসের Approved এবং Active শিক্ষার্থীদের খুঁজে বের করা
      const studentQuery = {
        $or: [
          { "divisionAcademy.class": className },
          { "divisionHifz.class": className },
          { "divisionPreHifz.class": className },
        ],
        status: { $regex: /^approved$/i },
        activity: "active",
      };

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, parseInt(limit, 10) || 20);
      const skip = (pageNum - 1) * limitNum;

      const total = await studentsCollection.countDocuments(studentQuery);
      const totalPages = Math.ceil(total / limitNum) || 1;

      const students = await studentsCollection
        .find(studentQuery)
        .sort({ roll: 1, studentId: 1 })
        .collation({ locale: "en", numericOrdering: true })
        .skip(skip)
        .limit(limitNum)
        .toArray();

      // ২. marksCollection থেকে ওই ক্লাসের ও সেশনের সকল শিক্ষার্থীর মার্কস নিয়ে আসা
      const marksList = await marksCollection
        .find({
          class: className,
          year: { $regex: new RegExp(`^${targetYear}`) },
        })
        .toArray();

      // ৩. পাবলিশ স্ট্যাটাস যাচাই
      let isPublished = false;
      if (marksList.length > 0) {
        isPublished = marksList.some((m) => {
          if (
            currentExam &&
            m[currentExam] &&
            typeof m[currentExam].isPublished === "boolean"
          ) {
            return m[currentExam].isPublished;
          }
          return Boolean(m.isPublished);
        });
      }

      // ৪. Access Control: Before publishing (isPublished === false), ONLY Admins can view class-wise-result
      const authUser = await getAuthUser(req);
      const isAdmin = isAdminUser(authUser);

      if (!isPublished && !isAdmin) {
        return res.status(403).json({
          success: false,
          isPublished: false,
          message:
            "ফলাফল এখনো প্রকাশ করা হয়নি। শুধুমাত্র অ্যাডমিন শ্রেণিভিত্তিক ফলাফল দেখতে পারবেন।",
          data: [],
          total: total,
          page: pageNum,
          limit: limitNum,
          totalPages: totalPages,
        });
      }

      // studentId দিয়ে মার্কস গ্রুপ করা
      const marksByStudent = {};
      marksList.forEach((mark) => {
        const sId = String(mark.studentId);
        if (!marksByStudent[sId]) {
          marksByStudent[sId] = [];
        }
        marksByStudent[sId].push(mark);
      });

      // ৫. শিক্ষার্থীদের লিস্ট ও মার্কস মার্জ করে মেরিট শিট তৈরি করা
      const results = students.map((student) => {
        const sId = String(student.studentId);
        const studentMarks = deduplicateSubjectMarks(
          marksByStudent[sId] || [],
          className,
        );

        const allSubjects = studentMarks.map((item) => ({
          subject: item.subject,
          term1: item.term1 || {},
          term2: item.term2 || {},
          annual: item.annual || {},
          isPublished: item.isPublished,
        }));

        return {
          studentId: sId,
          studentName:
            student.studentNameBangla || student.studentNameEnglish || "N/A",
          roll: student.roll || "N/A",
          allSubjects: allSubjects,
          isPublished: studentMarks[0]?.isPublished ?? isPublished,
        };
      });

      // রোল নম্বর অনুযায়ী সর্ট করা
      results.sort((a, b) => {
        const rollA = parseInt(a.roll) || Infinity;
        const rollB = parseInt(b.roll) || Infinity;
        return rollA - rollB;
      });

      res.status(200).json({
        success: true,
        data: results,
        total: total,
        page: pageNum,
        limit: limitNum,
        totalPages: totalPages,
        isPublished: isPublished,
        totalCount: total,
        count: results.length,
        currentPage: pageNum,
      });
    } catch (error) {
      console.error("Get Class Results Error:", error);
      res.status(500).json({
        success: false,
        message: "শ্রেণিভিত্তিক ফলাফল লোড করতে সার্ভারে সমস্যা হয়েছে।",
      });
    }
  });

  /**
   * ফলাফল তালিকা এবং অনুসন্ধানের সাধারণ API (পেজিনেটেড)
   * Endpoint: GET /api/results?class=...&year=...&term=...&subject=...&search=...&page=1&limit=20
   */
  router.get("/api/results", async (req, res) => {
    try {
      const {
        class: className,
        year,
        term,
        examType,
        subject,
        studentId,
        search,
        page,
        limit,
      } = req.query;

      const andClauses = [];

      if (className && className !== "all") {
        andClauses.push({ class: className });
      }

      if (year && year !== "all") {
        const cleanYear = sanitizeYear(year);
        andClauses.push({ year: { $regex: new RegExp(`^${cleanYear}`) } });
      }

      if (subject && subject !== "all") {
        andClauses.push({ subject: subject });
      }

      if (studentId) {
        andClauses.push({ studentId: studentId });
      }

      if (search) {
        andClauses.push({
          $or: [
            { studentId: { $regex: search, $options: "i" } },
            { subject: { $regex: search, $options: "i" } },
            { teacher: { $regex: search, $options: "i" } },
          ],
        });
      }

      const filter = andClauses.length > 0 ? { $and: andClauses } : {};

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, parseInt(limit, 10) || 20);
      const skip = (pageNum - 1) * limitNum;

      const total = await marksCollection.countDocuments(filter);
      const totalPages = Math.ceil(total / limitNum) || 1;

      const marks = await marksCollection
        .find(filter)
        .sort({ class: 1, studentId: 1, subject: 1 })
        .skip(skip)
        .limit(limitNum)
        .toArray();

      res.status(200).json({
        success: true,
        data: marks,
        total: total,
        page: pageNum,
        limit: limitNum,
        totalPages: totalPages,
        totalCount: total,
        count: marks.length,
        currentPage: pageNum,
      });
    } catch (error) {
      console.error("Fetch Results API Error:", error);
      res.status(500).json({
        success: false,
        message: "ফলাফলের তথ্য লোড করতে ব্যর্থ হয়েছে।",
      });
    }
  });

  /**
   * ৪. নির্দিষ্ট শিক্ষার্থীর রেজাল্ট / মার্কশিট দেখার API
   * Endpoint: GET /api/results/student/:studentId
   * Query Params: ?year=...&term=...
   */
  router.get("/api/results/student/:studentId", async (req, res) => {
    try {
      const { studentId } = req.params;
      const { year, term, examType } = req.query;
      const currentExam = examType || term;

      const targetYear = sanitizeYear(year, "২০২৬");

      // studentId দিয়ে শিক্ষার্থী খোঁজা
      let student = await studentsCollection.findOne({
        studentId: String(studentId),
      });

      // যদি studentsCollection-এ না থাকে, তবে admissions-এ approved স্ট্যাটাসসহ খোঁজা
      if (!student) {
        student = await admissionCollection.findOne({
          studentId: String(studentId),
          status: { $regex: /^approved$/i },
        });
      }

      if (!student) {
        return res.status(404).json({
          success: false,
          message: "শিক্ষার্থীর কোনো তথ্য পাওয়া যায়নি।",
        });
      }

      const studentClass = getStudentClass(student);

      // marksCollection থেকে মার্কস নিয়ে আসা
      const rawMarksList = await marksCollection
        .find({
          studentId: String(studentId),
          year: { $regex: new RegExp(`^${targetYear}`) },
        })
        .toArray();

      // বিষয়ভিত্তিক ডুপ্লিকেট মার্কস ডিডুপ্লিকেশন (বর্তমান শ্রেণি ও সর্বশেষ আপডেট অগ্রাধিকার)
      const marksList = deduplicateSubjectMarks(rawMarksList, studentClass);

      // পাবলিশ স্ট্যাটাস যাচাই
      let isPublished = false;
      if (marksList.length > 0) {
        isPublished = marksList.some((m) => {
          if (
            currentExam &&
            m[currentExam] &&
            typeof m[currentExam].isPublished === "boolean"
          ) {
            return m[currentExam].isPublished;
          }
          return Boolean(m.isPublished);
        });
      }

      const authUser = await getAuthUser(req);
      const isAdmin = isAdminUser(authUser);

      // Access Control: When isPublished === false, non-admin users cannot access results
      if (!isPublished && !isAdmin) {
        return res.status(403).json({
          success: false,
          isPublished: false,
          message: "এই শিক্ষাবর্ষের ফলাফল এখনো প্রকাশিত হয়নি।",
        });
      }

      const results = marksList.map((item) => ({
        subject: item.subject,
        term1: item.term1 || {},
        term2: item.term2 || {},
        annual: item.annual || {},
        isPublished: item.isPublished,
      }));

      // মোট নম্বর (Total Marks) এর ভিত্তিতে ক্লাসের মেধাস্থান (Merit Position) হিসাব করা
      let meritPosition = "-";
      try {
        if (studentClass && studentClass !== "N/A") {
          const classStudentQuery = {
            $or: [
              { "divisionAcademy.class": studentClass },
              { "divisionHifz.class": studentClass },
              { "divisionPreHifz.class": studentClass },
              { "officeUse.recommendedClass": studentClass },
              { class: studentClass },
            ],
            status: { $regex: /^approved$/i },
            activity: "active",
          };

          const [allClassStudents, allClassMarks] = await Promise.all([
            studentsCollection.find(classStudentQuery).toArray(),
            marksCollection
              .find({
                class: studentClass,
                year: { $regex: new RegExp(`^${targetYear}`) },
              })
              .toArray(),
          ]);

          // মার্কস গ্রুপ করা studentId দিয়ে
          const marksByStudent = {};
          allClassMarks.forEach((m) => {
            const sid = String(m.studentId);
            if (!marksByStudent[sid]) marksByStudent[sid] = [];
            marksByStudent[sid].push(m);
          });

          const getSubjectPoint = (mark) => {
            const num =
              typeof mark === "number" ? mark : parseFloat(mark) || 0;
            if (num >= 80) return 5.0;
            if (num >= 70) return 4.0;
            if (num >= 60) return 3.0;
            if (num >= 50) return 2.0;
            if (num >= 40) return 1.0;
            return 0.0;
          };

          const studentCalculations = [];

          allClassStudents.forEach((cs) => {
            const sid = String(cs.studentId);
            const studentSubjectMarks = deduplicateSubjectMarks(
              marksByStudent[sid] || [],
              studentClass,
            );
            if (studentSubjectMarks.length === 0) return;

            let totalMarks = 0;
            let totalPoints = 0;
            let absentSubsCount = 0;
            let hasFailedSub = false;

            studentSubjectMarks.forEach((item) => {
              let termData = {};
              if (
                currentExam === "term1" ||
                currentExam === "১ম সাময়িক পরীক্ষা"
              ) {
                termData = item.term1 || item["১ম সাময়িক পরীক্ষা"] || {};
              } else if (
                currentExam === "term2" ||
                currentExam === "২য় সাময়িক পরীক্ষা"
              ) {
                termData = item.term2 || item["২য় সাময়িক পরীক্ষা"] || {};
              } else if (
                currentExam === "annual" ||
                currentExam === "বার্ষিক পরীক্ষা"
              ) {
                termData = item.annual || item["বার্ষিক পরীক্ষা"] || {};
              } else {
                termData = item[currentExam] || item.term1 || {};
              }

              const isAbsent =
                Boolean(termData.isAbsent) ||
                termData.exam === "A" ||
                termData.exam === "ABS" ||
                termData.exam === "অনুঃ" ||
                termData.ct === "A" ||
                termData.ct === "ABS" ||
                termData.ct === "অনুঃ";

              const ct = parseFloat(termData.ct) || 0;
              const exam = parseFloat(termData.exam) || 0;
              const total = isAbsent ? 0 : ct + exam;

              if (isAbsent) {
                absentSubsCount++;
                hasFailedSub = true;
              } else if (total < 40) {
                hasFailedSub = true;
                totalMarks += total;
              } else {
                totalMarks += total;
                totalPoints += getSubjectPoint(total);
              }
            });

            const totalSubs = studentSubjectMarks.length;
            const isAbsentAll = absentSubsCount === totalSubs;
            const isPartialAbsent =
              absentSubsCount > 0 && absentSubsCount < totalSubs;
            const gpa =
              totalSubs > 0 &&
              !hasFailedSub &&
              !isAbsentAll &&
              !isPartialAbsent
                ? Math.min(5.0, totalPoints / totalSubs)
                : 0.0;

            const isPassed =
              !hasFailedSub && !isAbsentAll && !isPartialAbsent;

            studentCalculations.push({
              studentId: sid,
              roll: cs.roll || "999999",
              totalMarks,
              gpa,
              isPassed,
            });
          });

          // ১. শুধুমাত্র উত্তীর্ণ শিক্ষার্থীদের মোট নম্বর (Total Marks) অনুযায়ী সাজানো
          const passedStudents = studentCalculations
            .filter((sc) => sc.isPassed)
            .sort((a, b) => {
              // ১ম ধাপ: মোট নম্বর (অবতরণ ক্রম)
              const markDiff = b.totalMarks - a.totalMarks;
              if (markDiff !== 0) return markDiff;

              // টাই-ব্রেকিং ১: GPA (অবতরণ ক্রম)
              const gpaDiff = b.gpa - a.gpa;
              if (Math.abs(gpaDiff) > 0.001) return gpaDiff;

              // টাই-ব্রেকিং ২: পূর্ববর্তী রোল (আরোহণ ক্রম)
              const rollA = parseInt(a.roll, 10) || 999999;
              const rollB = parseInt(b.roll, 10) || 999999;
              return rollA - rollB;
            });

          // ২. মেধাস্থান নির্ধারণ (টাই হলে একই মোট নম্বরে একই মেধাস্থান)
          const meritRankMap = new Map();
          passedStudents.forEach((st, idx) => {
            if (idx > 0) {
              const prev = passedStudents[idx - 1];
              if (st.totalMarks === prev.totalMarks) {
                meritRankMap.set(
                  st.studentId,
                  meritRankMap.get(prev.studentId),
                );
              } else {
                meritRankMap.set(st.studentId, idx + 1);
              }
            } else {
              meritRankMap.set(st.studentId, 1);
            }
          });

          const currentSid = String(student.studentId);
          if (meritRankMap.has(currentSid)) {
            meritPosition = meritRankMap.get(currentSid);
          }
        }
      } catch (meritErr) {
        console.error("Error calculating student merit position:", meritErr);
      }

      res.status(200).json({
        success: true,
        isPublished: isPublished,
        year: targetYear,
        meritPosition: meritPosition,
        student: {
          name:
            student.studentNameBangla || student.studentNameEnglish || "N/A",
          studentId: student.studentId,
          class: studentClass,
          roll: student.roll || student.officeUse?.rollNumber || "N/A",
          fatherNameBangla:
            student.fatherNameBangla || student.guardianName || "",
          currentAddress: student.currentAddress || {},
          studentImage: student.studentImage || student.profilePhoto || "",
        },
        results: results,
      });
    } catch (error) {
      console.error("Get Student Results Error:", error);
      res.status(500).json({
        success: false,
        message: "শিক্ষার্থীর ফলাফল লোড করতে সার্ভারে সমস্যা হয়েছে।",
      });
    }
  });

  /**
   * ৫. টিচার প্যানেল থেকে শিক্ষার্থীদের মার্ক ইনপুট বা আপডেট করার API
   * Endpoint: POST /api/marks/input
   */
  router.post("/api/marks/input", async (req, res) => {
    try {
      const {
        class: studentClass,
        subject,
        examType,
        year,
        marksData,
      } = req.body;

      if (
        !studentClass ||
        !subject ||
        !examType ||
        !Array.isArray(marksData) ||
        marksData.length === 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "প্রয়োজনীয় তথ্য (Class, Subject, Exam Type এবং Marks Data) সঠিকভাবে দেওয়া হয়নি।",
        });
      }

      const academicYear = sanitizeYear(year, "২০২৬");

      // অথেনটিকেশন ও টিচার ক্রেডেনশিয়াল নির্ধারণ
      const authUser = await getAuthUser(req);
      const isAdmin = isAdminUser(authUser);
      const teacherEmail =
        authUser?.email ||
        req.body.teacher ||
        req.body.teacherEmail ||
        "unknown";

      // Locking Logic:
      // If isPublished === true:
      // - For Non-Admin teachers/users, backend API for result input/upsert MUST reject non-admin attempts.
      // - Admin Privilege: Admins CAN STILL edit/update input fields even after publication.
      const existingPublishedDoc = await marksCollection.findOne({
        class: studentClass,
        year: { $regex: new RegExp(`^${academicYear}`) },
        $or: [{ [`${examType}.isPublished`]: true }, { isPublished: true }],
      });

      if (existingPublishedDoc && !isAdmin) {
        return res.status(403).json({
          success: false,
          message:
            "ফলাফল ইতোমধ্যে প্রকাশিত হয়েছে। শুধুমাত্র অ্যাডমিন এটি সম্পাদনা বা আপডেট করতে পারবেন।",
        });
      }

      // 'A' বা 'Abs' হলে স্ট্রিং হিসেবে রাখবে, সংখ্যা হলে Float করবে, খালি হলে null করবে
      const parseMark = (mark) => {
        if (mark === "" || mark === null || mark === undefined) return null;

        if (
          typeof mark === "string" &&
          (mark.trim().toUpperCase() === "A" ||
            mark.trim().toUpperCase() === "ABS")
        ) {
          return mark.trim().toUpperCase();
        }

        const parsed = parseFloat(mark);
        return !isNaN(parsed) ? parsed : null;
      };

      const operations = marksData.map((student) => {
        const { studentId, studentName, roll, ctMark, examMark } = student;

        const filter = {
          studentId: String(studentId),
          subject: subject,
          year: academicYear,
        };

        const ctVal = parseMark(ctMark);
        const examVal = parseMark(examMark);

        const updateField = {};
        updateField[`${examType}.ct`] = ctVal;
        updateField[`${examType}.exam`] = examVal;

        return {
          updateOne: {
            filter: filter,
            update: {
              $set: {
                class: studentClass,
                studentName: studentName || "N/A",
                roll: roll || "N/A",
                teacher: teacherEmail,
                updatedAt: new Date(),
                ...updateField,
              },
              $setOnInsert: {
                createdAt: new Date(),
                isPublished: false,
                [`${examType}.isPublished`]: false,
              },
            },
            upsert: true,
          },
        };
      });

      const result = await marksCollection.bulkWrite(operations);

      res.status(200).json({
        success: true,
        message: "সকল শিক্ষার্থীর মার্কস সফলভাবে সংরক্ষণ ও আপডেট করা হয়েছে।",
        data: result,
      });
    } catch (error) {
      console.error("Save Marks Error:", error);
      res.status(500).json({
        success: false,
        message: "মার্কস সংরক্ষণ করতে সার্ভারে সমস্যা হয়েছে।",
      });
    }
  });

  if (app) {
    app.use(router);
  }

  return router;
}

module.exports = resultRoutes;
