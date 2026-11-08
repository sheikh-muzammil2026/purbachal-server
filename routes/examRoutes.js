const express = require("express");

function examRoutes(collections, helpers, database) {
  const router = express.Router();
  const { studentsCollection, seatPlansCollection, routinesCollection } =
    collections;
  const { sanitizeYear } = helpers;

  /**
   * সীট প্ল্যান সামারি রিপোর্ট API
   * Endpoint: GET /api/seat-plans/summary
   */
  router.get("/api/seat-plans/summary", async (req, res) => {
    try {
      // ১. স্টুডেন্টদের তালিকা খোঁজা (Approved এবং Active স্ট্যাটাসসহ, রোল অনুযায়ী সর্ট)
      const students = await studentsCollection
        .find({ status: "Approved", activity: "active" })
        .sort({ roll: 1, studentId: 1 })
        .collation({ locale: "en", numericOrdering: true })
        .toArray();

      // ২. seat_plan কালেকশন থেকে ডাটা নিয়ে আসা
      const seatPlans = await seatPlansCollection.find().toArray();

      // ৩. seatPlans কে ইন-মেমোরি ম্যাপে রূপান্তর করা সহজ অনুসন্ধানের জন্য
      const seatPlanMap = {};
      seatPlans.forEach((sp) => {
        if (sp.studentId) {
          seatPlanMap[sp.studentId] = sp;
        }
      });

      // Helper to normalize Bengali class names to NFC
      const normalizeClassName = (name) => {
        if (!name) return "N/A";
        return String(name).normalize("NFC").trim();
      };

      // ৪. শিক্ষার্থীদের হল ভিত্তিক গ্রুপ করা ও ডুপ্লিকেশন দূর করা
      const seenStudentIds = new Set();
      const seenMongoIds = new Set();

      const allocatedSeats = [];
      const unassignedStudents = [];

      students.forEach((student) => {
        const sId = student.studentId;
        const sMongoId = student._id.toString();

        // ইউনিকনেস ভ্যালিডেশন
        if (sId && seenStudentIds.has(sId)) {
          console.warn(`Duplicate studentId detected in summary: ${sId}`);
          return;
        }
        if (seenMongoIds.has(sMongoId)) {
          console.warn(`Duplicate Mongo ID detected in summary: ${sMongoId}`);
          return;
        }

        if (sId) seenStudentIds.add(sId);
        seenMongoIds.add(sMongoId);

        // শ্রেণি নির্ধারণ
        let rawClass = "N/A";
        if (student.divisionPreHifz?.active) {
          rawClass = student.divisionPreHifz.class || "N/A";
        } else if (student.divisionHifz?.active) {
          rawClass = student.divisionHifz.class || "N/A";
        } else if (student.divisionAcademy?.active) {
          rawClass = student.divisionAcademy.class || "N/A";
        } else {
          rawClass = student.officeUse?.recommendedClass || "N/A";
        }

        const className = normalizeClassName(rawClass);

        // সিট প্ল্যান তথ্য বের করা
        const matchedPlan = seatPlanMap[sId] || seatPlanMap[sMongoId];
        let hallNo =
          matchedPlan?.room ||
          matchedPlan?.building ||
          student.seatPlan?.hallNo ||
          student.hallNo;
        let seatNo =
          matchedPlan?.seatNo || student.seatPlan?.seatNo || student.seatNo;

        if (hallNo) hallNo = String(hallNo).trim();
        if (seatNo) seatNo = String(seatNo).trim();

        if (hallNo && seatNo && hallNo !== "" && seatNo !== "") {
          allocatedSeats.push({
            studentId: sId,
            studentMongoId: sMongoId,
            student: {
              ...student,
              class: className,
            },
            hallNo,
            seatNo,
          });
        } else {
          unassignedStudents.push({
            studentId: sId,
            studentMongoId: sMongoId,
            student: {
              ...student,
              class: className,
            },
          });
        }
      });

      // ৫. allocatedSeats থেকে সরাসরি Summary গণনা করা (reduce ব্যবহার করে)
      const groupedData = allocatedSeats.reduce((acc, seat) => {
        const hall = seat.hallNo;
        const className = seat.student.class;

        if (!acc[hall]) {
          acc[hall] = {};
        }
        acc[hall][className] = (acc[hall][className] || 0) + 1;
        return acc;
      }, {});

      // ৬. সেলফ-ভ্যালিডেশন এবং ক্রস-চেক লেয়ার
      const totalUniqueStudents = seenMongoIds.size;
      const totalAllocatedSeats = allocatedSeats.length;
      const totalUnassignedStudents = unassignedStudents.length;

      const isCountConsistent =
        totalUniqueStudents === totalAllocatedSeats + totalUnassignedStudents;

      let classSummarySum = 0;
      Object.keys(groupedData).forEach((hall) => {
        Object.keys(groupedData[hall]).forEach((cls) => {
          classSummarySum += groupedData[hall][cls];
        });
      });

      const isSumConsistent = classSummarySum === totalAllocatedSeats;

      if (!isCountConsistent || !isSumConsistent) {
        console.warn(`[SeatPlanSummary] Crosscheck failed!
                    - Unique Students: ${totalUniqueStudents}
                    - Allocated + Unassigned: ${totalAllocatedSeats + totalUnassignedStudents} (Allocated: ${totalAllocatedSeats}, Unassigned: ${totalUnassignedStudents})
                    - Class Summary Sum: ${classSummarySum}
                    - Total Assigned Seat Count: ${totalAllocatedSeats}
                    Recalculating using real-time fallback...`);

        const fallbackGrouped = {};
        const fallbackProcessed = new Set();

        allocatedSeats.forEach((seat) => {
          const uniqueKey = seat.studentId || seat.studentMongoId;
          if (fallbackProcessed.has(uniqueKey)) return;
          fallbackProcessed.add(uniqueKey);

          const hall = seat.hallNo;
          const cls = seat.student.class;
          if (!fallbackGrouped[hall]) {
            fallbackGrouped[hall] = {};
          }
          fallbackGrouped[hall][cls] = (fallbackGrouped[hall][cls] || 0) + 1;
        });

        res.status(200).json({
          success: true,
          data: fallbackGrouped,
          validationError: true,
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: groupedData,
      });
    } catch (error) {
      console.error("Seat Plan Summary Error:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভারে সিট প্ল্যান সামারি প্রস্তুত করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * নির্দিষ্ট হলের বিস্তারিত সিট প্ল্যান পাওয়ার API
   * Endpoint: GET /api/seat-plan
   */
  router.get("/api/seat-plan", async (req, res) => {
    try {
      console.log("Incoming Query Params:", req.query);
      const { hallNo, semester } = req.query;
      if (!hallNo) {
        return res.status(400).json({
          success: false,
          message: "Hall number is required",
        });
      }

      // Convert English digits to Bengali digits helper
      const englishToBengali = (num) => {
        const digits = {
          0: "০",
          1: "১",
          2: "২",
          3: "৩",
          4: "৪",
          5: "৫",
          6: "৬",
          7: "৭",
          8: "৮",
          9: "৯",
        };
        return String(num)
          .split("")
          .map((d) => digits[d] || d)
          .join("");
      };

      const hallQuery = !isNaN(hallNo) ? Number(hallNo) : hallNo;
      const bnHall = englishToBengali(hallNo);

      const query = {
        $or: [
          { hallNo: hallQuery },
          { hallNo: String(hallNo) },
          { hallNo: bnHall },
        ],
        ...(semester && { semester: semester }),
      };

      console.log("Query constructed for seats:", JSON.stringify(query));
      let data = await database
        .collection("seats")
        .find(query)
        .sort({ seatNo: 1 })
        .toArray();

      // Enrich seats with student name from 'students' collection if missing or incomplete
      const seatStudentIds = data
        .map((s) => s.studentId || s.student_id)
        .filter(Boolean);
      let studentDocs = [];
      if (seatStudentIds.length > 0) {
        studentDocs = await database
          .collection("students")
          .find({
            studentId: { $in: seatStudentIds.map((id) => String(id)) },
          })
          .toArray();
      }

      const studentMap = {};
      studentDocs.forEach((s) => {
        studentMap[String(s.studentId)] = s;
      });

      data = data.map((seat) => {
        const student = studentMap[String(seat.studentId || seat.student_id)];
        let nameVal =
          seat.name ||
          seat.studentName ||
          seat.studentNameBangla ||
          seat.student_name;
        let classVal =
          seat.class ||
          seat.className ||
          seat.class_name ||
          seat.classGroup ||
          seat.jamayat;
        let rollVal =
          seat.roll ||
          seat.rollNo ||
          seat.roll_no ||
          seat.studentId ||
          seat.student_id;

        if (student) {
          // Always prioritize studentNameBangla from the student profile
          if (
            !nameVal ||
            nameVal === "Unknown" ||
            nameVal === "অন্যান্য" ||
            nameVal === seat.studentId
          ) {
            nameVal = student.studentNameBangla || student.name || "Unknown";
          }
          if (!classVal || classVal === "N/A") {
            if (student.divisionPreHifz?.active) {
              classVal = student.divisionPreHifz.class;
            } else if (student.divisionHifz?.active) {
              classVal = student.divisionHifz.class;
            } else if (student.divisionAcademy?.active) {
              classVal = student.divisionAcademy.class;
            } else {
              classVal = student.officeUse?.recommendedClass || "N/A";
            }
          }
          if (!rollVal) {
            rollVal =
              student.roll ||
              student.officeUse?.rollNumber ||
              student.studentId;
          }
        }

        return {
          ...seat,
          seatNo: Number(seat.seatNo || seat.seat_no || 0),
          class: classVal || "N/A",
          name: nameVal || "Unknown",
          roll: rollVal || "",
          studentId:
            seat.studentId ||
            seat.student_id ||
            (student ? student.studentId : ""),
        };
      });

      // Fallback to students collection if seats collection has no documents
      if (data.length === 0) {
        console.log(
          "No seats found in 'seats' collection, attempting fallback to 'students' collection...",
        );
        const students = await database
          .collection("students")
          .find({
            status: "Approved",
            $or: [
              { hallNo: String(hallNo) },
              { hallNo: Number(hallNo) },
              { hallNo: bnHall },
              { "seatPlan.hallNo": String(hallNo) },
              { "seatPlan.hallNo": Number(hallNo) },
              { "seatPlan.hallNo": bnHall },
            ],
          })
          .toArray();

        data = students
          .map((student) => {
            let classVal = "N/A";
            if (student.divisionPreHifz?.active) {
              classVal = student.divisionPreHifz.class || "N/A";
            } else if (student.divisionHifz?.active) {
              classVal = student.divisionHifz.class || "N/A";
            } else if (student.divisionAcademy?.active) {
              classVal = student.divisionAcademy.class || "N/A";
            } else {
              classVal = student.officeUse?.recommendedClass || "N/A";
            }

            const currentSeatPlan = student.seatPlan || {};
            const actualSeatNo = Number(
              student.seatNo || currentSeatPlan.seatNo || 0,
            );

            return {
              _id: student._id.toString(),
              hallNo: Number(
                student.hallNo || currentSeatPlan.hallNo || hallNo,
              ),
              seatNo: actualSeatNo,
              class: classVal,
              name:
                student.studentNameBangla ||
                student.name ||
                student.studentId,
              studentId: student.studentId,
              roll:
                student.roll ||
                student.officeUse?.rollNumber ||
                student.studentId,
              semester: semester || "দ্বিতীয় সাময়িক",
            };
          })
          .filter((s) => s.seatNo > 0);
      }

      // Ensure data is sorted in strictly ascending order based on seatNo as fallback/final check
      data.sort(
        (a, b) =>
          Number(a.seatNo || a.seat_no) - Number(b.seatNo || b.seat_no),
      );

      console.log("MongoDB Search Results (data count):", data.length);
      console.log("MongoDB Search Results:", data);

      res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      console.error("Fetch Seat Plan Error:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভারে সিট প্ল্যানের তথ্য পেতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * পরীক্ষার তালিকা পাওয়ার API
   * Endpoint: GET /api/exams/list
   */
  router.get("/api/exams/list", async (req, res) => {
    try {
      const examTitles = await routinesCollection.distinct("examTitle");
      res.status(200).json({ success: true, data: examTitles });
    } catch (error) {
      console.error("Fetch exams error:", error);
      res.status(500).json({
        success: false,
        message: "পরীক্ষার তালিকা লোড করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * পরীক্ষা কক্ষের উপস্থিতি স্বাক্ষরপত্র তৈরির API
   * Endpoint: GET /api/exams/attendance-sheet
   */
  router.get("/api/exams/attendance-sheet", async (req, res) => {
    try {
      const { className, examName } = req.query;

      if (!className || !examName) {
        return res.status(400).json({
          success: false,
          message: "className এবং examName উভয়ই প্রয়োজন।",
        });
      }

      // ১. স্টুডেন্টদের তালিকা খোঁজা (নির্দিষ্ট ক্লাস, Approved এবং Active স্ট্যাটাস)
      const query = {
        status: "Approved",
        activity: "active",
        $or: [
          {
            "divisionPreHifz.active": true,
            "divisionPreHifz.class": className,
          },
          { "divisionHifz.active": true, "divisionHifz.class": className },
          {
            "divisionAcademy.active": true,
            "divisionAcademy.class": className,
          },
          { "officeUse.recommendedClass": className },
        ],
      };

      const students = await studentsCollection
        .find(query)
        .sort({ roll: 1, studentId: 1 })
        .collation({ locale: "en", numericOrdering: true })
        .toArray();

      // ২. রুটিন ও সাবজেক্ট শিডিউল খোঁজা
      const routine = await routinesCollection.findOne({
        examTitle: examName,
      });

      let subjectsList = [];
      let hijriYear = "";
      let englishYear = "";

      if (routine) {
        hijriYear = routine.hijriYear || "";
        englishYear = routine.gregorianYear || "";

        if (
          Array.isArray(routine.dates) &&
          Array.isArray(routine.routineData)
        ) {
          const classRoutine = routine.routineData.find(
            (r) =>
              r.class === className ||
              r.class?.toLowerCase() === className?.toLowerCase(),
          );

          if (classRoutine && classRoutine.subjects) {
            // রুটিনের তারিখগুলো ম্যাপ করে সাবজেক্ট শিডিউল তৈরি করা
            subjectsList = routine.dates
              .map((d) => {
                const subjectName = classRoutine.subjects[d.id];
                return {
                  id: d.id,
                  name: subjectName || "",
                  date: d.gregorian + " ইং:",
                  gregorianRaw: d.gregorianRaw || "",
                };
              })
              .filter(
                (sub) =>
                  sub.name && sub.name.trim() !== "" && sub.name !== "—",
              );

            // তারিখ অনুযায়ী সর্ট করা (earliest/upcoming exam first)
            subjectsList.sort((a, b) => {
              const dateA = a.gregorianRaw
                ? new Date(a.gregorianRaw)
                : new Date(
                    a.date.split(" ")[0].split("/").reverse().join("-"),
                  );
              const dateB = b.gregorianRaw
                ? new Date(b.gregorianRaw)
                : new Date(
                    a.date.split(" ")[0].split("/").reverse().join("-"),
                  );
              return dateA - dateB;
            });
          }
        }
      }

      // ৩. স্টুডেন্টদের ডাটা ফরম্যাট করা
      const formattedStudents = students.map((student) => {
        return {
          roll: student.officeUse?.rollNumber || student.roll || "N/A",
          studentId: student.studentId || "N/A",
          studentName:
            student.studentNameBangla ||
            student.studentNameEnglish ||
            "নাম বিহীন",
        };
      });

      // রোল অনুযায়ী সর্ট করা
      const parseRoll = (r) => {
        if (!r || r === "N/A") return Infinity;
        const bnToEn = {
          "০": "0",
          "১": "1",
          "২": "2",
          "৩": "3",
          "৪": "4",
          "৫": "5",
          "৬": "6",
          "৭": "7",
          "৮": "8",
          "৯": "9",
        };
        const enStr = String(r)
          .split("")
          .map((char) => bnToEn[char] || char)
          .join("");
        const num = parseInt(enStr, 10);
        return isNaN(num) ? Infinity : num;
      };

      formattedStudents.sort((a, b) => parseRoll(a.roll) - parseRoll(b.roll));

      res.status(200).json({
        success: true,
        metaData: {
          className,
          examName,
          englishYear: sanitizeYear(englishYear, "২০২৬"),
          hijriYear: sanitizeYear(hijriYear, "১৪৪৭"),
        },
        subjects: subjectsList,
        students: formattedStudents,
      });
    } catch (error) {
      console.error("Attendance Sheet API Error:", error);
      res.status(500).json({
        success: false,
        message:
          "উপস্থিতি স্বাক্ষরপত্র শিটের তথ্য প্রস্তুত করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  return router;
}

module.exports = examRoutes;
