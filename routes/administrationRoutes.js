const administrationHandler = require("../administration");

/**
 * Administration Module Routes (User & Role Management) Wrapper
 */
function administrationRoutes(app, database, authHelpers) {
  return administrationHandler(app, database, authHelpers);
}

module.exports = administrationRoutes;
