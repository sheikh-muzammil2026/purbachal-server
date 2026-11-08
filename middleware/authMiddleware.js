const { isAdminUser } = require("../utils/authHelpers");

/**
 * Middleware factory to require Admin role
 */
const requireAdmin = (getAuthUser) => {
  return async (req, res, next) => {
    try {
      const user = await getAuthUser(req);
      if (!isAdminUser(user)) {
        return res.status(403).json({
          success: false,
          message:
            "অননুমোদিত অনুরোধ। শুধুমাত্র অ্যাডমিন এই কাজটি সম্পন্ন করতে পারেন।",
        });
      }
      req.authUser = user;
      next();
    } catch (err) {
      res.status(500).json({
        success: false,
        message: "অথেনটিকেশন যাচাইয়ে সমস্যা হয়েছে।",
        error: err.message,
      });
    }
  };
};

module.exports = {
  requireAdmin,
};
