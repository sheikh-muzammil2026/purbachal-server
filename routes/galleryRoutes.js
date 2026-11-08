const express = require("express");
const { ObjectId } = require("mongodb");

function galleryRoutes(collections) {
  const router = express.Router();
  const { galleryCollection } = collections;

  /**
   * গ্যালারিতে ছবি/ভিডিও আপলোড করার API
   * Endpoint: POST /api/gallery
   */
  router.post("/api/gallery", async (req, res) => {
    try {
      const newItem = req.body;
      newItem.createdAt = new Date();

      const result = await galleryCollection.insertOne(newItem);
      res.status(201).json({
        success: true,
        message: "আইটেমটি গ্যালারিতে সফলভাবে যোগ করা হয়েছে!",
        insertedId: result.insertedId,
      });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, message: "সার্ভারে সমস্যা হয়েছে।" });
    }
  });

  /**
   * গ্যালারির সকল ছবি ও ভিডিও পাওয়ার API
   * Endpoint: GET /api/gallery
   */
  router.get("/api/gallery", async (req, res) => {
    try {
      const items = await galleryCollection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
      const photos = items.filter((item) => item.type === "photo");
      const videos = items.filter((item) => item.type === "video");

      res.json({ success: true, photos, videos });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, message: "ডাটা আনা সম্ভব হয়নি।" });
    }
  });

  /**
   * গ্যালারি থেকে আইটেম মুছে ফেলার API
   * Endpoint: DELETE /api/gallery/:id
   */
  router.delete("/api/gallery/:id", async (req, res) => {
    try {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res
          .status(400)
          .json({ success: false, message: "অকার্যকর আইডি ফর্ম্যাট।" });
      }

      const result = await galleryCollection.deleteOne({
        _id: new ObjectId(id),
      });

      if (result.deletedCount === 1) {
        res.json({
          success: true,
          message: "মিডিয়াটি সফলভাবে মুছে ফেলা হয়েছে।",
        });
      } else {
        res
          .status(404)
          .json({ success: false, message: "আইটেমটি খুঁজে পাওয়া যায়নি।" });
      }
    } catch (error) {
      res
        .status(500)
        .json({ success: false, message: "সার্ভারে সমস্যা হয়েছে।" });
    }
  });

  return router;
}

module.exports = galleryRoutes;
