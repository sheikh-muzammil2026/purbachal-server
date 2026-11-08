const express = require("express");
const { ObjectId } = require("mongodb");

function admissionRoutes(collections, helpers) {
  const router = express.Router();
  const {
    admissionCollection,
    deletedIdsCollection,
    countersCollection,
    studentsCollection,
    settingsCollection,
  } = collections;
  const { sanitizeYear } = helpers;

  /**
   * নতুন ভর্তি আবেদন সাবমিট করার API
   * Endpoint: POST /api/admissions
   */
  router.post("/api/admissions", async (req, res) => {
    try {
      const newApplication = req.body;

      if (newApplication.sessionYear) {
        newApplication.sessionYear = sanitizeYear(
          newApplication.sessionYear,
          "২০২৬",
        );
      }

      newApplication.studentId = "Pending"; // প্রারম্ভিক অবস্থায় Pending থাকবে
      newApplication.status = "Pending";
      newApplication.createdAt = new Date();

      const result = await admissionCollection.insertOne(newApplication);

      res.status(201).json({
        success: true,
        message: "ভর্তি ফরমটি সফলভাবে ডাটাবেজে সংরক্ষিত হয়েছে!",
        insertedId: result.insertedId,
      });
    } catch (error) {
      console.error("ডাটা সেভ করতে সমস্যা হয়েছে:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভারে কোনো সমস্যা হয়েছে, আবার চেষ্টা করুন।",
      });
    }
  });

  /**
   * সকল ভর্তি আবেদনপত্র পাওয়ার API
   * Endpoint: GET /api/admissions
   */
  router.get("/api/admissions", async (req, res) => {
    try {
      const applications = await admissionCollection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
      res.json({ success: true, data: applications });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "আবেদনপত্র নিয়ে আসতে সমস্যা হয়েছে।",
      });
    }
  });

  /**
   * ভর্তি আবেদন স্ট্যাটাস পরিবর্তন এবং অনুমোদিত হলে আইডি তৈরি করার API
   * Endpoint: PATCH /api/admissions/:id
   */
  router.patch("/api/admissions/:id", async (req, res) => {
    try {
      const id = req.params.id;
      const { status } = req.body;

      if (!ObjectId.isValid(id)) {
        return res
          .status(400)
          .json({ success: false, message: "অকার্যকর আইডি ফর্ম্যাট।" });
      }

      const filter = { _id: new ObjectId(id) };
      const existingStudent = await admissionCollection.findOne(filter);

      if (!existingStudent) {
        return res
          .status(404)
          .json({ success: false, message: "আবেদনটি পাওয়া যায়নি।" });
      }

      let updateDoc = { $set: { status: status } };

      if (
        status === "Approved" &&
        (existingStudent.studentId === "Pending" ||
          !existingStudent.studentId)
      ) {
        let nextIdNumber;

        const reusableId = await deletedIdsCollection.findOneAndDelete(
          {},
          { sort: { sequence_value: 1 } },
        );

        if (reusableId) {
          nextIdNumber = reusableId.sequence_value;
        } else {
          const counterResult = await countersCollection.findOneAndUpdate(
            { _id: "studentId" },
            { $inc: { sequence_value: 1 } },
            { returnDocument: "after", upsert: true },
          );
          nextIdNumber = counterResult.sequence_value;
        }

        const formattedSequence = String(nextIdNumber).padStart(2, "0");
        const generatedStudentId = `04${formattedSequence}`;

        updateDoc.$set.studentId = generatedStudentId;
      }

      const result = await admissionCollection.updateOne(filter, updateDoc);

      if (result.modifiedCount === 1 || result.matchedCount === 1) {
        const updatedStudent = await admissionCollection.findOne(filter);

        if (status === "Approved") {
          // Copy/update in studentsCollection
          const studentFilter = { studentId: updatedStudent.studentId };
          const studentDoc = {
            ...updatedStudent,
            activity: updatedStudent.activity || "active",
          };
          delete studentDoc._id; // Ensure we don't duplicate/change original _id

          await studentsCollection.updateOne(
            studentFilter,
            { $set: studentDoc },
            { upsert: true },
          );
        } else {
          // If updated to a non-Approved status, remove from studentsCollection
          if (updatedStudent.studentId) {
            await studentsCollection.deleteOne({
              studentId: updatedStudent.studentId,
            });
          }
        }

        res.json({
          success: true,
          message: `আবেদনটি সফলভাবে ${status === "Approved" ? "অনুমোদন" : "আপডেট"} করা হয়েছে।`,
          studentId: updatedStudent.studentId,
        });
      } else {
        res
          .status(400)
          .json({ success: false, message: "কোনো পরিবর্তন করা হয়নি।" });
      }
    } catch (error) {
      console.error("স্ট্যাটাস আপডেট করতে সমস্যা হয়েছে:", error);
      res
        .status(500)
        .json({ success: false, message: "সার্ভারে সমস্যা হয়েছে।" });
    }
  });

  /**
   * ভর্তি আবেদন মুছে ফেলা এবং স্টুডেন্ট আইডি রিসাইকেল করার API
   * Endpoint: DELETE /api/admissions/:id
   */
  router.delete("/api/admissions/:id", async (req, res) => {
    try {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res
          .status(400)
          .json({ success: false, message: "অকার্যকর আইডি ফর্ম্যাট।" });
      }

      const query = { _id: new ObjectId(id) };
      const student = await admissionCollection.findOne(query);

      if (!student) {
        return res
          .status(404)
          .json({ success: false, message: "আবেদনটি খুঁজে পাওয়া যায়নি।" });
      }

      if (
        student.status === "Approved" &&
        student.studentId &&
        student.studentId.startsWith("04")
      ) {
        const rawSeqNumber = parseInt(student.studentId.slice(2), 10);

        if (!isNaN(rawSeqNumber)) {
          await deletedIdsCollection.insertOne({
            sequence_value: rawSeqNumber,
            deletedAt: new Date(),
          });
        }
      }

      const result = await admissionCollection.deleteOne(query);

      if (result.deletedCount === 1) {
        if (student.studentId) {
          await studentsCollection.deleteOne({
            studentId: student.studentId,
          });
        }
        res.json({
          success: true,
          message:
            "ভর্তি আবেদনটি সফলভাবে মুছে ফেলা হয়েছে এবং আইডিটি পুনরায় ব্যবহারের জন্য খালি করা হয়েছে।",
        });
      } else {
        res
          .status(404)
          .json({ success: false, message: "আবেদনটি খুঁজে পাওয়া যায়নি।" });
      }
    } catch (error) {
      console.error("আবেদন মুছতে সমস্যা হয়েছে:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভারে সমস্যা হয়েছে, আবার চেষ্টা করুন।",
      });
    }
  });

  /**
   * নির্দিষ্ট ভর্তি আবেদনের ডাটা লোড করার API
   * Endpoint: GET /api/admissions/edit/:id
   */
  router.get("/api/admissions/edit/:id", async (req, res) => {
    try {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res
          .status(400)
          .json({ success: false, message: "অকার্যকর আইডি ফর্ম্যাট।" });
      }

      const student = await admissionCollection.findOne({
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
      console.error("GET Error:", error);
      res
        .status(500)
        .json({ success: false, message: "সার্ভারে সমস্যা হয়েছে।" });
    }
  });

  /**
   * ভর্তি আবেদন আপডেট করার API
   * Endpoint: PUT /api/admissions/edit/:id
   */
  router.put("/api/admissions/edit/:id", async (req, res) => {
    try {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res
          .status(400)
          .json({ success: false, message: "অকার্যকর আইডি ফর্ম্যাট।" });
      }

      const { _id, createdAt, updatedAt, ...updateData } = req.body;

      if (updateData.sessionYear) {
        updateData.sessionYear = sanitizeYear(updateData.sessionYear, "২০২৬");
      }

      const result = await admissionCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData },
      );

      if (result.matchedCount > 0) {
        // Sync to studentsCollection if approved
        const updatedAdmission = await admissionCollection.findOne({
          _id: new ObjectId(id),
        });
        if (
          updatedAdmission &&
          updatedAdmission.status === "Approved" &&
          updatedAdmission.studentId
        ) {
          const studentFilter = { studentId: updatedAdmission.studentId };
          const studentDoc = {
            ...updatedAdmission,
            activity: updatedAdmission.activity || "active",
          };
          delete studentDoc._id; // Ensure we don't try to change original _id

          await studentsCollection.updateOne(
            studentFilter,
            { $set: studentDoc },
            { upsert: true },
          );
        }
        res.json({
          success: true,
          message: "শিক্ষার্থীর প্রোফাইল সফলভাবে আপডেট করা হয়েছে।",
        });
      } else {
        res.status(404).json({
          success: false,
          message: "শিক্ষার্থীর তথ্য পাওয়া যায়নি।",
        });
      }
    } catch (error) {
      console.error("PUT Error:", error);
      res
        .status(500)
        .json({ success: false, message: "সার্ভারে সমস্যা হয়েছে।" });
    }
  });

  /**
   * ভর্তি নির্দেশিকা ও সেটিংস সংরক্ষণ API
   * Endpoint: PUT /api/admission-settings
   */
  router.put("/api/admission-settings", async (req, res) => {
    try {
      const { _id, type, ...settingsData } = req.body;

      await settingsCollection.updateOne(
        { type: "admission_guideline" },
        {
          $set: {
            type: "admission_guideline",
            ...settingsData,
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );

      res.json({
        success: true,
        message: "ভর্তি নির্দেশিকা সফলভাবে আপডেট হয়েছে!",
      });
    } catch (error) {
      console.error("সেটিংস আপডেট করার ত্রুটি:", error);
      res
        .status(500)
        .json({ success: false, message: "সেটিংস আপডেট করা যায়নি।" });
    }
  });

  /**
   * ভর্তি নির্দেশিকা ও সেটিংস লোড API
   * Endpoint: GET /api/admission-settings
   */
  router.get("/api/admission-settings", async (req, res) => {
    try {
      const settings = await settingsCollection.findOne({
        type: "admission_guideline",
      });
      res.json({ success: true, data: settings || {} });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, message: "ডাটা লোড করা সম্ভব হয়নি।" });
    }
  });

  return router;
}

module.exports = admissionRoutes;
