const crypto = require("node:crypto");

// শিক্ষাবর্ষ / সেশন স্যানিটাইজেশন হেল্পার (একক বছর নিশ্চিত করতে)
const sanitizeYear = (yearStr, fallback = "") => {
  const val = yearStr || fallback;
  return (val || "").split(/[-–/]/)[0].trim();
};

// অ্যাডমিন রোল যাচাই হেল্পার
const isAdminUser = (user) => {
  return (
    user &&
    (user.role === "admin" ||
      user.role === "superadmin" ||
      user.role === "administrator")
  );
};

// পাসওয়ার্ড হ্যাশিং কনফিগারেশন (Better-Auth Compatible scrypt)
const scryptConfig = {
  N: 16384,
  r: 16,
  p: 1,
  dkLen: 64,
};

function generateScryptKey(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password.normalize("NFKC"),
      salt,
      scryptConfig.dkLen,
      {
        N: scryptConfig.N,
        r: scryptConfig.r,
        p: scryptConfig.p,
        maxmem: 128 * scryptConfig.N * scryptConfig.r * 2,
      },
      (err, key) => {
        if (err) reject(err);
        else resolve(key);
      },
    );
  });
}

async function hashUserPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await generateScryptKey(password, salt);
  return `${salt}:${key.toString("hex")}`;
}

async function verifyUserPassword(hash, password) {
  if (!hash || typeof hash !== "string") return false;
  const [salt, key] = hash.split(":");
  if (!salt || !key) return false;
  const targetKey = await generateScryptKey(password, salt);
  return targetKey.toString("hex") === key;
}

const getClientBaseUrl = (req) => {
  const origin = req.headers.origin || req.headers.referer;
  if (origin) {
    try {
      const parsed = new URL(origin);
      return `${parsed.protocol}//${parsed.host}`;
    } catch (_) {}
  }
  return (
    process.env.CLIENT_BASE_URL ||
    process.env.NEXT_PUBLIC_BASE_URI ||
    "http://localhost:3000"
  );
};

// অথেনটিকেশন ও আরবেক (RBAC) হেল্পার ফাংশন ফ্যাক্টরি
function createAuthHelpers(collections) {
  const { usersCollection, teachersCollection } = collections;

  const getAuthUser = async (req) => {
    const email =
      req.headers["x-user-email"] ||
      req.body?.teacherEmail ||
      req.body?.teacher ||
      req.query?.userEmail;

    if (!email) {
      return null;
    }

    const cleanEmail = String(email).trim().toLowerCase();

    // Better-auth user কালেকশন থেকে রোল যাচাই
    const user = await usersCollection.findOne({
      email: { $regex: new RegExp(`^${cleanEmail}$`, "i") },
    });

    if (user) {
      return {
        id: user._id || user.id,
        email: user.email,
        name: user.name,
        role: (user.role || "").toLowerCase(),
        permissions: Array.isArray(user.permissions) ? user.permissions : [],
      };
    }

    // টিচার কালেকশনে খোঁজ করা
    const teacher = await teachersCollection.findOne({
      email: { $regex: new RegExp(`^${cleanEmail}$`, "i") },
    });

    if (teacher) {
      return {
        id: teacher._id,
        email: teacher.email,
        name: teacher.name || teacher.teacherName,
        role: (teacher.role || "teacher").toLowerCase(),
      };
    }

    // ডাটাবেজে ইউজার না থাকলে হেডার বা বডির রোল ফলব্যাক
    const fallbackRole = (
      req.headers["x-user-role"] ||
      req.body?.userRole ||
      "user"
    ).toLowerCase();

    return {
      email: cleanEmail,
      role: fallbackRole,
    };
  };

  return {
    getAuthUser,
    isAdminUser,
    sanitizeYear,
    hashUserPassword,
    verifyUserPassword,
    getClientBaseUrl,
  };
}

module.exports = {
  sanitizeYear,
  isAdminUser,
  hashUserPassword,
  verifyUserPassword,
  getClientBaseUrl,
  createAuthHelpers,
};
