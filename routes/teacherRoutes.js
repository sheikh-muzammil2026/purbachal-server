const express = require("express");
const { ObjectId } = require("mongodb");
const {
  isWithinMadrasaGeofence,
  getDhakaTime,
  evaluateCheckInStatus,
  evaluateCheckOutStatus,
  MADRASA_LOCATION,
  ATTENDANCE_RULES,
  RESIDENTIAL_ATTENDANCE_RULES,
  HIFZ_ATTENDANCE_RULES,
  getTeacherCategory,
  getTeacherShiftRules,
  evaluateTeacherShiftCheckIn,
  evaluateTeacherShiftCheckOut,
  getActiveTeacherShift,
} = require("../utils/attendanceConfig");

function teacherRoutes(collections) {
  const router = express.Router();
  const { teachersCollection, teacherAttendanceCollection, usersCollection } = collections;

  function normalizeDesignation(rawDesignation = "") {
    const d = String(rawDesignation || "").trim();
    const lower = d.toLowerCase();
    if (lower === "residential_teacher") return "আবাসিক শিক্ষক";
    if (lower === "hifz_teacher") return "হিফজ শিক্ষক";
    if (lower === "teacher" || lower === "admin" || lower === "superadmin") {
      return "অনাবাসিক শিক্ষক";
    }
    return d || "শিক্ষক";
  }

  function formatFallbackTeacherId(index = 0, rawDoc = null) {
    const customId = String(rawDoc?.teacherId || rawDoc?.idNo || "").trim();
    if (customId && !/^[a-f\d]{24}$/i.test(customId)) {
      return customId;
    }
    return `AIM-T-${String(index + 1).padStart(3, "0")}`;
  }

  /**
   * শিক্ষকের প্রোফাইল সেভ বা আপডেট করা (POST / Upsert)
   * Endpoint: POST /api/teacher/profile
   */
  router.post("/api/teacher/profile", async (req, res) => {
    try {
      const {
        email,
        teacherId,
        fullName,
        nameEnglish,
        designation,
        phone,
        dateOfBirth,
        bloodGroup,
        address,
        addressDetails,
        bankAccount,
        bio,
        profileImage,
        socialLinks,
        academic,
        experience,
        publications,
        isPublicView,
        hardSkills,
        softSkills,
        edTechSkills,
        certifications,
        awards,
        references,
      } = req.body;

      if (!email || !fullName) {
        return res.status(400).json({
          success: false,
          message: "প্রয়োজনীয় তথ্য (ইমেইল ও নাম) প্রদান করুন।",
        });
      }

      const cleanEmail = String(email).trim();
      const cleanTeacherId = teacherId !== undefined ? String(teacherId).trim() : undefined;

      if (cleanTeacherId) {
        const duplicate = await teachersCollection.findOne({
          teacherId: { $regex: new RegExp(`^${cleanTeacherId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
          email: { $not: new RegExp(`^${cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
        });
        if (duplicate) {
          return res.status(400).json({
            success: false,
            message: `এই শিক্ষক আইডি (${cleanTeacherId}) ইতিমধ্যে অন্য একজন শিক্ষকের প্রোফাইলে ব্যবহৃত হয়েছে। অনুগ্রহ করে স্বতন্ত্র আইডি প্রদান করুন।`,
          });
        }
      }

      const filter = { email: { $regex: new RegExp(`^${cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } };
      const setFields = {
        email: cleanEmail,
        fullName,
        nameEnglish: nameEnglish || "",
        designation: normalizeDesignation(designation),
        phone: phone || "",
        address: address || "",
        addressDetails:
          addressDetails && typeof addressDetails === "object"
            ? addressDetails
            : {},
        bankAccount:
          bankAccount && typeof bankAccount === "object"
            ? bankAccount
            : bankAccount
            ? { accountNumber: String(bankAccount) }
            : {},
        bio: bio || "",
        profileImage: profileImage || "",
        socialLinks: socialLinks || {},
        academic: Array.isArray(academic) ? academic : [],
        experience: Array.isArray(experience) ? experience : [],
        publications: Array.isArray(publications) ? publications : [],
        hardSkills: hardSkills || "",
        softSkills: softSkills || "",
        edTechSkills: edTechSkills || "",
        certifications: Array.isArray(certifications) ? certifications : [],
        awards: Array.isArray(awards) ? awards : [],
        references: Array.isArray(references) ? references : [],
        isPublicView: isPublicView ?? true,
        updatedAt: new Date(),
      };

      if (cleanTeacherId !== undefined) {
        setFields.teacherId = cleanTeacherId;
      }
      if (dateOfBirth !== undefined) {
        setFields.dateOfBirth = dateOfBirth;
      }
      if (bloodGroup !== undefined) {
        setFields.bloodGroup = bloodGroup;
      }

      const updateDoc = {
        $set: setFields,
        $setOnInsert: {
          createdAt: new Date(),
        },
      };

      const result = await teachersCollection.updateOne(filter, updateDoc, {
        upsert: true,
      });

      if (cleanTeacherId && teacherAttendanceCollection) {
        await teacherAttendanceCollection
          .updateMany(
            { teacherEmail: { $regex: new RegExp(`^${cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } },
            { $set: { teacherId: cleanTeacherId, teacherDesignation: setFields.designation } }
          )
          .catch(() => {});
      }

      res.status(200).json({
        success: true,
        message: "প্রোফাইল তথ্য সফলভাবে সেভ ও আপডেট করা হয়েছে।",
        data: result,
      });
    } catch (error) {
      console.error("Profile save error:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভারে প্রোফাইল সেভ করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * শিক্ষকের প্রোফাইল তথ্য আনা (GET)
   * Endpoint: GET /api/teacher/profile/:email
   */
  router.get("/api/teacher/profile/:email", async (req, res) => {
    try {
      const { email } = req.params;
      if (!email) {
        return res
          .status(400)
          .json({ success: false, message: "ইমেইল প্রয়োজন।" });
      }

      const teacher = await teachersCollection.findOne({ email });
      if (!teacher) {
        return res.status(404).json({
          success: false,
          message: "শিক্ষকের প্রোফাইল পাওয়া যায়নি।",
        });
      }

      res.status(200).json({
        success: true,
        data: teacher,
      });
    } catch (error) {
      console.error("Fetch profile error:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভারে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * পাবলিক ফ্যাকাল্টি ও শিক্ষকদের তালিকা (GET)
   * Endpoints: GET /api/faculty, GET /api/teachers
   */
  const getPublicFacultyHandler = async (req, res) => {
    try {
      let teacherUsers = [];
      if (usersCollection) {
        teacherUsers = await usersCollection
          .find({
            $or: [
              { role: { $regex: /^(teacher|residential_teacher|hifz_teacher|admin|superadmin)$/i } },
              { permissions: "teacher" },
            ],
          })
          .sort({ order: 1, priority: 1, createdAt: 1 })
          .toArray()
          .catch(() => []);
      }

      const teachersProfiles = await teachersCollection
        .find({})
        .sort({ order: 1, priority: 1, createdAt: 1 })
        .toArray()
        .catch(() => []);

      const profileMap = new Map();
      teachersProfiles.forEach((t) => {
        if (t.email) {
          profileMap.set(t.email.trim().toLowerCase(), t);
        }
      });

      const faculty = [];
      const addedEmails = new Set();

      teacherUsers.forEach((user, index) => {
        const emailKey = (user.email || "").trim().toLowerCase();
        if (emailKey) addedEmails.add(emailKey);

        const profile = emailKey ? profileMap.get(emailKey) : null;

        let education = "";
        if (typeof profile?.education === "string" && profile.education.trim()) {
          education = profile.education.trim();
        } else if (Array.isArray(profile?.academic) && profile.academic.length > 0) {
          education = profile.academic
            .map((a) => a.degree || a.title || a.name || "")
            .filter(Boolean)
            .join(", ");
        }

        const name = profile?.fullName?.trim() || profile?.name?.trim() || user.name?.trim() || "সম্মানিত শিক্ষক";
        const designation = profile?.designation?.trim() || user.designation?.trim() || "শিক্ষক";
        const department = profile?.department?.trim() || profile?.subject?.trim() || "";
        const image = profile?.profileImage || profile?.image || user.image || "";

        faculty.push({
          id: user._id?.toString() || profile?._id?.toString() || `faculty-${index + 1}`,
          _id: profile?._id?.toString() || user._id?.toString(),
          name,
          fullName: name,
          designation,
          department,
          subject: department,
          education: education || "উচ্চতর ইসলামী ও সাধারণ শিক্ষা",
          image,
          profileImage: image,
          email: user.email || profile?.email || "",
          phone: profile?.phone || profile?.mobile || user.phone || "",
          socialLinks: profile?.socialLinks || {},
          bio: profile?.bio || "",
          academic: Array.isArray(profile?.academic) ? profile.academic : [],
          experience: Array.isArray(profile?.experience) ? profile.experience : [],
          order: typeof profile?.order === "number" ? profile.order : typeof user?.order === "number" ? user.order : index + 1,
          priority: typeof profile?.priority === "number" ? profile.priority : typeof user?.priority === "number" ? user.priority : 99,
        });
      });

      teachersProfiles.forEach((profile, index) => {
        const emailKey = (profile.email || "").trim().toLowerCase();
        if (!emailKey || !addedEmails.has(emailKey)) {
          if (profile.fullName || profile.name) {
            let education = "";
            if (typeof profile.education === "string" && profile.education.trim()) {
              education = profile.education.trim();
            } else if (Array.isArray(profile.academic) && profile.academic.length > 0) {
              education = profile.academic
                .map((a) => a.degree || a.title || a.name || "")
                .filter(Boolean)
                .join(", ");
            }

            const name = profile.fullName?.trim() || profile.name?.trim() || "সম্মানিত শিক্ষক";
            const designation = profile.designation?.trim() || "শিক্ষক";
            const department = profile.department?.trim() || profile.subject?.trim() || "";
            const image = profile.profileImage || profile.image || "";

            faculty.push({
              id: profile._id?.toString() || `faculty-ext-${index + 1}`,
              _id: profile._id?.toString(),
              name,
              fullName: name,
              designation,
              department,
              subject: department,
              education: education || "উচ্চতর ইসলামী ও সাধারণ শিক্ষা",
              image,
              profileImage: image,
              email: profile.email || "",
              phone: profile.phone || profile.mobile || "",
              socialLinks: profile.socialLinks || {},
              bio: profile.bio || "",
              academic: Array.isArray(profile.academic) ? profile.academic : [],
              experience: Array.isArray(profile.experience) ? profile.experience : [],
              order: typeof profile.order === "number" ? profile.order : index + 1,
              priority: typeof profile.priority === "number" ? profile.priority : 99,
            });
          }
        }
      });

      // Sort by order ascending, then priority ascending
      faculty.sort((a, b) => {
        const orderA = typeof a.order === "number" ? a.order : 999;
        const orderB = typeof b.order === "number" ? b.order : 999;
        if (orderA !== orderB) return orderA - orderB;
        const priorityA = typeof a.priority === "number" ? a.priority : 99;
        const priorityB = typeof b.priority === "number" ? b.priority : 99;
        return priorityA - priorityB;
      });

      let filteredFaculty = faculty;

      if (req.query.department && req.query.department !== "all") {
        const deptFilter = req.query.department.trim().toLowerCase();
        filteredFaculty = filteredFaculty.filter(
          (t) =>
            (t.department && t.department.toLowerCase() === deptFilter) ||
            (t.subject && t.subject.toLowerCase() === deptFilter)
        );
      }

      if (req.query.search && req.query.search.trim()) {
        const searchFilter = req.query.search.trim().toLowerCase();
        filteredFaculty = filteredFaculty.filter(
          (t) =>
            t.name?.toLowerCase().includes(searchFilter) ||
            t.fullName?.toLowerCase().includes(searchFilter) ||
            t.designation?.toLowerCase().includes(searchFilter) ||
            t.department?.toLowerCase().includes(searchFilter) ||
            t.subject?.toLowerCase().includes(searchFilter) ||
            t.education?.toLowerCase().includes(searchFilter) ||
            t.phone?.includes(searchFilter)
        );
      }

      res.status(200).json({
        success: true,
        count: filteredFaculty.length,
        data: filteredFaculty,
      });
    } catch (error) {
      console.error("Fetch faculty error:", error);
      res.status(500).json({
        success: false,
        message: "শিক্ষকমণ্ডলীর তথ্য লোড করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  };

  router.get("/api/faculty", getPublicFacultyHandler);
  router.get("/api/teachers", getPublicFacultyHandler);

  // Helper: Merge teachersCollection and usersCollection (role: teacher) so no category is omitted
  async function getUnifiedTeachersCatalog() {
    const teachersProfileList = teachersCollection
      ? await teachersCollection.find({}).sort({ order: 1, priority: 1, createdAt: 1 }).toArray().catch(() => [])
      : [];

    let teacherUsers = [];
    if (usersCollection) {
      teacherUsers = await usersCollection
        .find({
          $or: [
            { role: { $regex: /(teacher|residential|hifz|admin)/i } },
            { permissions: "teacher" },
          ],
        })
        .sort({ order: 1, priority: 1, createdAt: 1 })
        .toArray()
        .catch(() => []);
    }

    const profileByEmail = new Map();
    teachersProfileList.forEach((t) => {
      if (t.email) {
        profileByEmail.set(t.email.trim().toLowerCase(), t);
      }
    });

    const unifiedCatalog = [];
    const seenEmails = new Set();

    teachersProfileList.forEach((t, idx) => {
      const emailLower = (t.email || "").trim().toLowerCase();
      if (emailLower) seenEmails.add(emailLower);
      const normDesignation = normalizeDesignation(t.designation);
      unifiedCatalog.push({
        ...t,
        _id: t._id,
        email: t.email || "",
        fullName: t.fullName || t.name || "নাম পাওয়া যায়নি",
        designation: normDesignation,
        category: getTeacherCategory(normDesignation),
        teacherId: formatFallbackTeacherId(idx, t),
        rawTeacherId: t.teacherId || t.idNo || "",
      });
    });

    teacherUsers.forEach((u) => {
      const emailLower = (u.email || "").trim().toLowerCase();
      if (emailLower && !seenEmails.has(emailLower)) {
        seenEmails.add(emailLower);
        const idx = unifiedCatalog.length;
        const normDesignation = normalizeDesignation(u.designation || u.role);
        unifiedCatalog.push({
          _id: u._id,
          email: u.email || "",
          fullName: u.name || u.fullName || emailLower.split("@")[0] || "নাম পাওয়া যায়নি",
          designation: normDesignation,
          category: getTeacherCategory(normDesignation),
          phone: u.phone || "",
          profileImage: u.image || "",
          teacherId: formatFallbackTeacherId(idx, u),
          rawTeacherId: u.teacherId || u.idNo || "",
        });
      }
    });

    return unifiedCatalog;
  }

  // Teacher Authentication Helper (Fetch directly from teachersCollection or usersCollection)
  async function getAuthTeacher(req, body = {}) {
    const email =
      req.headers["x-user-email"] ||
      body.teacherEmail ||
      body.email ||
      req.query.email ||
      req.query.teacherEmail;

    if (!email) return null;
    const cleanEmail = String(email).trim().toLowerCase();

    let teacher = null;
    if (teachersCollection) {
      teacher = await teachersCollection.findOne({
        email: { $regex: new RegExp(`^${cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
      });
    }

    if (!teacher && usersCollection) {
      const userDoc = await usersCollection.findOne({
        email: { $regex: new RegExp(`^${cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
      });
      if (userDoc) {
        teacher = {
          _id: userDoc._id,
          email: userDoc.email,
          fullName: userDoc.name,
          designation: userDoc.designation || "শিক্ষক",
          profileImage: userDoc.image || "",
          teacherId: userDoc.teacherId || "",
        };
      }
    }

    if (!teacher) return null;

    const customId = String(teacher.teacherId || teacher.idNo || "").trim();
    const resolvedTeacherId =
      customId && !/^[a-f\d]{24}$/i.test(customId)
        ? customId
        : `AIM-T-${String(teacher._id || "001").slice(-4).toUpperCase()}`;

    const normDesignation = normalizeDesignation(teacher.designation);

    return {
      id: resolvedTeacherId,
      teacherId: resolvedTeacherId,
      rawTeacherId: customId,
      mongoId: teacher._id?.toString() || "teacher-id",
      email: cleanEmail,
      name: teacher.fullName || teacher.name || cleanEmail.split("@")[0],
      role: "teacher",
      designation: normDesignation,
      profileImage: teacher.profileImage || teacher.image || "",
      teacherDoc: teacher,
    };
  }

  /**
   * শিক্ষকের উপস্থিতি হাজিরা (Check-In)
   * Endpoint: POST /api/attendance/check-in
   */
  router.post("/api/attendance/check-in", async (req, res) => {
    try {
      const body = req.body || {};
      const { lat, lng, mockInPremises } = body;

      const user = await getAuthTeacher(req, body);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: "অনুমতি নেই। অনুগ্রহ করে লগইন করুন।",
        });
      }

      if (lat === undefined || lng === undefined) {
        return res.status(400).json({
          success: false,
          message: "ডিভাইসের অবস্থান (Latitude ও Longitude) প্রয়োজন।",
        });
      }

      const effectiveLat = Number(lat);
      const effectiveLng = Number(lng);

      if (!mockInPremises) {
        const geofenceResult = isWithinMadrasaGeofence(effectiveLat, effectiveLng);
        if (!geofenceResult.isInside) {
          return res.status(403).json({
            success: false,
            message: "You must be inside the madrasa premises to submit attendance.",
            distance: geofenceResult.distance,
            threshold: geofenceResult.threshold,
          });
        }
      }

      const category = getTeacherCategory(user.designation);
      const isMultiShift = category === "residential" || category === "hifz";
      const shiftId = body.shiftId || (isMultiShift ? getActiveTeacherShift(category) : null);
      const shiftRules = getTeacherShiftRules(category);
      const currentShiftRule = (shiftRules && shiftId) ? shiftRules[shiftId] : null;

      const { dateStr } = getDhakaTime();
      const now = new Date();

      let checkInStatus = "On Time";
      if (isMultiShift && shiftId) {
        const evalResult = evaluateTeacherShiftCheckIn(category, shiftId, now);
        checkInStatus = evalResult.status;
      } else {
        checkInStatus = evaluateCheckInStatus(now);
      }

      const checkInComment = (body.checkInComment || body.comment || "").trim();

      // Enforce late check-in reason comment
      if (checkInStatus === "Late" && !checkInComment) {
        return res.status(400).json({
          success: false,
          requiresComment: true,
          status: "Late",
          message: "দেরিতে উপস্থিতির কারণ উল্লেখ করা বাধ্যতামূলক।",
        });
      }

      const existing = await teacherAttendanceCollection.findOne({
        teacherEmail: user.email,
        date: dateStr,
      });

      if (!isMultiShift) {
        // Case A: Regular Teacher (Single-shift, completely unchanged flow)
        if (existing && existing.checkInTime) {
          return res.status(400).json({
            success: false,
            message: "আপনি আজকের হাজিরা (Check-In) ইতিমধ্যে সম্পন্ন করেছেন।",
            attendance: existing,
          });
        }

        const attendanceDoc = {
          teacherEmail: user.email,
          teacherName: user.name || user.email.split("@")[0],
          teacherId: user.id,
          date: dateStr,
          checkInTime: now.toISOString(),
          checkInStatus: checkInStatus, // 'On Time' | 'Late'
          checkInComment: checkInComment || null,
          checkInLocation: {
            lat: effectiveLat,
            lng: effectiveLng,
          },
          checkOutTime: null,
          checkOutStatus: null,
          checkOutLocation: null,
          createdAt: now,
          updatedAt: now,
        };

        if (existing) {
          await teacherAttendanceCollection.updateOne(
            { _id: existing._id },
            {
              $set: {
                checkInTime: attendanceDoc.checkInTime,
                checkInStatus: attendanceDoc.checkInStatus,
                checkInComment: attendanceDoc.checkInComment,
                checkInLocation: attendanceDoc.checkInLocation,
                updatedAt: now,
              },
            }
          );
          attendanceDoc._id = existing._id;
        } else {
          const result = await teacherAttendanceCollection.insertOne(attendanceDoc);
          attendanceDoc._id = result.insertedId;
        }

        return res.status(200).json({
          success: true,
          message:
            checkInStatus === "On Time"
              ? "সফলভাবে সময়মতো প্রবেশ হাজিরা নিশ্চিত হয়েছে! (On Time)"
              : "দেরিতে প্রবেশ হাজিরা নিশ্চিত হয়েছে! (Late)",
          checkInStatus,
          attendance: attendanceDoc,
        });
      } else {
        // Case B & Case C: Multi-shift (Residential / Hifz)
        if (existing?.shifts?.[shiftId]?.checkInTime) {
          return res.status(400).json({
            success: false,
            message: `আপনি ইতিমধ্যে ${currentShiftRule?.name || shiftId}-এর প্রবেশ হাজিরা সম্পন্ন করেছেন।`,
            attendance: existing,
          });
        }

        const shiftRecord = {
          shiftId,
          name: currentShiftRule?.name || shiftId,
          checkInTime: now.toISOString(),
          checkInStatus,
          checkInComment: checkInComment || null,
          checkInLocation: {
            lat: effectiveLat,
            lng: effectiveLng,
          },
          checkOutTime: null,
          checkOutStatus: null,
          checkOutComment: null,
          checkOutLocation: null,
        };

        let updatedDoc = null;

        if (existing) {
          const updateFields = {
            [`shifts.${shiftId}`]: shiftRecord,
            updatedAt: now,
          };
          if (!existing.checkInTime) {
            updateFields.checkInTime = now.toISOString();
            updateFields.checkInStatus = checkInStatus;
            updateFields.checkInComment = checkInComment || null;
            updateFields.checkInLocation = { lat: effectiveLat, lng: effectiveLng };
          }
          await teacherAttendanceCollection.updateOne(
            { _id: existing._id },
            { $set: updateFields }
          );
          updatedDoc = await teacherAttendanceCollection.findOne({ _id: existing._id });
        } else {
          const docToInsert = {
            teacherEmail: user.email,
            teacherName: user.name || user.email.split("@")[0],
            teacherId: user.id,
            teacherDesignation: user.designation,
            category,
            date: dateStr,
            checkInTime: now.toISOString(),
            checkInStatus: checkInStatus,
            checkInComment: checkInComment || null,
            checkInLocation: { lat: effectiveLat, lng: effectiveLng },
            checkOutTime: null,
            checkOutStatus: null,
            checkOutLocation: null,
            shifts: {
              [shiftId]: shiftRecord,
            },
            createdAt: now,
            updatedAt: now,
          };
          const result = await teacherAttendanceCollection.insertOne(docToInsert);
          docToInsert._id = result.insertedId;
          updatedDoc = docToInsert;
        }

        return res.status(200).json({
          success: true,
          message:
            checkInStatus === "On Time"
              ? `${currentShiftRule?.name || shiftId}: সময়মতো প্রবেশ হাজিরা নিশ্চিত হয়েছে! (On Time)`
              : `${currentShiftRule?.name || shiftId}: দেরিতে প্রবেশ হাজিরা নিশ্চিত হয়েছে! (Late)`,
          checkInStatus,
          shiftId,
          attendance: updatedDoc,
        });
      }
    } catch (error) {
      console.error("Teacher Check-in error:", error);
      res.status(500).json({
        success: false,
        message: "হাজিরা সাবমিট করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * শিক্ষকের প্রস্থান হাজিরা (Check-Out)
   * Endpoint: POST /api/attendance/check-out
   */
  router.post("/api/attendance/check-out", async (req, res) => {
    try {
      const body = req.body || {};
      const { lat, lng, mockInPremises } = body;

      const user = await getAuthTeacher(req, body);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: "অনুমতি নেই। অনুগ্রহ করে লগইন করুন।",
        });
      }

      if (lat === undefined || lng === undefined) {
        return res.status(400).json({
          success: false,
          message: "ডিভাইসের অবস্থান (Latitude ও Longitude) প্রয়োজন।",
        });
      }

      const effectiveLat = Number(lat);
      const effectiveLng = Number(lng);

      if (!mockInPremises) {
        const geofenceResult = isWithinMadrasaGeofence(effectiveLat, effectiveLng);
        if (!geofenceResult.isInside) {
          return res.status(403).json({
            success: false,
            message: "You must be inside the madrasa premises to submit attendance.",
            distance: geofenceResult.distance,
            threshold: geofenceResult.threshold,
          });
        }
      }

      const category = getTeacherCategory(user.designation);
      const isMultiShift = category === "residential" || category === "hifz";
      const shiftId = body.shiftId || (isMultiShift ? getActiveTeacherShift(category) : null);
      const shiftRules = getTeacherShiftRules(category);
      const currentShiftRule = (shiftRules && shiftId) ? shiftRules[shiftId] : null;

      const { dateStr } = getDhakaTime();
      const now = new Date();

      let checkOutStatus = "On Time";
      if (isMultiShift && shiftId) {
        const evalResult = evaluateTeacherShiftCheckOut(category, shiftId, now);
        checkOutStatus = evalResult.status;
      } else {
        checkOutStatus = evaluateCheckOutStatus(now);
      }

      const checkOutComment = (body.checkOutComment || body.comment || "").trim();

      // Enforce early check-out reason comment
      if (checkOutStatus === "Early" && !checkOutComment) {
        return res.status(400).json({
          success: false,
          requiresComment: true,
          status: "Early",
          message: "নির্ধারিত সময়ের পূর্বে প্রস্থানের কারণ উল্লেখ করা বাধ্যতামূলক।",
        });
      }

      const existing = await teacherAttendanceCollection.findOne({
        teacherEmail: user.email,
        date: dateStr,
      });

      if (!isMultiShift) {
        // Case A: Regular Teacher (Single-shift, completely unchanged flow)
        if (!existing || !existing.checkInTime) {
          return res.status(400).json({
            success: false,
            message:
              "আজকের কোনো প্রবেশ হাজিরা (Check-In) পাওয়া যায়নি। আগে Check-In সম্পন্ন করুন।",
          });
        }

        if (existing.checkOutTime) {
          return res.status(400).json({
            success: false,
            message: "আপনি আজকের প্রস্থান হাজিরা (Check-Out) ইতিমধ্যে সম্পন্ন করেছেন।",
            attendance: existing,
          });
        }

        const checkOutLocation = {
          lat: effectiveLat,
          lng: effectiveLng,
        };

        await teacherAttendanceCollection.updateOne(
          { _id: existing._id },
          {
            $set: {
              checkOutTime: now.toISOString(),
              checkOutStatus: checkOutStatus, // 'On Time' | 'Early'
              checkOutComment: checkOutComment || null,
              checkOutLocation: checkOutLocation,
              updatedAt: now,
            },
          }
        );

        const updatedDoc = {
          ...existing,
          checkOutTime: now.toISOString(),
          checkOutStatus,
          checkOutComment: checkOutComment || null,
          checkOutLocation,
          updatedAt: now,
        };

        return res.status(200).json({
          success: true,
          message:
            checkOutStatus === "On Time"
              ? "সফলভাবে প্রস্থান হাজিরা নিশ্চিত হয়েছে! (Completed / On Time Departure)"
              : "সময় শেষ হওয়ার পূর্বে প্রস্থান সম্পন্ন হয়েছে! (Early Departure)",
          checkOutStatus,
          attendance: updatedDoc,
        });
      } else {
        // Case B & Case C: Multi-shift
        if (!existing || !existing.shifts?.[shiftId]?.checkInTime) {
          return res.status(400).json({
            success: false,
            message: `${currentShiftRule?.name || shiftId}-এর কোনো প্রবেশ হাজিরা পাওয়া যায়নি। আগে Check-In সম্পন্ন করুন।`,
          });
        }

        if (existing.shifts?.[shiftId]?.checkOutTime) {
          return res.status(400).json({
            success: false,
            message: `আপনি ইতিমধ্যে ${currentShiftRule?.name || shiftId}-এর প্রস্থান হাজিরা সম্পন্ন করেছেন।`,
            attendance: existing,
          });
        }

        const checkOutLocation = {
          lat: effectiveLat,
          lng: effectiveLng,
        };

        const updateFields = {
          [`shifts.${shiftId}.checkOutTime`]: now.toISOString(),
          [`shifts.${shiftId}.checkOutStatus`]: checkOutStatus,
          [`shifts.${shiftId}.checkOutComment`]: checkOutComment || null,
          [`shifts.${shiftId}.checkOutLocation`]: checkOutLocation,
          checkOutTime: now.toISOString(),
          checkOutStatus: checkOutStatus,
          checkOutComment: checkOutComment || null,
          checkOutLocation,
          updatedAt: now,
        };

        await teacherAttendanceCollection.updateOne(
          { _id: existing._id },
          { $set: updateFields }
        );

        const updatedDoc = await teacherAttendanceCollection.findOne({ _id: existing._id });

        return res.status(200).json({
          success: true,
          message:
            checkOutStatus === "On Time"
              ? `${currentShiftRule?.name || shiftId}: সময়মতো প্রস্থান হাজিরা নিশ্চিত হয়েছে!`
              : `${currentShiftRule?.name || shiftId}: সময়ের পূর্বে প্রস্থান নিশ্চিত হয়েছে! (Early Departure)`,
          checkOutStatus,
          shiftId,
          attendance: updatedDoc,
        });
      }
    } catch (error) {
      console.error("Teacher Check-out error:", error);
      res.status(500).json({
        success: false,
        message: "প্রস্থান হাজিরা সাবমিট করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * আজকের হাজিরা স্টেটাস
   * Endpoint: GET /api/attendance/today
   */
  router.get("/api/attendance/today", async (req, res) => {
    try {
      const user = await getAuthTeacher(req);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: "অনুমতি নেই। অনুগ্রহ করে লগইন করুন।",
        });
      }

      const { dateStr } = getDhakaTime();
      const attendanceRecord = await teacherAttendanceCollection.findOne({
        teacherEmail: user.email,
        date: dateStr,
      });

      const category = getTeacherCategory(user.designation);
      const shiftRules = getTeacherShiftRules(category);
      const activeShiftId = getActiveTeacherShift(category);

      res.status(200).json({
        success: true,
        today: dateStr,
        user: {
          id: user.id,
          teacherId: user.teacherId,
          rawTeacherId: user.rawTeacherId,
          mongoId: user.mongoId,
          name: user.name,
          email: user.email,
          role: user.role,
          designation: user.designation,
          profileImage: user.profileImage,
        },
        category, // 'regular' | 'residential' | 'hifz'
        shiftRules: shiftRules || null,
        activeShiftId: activeShiftId || null,
        attendance: attendanceRecord || null,
        madrasaLocation: MADRASA_LOCATION,
        rules: ATTENDANCE_RULES,
      });
    } catch (error) {
      console.error("Error fetching today teacher attendance:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভারে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * শিক্ষকের পূর্ববর্তী হাজিরা হিস্ট্রি
   * Endpoint: GET /api/attendance/history
   */
  router.get("/api/attendance/history", async (req, res) => {
    try {
      const user = await getAuthTeacher(req);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: "অনুমতি নেই।",
        });
      }

      const limit = parseInt(req.query.limit || "30", 10);
      const history = await teacherAttendanceCollection
        .find({ teacherEmail: user.email })
        .sort({ date: -1, createdAt: -1 })
        .limit(limit)
        .toArray();

      res.status(200).json({
        success: true,
        history,
      });
    } catch (error) {
      console.error("History fetch error:", error);
      res.status(500).json({
        success: false,
        message: "হিস্ট্রি লোড করতে ব্যর্থ হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * এডমিন: শিক্ষক হাজিরা ব্যবস্থাপনা
   * Endpoint: GET /api/admin/teachers-attendance
   */
  router.get("/api/admin/teachers-attendance", async (req, res) => {
    try {
      const dateParam = req.query.date;
      const search = (req.query.search || "").trim().toLowerCase();
      const statusFilter = req.query.status || "all";

      const { dateStr: todayStr } = getDhakaTime();
      const targetDate = dateParam || todayStr;

      const unifiedCatalog = await getUnifiedTeachersCatalog();

      const attendanceLogs = await teacherAttendanceCollection
        .find({ date: targetDate })
        .toArray();

      const attendanceByEmail = new Map();
      attendanceLogs.forEach((log) => {
        if (log.teacherEmail) {
          attendanceByEmail.set(log.teacherEmail.trim().toLowerCase(), log);
        }
      });

      const unifiedList = [];
      const processedEmails = new Set();

      for (let i = 0; i < unifiedCatalog.length; i++) {
        const teacher = unifiedCatalog[i];
        const emailLower = (teacher.email || "").trim().toLowerCase();
        if (emailLower) processedEmails.add(emailLower);

        const attendance = emailLower ? attendanceByEmail.get(emailLower) : null;
        const normDesignation = normalizeDesignation(
          teacher.designation || attendance?.teacherDesignation || "শিক্ষক"
        );
        const category =
          attendance?.category || getTeacherCategory(normDesignation);

        const shiftValues = attendance?.shifts
          ? Object.values(attendance.shifts).filter((s) => !!s?.checkInTime)
          : [];
        const hasAnyShiftCheckedIn = shiftValues.length > 0;
        const hasCheckedIn = !!attendance?.checkInTime || hasAnyShiftCheckedIn;

        let effectiveCheckInStatus = "Absent";
        if (hasCheckedIn) {
          if (shiftValues.length > 0) {
            effectiveCheckInStatus = shiftValues.some(
              (s) => s.checkInStatus === "Late"
            )
              ? "Late"
              : "On Time";
          } else {
            effectiveCheckInStatus = attendance?.checkInStatus || "On Time";
          }
        }

        let effectiveCheckOutStatus = attendance?.checkOutStatus || null;
        if (shiftValues.length > 0) {
          const checkedOutShifts = shiftValues.filter((s) => !!s?.checkOutTime);
          if (checkedOutShifts.length > 0) {
            effectiveCheckOutStatus = checkedOutShifts.some(
              (s) => s.checkOutStatus === "Early"
            )
              ? "Early"
              : "On Time";
          }
        }

        unifiedList.push({
          mongoId: teacher._id ? teacher._id.toString() : `teacher-${i + 1}`,
          teacherId: teacher.teacherId || formatFallbackTeacherId(i, teacher),
          rawTeacherId: teacher.rawTeacherId || "",
          teacherName:
            teacher.fullName || teacher.name || "নাম পাওয়া যায়নি",
          teacherEmail: teacher.email || "",
          designation: normDesignation,
          phone: teacher.phone || teacher.mobile || "",
          profileImage: teacher.profileImage || teacher.image || "",
          date: targetDate,
          hasCheckedIn,
          checkInTime: attendance?.checkInTime || shiftValues[0]?.checkInTime || null,
          checkInStatus: effectiveCheckInStatus,
          checkInLocation: attendance?.checkInLocation || shiftValues[0]?.checkInLocation || null,
          checkInComment: attendance?.checkInComment || null,
          hasCheckedOut: !!attendance?.checkOutTime || shiftValues.some((s) => !!s?.checkOutTime),
          checkOutTime: attendance?.checkOutTime || null,
          checkOutStatus: effectiveCheckOutStatus,
          checkOutLocation: attendance?.checkOutLocation || null,
          checkOutComment: attendance?.checkOutComment || null,
          attendanceId: attendance?._id?.toString() || null,
          category,
          shifts: attendance?.shifts || null,
        });
      }

      for (const attendance of attendanceLogs) {
        const emailLower = (attendance.teacherEmail || "").trim().toLowerCase();
        if (!processedEmails.has(emailLower)) {
          processedEmails.add(emailLower);
          const idx = unifiedList.length;
          const normDesignation = normalizeDesignation(
            attendance.teacherDesignation || "শিক্ষক"
          );
          const category =
            attendance.category || getTeacherCategory(normDesignation);

          const shiftValues = attendance?.shifts
            ? Object.values(attendance.shifts).filter((s) => !!s?.checkInTime)
            : [];
          const hasCheckedIn = !!attendance.checkInTime || shiftValues.length > 0;

          let effectiveCheckInStatus = attendance.checkInStatus || "On Time";
          if (shiftValues.length > 0) {
            effectiveCheckInStatus = shiftValues.some(
              (s) => s.checkInStatus === "Late"
            )
              ? "Late"
              : "On Time";
          }

          unifiedList.push({
            mongoId: attendance._id.toString(),
            teacherId: formatFallbackTeacherId(idx, attendance),
            rawTeacherId:
              attendance.teacherId && !/^[a-f\d]{24}$/i.test(attendance.teacherId)
                ? attendance.teacherId
                : "",
            teacherName: attendance.teacherName || attendance.teacherEmail,
            teacherEmail: attendance.teacherEmail,
            designation: normDesignation,
            phone: "",
            profileImage: "",
            date: targetDate,
            hasCheckedIn,
            checkInTime: attendance.checkInTime || shiftValues[0]?.checkInTime || null,
            checkInStatus: effectiveCheckInStatus,
            checkInLocation: attendance.checkInLocation || shiftValues[0]?.checkInLocation || null,
            checkInComment: attendance.checkInComment || null,
            hasCheckedOut: !!attendance.checkOutTime || shiftValues.some((s) => !!s?.checkOutTime),
            checkOutTime: attendance.checkOutTime || null,
            checkOutStatus: attendance.checkOutStatus || null,
            checkOutLocation: attendance.checkOutLocation || null,
            checkOutComment: attendance.checkOutComment || null,
            attendanceId: attendance._id.toString(),
            category,
            shifts: attendance.shifts || null,
          });
        }
      }

      const totalTeachersCount = unifiedList.length;
      const presentCount = unifiedList.filter((item) => item.hasCheckedIn).length;
      const absentCount = Math.max(0, totalTeachersCount - presentCount);
      const onTimeCount = unifiedList.filter(
        (item) => item.hasCheckedIn && item.checkInStatus === "On Time"
      ).length;
      const lateCount = unifiedList.filter(
        (item) => item.hasCheckedIn && item.checkInStatus === "Late"
      ).length;

      let filteredList = unifiedList;
      if (search) {
        filteredList = filteredList.filter(
          (item) =>
            (item.teacherId || "").toLowerCase().includes(search) ||
            (item.teacherName || "").toLowerCase().includes(search) ||
            (item.teacherEmail || "").toLowerCase().includes(search) ||
            (item.designation || "").toLowerCase().includes(search)
        );
      }

      if (statusFilter === "present") {
        filteredList = filteredList.filter((item) => item.hasCheckedIn);
      } else if (statusFilter === "absent") {
        filteredList = filteredList.filter((item) => !item.hasCheckedIn);
      } else if (statusFilter === "onTime") {
        filteredList = filteredList.filter(
          (item) => item.hasCheckedIn && item.checkInStatus === "On Time"
        );
      } else if (statusFilter === "late") {
        filteredList = filteredList.filter(
          (item) => item.hasCheckedIn && item.checkInStatus === "Late"
        );
      }

      res.status(200).json({
        success: true,
        date: targetDate,
        isToday: targetDate === todayStr,
        metrics: {
          totalTeachers: totalTeachersCount,
          presentToday: presentCount,
          absentToday: absentCount,
          onTimeToday: onTimeCount,
          lateToday: lateCount,
        },
        attendanceList: filteredList,
      });
    } catch (error) {
      console.error("Admin teachers attendance error:", error);
      res.status(500).json({
        success: false,
        message: "শিক্ষক হাজিরা তথ্য লোড করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * এডমিন: শিক্ষক মাসিক হাজিরা রিপোর্ট
   * Endpoint: GET /api/admin/teachers-attendance/monthly
   */
  router.get("/api/admin/teachers-attendance/monthly", async (req, res) => {
    try {
      const { dateStr } = getDhakaTime();
      const currentMonth = dateStr.slice(0, 7);
      const month = req.query.month || currentMonth;

      const unifiedCatalog = await getUnifiedTeachersCatalog();

      const attendanceLogs = await teacherAttendanceCollection
        .find({ date: { $regex: `^${month}` } })
        .sort({ date: 1 })
        .toArray();

      const distinctDates = Array.from(new Set(attendanceLogs.map((l) => l.date))).sort();
      const totalWorkingDays = distinctDates.length > 0 ? distinctDates.length : 1;

      const logsByEmail = new Map();
      attendanceLogs.forEach((log) => {
        if (!log.teacherEmail) return;
        const emailLower = log.teacherEmail.trim().toLowerCase();
        if (!logsByEmail.has(emailLower)) {
          logsByEmail.set(emailLower, []);
        }
        logsByEmail.get(emailLower).push(log);
      });

      // Also append any teacher who has logs in this month but wasn't in unifiedCatalog
      const catalogEmails = new Set(
        unifiedCatalog.map((t) => (t.email || "").trim().toLowerCase()).filter(Boolean)
      );
      for (const [emailLower, logs] of logsByEmail.entries()) {
        if (!catalogEmails.has(emailLower) && logs.length > 0) {
          catalogEmails.add(emailLower);
          const sample = logs[logs.length - 1];
          const idx = unifiedCatalog.length;
          const normDesignation = normalizeDesignation(
            sample.teacherDesignation || "শিক্ষক"
          );
          unifiedCatalog.push({
            _id: sample._id,
            email: sample.teacherEmail,
            fullName: sample.teacherName || sample.teacherEmail,
            designation: normDesignation,
            category: sample.category || getTeacherCategory(normDesignation),
            phone: "",
            teacherId: formatFallbackTeacherId(idx, sample),
            rawTeacherId:
              sample.teacherId && !/^[a-f\d]{24}$/i.test(sample.teacherId)
                ? sample.teacherId
                : "",
          });
        }
      }

      const teacherSummaries = [];

      for (let i = 0; i < unifiedCatalog.length; i++) {
        const teacher = unifiedCatalog[i];
        const emailLower = (teacher.email || "").trim().toLowerCase();
        const logs = logsByEmail.get(emailLower) || [];

        const presentLogs = logs.filter((l) => {
          if (l.checkInTime) return true;
          if (l.shifts) {
            return Object.values(l.shifts).some((s) => !!s?.checkInTime);
          }
          return false;
        });
        const presentDays = presentLogs.length;

        const onTimeDays = presentLogs.filter((l) => {
          if (l.shifts) {
            const shiftValues = Object.values(l.shifts).filter((s) => !!s?.checkInTime);
            if (shiftValues.length > 0) {
              return shiftValues.every((s) => s.checkInStatus === "On Time");
            }
          }
          return l.checkInStatus === "On Time";
        }).length;

        const lateDays = presentLogs.filter((l) => {
          if (l.shifts) {
            const shiftValues = Object.values(l.shifts).filter((s) => !!s?.checkInTime);
            if (shiftValues.some((s) => s.checkInStatus === "Late")) {
              return true;
            }
          }
          return l.checkInStatus === "Late";
        }).length;

        const earlyExitDays = presentLogs.filter((l) => {
          if (l.shifts) {
            const shiftValues = Object.values(l.shifts).filter((s) => !!s?.checkOutTime);
            if (shiftValues.some((s) => s.checkOutStatus === "Early")) {
              return true;
            }
          }
          return l.checkOutStatus === "Early";
        }).length;

        const absentDays = Math.max(0, totalWorkingDays - presentDays);
        const attendanceRate =
          totalWorkingDays > 0 ? Math.round((presentDays / totalWorkingDays) * 100) : 0;

        const lateComments = [];
        const earlyComments = [];

        logs.forEach((l) => {
          const hasShifts = l.shifts && Object.keys(l.shifts).length > 0;
          let addedShiftLate = false;
          let addedShiftEarly = false;

          if (hasShifts) {
            const orderedKeys = ["shift1", "shift2", "shift3"];
            const extraKeys = Object.keys(l.shifts).filter((k) => !orderedKeys.includes(k));
            const allShiftKeys = [...orderedKeys, ...extraKeys];

            allShiftKeys.forEach((sKey) => {
              const s = l.shifts[sKey];
              if (!s) return;
              const shiftLabel = s.name || s.shiftId || sKey;
              if (s.checkInComment) {
                lateComments.push({
                  date: l.date,
                  shift: shiftLabel,
                  comment: `${shiftLabel}: ${s.checkInComment}`,
                });
                addedShiftLate = true;
              }
              if (s.checkOutComment) {
                earlyComments.push({
                  date: l.date,
                  shift: shiftLabel,
                  comment: `${shiftLabel}: ${s.checkOutComment}`,
                });
                addedShiftEarly = true;
              }
            });
          }

          if (!addedShiftLate && l.checkInComment) {
            lateComments.push({ date: l.date, comment: l.checkInComment });
          }
          if (!addedShiftEarly && l.checkOutComment) {
            earlyComments.push({ date: l.date, comment: l.checkOutComment });
          }
        });

        const normDesignation = normalizeDesignation(teacher.designation);

        teacherSummaries.push({
          mongoId: teacher._id ? teacher._id.toString() : `teacher-${i + 1}`,
          teacherId: teacher.teacherId || formatFallbackTeacherId(i, teacher),
          rawTeacherId: teacher.rawTeacherId || "",
          teacherName: teacher.fullName || teacher.name || "নাম পাওয়া যায়নি",
          teacherEmail: teacher.email || "",
          designation: normDesignation,
          category: teacher.category || getTeacherCategory(normDesignation),
          phone: teacher.phone || teacher.mobile || "",
          presentDays,
          onTimeDays,
          lateDays,
          earlyExitDays,
          absentDays,
          attendanceRate,
          lateComments,
          earlyComments,
        });
      }

      res.status(200).json({
        success: true,
        month,
        totalTeachers: unifiedCatalog.length,
        totalWorkingDays,
        distinctDates,
        summary: teacherSummaries,
        teachersSummary: teacherSummaries,
      });
    } catch (error) {
      console.error("Monthly attendance summary error:", error);
      res.status(500).json({
        success: false,
        message: "মাসিক শিক্ষক হাজিরা লোড করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * এডমিন: সকল শিক্ষক তালিকা (ID Card & Management)
   * Endpoint: GET /api/admin/teachers
   */
  router.get("/api/admin/teachers", async (req, res) => {
    try {
      const search = (req.query.search || "").trim().toLowerCase();

      const unifiedCatalog = await getUnifiedTeachersCatalog();

      const rawTeachers = search
        ? unifiedCatalog.filter((t) => {
            const nameMatch = (t.fullName || t.name || "").toLowerCase().includes(search);
            const desigMatch = (t.designation || "").toLowerCase().includes(search);
            const emailMatch = (t.email || "").toLowerCase().includes(search);
            const phoneMatch = (t.phone || t.mobile || "").toLowerCase().includes(search);
            const idMatch = (t.teacherId || t.idNo || "").toLowerCase().includes(search);
            return nameMatch || desigMatch || emailMatch || phoneMatch || idMatch;
          })
        : unifiedCatalog;

      const teachers = rawTeachers.map((t, index) => {
        const idStr = t._id ? t._id.toString() : `t-${index + 1}`;
        const fallbackIdNo = formatFallbackTeacherId(index, t);

        return {
          _id: idStr,
          id: idStr,
          fullName: t.fullName || t.name || "নামহীন শিক্ষক",
          designation: normalizeDesignation(t.designation),
          dateOfBirth: t.dateOfBirth || t.dob || "",
          phone: t.phone || t.mobile || "",
          bloodGroup: t.bloodGroup || t.blood || "",
          teacherId: t.teacherId || t.idNo || fallbackIdNo,
          rawTeacherId: t.teacherId || t.idNo || "",
          email: t.email || "",
          profileImage: t.profileImage || t.image || t.photo || "",
          address: t.address || "",
          addressDetails: t.addressDetails || {},
          bankAccount: t.bankAccount || {},
          nameEnglish: t.nameEnglish || "",
          bio: t.bio || "",
          academic: t.academic || [],
          experience: t.experience || [],
          createdAt: t.createdAt,
        };
      });

      res.status(200).json({
        success: true,
        data: teachers,
        total: teachers.length,
      });
    } catch (error) {
      console.error("GET /api/admin/teachers error:", error);
      res.status(500).json({
        success: false,
        message: "শিক্ষকদের তালিকা লোড করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * এডমিন: শিক্ষক তথ্য আপডেট (ID Card & Management)
   * Endpoint: PATCH /api/admin/teachers
   */
  router.patch("/api/admin/teachers", async (req, res) => {
    try {
      const body = req.body || {};
      const { id, _id, ...updateFields } = body;
      const targetId = id || _id;

      if (!targetId) {
        return res.status(400).json({
          success: false,
          message: "শিক্ষকের আইডি দেওয়া হয়নি।",
        });
      }

      let filter = {};
      if (ObjectId.isValid(targetId)) {
        try {
          filter = { $or: [{ _id: new ObjectId(targetId) }, { _id: targetId }] };
        } catch {
          filter = { _id: targetId };
        }
      } else {
        filter = { _id: targetId };
      }

      delete updateFields._id;
      delete updateFields.id;
      updateFields.updatedAt = new Date().toISOString();

      let result = await teachersCollection.updateOne(filter, {
        $set: updateFields,
      });

      if (result.matchedCount === 0) {
        let userDoc = null;
        if (usersCollection && ObjectId.isValid(targetId)) {
          userDoc = await usersCollection
            .findOne({ _id: new ObjectId(targetId) })
            .catch(() => null);
        }
        if (userDoc && userDoc.email) {
          const escapedEmail = String(userDoc.email).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const emailFilter = {
            email: { $regex: new RegExp("^" + escapedEmail + "$", "i") },
          };
          result = await teachersCollection.updateOne(
            emailFilter,
            {
              $set: {
                email: userDoc.email,
                fullName: updateFields.fullName || userDoc.name || "",
                ...updateFields,
              },
              $setOnInsert: {
                createdAt: new Date(),
              },
            },
            { upsert: true }
          );
        }
      }

      res.status(200).json({
        success: true,
        message: "শিক্ষকের তথ্য সফলভাবে সংরক্ষণ করা হয়েছে।",
        modifiedCount: result.modifiedCount || result.upsertedCount || 1,
      });
    } catch (error) {
      console.error("PATCH /api/admin/teachers error:", error);
      res.status(500).json({
        success: false,
        message: "তথ্য সংরক্ষণ করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  return router;
}

module.exports = teacherRoutes;
