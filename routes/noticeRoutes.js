const noticesRoutes = require("../notices");

/**
 * Notice & Ticker Routes Wrapper
 */
function noticeRoutes(app, database) {
  return noticesRoutes(app, database);
}

module.exports = noticeRoutes;
