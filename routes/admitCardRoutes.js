const express = require("express");
const { ObjectId } = require("mongodb");

function admitCardRoutes(collections, helpers) {
  const router = express.Router();
  const {
    studentsCollection,
    routinesCollection,
    seatPlansCollection,
    settingsCollection,
  } = collections;
  const { sanitizeYear } = helpers;

  /**
   * পরীক্ষার নামের তালিকা পাওয়ার API
   * Endpoint: GET /api/admit-cards/exams
   */
  router.get("/api/admit-cards/exams", async (req, res) => {
    try {
      const examTitles = await routinesCollection.distinct("examTitle");
      res.status(200).json({
        success: true,
        data: examTitles.filter(Boolean),
      });
    } catch (error) {
      console.error("Fetch Exam Titles Error:", error);
      res.status(500).json({
        success: false,
        message: "পরীক্ষার তালিকা লোড করা যায়নি।",
      });
    }
  });

  /**
   * একাধিক শিক্ষার্থীর এডমিট কার্ড তৈরির API
   * Endpoint: GET /api/admit-cards
   */
  router.get("/api/admit-cards", async (req, res) => {
    try {
      const { studentIds, examName } = req.query;

      if (!examName) {
        return res.status(400).json({
          success: false,
          message: "examName প্রয়োজন।",
        });
      }

      let ids = [];
      if (studentIds) {
        ids = studentIds
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
      }

      if (ids.length === 0) {
        return res.status(200).json({
          success: true,
          data: [],
        });
      }

      // ১. স্টুডেন্টদের তথ্য খোঁজা
      const objectIds = ids
        .map((id) => {
          try {
            return new ObjectId(id);
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);

      const students = await studentsCollection
        .find({
          $or: [{ _id: { $in: objectIds } }, { studentId: { $in: ids } }],
          activity: "active",
        })
        .sort({ roll: 1, studentId: 1 })
        .collation({ locale: "en", numericOrdering: true })
        .toArray();

      // ২. রুটিন খোঁজা
      const routines = await routinesCollection
        .find({ examTitle: examName })
        .toArray();

      // ৩. সিট প্ল্যান খোঁজা
      const studentIdCodes = students.map((s) => s.studentId).filter(Boolean);
      const studentMongoIds = students.map((s) => s._id.toString());
      const seatPlans = await seatPlansCollection
        .find({
          $or: [
            { studentId: { $in: studentIdCodes } },
            { studentId: { $in: studentMongoIds } },
          ],
        })
        .toArray();

      // ৪. এডমিট কার্ড সেটিংস খোঁজা (ডাটাবেস থেকে ডায়নামিকলি লোড করা)
      let admitCardSettings = await settingsCollection.findOne({
        type: "admit_card_settings",
      });
      if (!admitCardSettings) {
        admitCardSettings = {
          type: "admit_card_settings",
          examCenter: "আস সালাম আইডিয়াল মাদরাসা (এইম) পুর্বাচল",
          instructions: [
            "পরীক্ষা শুরু হওয়ার ২০ মিনিট পূর্বে পরীক্ষা কক্ষে প্রবেশ করে নিজ আসনে বসতে হবে",
            "এডমিট কার্ড, আইডি কার্ড সাথে নিয়ে আসতে হবে",
            "মাদরাসার ড্রেস পরে আসতে হবে",
            "কলম/পেন্সিল, রাবারসহ প্রয়োজনীয় জিনিস সাথে আনতে হবে",
          ],
          signatures: {
            principal: "/principle's_signature.jpg",
            controller: "/principle's_signature.jpg",
          },
        };
        await settingsCollection.insertOne(admitCardSettings);
      }

      // ৫. প্রত্যেক স্টুডেন্টের জন্য এডমিট কার্ডের ডাটা সাজানো
      const admitCards = students.map((student) => {
        // স্টুডেন্টের একটিভ বিভাগ ও শ্রেণি বের করা
        let divisionKey = "none";
        let divisionName = "অন্যান্য";
        let className = "N/A";
        let academyType = "";

        if (student.divisionPreHifz?.active) {
          divisionKey = "preHifz";
          divisionName = "প্রি-হিফজ";
          className = student.divisionPreHifz.class || "N/A";
        } else if (student.divisionHifz?.active) {
          divisionKey = "hifz";
          divisionName = "হিফজ";
          className = student.divisionHifz.class || "N/A";
        } else if (student.divisionAcademy?.active) {
          divisionKey = "academy";
          divisionName = "একাডেমিক";
          className = student.divisionAcademy.class || "N/A";
          academyType = student.divisionAcademy.academyType || "";
        } else {
          className = student.officeUse?.recommendedClass || "N/A";
        }

        // সংশ্লিষ্ট রুটিন খোঁজা (বিভাগ অনুযায়ী বা generic)
        const routine =
          routines.find(
            (r) => r.division === divisionKey || r.division === "all",
          ) || routines[0];

        let routineList = [];
        if (
          routine &&
          Array.isArray(routine.dates) &&
          Array.isArray(routine.routineData)
        ) {
          const classRoutine = routine.routineData.find(
            (r) =>
              r.class === className ||
              r.class?.toLowerCase() === className?.toLowerCase(),
          );

          if (classRoutine && classRoutine.subjects) {
            routineList = routine.dates
              .map((d) => {
                const subject = classRoutine.subjects[d.id];
                return {
                  date: d.gregorian,
                  day: d.day,
                  subject: subject || "",
                };
              })
              .filter(
                (row) =>
                  row.subject &&
                  row.subject.trim() !== "" &&
                  row.subject !== "—",
              );
          }
        }

        // সিট প্ল্যান খোঁজা
        const seatPlan = seatPlans.find(
          (sp) =>
            sp.studentId === student.studentId ||
            sp.studentId === student._id.toString(),
        );

        return {
          _id: student._id,
          studentId: student.studentId,
          roll: student.roll || seatPlan?.roll || "N/A",
          studentNameBangla:
            student.studentNameBangla || student.studentNameEnglish || "N/A",
          studentNameEnglish: student.studentNameEnglish || "N/A",
          fatherNameBangla:
            student.fatherNameBangla || student.fatherNameEnglish || "N/A",
          fatherNameEnglish: student.fatherNameEnglish || "N/A",
          studentImage: student.studentImage || student.photoUrl || "",
          photoUrl: student.photoUrl || student.studentImage || "",
          sessionYear: sanitizeYear(student.sessionYear, "২০২৬"),
          divisionName,
          divisionKey,
          className,
          academyType,
          upazila:
            student.currentAddress?.thana ||
            student.permanentAddress?.thana ||
            "N/A",
          district:
            student.currentAddress?.district ||
            student.permanentAddress?.district ||
            "N/A",
          hallNo:
            seatPlan?.room ||
            seatPlan?.building ||
            student.seatPlan?.hallNo ||
            student.hallNo ||
            "১",
          seatNo:
            seatPlan?.seatNo ||
            student.seatPlan?.seatNo ||
            student.seatNo ||
            "১",
          examName,
          examTime:
            routine?.note || "সকাল ৯:০০ টা হইতে দুপুর ১২:০০ টা পর্যন্ত",
          examCenter: admitCardSettings.examCenter,
          routine: routineList.length > 0 ? routineList : null,
          instructions: admitCardSettings.instructions,
          signatures: admitCardSettings.signatures,
        };
      });

      res.status(200).json({
        success: true,
        count: admitCards.length,
        data: admitCards,
      });
    } catch (error) {
      console.error("Fetch Admit Cards Error:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভারে এডমিট কার্ডের তথ্য প্রস্তুত করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * নির্দিষ্ট এক শিক্ষার্থীর এডমিট কার্ড পাওয়ার API
   * Endpoint: GET /api/admit-cards/:id
   */
  router.get("/api/admit-cards/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { examName } = req.query;

      if (!examName) {
        return res.status(400).json({
          success: false,
          message: "examName প্রয়োজন।",
        });
      }

      let student;
      try {
        student = await studentsCollection.findOne({ _id: new ObjectId(id) });
      } catch (e) {
        // ignore and try studentId
      }

      if (!student) {
        student = await studentsCollection.findOne({ studentId: id });
      }

      if (!student) {
        return res.status(404).json({
          success: false,
          message: "শিক্ষার্থী পাওয়া যায়নি।",
        });
      }

      const routines = await routinesCollection
        .find({ examTitle: examName })
        .toArray();

      const seatPlan = await seatPlansCollection.findOne({
        $or: [
          { studentId: student.studentId },
          { studentId: student._id.toString() },
        ],
      });

      let admitCardSettings = await settingsCollection.findOne({
        type: "admit_card_settings",
      });
      if (!admitCardSettings) {
        admitCardSettings = {
          type: "admit_card_settings",
          examCenter: "আস সালাম আইডিয়াল মাদরাসা (এইম) পুর্বাচল",
          instructions: [
            "পরীক্ষা শুরু হওয়ার ২০ মিনিট পূর্বে পরীক্ষা কক্ষে প্রবেশ করে নিজ আসনে বসতে হবে",
            "এডমিট কার্ড, আইডি কার্ড সাথে নিয়ে আসতে হবে",
            "মাদরাসার ড্রেস পরে আসতে হবে",
            "কলম/পেন্সিল, রাবারসহ প্রয়োজনীয় জিনিস সাথে আনতে হবে",
          ],
          signatures: {
            principal: "/principle's_signature.jpg",
            controller: "/principle's_signature.jpg",
          },
        };
        await settingsCollection.insertOne(admitCardSettings);
      }

      let divisionKey = "none";
      let divisionName = "অন্যান্য";
      let className = "N/A";
      let academyType = "";

      if (student.divisionPreHifz?.active) {
        divisionKey = "preHifz";
        divisionName = "প্রি-হিফজ";
        className = student.divisionPreHifz.class || "N/A";
      } else if (student.divisionHifz?.active) {
        divisionKey = "hifz";
        divisionName = "হিফজ";
        className = student.divisionHifz.class || "N/A";
      } else if (student.divisionAcademy?.active) {
        divisionKey = "academy";
        divisionName = "একাডেমিক";
        className = student.divisionAcademy.class || "N/A";
        academyType = student.divisionAcademy.academyType || "";
      } else {
        className = student.officeUse?.recommendedClass || "N/A";
      }

      const routine =
        routines.find(
          (r) => r.division === divisionKey || r.division === "all",
        ) || routines[0];

      let routineList = [];
      if (
        routine &&
        Array.isArray(routine.dates) &&
        Array.isArray(routine.routineData)
      ) {
        const classRoutine = routine.routineData.find(
          (r) =>
            r.class === className ||
            r.class?.toLowerCase() === className?.toLowerCase(),
        );

        if (classRoutine && classRoutine.subjects) {
          routineList = routine.dates
            .map((d) => {
              const subject = classRoutine.subjects[d.id];
              return {
                date: d.gregorian,
                day: d.day,
                subject: subject || "",
              };
            })
            .filter(
              (row) =>
                row.subject &&
                row.subject.trim() !== "" &&
                row.subject !== "—",
            );
        }
      }

      const admitCard = {
        _id: student._id,
        studentId: student.studentId,
        roll:
          student.officeUse?.rollNumber ||
          student.roll ||
          seatPlan?.roll ||
          "N/A",
        studentNameBangla:
          student.studentNameBangla || student.studentNameEnglish || "N/A",
        studentNameEnglish: student.studentNameEnglish || "N/A",
        fatherNameBangla:
          student.fatherNameBangla || student.fatherNameEnglish || "N/A",
        fatherNameEnglish: student.fatherNameEnglish || "N/A",
        studentImage: student.studentImage || student.photoUrl || "",
        photoUrl: student.photoUrl || student.studentImage || "",
        sessionYear: sanitizeYear(student.sessionYear, "২০২৬"),
        divisionName,
        divisionKey,
        className,
        academyType,
        upazila:
          student.currentAddress?.thana ||
          student.permanentAddress?.thana ||
          "হবিগঞ্জ সদর",
        district:
          student.currentAddress?.district ||
          student.permanentAddress?.district ||
          "হবিগঞ্জ",
        hallNo:
          seatPlan?.room ||
          seatPlan?.building ||
          student.seatPlan?.hallNo ||
          student.hallNo ||
          "১",
        seatNo:
          seatPlan?.seatNo ||
          student.seatPlan?.seatNo ||
          student.seatNo ||
          "১",
        examName,
        examTime: routine?.note || "সকাল ৯:০০ টা হইতে দুপুর ১২:০০ টা পর্যন্ত",
        examCenter: admitCardSettings.examCenter,
        routine: routineList.length > 0 ? routineList : null,
        instructions: admitCardSettings.instructions,
        signatures: admitCardSettings.signatures,
      };

      res.status(200).json({
        success: true,
        data: admitCard,
      });
    } catch (error) {
      console.error("Fetch Single Admit Card Error:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভারে এডমিট কার্ডের তথ্য প্রস্তুত করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  return router;
}

module.exports = admitCardRoutes;
