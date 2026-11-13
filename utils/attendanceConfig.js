// Fixed Geofence Configuration for Madrasa premises
// As-Salam Ideal Madrasah (AIM) Purbachal Campus
const MADRASA_LOCATION = {
  LATITUDE: parseFloat(process.env.MADRASA_LAT || "23.860061"),
  LONGITUDE: parseFloat(process.env.MADRASA_LNG || "90.546755"),
  RADIUS_METERS: parseFloat(process.env.MADRASA_RADIUS || "15"),
  MAX_ALLOWED_ACCURACY_METERS: 500,
  ACCURACY_TOLERANCE_METERS: 50,
  NAME: "আস সালাম আইডিয়াল মাদরাসা (এইম) পুর্বাচল ক্যাম্পাস",
  ADDRESS: "কাজিরবাগ (পুর্বাচল সংলগ্ন), রূপগঞ্জ, নারায়ণগঞ্জ।",
};

// Attendance Schedule & Rules (Teachers)
// Office Hours: Morning 8:00 AM to 1:10 PM (13:10)
const ATTENDANCE_RULES = {
  OFFICE_START_HOUR: 8,
  OFFICE_START_MINUTE: 0,
  ON_TIME_CHECKIN_CUTOFF_HOUR: 8,
  ON_TIME_CHECKIN_CUTOFF_MINUTE: 5, // <= 8:05 AM is 'On Time', > 8:05 AM is 'Late'
  OFFICE_END_HOUR: 13,
  OFFICE_END_MINUTE: 10, // >= 1:10 PM is 'On Time' departure, < 1:10 PM is 'Early'
};

// Staff Attendance Schedule & Rules (2 Terms Per Day)
// Term 1 (Morning Check-in): Last time is 5:30 AM
// Term 2 (Night Check-out): Window is 10:00 PM to 10:10 PM (22:00 to 22:10)
const STAFF_ATTENDANCE_RULES = {
  // টার্ম ১: সকালের হাজিরা / চেক-ইন (সর্বশেষ সময় ভোর ৫:৩০)
  TERM_1_TITLE: "১ম টার্ম (সকালের প্রবেশ হাজিরা)",
  TERM_1_CUTOFF_HOUR: 5,
  TERM_1_CUTOFF_MINUTE: 30, // <= 05:30 AM 'On Time', > 05:30 AM 'Late'
  TERM_1_CUTOFF_LABEL: "ভোর ০৫:৩০ টা",

  // টার্ম ২: রাতের হাজিরা / চেক-আউট (রাত ১০:০০ থেকে ১০:১০)
  TERM_2_TITLE: "২য় টার্ম (রাতের প্রস্থান হাজিরা)",
  TERM_2_START_HOUR: 22,
  TERM_2_START_MINUTE: 0,
  TERM_2_END_HOUR: 22,
  TERM_2_END_MINUTE: 10,
  TERM_2_WINDOW_LABEL: "রাত ১০:০০ টা - ১০:১০ টা",
};

