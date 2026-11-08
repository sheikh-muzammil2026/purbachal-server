const administrationHandler = require("../administration");

/**
 * Administration Module Routes (User & Role Management) Wrapper
 */
function administrationRoutes(app, database) {
  return administrationHandler(app, database);
}

module.exports = administrationRoutes;
