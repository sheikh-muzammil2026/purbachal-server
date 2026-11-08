const express = require("express");
const { ObjectId } = require("mongodb");
const {
  isWithinMadrasaGeofence,
  getDhakaTime,
  evaluateStaffCheckInStatus,
  evaluateStaffCheckOutStatus,
  getStaffShiftPhase,
  STAFF_ATTENDANCE_RULES,
  MADRASA_LOCATION,
} = require("../utils/attendanceConfig");

function staffRoutes(collections, authHelpers, database) {
  const router = express.Router();
  const { staffCollection, staffAttendanceCollection, usersCollection } = collections;

  // Helper to resolve staff user from request
  async function getStaffUser(req, body = {}) {
    const email =
      req.headers["x-user-email"] ||
      body.staffEmail ||
      body.email ||
      req.query.email ||
      req.query.staffEmail;

    const staffId = body.staffId || req.query.staffId;

    let staffDoc = null;
    let userDoc = null;

    if (email && staffCollection) {
      const cleanEmail = String(email).trim().toLowerCase();
      const emailRegex = new RegExp(`^${cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
      staffDoc = await staffCollection.findOne({
        email: { $regex: emailRegex },
      });
      if (!staffDoc && usersCollection) {
        userDoc = await usersCollection.findOne({
          email: { $regex: emailRegex },
        });
      }
    }

    if (!staffDoc && staffId && staffCollection) {
      staffDoc = await staffCollection.findOne({
        staffId: String(staffId).trim(),
      });
    }

    if (!staffDoc && !userDoc && !email && !staffId) {
      return null;
    }

    const resolvedEmail =
      staffDoc?.email || userDoc?.email || (email ? String(email).trim().toLowerCase() : "");
    const resolvedName =
      staffDoc?.fullName || staffDoc?.name || userDoc?.name || body.staffName || "সম্মানিত স্টাফ";
    const resolvedStaffId =
      staffDoc?.staffId || staffId || (resolvedEmail ? `ST-${resolvedEmail.split("@")[0].toUpperCase()}` : "");
    const resolvedDesignation =
      staffDoc?.designation || userDoc?.designation || "স্টাফ";

    return {
      id: staffDoc?._id?.toString() || userDoc?._id?.toString() || resolvedStaffId || resolvedEmail,
      email: resolvedEmail,
      name: resolvedName,
      staffId: resolvedStaffId,
      designation: resolvedDesignation,
      role: (staffDoc?.role || userDoc?.role || staffDoc?.designation || "staff").toLowerCase(),
      staffProfile: staffDoc,
    };
  }

  // Helper to resolve active staff collection (staffs or staff)
  const getActiveStaffCol = async () => {
    if (collections.staffsCollection) return collections.staffsCollection;
    if (database) {
      try {
        const count = await database.collection("staffs").countDocuments();
        if (count > 0) return database.collection("staffs");
      } catch (_) {}
    }
    return staffCollection;
  };

  /**
   * 1. GET /api/staff & GET /api/staffs
   * Public directory of staff members
   */
  const getPublicStaffHandler = async (req, res) => {
    try {
      const targetCol = await getActiveStaffCol();
      const staffProfiles = targetCol
        ? await targetCol
            .find({})
            .sort({ order: 1, priority: 1, createdAt: 1 })
            .toArray()
            .catch(() => [])
        : [];

      let staffList = staffProfiles.map((profile, index) => {
        const name =
          profile?.fullName?.trim() ||
          profile?.name?.trim() ||
          "কর্মকর্তা / কর্মচারী";
        const designation =
          profile?.designation?.trim() || profile?.role?.trim() || "স্টাফ";
        const image = profile?.profileImage || profile?.image || "";
        const phone =
          profile?.phone || profile?.mobile || profile?.contact || "";

        return {
          id: profile._id?.toString() || `staff-${index + 1}`,
          _id: profile._id?.toString(),
          name,
          fullName: name,
          role: designation,
          designation,
          department: profile?.department?.trim() || "প্রশাসন ও সেবা",
          phone,
          contact: phone,
          email: profile?.email || "",
          staffId: profile?.staffId || "",
          bloodGroup: profile?.bloodGroup || profile?.blood || "",
          joiningDate: profile?.joiningDate || "",
          dateOfBirth: profile?.dateOfBirth || profile?.dob || "",
          address: profile?.address || "",
          image,
          profileImage: image,
          bio: profile?.bio || "",
          order: typeof profile?.order === "number" ? profile.order : index + 1,
          priority:
            typeof profile?.priority === "number" ? profile.priority : 99,
        };
      });

      // Sort by order ascending, then priority ascending
      staffList.sort((a, b) => {
        const orderA = typeof a.order === "number" ? a.order : 999;
        const orderB = typeof b.order === "number" ? b.order : 999;
        if (orderA !== orderB) return orderA - orderB;
        const priorityA = typeof a.priority === "number" ? a.priority : 99;
        const priorityB = typeof b.priority === "number" ? b.priority : 99;
        return priorityA - priorityB;
      });

      // Filter by department if supplied
      if (req.query.department && req.query.department !== "all") {
        const deptFilter = req.query.department.trim().toLowerCase();
        staffList = staffList.filter(
          (s) => s.department && s.department.toLowerCase() === deptFilter,
        );
      }

      // Filter by role/designation if supplied
      if (req.query.role && req.query.role !== "all") {
        const roleFilter = req.query.role.trim().toLowerCase();
        staffList = staffList.filter(
          (s) =>
            (s.designation && s.designation.toLowerCase() === roleFilter) ||
            (s.role && s.role.toLowerCase() === roleFilter),
        );
      }

      // Filter by search query if supplied
      if (req.query.search && req.query.search.trim()) {
        const searchFilter = req.query.search.trim().toLowerCase();
        staffList = staffList.filter(
          (s) =>
            s.name?.toLowerCase().includes(searchFilter) ||
            s.fullName?.toLowerCase().includes(searchFilter) ||
            s.designation?.toLowerCase().includes(searchFilter) ||
            s.role?.toLowerCase().includes(searchFilter) ||
            s.staffId?.toLowerCase().includes(searchFilter) ||
            s.phone?.includes(searchFilter),
        );
      }

      res.status(200).json({
        success: true,
        count: staffList.length,
        data: staffList,
      });
    } catch (error) {
      console.error("GET /api/staff(s) error:", error);
      res.status(500).json({
        success: false,
        message: "কর্মকর্তা ও কর্মচারীদের তথ্য লোড করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  };

  router.get("/api/staff", getPublicStaffHandler);
  router.get("/api/staffs", getPublicStaffHandler);

  /**
   * 2. GET /api/staff/me
   * Complete staff profile and dashboard overview
   */
  router.get("/api/staff/me", async (req, res) => {
    try {
      const user = await getStaffUser(req);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "স্টাফ তথ্য পাওয়া যায়নি। অনুগ্রহ করে লগইন করুন।",
        });
      }

      const { dateStr: todayStr } = getDhakaTime();

      const attendanceFilter = {
        $or: [
          ...(user.email
            ? [
                {
                  staffEmail: { $regex: new RegExp(`^${user.email}$`, "i") },
                  date: todayStr,
                },
              ]
            : []),
          ...(user.staffId ? [{ staffId: user.staffId, date: todayStr }] : []),
        ],
      };

      const todayAttendance = staffAttendanceCollection
        ? await staffAttendanceCollection.findOne(attendanceFilter)
        : null;

      const currentMonth = todayStr.substring(0, 7);
      const monthlyFilter = {
        $or: [
          ...(user.email
            ? [{ staffEmail: { $regex: new RegExp(`^${user.email}$`, "i") } }]
            : []),
          ...(user.staffId ? [{ staffId: user.staffId }] : []),
        ],
        date: { $regex: `^${currentMonth}` },
      };

      const monthlyLogs = staffAttendanceCollection
        ? await staffAttendanceCollection.find(monthlyFilter).toArray()
        : [];

      const presentDays = monthlyLogs.filter((l) => !!l.checkInTime).length;
      const onTimeDays = monthlyLogs.filter(
        (l) => l.checkInStatus === "On Time",
      ).length;
      let totalMinutesWorked = 0;
      monthlyLogs.forEach((l) => {
        if (typeof l.durationMinutes === "number")
          totalMinutesWorked += l.durationMinutes;
      });

      const profileData = user.staffProfile || {};
      res.status(200).json({
        success: true,
        profile: {
          id: user.id,
          _id: user.id,
          fullName: profileData.fullName || user.name || "",
          nameEnglish: profileData.nameEnglish || "",
          name: user.name || "",
          email: user.email || "",
          staffId: profileData.staffId || user.staffId || "",
          designation: profileData.designation || user.designation || "স্টাফ",
          department: profileData.department || "সাধারণ প্রশাসন",
          phone: profileData.phone || "",
          dateOfBirth: profileData.dateOfBirth || "",
          bloodGroup: profileData.bloodGroup || "",
          nid: profileData.nid || "",
          emergencyContact: profileData.emergencyContact || "",
          joiningDate: profileData.joiningDate || "",
          employmentType: profileData.employmentType || "ফুল-টাইম (Full-time)",
          workShift: profileData.workShift || "২ টার্ম (সকাল-রাত)",
          salaryDetails: profileData.salaryDetails || {
            basicSalary: "",
            houseRent: "",
            medicalAllowance: "",
            otherAllowance: "",
            totalSalary: "",
          },
          address: profileData.address || "",
          addressDetails: profileData.addressDetails || {
            village: "",
            postOffice: "",
            thana: "",
            district: "",
          },
          bankAccount: profileData.bankAccount || {
            bankName: "",
            accountNumber: "",
            branchName: "",
            routingNumber: "",
            accountType: "সঞ্চয়ী (Savings)",
            mobileBanking: "",
            mobileBankingNumber: "",
          },
          profileImage: profileData.profileImage || "",
          bio: profileData.bio || "",
          status: profileData.status || "active",
        },
        stats: {
          month: currentMonth,
          presentDays,
          onTimeDays,
          totalHoursWorked: Math.round((totalMinutesWorked / 60) * 10) / 10,
          onTimeRate:
            presentDays > 0
              ? Math.round((onTimeDays / presentDays) * 100)
              : 100,
        },
        todayAttendance: todayAttendance || null,
      });
    } catch (error) {
      console.error("GET /api/staff/me error:", error);
      res.status(500).json({
        success: false,
        message: "স্টাফ প্রোফাইল লোড করতে ব্যর্থ হয়েছে।",
        error: error.message,
      });
    }
  });


  /**
   * 2.1 POST /api/staff/profile
   * Save or update staff profile from staff dashboard
   */
  router.post("/api/staff/profile", async (req, res) => {
    try {
      const {
        email,
        staffId,
        fullName,
        nameEnglish,
        designation,
        department,
        phone,
        dateOfBirth,
        bloodGroup,
        nid,
        emergencyContact,
        joiningDate,
        employmentType,
        workShift,
        salaryDetails,
        address,
        addressDetails,
        bankAccount,
        profileImage,
        bio,
        status,
      } = req.body || {};

      const cleanEmail = email ? String(email).trim().toLowerCase() : "";
      const cleanStaffId = staffId ? String(staffId).trim() : "";

      if (!cleanEmail && !cleanStaffId) {
        return res.status(400).json({
          success: false,
          message: "ইমেইল বা স্টাফ আইডি আবশ্যক।",
        });
      }

      const filter = {};
      if (cleanEmail) {
        filter.email = { $regex: new RegExp("^" + cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i") };
      } else {
        filter.staffId = cleanStaffId;
      }

      let finalStaffId = cleanStaffId;
      if (!finalStaffId) {
        const existing = await staffCollection.findOne(filter);
        if (existing?.staffId) {
          finalStaffId = existing.staffId;
        } else {
          const count = await staffCollection.countDocuments();
          finalStaffId = "ID NO-AIM ST-" + String(count + 1).padStart(3, "0");
        }
      }

      const updateDoc = {
        $set: {
          fullName: (fullName || "").trim(),
          nameEnglish: (nameEnglish || "").trim(),
          designation: (designation || "").trim() || "স্টাফ",
          department: (department || "").trim() || "সাধারণ প্রশাসন",
          phone: (phone || "").trim(),
          email: cleanEmail,
          staffId: finalStaffId,
          dateOfBirth: (dateOfBirth || "").trim(),
          bloodGroup: (bloodGroup || "").trim(),
          nid: (nid || "").trim(),
          emergencyContact: (emergencyContact || "").trim(),
          joiningDate: (joiningDate || "").trim(),
          employmentType: (employmentType || "ফুল-টাইম (Full-time)").trim(),
          workShift: (workShift || "২ টার্ম (সকাল-রাত)").trim(),
          salaryDetails:
            salaryDetails && typeof salaryDetails === "object"
              ? salaryDetails
              : {},
          address: (address || "").trim(),
          addressDetails:
            addressDetails && typeof addressDetails === "object"
              ? addressDetails
              : {},
          bankAccount:
            bankAccount && typeof bankAccount === "object" ? bankAccount : {},
          profileImage: (profileImage || "").trim(),
          bio: (bio || "").trim(),
          status: status || "active",
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      };

      await staffCollection.updateOne(filter, updateDoc, { upsert: true });
      const updatedStaff = await staffCollection.findOne(filter);

      res.status(200).json({
        success: true,
        message: "স্টাফ প্রোফাইল সফলভাবে সংরক্ষিত হয়েছে! 🎉",
        data: updatedStaff,
      });
    } catch (error) {
      console.error("POST /api/staff/profile error:", error);
      res.status(500).json({
        success: false,
        message: "স্টাফ প্রোফাইল সংরক্ষণে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * 2.2 GET /api/staff/profile/:identifier
   * Fetch staff profile by email or staffId
   */
  router.get("/api/staff/profile/:identifier", async (req, res) => {
    try {
      const { identifier } = req.params;
      const clean = decodeURIComponent(identifier || "").trim();
      if (!clean) {
        return res.status(400).json({ success: false, message: "আইডেন্টিফায়ার আবশ্যক।" });
      }

      const query = {
        $or: [
          { email: { $regex: new RegExp("^" + clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i") } },
          { staffId: clean },
        ],
      };

      if (ObjectId.isValid(clean)) {
        query.$or.push({ _id: new ObjectId(clean) });
      }

      const staff = await staffCollection.findOne(query);
      if (!staff) {
        return res.status(404).json({ success: false, message: "স্টাফ প্রোফাইল পাওয়া যায়নি।" });
      }

      res.status(200).json({ success: true, data: staff });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  /**
   * 3. POST /api/staff/attendance/check-in
   * Term 1: Morning Check-In (Cutoff 5:30 AM)
   */
  router.post("/api/staff/attendance/check-in", async (req, res) => {
    try {
      const body = req.body || {};
      const { lat, lng, accuracy } = body;

      const user = await getStaffUser(req, body);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: "অনুমতি নেই। অনুগ্রহ করে লগইন করুন।",
        });
      }

      if (lat === undefined || lng === undefined || lat === null || lng === null) {
        return res.status(400).json({
          success: false,
          message: "ডিভাইসের GPS অবস্থান (Latitude ও Longitude) প্রয়োজন। অনুগ্রহ করে ব্রাউজারের লোকেশন পারমিশন অন করুন।",
        });
      }

      const effectiveLat = Number(lat);
      const effectiveLng = Number(lng);
      const effectiveAccuracy = Number.isFinite(Number(accuracy)) ? Math.round(Number(accuracy)) : 0;

      if (
        effectiveAccuracy > 0 &&
        MADRASA_LOCATION.MAX_ALLOWED_ACCURACY_METERS &&
        effectiveAccuracy > MADRASA_LOCATION.MAX_ALLOWED_ACCURACY_METERS
      ) {
        return res.status(400).json({
          success: false,
          message: `আপনার ডিভাইসের GPS সংকেত অত্যন্ত দুর্বল (Accuracy: ±${effectiveAccuracy} মিটার)। অনুগ্রহ করে খোলা স্থানে গিয়ে পুনরায় লোকেশন রিফ্রেশ করুন।`,
          accuracy: effectiveAccuracy,
        });
      }

      const geofenceResult = isWithinMadrasaGeofence(
        effectiveLat,
        effectiveLng,
        MADRASA_LOCATION.RADIUS_METERS,
        effectiveAccuracy
      );

      if (!geofenceResult.isValidCoords) {
        return res.status(400).json({
          success: false,
          message: "অবৈধ GPS স্থানাঙ্ক শনাক্ত হয়েছে। অনুগ্রহ করে পুনরায় লোকেশন রিফ্রেশ করুন।",
        });
      }

      if (!geofenceResult.isInside) {
        return res.status(403).json({
          success: false,
          message: `হাজিরা দিতে আপনাকে অবশ্যই মাদরাসা প্রাঙ্গণে (${geofenceResult.threshold} মিটারের মধ্যে) থাকতে হবে। আপনার বর্তমান দূরত্ব: ${geofenceResult.distance} মিটার।`,
          distance: geofenceResult.distance,
          threshold: geofenceResult.threshold,
          accuracy: effectiveAccuracy,
        });
      }

      const { dateStr } = getDhakaTime();
      const now = new Date();
      const checkInStatus = evaluateStaffCheckInStatus(now);
      const queryFilter = {
        $or: [
          ...(user.email
            ? [
                {
                  staffEmail: { $regex: new RegExp(`^${user.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
                  date: dateStr,
                },
              ]
            : []),
          ...(user.staffId ? [{ staffId: user.staffId, date: dateStr }] : []),
        ],
      };

      const existing = await staffAttendanceCollection.findOne(queryFilter);
      if (existing && existing.checkInTime) {
        return res.status(400).json({
          success: false,
          message:
            "আপনি আজকের ১ম টার্ম (সকালের চেক-ইন) ইতিমধ্যে সম্পন্ন করেছেন।",
          attendance: existing,
        });
      }

      const checkInComment = (body.checkInComment || body.comment || "").trim();

      // Enforce late check-in reason comment
      if (checkInStatus === "Late" && !checkInComment) {
        return res.status(400).json({
          success: false,
          requiresComment: true,
          status: "Late",
          message:
            "দেরিতে উপস্থিতির কারণ উল্লেখ করা বাধ্যতামূলক (ভোর ৫:৩০ অতিক্রান্ত)।",
        });
      }
      const attendanceDoc = {
        staffId: user.staffId || user.id,
        staffEmail: user.email,
        staffName: user.name || "স্টাফ",
        designation: user.designation || "স্টাফ",
        date: dateStr,
        checkInTime: now.toISOString(),
        checkInStatus: checkInStatus, // 'On Time' | 'Late'
        checkInComment: checkInComment || null,
        checkInLocation: {
          lat: effectiveLat,
          lng: effectiveLng,
          accuracy: effectiveAccuracy,
          distance: geofenceResult.distance,
        },
        checkOutTime: null,
        checkOutStatus: null,
        checkOutComment: null,
        createdAt: now,
        updatedAt: now,
      };

      if (existing) {
        await staffAttendanceCollection.updateOne(
          { _id: existing._id },
          {
            $set: {
              checkInTime: attendanceDoc.checkInTime,
              checkInStatus: attendanceDoc.checkInStatus,
              checkInComment: attendanceDoc.checkInComment,
              checkInLocation: attendanceDoc.checkInLocation,
              updatedAt: now,
            },
          },
        );
        attendanceDoc._id = existing._id;
      } else {
        const result = await staffAttendanceCollection.insertOne(attendanceDoc);
        attendanceDoc._id = result.insertedId;
      }

      const isSuccessOnTime = checkInStatus === "On Time";
      const statusMsg = isSuccessOnTime
        ? `সফলভাবে সময়মতো ১ম টার্ম প্রবেশ হাজিরা নিশ্চিত হয়েছে! (On Time - ভোর ৫:৩০ এর মধ্যে)`
        : `দেরিতে ১ম টার্ম প্রবেশ হাজিরা নিশ্চিত হয়েছে! (Late - ভোর ৫:৩০ এর পর)`;

      res.status(200).json({
        success: true,
        message: statusMsg,
        checkInStatus,
        attendance: attendanceDoc,
      });
    } catch (error) {
      console.error("Staff Check-in error:", error);
      res.status(500).json({
        success: false,
        message: "স্টাফ হাজিরা সাবমিট করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * 4. POST /api/staff/attendance/check-out
   * Term 2: Night Check-Out (Window: 10:00 PM to 10:10 PM)
   */
  router.post("/api/staff/attendance/check-out", async (req, res) => {
    try {
      const body = req.body || {};
      const { lat, lng, accuracy } = body;

      const user = await getStaffUser(req, body);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: "অনুমতি নেই। অনুগ্রহ করে লগইন করুন।",
        });
      }

      if (lat === undefined || lng === undefined || lat === null || lng === null) {
        return res.status(400).json({
          success: false,
          message: "ডিভাইসের GPS অবস্থান (Latitude ও Longitude) প্রয়োজন। অনুগ্রহ করে ব্রাউজারের লোকেশন পারমিশন অন করুন।",
        });
      }

      const effectiveLat = Number(lat);
      const effectiveLng = Number(lng);
      const effectiveAccuracy = Number.isFinite(Number(accuracy)) ? Math.round(Number(accuracy)) : 0;

      if (
        effectiveAccuracy > 0 &&
        MADRASA_LOCATION.MAX_ALLOWED_ACCURACY_METERS &&
        effectiveAccuracy > MADRASA_LOCATION.MAX_ALLOWED_ACCURACY_METERS
      ) {
        return res.status(400).json({
          success: false,
          message: `আপনার ডিভাইসের GPS সংকেত অত্যন্ত দুর্বল (Accuracy: ±${effectiveAccuracy} মিটার)। অনুগ্রহ করে খোলা স্থানে গিয়ে পুনরায় লোকেশন রিফ্রেশ করুন।`,
          accuracy: effectiveAccuracy,
        });
      }

      const geofenceResult = isWithinMadrasaGeofence(
        effectiveLat,
        effectiveLng,
        MADRASA_LOCATION.RADIUS_METERS,
        effectiveAccuracy
      );

      if (!geofenceResult.isValidCoords) {
        return res.status(400).json({
          success: false,
          message: "অবৈধ GPS স্থানাঙ্ক শনাক্ত হয়েছে। অনুগ্রহ করে পুনরায় লোকেশন রিফ্রেশ করুন।",
        });
      }

      if (!geofenceResult.isInside) {
        return res.status(403).json({
          success: false,
          message: `হাজিরা দিতে আপনাকে অবশ্যই মাদরাসা প্রাঙ্গণে (${geofenceResult.threshold} মিটারের মধ্যে) থাকতে হবে। আপনার বর্তমান দূরত্ব: ${geofenceResult.distance} মিটার।`,
          distance: geofenceResult.distance,
          threshold: geofenceResult.threshold,
          accuracy: effectiveAccuracy,
        });
      }

      const { dateStr } = getDhakaTime();
      const now = new Date();
      const checkOutStatus = evaluateStaffCheckOutStatus(now);

      const queryFilter = {
        $or: [
          ...(user.email
            ? [
                {
                  staffEmail: { $regex: new RegExp(`^${user.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
                  date: dateStr,
                },
              ]
            : []),
          ...(user.staffId ? [{ staffId: user.staffId, date: dateStr }] : []),
        ],
      };

      const existing = await staffAttendanceCollection.findOne(queryFilter);

      if (!existing || !existing.checkInTime) {
        return res.status(400).json({
          success: false,
          message:
            "প্রস্থান হাজিরা (Check-Out) দেওয়ার পূর্বে আজকের ১ম টার্মের প্রবেশ হাজিরা সম্পন্ন করতে হবে।",
        });
      }

      if (existing.checkOutTime) {
        return res.status(400).json({
          success: false,
          message:
            "আপনি আজকের ২য় টার্মের প্রস্থান হাজিরা ইতিমধ্যে সম্পন্ন করেছেন।",
          attendance: existing,
        });
      }

      const checkInDate = new Date(existing.checkInTime);
      const durationMs = Math.max(0, now.getTime() - checkInDate.getTime());
      const durationMinutes = Math.round(durationMs / (1000 * 60));
      const hours = Math.floor(durationMinutes / 60);
      const minutes = durationMinutes % 60;
      const durationText = `${hours} ঘণ্টা ${minutes} মিনিট`;

      const checkOutComment = (
        body.checkOutComment ||
        body.comment ||
        ""
      ).trim();

      // Enforce early or overtime check-out reason comment
      if ((checkOutStatus === "Early" || checkOutStatus === "Overtime") && !checkOutComment) {
        return res.status(400).json({
          success: false,
          requiresComment: true,
          status: checkOutStatus,
          message:
            checkOutStatus === "Early"
              ? "নির্ধারিত সময়ের পূর্বে প্রস্থানের কারণ উল্লেখ করা বাধ্যতামূলক (রাত ১০:০০ এর পূর্বে)।"
              : "রাত ১০:১০ অতিক্রান্ত হওয়ায় বিলম্বিত প্রস্থানের কারণ উল্লেখ করা বাধ্যতামূলক।",
        });
      }

      const updateFields = {
        checkOutTime: now.toISOString(),
        checkOutStatus, // 'On Time' | 'Early' | 'Overtime'
        checkOutComment: checkOutComment || null,
        checkOutLocation: {
          lat: effectiveLat,
          lng: effectiveLng,
          accuracy: effectiveAccuracy,
          distance: geofenceResult.distance,
        },
        durationMinutes,
        durationText,
        updatedAt: now,
      };

      await staffAttendanceCollection.updateOne(
        { _id: existing._id },
        { $set: updateFields },
      );

      const updatedAttendance = {
        ...existing,
        ...updateFields,
      };

      let statusMsg = "";
      if (checkOutStatus === "On Time") {
        statusMsg =
          "সফলভাবে নির্ধারিত সময়ে ২য় টার্ম প্রস্থান হাজিরা নিশ্চিত হয়েছে! (রাত ১০:০০ - ১০:১০)";
      } else if (checkOutStatus === "Early") {
        statusMsg =
          "সময়ের পূর্বে ২য় টার্ম প্রস্থান হাজিরা নিশ্চিত হয়েছে (Early Departure - রাত ১০:০০ এর পূর্বে)";
      } else {
        statusMsg =
          "বিলম্বিত ২য় টার্ম প্রস্থান হাজিরা নিশ্চিত হয়েছে (রাত ১০:১০ এর পর)";
      }

      res.status(200).json({
        success: true,
        message: statusMsg,
        checkOutStatus,
        durationText,
        attendance: updatedAttendance,
      });
    } catch (error) {
      console.error("Staff Check-out error:", error);
      res.status(500).json({
        success: false,
        message: "প্রস্থান হাজিরা সাবমিট করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * 5. GET /api/staff/attendance/today
   */
  router.get("/api/staff/attendance/today", async (req, res) => {
    try {
      const user = await getStaffUser(req);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "স্টাফ তথ্য পাওয়া যায়নি।",
        });
      }

      const { dateStr } = getDhakaTime();
      const queryFilter = {
        $or: [
          ...(user.email
            ? [
                {
                  staffEmail: { $regex: new RegExp(`^${user.email}$`, "i") },
                  date: dateStr,
                },
              ]
            : []),
          ...(user.staffId ? [{ staffId: user.staffId, date: dateStr }] : []),
        ],
      };

      const attendance = await staffAttendanceCollection.findOne(queryFilter);
      const shiftPhase = getStaffShiftPhase(new Date());

      res.status(200).json({
        success: true,
        date: dateStr,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          staffId: user.staffId,
          designation: user.designation,
          profileImage: user.staffProfile?.profileImage || "",
        },
        attendance: attendance || null,
        shiftPhase,
        rules: STAFF_ATTENDANCE_RULES,
      });
    } catch (error) {
      console.error("GET /api/staff/attendance/today error:", error);
      res.status(500).json({
        success: false,
        message: "আজকের হাজিরা তথ্য লোড করতে ব্যর্থ হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * 6. GET /api/staff/attendance/history
   */
  router.get("/api/staff/attendance/history", async (req, res) => {
    try {
      const user = await getStaffUser(req);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "স্টাফ তথ্য পাওয়া যায়নি।",
        });
      }

      const monthParam = req.query.month;
      const limit = parseInt(req.query.limit || "30", 10);
      const { dateStr: todayStr } = getDhakaTime();
      const currentMonth = monthParam || todayStr.substring(0, 7);

      const baseFilter = {
        $or: [
          ...(user.email
            ? [{ staffEmail: { $regex: new RegExp(`^${user.email}$`, "i") } }]
            : []),
          ...(user.staffId ? [{ staffId: user.staffId }] : []),
        ],
      };

      const monthlyFilter = {
        ...baseFilter,
        date: { $regex: `^${currentMonth}` },
      };

      const monthlyLogs = await staffAttendanceCollection
        .find(monthlyFilter)
        .sort({ date: -1 })
        .toArray();

      const historyLogs = await staffAttendanceCollection
        .find(baseFilter)
        .sort({ date: -1 })
        .limit(limit)
        .toArray();

      const totalRecordedDays = monthlyLogs.length;
      const presentDays = monthlyLogs.filter((l) => !!l.checkInTime).length;
      const onTimeCheckIns = monthlyLogs.filter(
        (l) => l.checkInStatus === "On Time",
      ).length;
      const lateCheckIns = monthlyLogs.filter(
        (l) => l.checkInStatus === "Late",
      ).length;
      const completedBothTerms = monthlyLogs.filter(
        (l) => !!l.checkInTime && !!l.checkOutTime,
      ).length;
      const onTimeCheckOuts = monthlyLogs.filter(
        (l) => l.checkOutStatus === "On Time",
      ).length;
      const earlyCheckOuts = monthlyLogs.filter(
        (l) => l.checkOutStatus === "Early",
      ).length;
      const overtimeCheckOuts = monthlyLogs.filter(
        (l) => l.checkOutStatus === "Overtime",
      ).length;

      let totalMinutesWorked = 0;
      monthlyLogs.forEach((l) => {
        if (typeof l.durationMinutes === "number")
          totalMinutesWorked += l.durationMinutes;
      });

      const totalHoursWorked = Math.round((totalMinutesWorked / 60) * 10) / 10;
      const onTimeRate =
        presentDays > 0
          ? Math.round((onTimeCheckIns / presentDays) * 100)
          : 100;

      res.status(200).json({
        success: true,
        month: currentMonth,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          staffId: user.staffId,
          designation: user.designation,
        },
        metrics: {
          totalRecordedDays,
          presentDays,
          onTimeCheckIns,
          lateCheckIns,
          completedBothTerms,
          onTimeCheckOuts,
          earlyCheckOuts,
          overtimeCheckOuts,
          totalMinutesWorked,
          totalHoursWorked,
          onTimeRate,
        },
        history: historyLogs,
      });
    } catch (error) {
      console.error("GET /api/staff/attendance/history error:", error);
      res.status(500).json({
        success: false,
        message: "হাজিরা হিস্টোরি লোড করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * 7. Admin: GET /api/admin/staff (list from database)
   */
  router.get("/api/admin/staff", async (req, res) => {
    try {
      const search = (req.query.search || "").trim();

      const query = {};
      if (search) {
        const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        query.$or = [
          { fullName: searchRegex },
          { name: searchRegex },
          { designation: searchRegex },
          { email: searchRegex },
          { phone: searchRegex },
          { staffId: searchRegex },
        ];
      }

      const rawStaff = await staffCollection
        .find(query)
        .sort({ createdAt: 1 })
        .toArray();

      const staffList = rawStaff.map((s, index) => {
        const idStr = s._id ? s._id.toString() : "staff-" + (index + 1);
        const fallbackStaffId = "ID NO-AIM ST-" + String(index + 1).padStart(3, "0");

        return {
          _id: idStr,
          id: idStr,
          fullName: s.fullName || s.name || "নামহীন কর্মচারী",
          nameEnglish: s.nameEnglish || "",
          designation: s.designation || "স্টাফ",
          department: s.department || "সাধারণ প্রশাসন",
          dateOfBirth: s.dateOfBirth || s.dob || "",
          phone: s.phone || s.mobile || "",
          bloodGroup: s.bloodGroup || s.blood || "",
          staffId: s.staffId || s.idNo || fallbackStaffId,
          email: s.email || "",
          nid: s.nid || "",
          emergencyContact: s.emergencyContact || "",
          employmentType: s.employmentType || "ফুল-টাইম (Full-time)",
          workShift: s.workShift || "২ টার্ম (সকাল-রাত)",
          salaryDetails: s.salaryDetails || {},
          profileImage: s.profileImage || s.image || "",
          address: s.address || "",
          addressDetails: s.addressDetails || {},
          bankAccount: s.bankAccount || {},
          joiningDate: s.joiningDate || "",
          status: s.status || "active",
          bio: s.bio || "",
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        };
      });
      res.status(200).json({
        success: true,
        data: staffList,
        total: staffList.length,
      });
    } catch (error) {
      console.error("GET /api/admin/staff error:", error);
      res.status(500).json({
        success: false,
        message: "স্টাফদের তালিকা লোড করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * 8. Admin: POST /api/admin/staff
   */
  router.post("/api/admin/staff", async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.fullName || !body.designation) {
        return res.status(400).json({
          success: false,
          message: "স্টাফের পূর্ণ নাম ও পদবি আবশ্যক।",
        });
      }

      const count = await staffCollection.countDocuments();
      const staffId =
        body.staffId || `ID NO-AIM ST-${String(count + 1).padStart(3, "0")}`;

      const newDoc = {
        fullName: body.fullName.trim(),
        nameEnglish: (body.nameEnglish || "").trim(),
        designation: body.designation.trim(),
        department: (body.department || "সাধারণ প্রশাসন").trim(),
        dateOfBirth: (body.dateOfBirth || "").trim(),
        phone: (body.phone || "").trim(),
        email: (body.email || "").trim().toLowerCase(),
        bloodGroup: (body.bloodGroup || "").trim(),
        staffId: staffId.trim(),
        nid: (body.nid || "").trim(),
        emergencyContact: (body.emergencyContact || "").trim(),
        employmentType: (body.employmentType || "ফুল-টাইম (Full-time)").trim(),
        workShift: (body.workShift || "২ টার্ম (সকাল-রাত)").trim(),
        salaryDetails: body.salaryDetails && typeof body.salaryDetails === "object" ? body.salaryDetails : {},
        address: (body.address || "").trim(),
        addressDetails: body.addressDetails && typeof body.addressDetails === "object" ? body.addressDetails : {},
        bankAccount: body.bankAccount && typeof body.bankAccount === "object" ? body.bankAccount : {},
        profileImage: (body.profileImage || "").trim(),
        bio: (body.bio || "").trim(),
        status: body.status || "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const result = await staffCollection.insertOne(newDoc);

      res.status(200).json({
        success: true,
        message: "নতুন স্টাফ সফলভাবে যুক্ত হয়েছে!",
        data: {
          _id: result.insertedId.toString(),
          id: result.insertedId.toString(),
          ...newDoc,
        },
      });
    } catch (error) {
      console.error("POST /api/admin/staff error:", error);
      res.status(500).json({
        success: false,
        message: "স্টাফ সংরক্ষণে ব্যর্থ হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * 9. Admin: PATCH /api/admin/staff
   */
  router.patch("/api/admin/staff", async (req, res) => {
    try {
      const body = req.body || {};
      const { id, _id, ...updateFields } = body;
      const targetId = id || _id;

      if (!targetId) {
        return res.status(400).json({
          success: false,
          message: "স্টাফের আইডি দেওয়া হয়নি।",
        });
      }

      let filter = {};
      if (ObjectId.isValid(targetId)) {
        filter = { _id: new ObjectId(targetId) };
      } else {
        filter = { staffId: targetId };
      }

      updateFields.updatedAt = new Date();

      const updateRes = await staffCollection.updateOne(filter, {
        $set: updateFields,
      });

      if (updateRes.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "স্টাফের রেকর্ড খুঁজে পাওয়া যায়নি।",
        });
      }

      res.status(200).json({
        success: true,
        message: "স্টাফের তথ্য সফলভাবে আপডেট হয়েছে!",
      });
    } catch (error) {
      console.error("PATCH /api/admin/staff error:", error);
      res.status(500).json({
        success: false,
        message: "স্টাফ আপডেট করতে ব্যর্থ হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * 10. Admin: DELETE /api/admin/staff
   */
  router.delete("/api/admin/staff", async (req, res) => {
    try {
      const id = req.query.id;
      if (!id) {
        return res.status(400).json({
          success: false,
          message: "আইডি দেওয়া হয়নি।",
        });
      }

      const filter = ObjectId.isValid(id)
        ? { _id: new ObjectId(id) }
        : { staffId: id };

      await staffCollection.deleteOne(filter);

      res.status(200).json({
        success: true,
        message: "স্টাফ সফলভাবে ডিলিট করা হয়েছে!",
      });
    } catch (error) {
      console.error("DELETE /api/admin/staff error:", error);
      res.status(500).json({
        success: false,
        message: "স্টাফ ডিলিট করতে ব্যর্থ হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * 11. Admin: GET /api/admin/staff-attendance
   */
  router.get("/api/admin/staff-attendance", async (req, res) => {
    try {
      const dateParam = req.query.date;
      const search = (req.query.search || "").trim().toLowerCase();
      const statusFilter = req.query.status || "all";
      const monthParam = req.query.month;

      const { dateStr: todayStr } = getDhakaTime();
      const targetDate = dateParam || todayStr;

      const staffList = await staffCollection
        .find({})
        .sort({ createdAt: 1 })
        .toArray();
      const totalStaffCount = staffList.length;

      // Monthly Summary
      if (monthParam) {
        const logs = await staffAttendanceCollection
          .find({ date: { $regex: `^${monthParam}` } })
          .toArray();

        const distinctDates = Array.from(
          new Set(logs.map((l) => l.date)),
        ).sort();
        const totalWorkingDays = distinctDates.length || 1;

        const logsByStaffId = new Map();
        logs.forEach((l) => {
          const key = l.staffId || l.staffEmail || "";
          if (!logsByStaffId.has(key)) logsByStaffId.set(key, []);
          logsByStaffId.get(key).push(l);
        });

        const summary = staffList.map((staff) => {
          const staffLogs =
            logsByStaffId.get(staff.staffId) ||
            logsByStaffId.get(staff.email) ||
            [];
          const presentDays = staffLogs.filter((l) => !!l.checkInTime).length;
          const onTimeDays = staffLogs.filter(
            (l) => l.checkInStatus === "On Time",
          ).length;
          const lateDays = staffLogs.filter(
            (l) => l.checkInStatus === "Late",
          ).length;
          const earlyExitDays = staffLogs.filter(
            (l) => l.checkOutStatus === "Early",
          ).length;
          const absentDays = Math.max(0, totalWorkingDays - presentDays);
          const attendanceRate =
            totalWorkingDays > 0
              ? Math.round((presentDays / totalWorkingDays) * 100)
              : 0;

          return {
            staffId: staff.staffId,
            fullName: staff.fullName,
            designation: staff.designation,
            phone: staff.phone,
            presentDays,
            onTimeDays,
            lateDays,
            earlyExitDays,
            absentDays,
            attendanceRate,
            lateComments: staffLogs
              .filter((l) => l.checkInComment)
              .map((l) => ({ date: l.date, comment: l.checkInComment })),
            earlyComments: staffLogs
              .filter((l) => l.checkOutComment)
              .map((l) => ({ date: l.date, comment: l.checkOutComment })),
          };
        });

        return res.status(200).json({
          success: true,
          month: monthParam,
          totalStaff: totalStaffCount,
          totalWorkingDays,
          summary,
          staffSummary: summary,
        });
      }

      // Daily Attendance
      const attendanceLogs = await staffAttendanceCollection
        .find({ date: targetDate })
        .toArray();

      const presentStaff = attendanceLogs.filter((log) => !!log.checkInTime);
      const presentCount = presentStaff.length;
      const absentCount = Math.max(0, totalStaffCount - presentCount);
      const onTimeCount = attendanceLogs.filter(
        (log) => log.checkInStatus === "On Time",
      ).length;
      const lateCount = attendanceLogs.filter(
        (log) => log.checkInStatus === "Late",
      ).length;

      const attendanceMap = new Map();
      attendanceLogs.forEach((log) => {
        if (log.staffId) attendanceMap.set(log.staffId, log);
        if (log.staffEmail)
          attendanceMap.set(log.staffEmail.toLowerCase(), log);
      });

      const unifiedList = staffList.map((staff) => {
        const attendance =
          attendanceMap.get(staff.staffId) ||
          (staff.email ? attendanceMap.get(staff.email.toLowerCase()) : null);

        return {
          staffId: staff.staffId,
          _id: staff._id.toString(),
          fullName: staff.fullName,
          designation: staff.designation,
          phone: staff.phone,
          email: staff.email,
          profileImage: staff.profileImage,
          date: targetDate,
          hasCheckedIn: !!attendance?.checkInTime,
          checkInTime: attendance?.checkInTime || null,
          checkInStatus: attendance?.checkInStatus || "Absent",
          checkInComment: attendance?.checkInComment || null,
          hasCheckedOut: !!attendance?.checkOutTime,
          checkOutTime: attendance?.checkOutTime || null,
          checkOutStatus: attendance?.checkOutStatus || null,
          checkOutComment: attendance?.checkOutComment || null,
          checkInLocation: attendance?.checkInLocation || null,
          checkOutLocation: attendance?.checkOutLocation || null,
        };
      });

      let filteredList = unifiedList;
      if (search) {
        filteredList = filteredList.filter(
          (s) =>
            s.fullName.toLowerCase().includes(search) ||
            s.designation.toLowerCase().includes(search) ||
            (s.email && s.email.toLowerCase().includes(search)) ||
            s.staffId.toLowerCase().includes(search),
        );
      }

      if (statusFilter === "present") {
        filteredList = filteredList.filter((s) => s.hasCheckedIn);
      } else if (statusFilter === "absent") {
        filteredList = filteredList.filter((s) => !s.hasCheckedIn);
      } else if (statusFilter === "onTime") {
        filteredList = filteredList.filter(
          (s) => s.checkInStatus === "On Time",
        );
      } else if (statusFilter === "late") {
        filteredList = filteredList.filter((s) => s.checkInStatus === "Late");
      }

      res.status(200).json({
        success: true,
        date: targetDate,
        isToday: targetDate === todayStr,
        metrics: {
          totalStaff: totalStaffCount,
          presentToday: presentCount,
          absentToday: absentCount,
          onTimeToday: onTimeCount,
          lateToday: lateCount,
        },
        attendanceList: filteredList,
      });
    } catch (error) {
      console.error("GET /api/admin/staff-attendance error:", error);
      res.status(500).json({
        success: false,
        message: "স্টাফ হাজিরা তথ্য লোড করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * 12. Admin: POST /api/admin/staff-attendance
   */
  router.post("/api/admin/staff-attendance", async (req, res) => {
    try {
      const body = req.body || {};
      const {
        staffId,
        date,
        checkInStatus,
        checkInComment,
        checkOutStatus,
        checkOutComment,
      } = body;

      if (!staffId) {
        return res.status(400).json({
          success: false,
          message: "স্টাফ আইডি দেওয়া হয়নি।",
        });
      }

      const { dateStr: todayStr } = getDhakaTime();
      const targetDate = date || todayStr;
      const now = new Date();

      const existing = await staffAttendanceCollection.findOne({
        staffId,
        date: targetDate,
      });

      if (existing) {
        const updateDoc = {
          updatedAt: now,
        };
        if (checkInStatus) updateDoc.checkInStatus = checkInStatus;
        if (checkInComment !== undefined)
          updateDoc.checkInComment = checkInComment;
        if (checkOutStatus) {
          updateDoc.checkOutStatus = checkOutStatus;
          if (!existing.checkOutTime) {
            updateDoc.checkOutTime = now.toISOString();
          }
        } else if (checkOutStatus === "") {
          updateDoc.checkOutStatus = null;
          updateDoc.checkOutTime = null;
        }
        if (checkOutComment !== undefined)
          updateDoc.checkOutComment = checkOutComment;

        await staffAttendanceCollection.updateOne(
          { _id: existing._id },
          { $set: updateDoc },
        );
      } else {
        const hasOutStatus = Boolean(checkOutStatus);
        const newDoc = {
          staffId,
          staffName: body.staffName || "",
          staffEmail: body.staffEmail || "",
          date: targetDate,
          checkInTime: now.toISOString(),
          checkInStatus: checkInStatus || evaluateStaffCheckInStatus(now),
          checkInComment: checkInComment || null,
          checkOutTime: hasOutStatus ? now.toISOString() : null,
          checkOutStatus: hasOutStatus ? checkOutStatus : null,
          checkOutComment: checkOutComment || null,
          createdAt: now,
          updatedAt: now,
        };

        await staffAttendanceCollection.insertOne(newDoc);
      }

      res.status(200).json({
        success: true,
        message: "স্টাফ হাজিরা সফলভাবে সংরক্ষিত হয়েছে!",
      });
    } catch (error) {
      console.error("POST /api/admin/staff-attendance error:", error);
      res.status(500).json({
        success: false,
        message: "স্টাফ হাজিরা সংরক্ষণ ব্যর্থ হয়েছে।",
        error: error.message,
      });
    }
  });

  return router;
}

module.exports = staffRoutes;
