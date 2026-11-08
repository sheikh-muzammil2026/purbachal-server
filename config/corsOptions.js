const allowedOrigins = [
  "https://aimpurbachal.com",
  "https://www.aimpurbachal.com",
  "https://api.aimpurbachal.com",
  "https://aimhabiganj.vercel.app",
"https://aim-server.vercel.app",
];

const isOriginAllowed = (origin) => {
  if (!origin) return true;
  const cleanOrigin = origin.replace(/\/$/, "");
  return (
    allowedOrigins.includes(cleanOrigin) ||
    cleanOrigin.endsWith(".aimpurbachal.com") ||
    cleanOrigin.endsWith(".aimhabiganj.com") ||
    cleanOrigin.endsWith(".vercel.app")
  );
};

const corsOptions = {
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps, curl, postman)
    if (!origin) {
      return callback(null, true);
    }
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true, // Authorization header / cookies পাঠানোর জন্য
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "x-user-email",
    "x-user-role",
    "Accept",
    "Origin",
    "Cache-Control",
    "Pragma",
    "X-CSRF-Token",
  ],
  optionsSuccessStatus: 204,
};

// Explicit preflight handler for any route
const handlePreflight = (req, res, next) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.origin;
    if (origin && isOriginAllowed(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Requested-With, x-user-email, x-user-role, Accept, Origin, Cache-Control, Pragma, X-CSRF-Token"
      );
    }
    return res.sendStatus(204);
  }
  next();
};

module.exports = {
  allowedOrigins,
  isOriginAllowed,
  corsOptions,
  handlePreflight,
};
