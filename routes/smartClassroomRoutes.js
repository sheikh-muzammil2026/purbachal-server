/**
 * Smart Classroom Routes Wrapper
 */
function smartClassroomRoutes(app, database) {
  try {
    const handler = require("../smart-classroom");
    return handler(app, database);
  } catch (err) {
    if (err.code !== "MODULE_NOT_FOUND") {
      console.error("Smart Classroom routes error:", err);
    }
  }
}

module.exports = smartClassroomRoutes;
