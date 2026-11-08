const { isOriginAllowed } = require("../config/corsOptions");

/**
 * Global Error Handling Middleware
 */
const errorHandler = (err, req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  if (err && err.message === "Not allowed by CORS") {
    return res.status(403).json({
      success: false,
      message: "CORS Error: Origin not allowed",
    });
  }
  console.error("Unhandled Server Error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: "Internal Server Error",
    error: err ? err.message : "Unknown error",
  });
};

/**
 * 404 Route Not Found Handler
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: `API Route not found: ${req.method} ${req.originalUrl}`,
  });
};

module.exports = {
  errorHandler,
  notFoundHandler,
};
