const { ObjectId } = require("mongodb");

const getIdFilter = (id) => {
  if (ObjectId.isValid(id)) {
    try {
      return { $or: [{ _id: new ObjectId(id) }, { _id: String(id) }] };
    } catch {
      return { _id: String(id) };
    }
  }
  return { _id: String(id) };
};

function noticesRoutes(app, db) {
  const noticesCollection = db.collection("notices");

  // 1. GET /api/notices - List all notices with filters & pagination
  app.get("/api/notices", async (req, res) => {
    try {
      const {
        search = "",
        category = "all",
        status = "all",
        page = 1,
        limit = 50,
      } = req.query;

      const query = {};

      if (search && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        query.$or = [{ title: regex }, { description: regex }];
      }

      if (category && category !== "all") {
        query.category = { $regex: new RegExp(`^${category.trim()}$`, "i") };
      }

      if (status === "active") {
        query.isActive = { $ne: false };
      } else if (status === "inactive") {
        query.isActive = false;
      }

      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.max(1, parseInt(limit) || 50);
      const skip = (pageNum - 1) * limitNum;

      const total = await noticesCollection.countDocuments(query);
      const notices = await noticesCollection
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .toArray();

      res.json({
        success: true,
        notices,
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      });
    } catch (error) {
      console.error("GET /api/notices error:", error);
      res.status(500).json({
        success: false,
        message: "নোটিশ লোড করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  // 2. GET /api/notices/ticker - Fetch notices configured for the public ticker
  app.get("/api/notices/ticker", async (req, res) => {
    try {
      // Find notices marked for ticker and active
      let tickerNotices = await noticesCollection
        .find({ isActive: { $ne: false }, showInTicker: true })
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(5)
        .toArray();

      // If no specific ticker notice set, fallback to the latest active notice
      if (!tickerNotices || tickerNotices.length === 0) {
        tickerNotices = await noticesCollection
          .find({ isActive: { $ne: false } })
          .sort({ createdAt: -1 })
          .limit(1)
          .toArray();
      }

      res.json({
        success: true,
        tickerNotices,
        latestNotice: tickerNotices[0] || null,
      });
    } catch (error) {
      console.error("GET /api/notices/ticker error:", error);
      res.status(500).json({
        success: false,
        message: "টিকার নোটিশ লোড করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  // 3. GET /api/notices/:id - Get single notice
  app.get("/api/notices/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const notice = await noticesCollection.findOne(getIdFilter(id));
      if (!notice) {
        return res
          .status(404)
          .json({ success: false, message: "নোটিশটি পাওয়া যায়নি।" });
      }
      res.json({ success: true, notice });
    } catch (error) {
      console.error("GET /api/notices/:id error:", error);
      res.status(500).json({
        success: false,
        message: "নোটিশ লোড করতে ব্যর্থ হয়েছে।",
        error: error.message,
      });
    }
  });

  // 4. POST /api/notices - Create new notice
  app.post("/api/notices", async (req, res) => {
    try {
      const {
        title,
        description = "",
        category = "general",
        showInTicker = false,
        isActive = true,
        publishDate = new Date(),
        expiryDate = null,
        attachmentUrl = "",
        createdBy = "Admin",
      } = req.body;

      if (!title || !title.trim()) {
        return res
          .status(400)
          .json({ success: false, message: "নোটিশের শিরোনাম আবশ্যক।" });
      }

      const newNotice = {
        title: title.trim(),
        description: description.trim(),
        category: category.trim().toLowerCase(),
        priority: priority.trim().toLowerCase(),
        showInTicker: Boolean(showInTicker),
        isActive: isActive !== false,
        publishDate: publishDate ? new Date(publishDate) : new Date(),
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        attachmentUrl: (attachmentUrl || "").trim(),
        createdBy: createdBy || "Admin",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await noticesCollection.insertOne(newNotice);
      res.status(201).json({
        success: true,
        message: "নোটিশ সফলভাবে তৈরি করা হয়েছে!",
        insertedId: result.insertedId,
        notice: { ...newNotice, _id: result.insertedId },
      });
    } catch (error) {
      console.error("POST /api/notices error:", error);
      res.status(500).json({
        success: false,
        message: "নোটিশ সংরক্ষণ করতে ব্যর্থ হয়েছে।",
        error: error.message,
      });
    }
  });

  // 5. PUT /api/notices/:id - Update notice
  app.put("/api/notices/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const {
        title,
        description,
        category,
        priority,
        showInTicker,
        isActive,
        publishDate,
        expiryDate,
        attachmentUrl,
      } = req.body;

      const updateFields = {
        updatedAt: new Date(),
      };

      if (title !== undefined) updateFields.title = title.trim();
      if (description !== undefined)
        updateFields.description = description.trim();
      if (category !== undefined)
        updateFields.category = category.trim().toLowerCase();
      if (priority !== undefined)
        updateFields.priority = priority.trim().toLowerCase();
      if (showInTicker !== undefined)
        updateFields.showInTicker = Boolean(showInTicker);
      if (isActive !== undefined) updateFields.isActive = Boolean(isActive);
      if (publishDate !== undefined)
        updateFields.publishDate = publishDate
          ? new Date(publishDate)
          : new Date();
      if (expiryDate !== undefined)
        updateFields.expiryDate = expiryDate ? new Date(expiryDate) : null;
      if (attachmentUrl !== undefined)
        updateFields.attachmentUrl = (attachmentUrl || "").trim();

      const result = await noticesCollection.updateOne(getIdFilter(id), {
        $set: updateFields,
      });

      if (result.matchedCount === 0) {
        return res
          .status(404)
          .json({ success: false, message: "নোটিশটি পাওয়া যায়নি।" });
      }

      res.json({
        success: true,
        message: "নোটিশ সফলভাবে আপডেট করা হয়েছে!",
      });
    } catch (error) {
      console.error("PUT /api/notices/:id error:", error);
      res.status(500).json({
        success: false,
        message: "নোটিশ আপডেট করতে ব্যর্থ হয়েছে।",
        error: error.message,
      });
    }
  });

  // 6. PATCH /api/notices/:id/ticker - Toggle ticker status
  app.patch("/api/notices/:id/ticker", async (req, res) => {
    try {
      const { id } = req.params;
      const { showInTicker } = req.body;

      const filter = getIdFilter(id);
      const current = await noticesCollection.findOne(filter);
      if (!current) {
        return res
          .status(404)
          .json({ success: false, message: "নোটিশটি পাওয়া যায়নি।" });
      }

      const nextStatus =
        typeof showInTicker === "boolean"
          ? showInTicker
          : !current.showInTicker;

      await noticesCollection.updateOne(filter, {
        $set: {
          showInTicker: nextStatus,
          updatedAt: new Date(),
        },
      });

      res.json({
        success: true,
        message: nextStatus
          ? "নোটিশটি টিকারে যুক্ত করা হয়েছে!"
          : "নোটিশটি টিকার থেকে সরিয়ে নেওয়া হয়েছে।",
        showInTicker: nextStatus,
      });
    } catch (error) {
      console.error("PATCH /api/notices/:id/ticker error:", error);
      res.status(500).json({
        success: false,
        message: "টিকার স্ট্যাটাস পরিবর্তন করতে ব্যর্থ হয়েছে।",
        error: error.message,
      });
    }
  });

  // 7. PATCH /api/notices/:id/status - Toggle active/inactive status
  app.patch("/api/notices/:id/status", async (req, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      const filter = getIdFilter(id);
      const current = await noticesCollection.findOne(filter);
      if (!current) {
        return res
          .status(404)
          .json({ success: false, message: "নোটিশটি পাওয়া যায়নি।" });
      }

      const nextStatus =
        typeof isActive === "boolean" ? isActive : !current.isActive;

      await noticesCollection.updateOne(filter, {
        $set: {
          isActive: nextStatus,
          updatedAt: new Date(),
        },
      });

      res.json({
        success: true,
        message: nextStatus
          ? "নোটিশটি সক্রিয় করা হয়েছে!"
          : "নোটিশটি নিষ্ক্রিয় করা হয়েছে।",
        isActive: nextStatus,
      });
    } catch (error) {
      console.error("PATCH /api/notices/:id/status error:", error);
      res.status(500).json({
        success: false,
        message: "স্ট্যাটাস পরিবর্তন করতে ব্যর্থ হয়েছে।",
        error: error.message,
      });
    }
  });

  // 8. DELETE /api/notices/:id - Delete notice
  app.delete("/api/notices/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const result = await noticesCollection.deleteOne(getIdFilter(id));
      if (result.deletedCount === 0) {
        return res
          .status(404)
          .json({ success: false, message: "নোটিশটি পাওয়া যায়নি।" });
      }

      res.json({
        success: true,
        message: "নোটিশ সফলভাবে মুছে ফেলা হয়েছে!",
      });
    } catch (error) {
      console.error("DELETE /api/notices/:id error:", error);
      res.status(500).json({
        success: false,
        message: "নোটিশ মুছে ফেলতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });
}

module.exports = noticesRoutes;