/**
 * Calculates distance between two GPS coordinates using the Haversine formula
 */
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  if (
    typeof lat1 !== "number" ||
    typeof lon1 !== "number" ||
    typeof lat2 !== "number" ||
    typeof lon2 !== "number" ||
    isNaN(lat1) ||
    isNaN(lon1) ||
    isNaN(lat2) ||
    isNaN(lon2)
  ) {
    return Infinity;
  }

  const R = 6371e3; // Earth's mean radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;

  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(lon2 - lon1);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) *
      Math.cos(phi2) *
      Math.sin(deltaLambda / 2) *
      Math.sin(deltaLambda / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Validates whether user coordinates are within the madrasa geofence radius
 */
function isWithinMadrasaGeofence(
  userLat,
  userLng,
  customRadius = MADRASA_LOCATION.RADIUS_METERS,
  accuracy = 0,
) {
  const latNum = Number(userLat);
  const lngNum = Number(userLng);

  if (
    !Number.isFinite(latNum) ||
    !Number.isFinite(lngNum) ||
    latNum < -90 ||
    latNum > 90 ||
    lngNum < -180 ||
    lngNum > 180 ||
    (latNum === 0 && lngNum === 0)
  ) {
    return {
      isInside: false,
      isValidCoords: false,
      distance: Infinity,
      threshold: customRadius,
      accuracy: Number(accuracy) || 0,
      reason: "INVALID_COORDINATES",
    };
  }

  const accNum =
    Number.isFinite(Number(accuracy)) && Number(accuracy) > 0
      ? Math.round(Number(accuracy))
      : 0;
  const distance = calculateDistanceMeters(
    latNum,
    lngNum,
    MADRASA_LOCATION.LATITUDE,
    MADRASA_LOCATION.LONGITUDE,
  );

  // Allow minor GPS jitter up to ACCURACY_TOLERANCE_METERS (50m) if accuracy is reported
  const tolerance = Math.min(
    accNum,
    MADRASA_LOCATION.ACCURACY_TOLERANCE_METERS || 50,
  );
  const effectiveThreshold = customRadius + tolerance;

  return {
    isInside: distance <= effectiveThreshold,
    isValidCoords: true,
    distance: Math.round(distance),
    threshold: customRadius,
    effectiveThreshold: Math.round(effectiveThreshold),
    accuracy: accNum,
  };
}

/**
 * Extract time parts in Asia/Dhaka timezone (UTC+6)
 */
function getDhakaTime(date = new Date()) {
  const dateObj = date instanceof Date ? date : new Date(date);

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(dateObj);
  const map = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  const year = map.year;
  const month = map.month;
  const day = map.day;
  const hour = parseInt(map.hour, 10);
  const minute = parseInt(map.minute, 10);
  const second = parseInt(map.second, 10);

  const dateStr = `${year}-${month}-${day}`;
  const minutesSinceMidnight = hour * 60 + minute;

  return {
    dateStr,
    hour,
    minute,
    second,
    minutesSinceMidnight,
    formattedTime: `${hour.toString().padStart(2, "0")}:${minute
      .toString()
      .padStart(2, "0")}:${second.toString().padStart(2, "0")}`,
  };
}

/**
 * Evaluates arrival check-in status (Teacher)
 */
function evaluateCheckInStatus(date = new Date()) {
  const { minutesSinceMidnight } = getDhakaTime(date);
  const cutoffMinutes =
    ATTENDANCE_RULES.ON_TIME_CHECKIN_CUTOFF_HOUR * 60 +
    ATTENDANCE_RULES.ON_TIME_CHECKIN_CUTOFF_MINUTE;

  return minutesSinceMidnight <= cutoffMinutes ? "On Time" : "Late";
}

/**
 * Evaluates departure check-out status (Teacher)
 */
function evaluateCheckOutStatus(date = new Date()) {
  const { minutesSinceMidnight } = getDhakaTime(date);
  const cutoffMinutes =
    ATTENDANCE_RULES.OFFICE_END_HOUR * 60 + ATTENDANCE_RULES.OFFICE_END_MINUTE;

  return minutesSinceMidnight >= cutoffMinutes ? "On Time" : "Early";
}

/**
 * Evaluates Staff Term 1 Check-In (Morning):
 * Last time is 5:30 AM (05:30)
 */
function evaluateStaffCheckInStatus(date = new Date()) {
  const { minutesSinceMidnight } = getDhakaTime(date);
  const cutoffMinutes =
    STAFF_ATTENDANCE_RULES.TERM_1_CUTOFF_HOUR * 60 +
    STAFF_ATTENDANCE_RULES.TERM_1_CUTOFF_MINUTE; // 330 (05:30 AM)

  return minutesSinceMidnight <= cutoffMinutes ? "On Time" : "Late";
}

/**
 * Evaluates Staff Term 2 Check-Out (Night):
 * Official window is 10:00 PM to 10:10 PM (22:00 to 22:10)
 */
function evaluateStaffCheckOutStatus(date = new Date()) {
  const { minutesSinceMidnight } = getDhakaTime(date);
  const startWindowMinutes =
    STAFF_ATTENDANCE_RULES.TERM_2_START_HOUR * 60 +
    STAFF_ATTENDANCE_RULES.TERM_2_START_MINUTE; // 1320 (10:00 PM)
  const endWindowMinutes =
    STAFF_ATTENDANCE_RULES.TERM_2_END_HOUR * 60 +
    STAFF_ATTENDANCE_RULES.TERM_2_END_MINUTE; // 1330 (10:10 PM)

  if (minutesSinceMidnight < startWindowMinutes) {
    return "Early";
  }
  if (minutesSinceMidnight <= endWindowMinutes) {
    return "On Time";
  }
  return "Overtime";
}

/**
 * Returns current phase information for Staff 2-term attendance
 */
function getStaffShiftPhase(date = new Date()) {
  const { minutesSinceMidnight, formattedTime } = getDhakaTime(date);
  const t1Cutoff =
    STAFF_ATTENDANCE_RULES.TERM_1_CUTOFF_HOUR * 60 +
    STAFF_ATTENDANCE_RULES.TERM_1_CUTOFF_MINUTE;
  const t2Start =
    STAFF_ATTENDANCE_RULES.TERM_2_START_HOUR * 60 +
    STAFF_ATTENDANCE_RULES.TERM_2_START_MINUTE;
  const t2End =
    STAFF_ATTENDANCE_RULES.TERM_2_END_HOUR * 60 +
    STAFF_ATTENDANCE_RULES.TERM_2_END_MINUTE;

  return {
    currentTime: formattedTime,
    isTerm1OnTime: minutesSinceMidnight <= t1Cutoff,
    isTerm2Open:
      minutesSinceMidnight >= t2Start && minutesSinceMidnight <= t2End,
    isTerm2Early: minutesSinceMidnight < t2Start,
    isTerm2Overtime: minutesSinceMidnight > t2End,
    term1CutoffTime: "05:30 AM",
    term2Window: "10:00 PM - 10:10 PM",
  };
}

// Residential Teachers (আবাসিক শিক্ষক) Attendance Rules - 3 Shifts
const RESIDENTIAL_ATTENDANCE_RULES = {
  shift1: {
    id: "shift1",
    name: "১ম শিফট (সকাল)",
    nameEnglish: "Morning Shift",
    checkInStartHour: 4,
    checkInStartMinute: 0,
    checkInCutoffHour: 5,
    checkInCutoffMinute: 30, // Cutoff 5:30 AM (Late after 5:30 AM)
    checkInWindowLabel: "ভোর ০৪:০০ টা – ০৫:৩০ টা",
    checkOutStartHour: 7,
    checkOutStartMinute: 0,
    checkOutEndHour: 7,
    checkOutEndMinute: 10, // Early before 7:00 AM
    checkOutWindowLabel: "সকাল ০৭:০০ টা – ০৭:১০ টা",
  },
  shift2: {
    id: "shift2",
    name: "২য় শিফট (ক্লাস)",
    nameEnglish: "Class Shift",
    checkInStartHour: 7,
    checkInStartMinute: 15,
    checkInCutoffHour: 8,
    checkInCutoffMinute: 5, // Cutoff 8:05 AM (Late after 8:05 AM)
    checkInWindowLabel: "সকাল ০৮:০৫ এর পূর্বে",
    checkOutStartHour: 13,
    checkOutStartMinute: 10,
    checkOutEndHour: 13,
    checkOutEndMinute: 30, // Early before 1:10 PM
    checkOutWindowLabel: "দুপুর ০১:১০ টা",
  },
  shift3: {
    id: "shift3",
    name: "৩য় শিফট (রাত/সন্ধ্যা)",
    nameEnglish: "Night Shift",
    checkInStartHour: 18,
    checkInStartMinute: 10,
    checkInCutoffHour: 18,
    checkInCutoffMinute: 20, // Cutoff 6:20 PM (Late after 6:20 PM)
    checkInWindowLabel: "সন্ধ্যা ০৬:১০ টা – ০৬:২০ টা",
    checkOutStartHour: 22,
    checkOutStartMinute: 0,
    checkOutEndHour: 22,
    checkOutEndMinute: 10, // Early before 10:00 PM
    checkOutWindowLabel: "রাত ১০:০০ টা – ১০:১০ টা",
  },
};

// Hifz Teachers (হিফজ শিক্ষক) Attendance Rules - 3 Shifts
const HIFZ_ATTENDANCE_RULES = {
  shift1: {
    id: "shift1",
    name: "১ম শিফট (সকাল)",
    nameEnglish: "Morning Shift",
    checkInStartHour: 4,
    checkInStartMinute: 0,
    checkInCutoffHour: 5,
    checkInCutoffMinute: 30, // Cutoff 5:30 AM (Late after 5:30 AM)
    checkInWindowLabel: "ভোর ০৪:০০ টা – ০৫:৩০ টা",
    checkOutStartHour: 9,
    checkOutStartMinute: 10,
    checkOutEndHour: 9,
    checkOutEndMinute: 30, // Early before 9:10 AM
    checkOutWindowLabel: "সকাল ০৯:১০ টা – ০৯:৩০ টা",
  },
  shift2: {
    id: "shift2",
    name: "২য় শিফট (দুপুর)",
    nameEnglish: "Noon Shift",
    checkInStartHour: 12,
    checkInStartMinute: 0,
    checkInCutoffHour: 14,
    checkInCutoffMinute: 20, // Cutoff 2:20 PM (Late after 2:20 PM)
    checkInWindowLabel: "দুপুর ১২:০০ টা – ০২:২০ টা",
    checkOutStartHour: 16,
    checkOutStartMinute: 10,
    checkOutEndHour: 16,
    checkOutEndMinute: 20, // Early before 4:10 PM
    checkOutWindowLabel: "বিকাল ০৪:১০ টা – ০৪:২০ টা",
  },
  shift3: {
    id: "shift3",
    name: "৩য় শিফট (রাত/সন্ধ্যা)",
    nameEnglish: "Night Shift",
    checkInStartHour: 18,
    checkInStartMinute: 10,
    checkInCutoffHour: 18,
    checkInCutoffMinute: 20, // Cutoff 6:20 PM (Late after 6:20 PM)
    checkInWindowLabel: "সন্ধ্যা ০৬:১০ টা – ০৬:২০ টা",
    checkOutStartHour: 22,
    checkOutStartMinute: 0,
    checkOutEndHour: 22,
    checkOutEndMinute: 10, // Early before 10:00 PM
    checkOutWindowLabel: "রাত ১০:০০ টা – ১০:১০ টা",
  },
};

/**
 * Categorizes a teacher designation into 'regular', 'residential', or 'hifz'
 * @param {string} designation
 * @returns {'regular'|'residential'|'hifz'}
 */
function getTeacherCategory(designation = "") {
  const norm = String(designation || "").trim();
  if (
    norm.includes("হিফজ") ||
    norm.includes("হিফয") ||
    norm.includes("হিফ্জ") ||
    /hifz|hifdh/i.test(norm)
  ) {
    return "hifz";
  }
  // Check 'অনাবাসিক' before 'আবাসিক' because 'অনাবাসিক' contains 'আবাসিক'
  if (norm.includes("অনাবাসিক") || /non-residential/i.test(norm)) {
    return "regular";
  }
  if (norm.includes("আবাসিক") || /residential/i.test(norm)) {
    return "residential";
  }
  return "regular";
}

/**
 * Returns shift rules dictionary for the category or null if regular
 * @param {'regular'|'residential'|'hifz'} category
 */
function getTeacherShiftRules(category) {
  if (category === "residential") return RESIDENTIAL_ATTENDANCE_RULES;
  if (category === "hifz") return HIFZ_ATTENDANCE_RULES;
  return null;
}

/**
 * Evaluates shift check-in status
 * @param {'regular'|'residential'|'hifz'} category
 * @param {string} shiftId ('shift1'|'shift2'|'shift3')
 * @param {Date|string|number} date
 */
function evaluateTeacherShiftCheckIn(
  category,
  shiftId = "shift1",
  date = new Date(),
) {
  const { minutesSinceMidnight } = getDhakaTime(date);

  if (category === "regular" || !category) {
    const isLate =
      minutesSinceMidnight >
      ATTENDANCE_RULES.ON_TIME_CHECKIN_CUTOFF_HOUR * 60 +
        ATTENDANCE_RULES.ON_TIME_CHECKIN_CUTOFF_MINUTE;
    return {
      status: isLate ? "Late" : "On Time",
      isLate,
      cutoffMinutes: 485,
    };
  }

  const rulesMap = getTeacherShiftRules(category);
  const shiftRule = rulesMap ? rulesMap[shiftId] : null;

  if (!shiftRule) {
    return { status: "On Time", isLate: false };
  }

  const cutoff =
    shiftRule.checkInCutoffHour * 60 + shiftRule.checkInCutoffMinute;
  const isLate = minutesSinceMidnight > cutoff;

  return {
    status: isLate ? "Late" : "On Time",
    isLate,
    cutoffMinutes: cutoff,
    shift: shiftRule,
  };
}

/**
 * Evaluates shift check-out status
 * @param {'regular'|'residential'|'hifz'} category
 * @param {string} shiftId ('shift1'|'shift2'|'shift3')
 * @param {Date|string|number} date
 */
function evaluateTeacherShiftCheckOut(
  category,
  shiftId = "shift1",
  date = new Date(),
) {
  const { minutesSinceMidnight } = getDhakaTime(date);

  if (category === "regular" || !category) {
    const isEarly =
      minutesSinceMidnight <
      ATTENDANCE_RULES.OFFICE_END_HOUR * 60 +
        ATTENDANCE_RULES.OFFICE_END_MINUTE;
    return {
      status: isEarly ? "Early" : "On Time",
      isEarly,
      startOutMinutes: 790,
    };
  }

  const rulesMap = getTeacherShiftRules(category);
  const shiftRule = rulesMap ? rulesMap[shiftId] : null;

  if (!shiftRule) {
    return { status: "On Time", isEarly: false };
  }

  const startOut =
    shiftRule.checkOutStartHour * 60 + shiftRule.checkOutStartMinute;
  const isEarly = minutesSinceMidnight < startOut;

  return {
    status: isEarly ? "Early" : "On Time",
    isEarly,
    startOutMinutes: startOut,
    shift: shiftRule,
  };
}

/**
 * Determines current active shift based on time of day
 * @param {'regular'|'residential'|'hifz'} category
 * @param {Date|string|number} date
 */
function getActiveTeacherShift(category, date = new Date()) {
  if (category === "regular" || !category) {
    return null;
  }
  const { minutesSinceMidnight } = getDhakaTime(date);

  if (category === "residential") {
    // shift1 check-out is 07:10 (430m). Up to 450m (07:30 AM), consider shift1.
    if (minutesSinceMidnight < 450) return "shift1";
    // shift2 check-out is 13:10 (790m). Up to 900m (15:00 / 03:00 PM), consider shift2.
    if (minutesSinceMidnight < 900) return "shift2";
    // Remaining is shift3 (evening/night).
    return "shift3";
  }

  if (category === "hifz") {
    // shift1 check-out is 09:30 (570m). Up to 630m (10:30 AM), consider shift1.
    if (minutesSinceMidnight < 630) return "shift1";
    // shift2 check-out is 16:20 (980m). Up to 1020m (17:00 / 05:00 PM), consider shift2.
    if (minutesSinceMidnight < 1020) return "shift2";
    // Remaining is shift3.
    return "shift3";
  }

  return "shift1";
}

module.exports = {
  MADRASA_LOCATION,
  ATTENDANCE_RULES,
  STAFF_ATTENDANCE_RULES,
  RESIDENTIAL_ATTENDANCE_RULES,
  HIFZ_ATTENDANCE_RULES,
  calculateDistanceMeters,
  isWithinMadrasaGeofence,
  getDhakaTime,
  evaluateCheckInStatus,
  evaluateCheckOutStatus,
  evaluateStaffCheckInStatus,
  evaluateStaffCheckOutStatus,
  getStaffShiftPhase,
  getTeacherCategory,
  getTeacherShiftRules,
  evaluateTeacherShiftCheckIn,
  evaluateTeacherShiftCheckOut,
  getActiveTeacherShift,
};
