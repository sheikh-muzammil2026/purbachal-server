const parentHandler = require("../parent");

/**
 * Parent Portal & Attendance Module Routes Wrapper
 */
function parentRoutes(app, database) {
  return parentHandler(app, database);
}

module.exports = parentRoutes;
