const { ObjectId } = require("mongodb");

const getIdFilter = (id) => {
  const strId = String(id);
  if (ObjectId.isValid(id)) {
    try {
      return { $or: [{ _id: new ObjectId(id) }, { _id: strId }, { id: strId }] };
    } catch {
      return { $or: [{ _id: strId }, { id: strId }] };
    }
  }
  return { $or: [{ _id: strId }, { id: strId }] };
};

const getTargetCollection = async (db) => {
  const userCount = await db.collection("user").countDocuments().catch(() => 0);
  if (userCount > 0) return db.collection("user");
  const usersCount = await db.collection("users").countDocuments().catch(() => 0);
  return usersCount > 0 ? db.collection("users") : db.collection("user");
};

const resolveUserAndCol = async (db, id) => {
  const filter = getIdFilter(id);
  let user = await db.collection("user").findOne(filter).catch(() => null);
  if (user) return { col: db.collection("user"), user, filter };
  user = await db.collection("users").findOne(filter).catch(() => null);
  if (user) return { col: db.collection("users"), user, filter };
  const col = await getTargetCollection(db);
  return { col, user: null, filter };
};

function administrationRoutes(app, db) {
  // 1. GET /api/admin/users - Fetch users with pagination and search filters
  app.get("/api/admin/users", async (req, res) => {
    try {
      const { page = 1, limit = 10, search = "", role = "all", status = "all" } = req.query;
      const col = await getTargetCollection(db);

      const query = {};
      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        query.$or = [{ name: regex }, { email: regex }, { phone: regex }];
      }

      if (role && role !== "all") {
        query.role = { $regex: new RegExp(`^${role.trim()}$`, "i") };
      }

      if (status && status !== "all") {
        if (status === "banned") {
          query.$or = [{ isBanned: true }, { status: "banned" }];
        } else if (status === "active") {
          query.$and = [
            { isBanned: { $ne: true } },
            { status: { $ne: "banned" } },
          ];
        }
      }

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
      const skip = (pageNum - 1) * limitNum;

      const [rawUsers, total] = await Promise.all([
        col.find(query).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limitNum).toArray(),
        col.countDocuments(query),
      ]);

      const users = rawUsers.map((u) => ({
        id: String(u._id),
        _id: String(u._id),
        name: u.name || "N/A",
        email: u.email || "",
        role: u.role || "student",
        isBanned: Boolean(u.isBanned || u.status === "banned"),
        status: u.isBanned || u.status === "banned" ? "banned" : "active",
        permissions: Array.isArray(u.permissions) ? u.permissions : [],
        image: u.image || "",
        createdAt: u.createdAt || null,
        updatedAt: u.updatedAt || null,
      }));

      res.json({
        success: true,
        users,
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum) || 1,
        limit: limitNum,
      });
    } catch (error) {
      console.error("Fetch admin users error:", error);
      res.status(500).json({ success: false, message: "Failed to fetch users", error: error.message });
    }
  });

  // 2. PATCH /api/admin/users/:id/role - Update primary role
  app.patch("/api/admin/users/:id/role", async (req, res) => {
    try {
      const { id } = req.params;
      const { role } = req.body;

      if (!role || typeof role !== "string") {
        return res.status(400).json({ success: false, message: "Valid role is required" });
      }

      const cleanRole = role.trim().toLowerCase();
      const { col, user, filter } = await resolveUserAndCol(db, id);

      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      await col.updateOne(filter, {
        $set: {
          role: cleanRole,
          updatedAt: new Date(),
        },
      });

      res.json({
        success: true,
        message: `Role updated to '${cleanRole}' successfully`,
        role: cleanRole,
      });
    } catch (error) {
      console.error("Update user role error:", error);
      res.status(500).json({ success: false, message: "Failed to update role", error: error.message });
    }
  });

  // 3. PATCH /api/admin/users/:id/permissions - Update permissions array
  app.patch("/api/admin/users/:id/permissions", async (req, res) => {
    try {
      const { id } = req.params;
      const { permissions } = req.body;

      if (!Array.isArray(permissions)) {
        return res.status(400).json({ success: false, message: "Permissions must be an array" });
      }

      const cleanPermissions = [...new Set(permissions.map((p) => String(p).trim()).filter(Boolean))];
      const { col, user, filter } = await resolveUserAndCol(db, id);

      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      await col.updateOne(filter, {
        $set: {
          permissions: cleanPermissions,
          updatedAt: new Date(),
        },
      });

      res.json({
        success: true,
        message: "Permissions updated successfully",
        permissions: cleanPermissions,
      });
    } catch (error) {
      console.error("Update permissions error:", error);
      res.status(500).json({ success: false, message: "Failed to update permissions", error: error.message });
    }
  });

  // 4. PATCH /api/admin/users/:id/status - Toggle account status (banned/active)
  app.patch("/api/admin/users/:id/status", async (req, res) => {
    try {
      const { id } = req.params;
      const { isBanned, status } = req.body;

      const isBanState = isBanned !== undefined ? Boolean(isBanned) : status === "banned";
      const statusValue = isBanState ? "banned" : "active";

      const { col, user, filter } = await resolveUserAndCol(db, id);

      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      await col.updateOne(filter, {
        $set: {
          isBanned: isBanState,
          status: statusValue,
          updatedAt: new Date(),
        },
      });

      res.json({
        success: true,
        message: `Account status updated to '${statusValue}' successfully`,
        isBanned: isBanState,
        status: statusValue,
      });
    } catch (error) {
      console.error("Update user status error:", error);
      res.status(500).json({ success: false, message: "Failed to update user status", error: error.message });
    }
  });

  // 5. DELETE /api/admin/users/:id - Permanent removal
  app.delete("/api/admin/users/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { col, user, filter } = await resolveUserAndCol(db, id);

      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      await col.deleteOne(filter);

      res.json({
        success: true,
        message: "User permanently removed successfully",
      });
    } catch (error) {
      console.error("Delete user error:", error);
      res.status(500).json({ success: false, message: "Failed to delete user", error: error.message });
    }
  });
}

module.exports = administrationRoutes;
