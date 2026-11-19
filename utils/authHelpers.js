const crypto = require("node:crypto");
const { ObjectId } = require("mongodb");

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseCookies = (cookieHeader) => {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== "string") return cookies;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) cookies[key] = val;
  }
  return cookies;
};

const extractSessionToken = (req) => {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const bearerToken = authHeader.slice(7).trim();
    if (bearerToken) return bearerToken;
  }

  const headerToken = req.headers?.["x-session-token"];
  if (typeof headerToken === "string" && headerToken.trim()) {
    return headerToken.trim();
  }

  const cookies = parseCookies(req.headers?.cookie);
  const rawCookieToken =
    cookies["__Secure-better-auth.session_token"] ||
    cookies["better-auth.session_token"];
  if (rawCookieToken) {
    try {
      const decoded = decodeURIComponent(rawCookieToken);
      const tokenPart = decoded.split(".")[0]?.trim();
      if (tokenPart) return tokenPart;
    } catch (_) {
      const tokenPart = rawCookieToken.split(".")[0]?.trim();
      if (tokenPart) return tokenPart;
    }
  }

  return null;
};

const verifySignedEmailHeader = (req) => {
  const email = req.headers?.["x-user-email"];
  const signature = req.headers?.["x-auth-signature"];
  const timestamp = req.headers?.["x-auth-timestamp"];
  const secret =
    process.env.BETTER_AUTH_SECRET || process.env.AUTH_INTERNAL_SECRET;

  if (!email || !signature || !timestamp || !secret) {
    return null;
  }

  const parsedTs = Number(timestamp);
  if (!Number.isFinite(parsedTs)) return null;

  // Reject replayed requests outside a 5-minute window
  if (Math.abs(Date.now() - parsedTs) > 5 * 60 * 1000) {
    return null;
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(`${cleanEmail}:${timestamp}`)
    .digest("hex");

  const sigBuf = Buffer.from(String(signature), "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return null;
  }

  return cleanEmail;
};

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
  const { usersCollection, teachersCollection, sessionsCollection } =
    collections;

  const findUserById = async (userId) => {
    if (!userId) return null;
    const strId = String(userId);
    const filters = [{ _id: userId }, { _id: strId }, { id: strId }];
    if (typeof userId === "string" && ObjectId.isValid(userId)) {
      try {
        filters.push({ _id: new ObjectId(userId) });
      } catch (_) {}
    }
    return usersCollection.findOne({ $or: filters });
  };

  const getAuthUser = async (req) => {
    // ১. Better-Auth সেশন টোকেন যাচাই (Authorization Bearer, x-session-token, বা সেশন কুকি)
    const sessionToken = extractSessionToken(req);
    if (sessionToken) {
      if (!sessionsCollection) {
        return null;
      }

      const session = await sessionsCollection.findOne({ token: sessionToken });
      if (!session) {
        return null;
      }

      if (session.expiresAt && new Date(session.expiresAt) <= new Date()) {
        return null;
      }

      const user = await findUserById(session.userId);
      if (!user || user.isBanned || user.status === "banned") {
        return null;
      }

      return {
        id: user._id || user.id,
        email: user.email,
        name: user.name,
        role: (user.role || "").toLowerCase(),
        permissions: Array.isArray(user.permissions) ? user.permissions : [],
        verified: true,
      };
    }

    // ২. শুধুমাত্র HMAC-স্বাক্ষরিত ইন্টারনাল হেডার গ্রহণ (অযাচাইকৃত x-user-email / x-user-role প্রত্যাখ্যান)
    const verifiedEmail = verifySignedEmailHeader(req);
    if (!verifiedEmail) {
      return null;
    }

    const emailRegex = new RegExp(`^${escapeRegex(verifiedEmail)}$`, "i");
    const user = await usersCollection.findOne({ email: { $regex: emailRegex } });

    if (user) {
      if (user.isBanned || user.status === "banned") {
        return null;
      }
      return {
        id: user._id || user.id,
        email: user.email,
        name: user.name,
        role: (user.role || "").toLowerCase(),
        permissions: Array.isArray(user.permissions) ? user.permissions : [],
        verified: true,
      };
    }

    const teacher = await teachersCollection.findOne({
      email: { $regex: emailRegex },
    });

    if (teacher) {
      return {
        id: teacher._id,
        email: teacher.email,
        name: teacher.name || teacher.teacherName,
        role: (teacher.role || "teacher").toLowerCase(),
        permissions: [],
        verified: true,
      };
    }

    return null;
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
