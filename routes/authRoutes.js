const express = require("express");
const crypto = require("node:crypto");
const {
  sendPasswordResetEmail,
  sendPasswordChangedNotification,
} = require("../mailer");

function authRoutes(collections, helpers) {
  const router = express.Router();
  const { usersCollection, accountsCollection, verificationTokensCollection } =
    collections;
  const { hashUserPassword, getClientBaseUrl } = helpers;

  /**
   * ৫. পাসওয়ার্ড ভুলে গেছেন? রিসেট রিকোয়েস্ট API
   * Endpoint: POST /api/auth/forgot-password
   */
  router.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;

      if (!email || !String(email).includes("@")) {
        return res.status(400).json({
          success: false,
          message: "একটি বৈধ নিবন্ধিত ইমেইল ঠিকানা প্রদান করুন।",
        });
      }

      const cleanEmail = String(email).trim().toLowerCase();
      const user = await usersCollection.findOne({
        email: { $regex: new RegExp(`^${cleanEmail}$`, "i") },
      });

      // সুরক্ষার খাতিরে ইউজার না থাকলেও জেনেরিক রেসপন্স দেওয়া ভালো
      if (!user) {
        return res.json({
          success: true,
          message:
            "যদি এই ইমেইলটি আমাদের সিস্টেমে নিবন্ধিত থাকে, তবে একটি পাসওয়ার্ড রিসেট লিংক পাঠানো হয়েছে।",
        });
      }

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await verificationTokensCollection.deleteMany({
        userId: user._id,
        type: "password_reset",
      });

      await verificationTokensCollection.insertOne({
        token,
        userId: user._id,
        type: "password_reset",
        email: user.email,
        expiresAt,
        createdAt: new Date(),
      });

      const baseUrl = getClientBaseUrl(req);
      const resetUrl = `${baseUrl}/reset-password?token=${token}`;

      await sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetUrl,
      });

      res.json({
        success: true,
        message:
          "আপনার ইমেইলে একটি পাসওয়ার্ড রিসেট লিংক পাঠানো হয়েছে। অনুগ্রহ করে ইনবক্স চেক করুন।",
        resetUrl:
          process.env.NODE_ENV === "development" ? resetUrl : undefined,
      });
    } catch (error) {
      console.error("Forgot password API error:", error);
      res.status(500).json({
        success: false,
        message: "পাসওয়ার্ড রিসেট লিংক পাঠাতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * ৬. নতুন পাসওয়ার্ড নির্ধারণ (রিসেট এক্সিকিউশন) API
   * Endpoint: POST /api/auth/reset-password
   */
  router.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        return res.status(400).json({
          success: false,
          message: "টোকেন এবং নতুন পাসওয়ার্ড উভয়ই আবশ্যক।",
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: "নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।",
        });
      }

      const tokenDoc = await verificationTokensCollection.findOne({
        token,
        type: "password_reset",
      });

      if (!tokenDoc) {
        return res.status(400).json({
          success: false,
          message:
            "পাসওয়ার্ড রিসেট লিংকটি অবৈধ অথবা ইতোমধ্যে ব্যবহৃত হয়েছে।",
        });
      }

      if (new Date() > new Date(tokenDoc.expiresAt)) {
        await verificationTokensCollection.deleteOne({ _id: tokenDoc._id });
        return res.status(400).json({
          success: false,
          message:
            "পাসওয়ার্ড রিসেট লিংকের মেয়াদ শেষ হয়ে গেছে। পুনরায় অনুরোধ করুন।",
        });
      }

      const hashedPassword = await hashUserPassword(newPassword);

      // অ্যাকাউন্ট কালেকশনে পাসওয়ার্ড আপডেট
      const updateResult = await accountsCollection.updateOne(
        {
          $or: [
            { userId: tokenDoc.userId, providerId: "credential" },
            { userId: String(tokenDoc.userId), providerId: "credential" },
          ],
        },
        {
          $set: {
            password: hashedPassword,
            updatedAt: new Date(),
          },
        },
      );

      // যদি অ্যাকাউন্ট কালেকশনে এখনও কোনো রেকর্ড না থাকে, তবে নতুন ক্রেডেনশিয়াল অ্যাকাউন্ট তৈরি করা
      if (updateResult.matchedCount === 0) {
        await accountsCollection.insertOne({
          userId: tokenDoc.userId,
          accountId: String(tokenDoc.userId),
          providerId: "credential",
          password: hashedPassword,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // ব্যবহৃত টোকেন মুছে ফেলা
      await verificationTokensCollection.deleteOne({ _id: tokenDoc._id });

      // ইউজারকে সতর্কবার্তা নোটিফিকেশন প্রেরণ
      const user = await usersCollection.findOne({ _id: tokenDoc.userId });
      if (user) {
        sendPasswordChangedNotification({
          to: user.email,
          name: user.name,
        }).catch((e) => console.error("Notification email error:", e));
      }

      res.json({
        success: true,
        message:
          "পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে! এখন নতুন পাসওয়ার্ড দিয়ে লগইন করুন।",
      });
    } catch (error) {
      console.error("Reset password API error:", error);
      res.status(500).json({
        success: false,
        message: "পাসওয়ার্ড রিসেট করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  return router;
}

module.exports = authRoutes;
