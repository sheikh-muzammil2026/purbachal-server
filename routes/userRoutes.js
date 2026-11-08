const express = require("express");
const { ObjectId } = require("mongodb");
const crypto = require("node:crypto");
const {
  sendPasswordChangedNotification,
  sendEmailVerificationEmail,
} = require("../mailer");

function userRoutes(collections, helpers) {
  const router = express.Router();
  const { usersCollection, accountsCollection, verificationTokensCollection } =
    collections;
  const { hashUserPassword, verifyUserPassword, getClientBaseUrl } = helpers;

  /**
   * ১. প্রোফাইল ইনফো আপডেট API (নাম ও ছবি)
   * Endpoint: PUT /api/user/profile
   */
  router.put("/api/user/profile", async (req, res) => {
    try {
      const { userId, email, name, image } = req.body;

      if (!userId && !email) {
        return res.status(400).json({
          success: false,
          message: "ইউজার আইডি অথবা ইমেইল আবশ্যক।",
        });
      }

      const query = {};
      if (userId) {
        query._id = ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
      } else if (email) {
        query.email = {
          $regex: new RegExp(`^${String(email).trim()}$`, "i"),
        };
      }

      const user = await usersCollection.findOne(query);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "ব্যবহারকারী খুঁজে পাওয়া যায়নি।",
        });
      }

      const updateFields = { updatedAt: new Date() };
      if (name !== undefined) updateFields.name = String(name).trim();
      if (image !== undefined) updateFields.image = String(image).trim();

      await usersCollection.updateOne(
        { _id: user._id },
        { $set: updateFields },
      );

      const updatedUser = await usersCollection.findOne({ _id: user._id });

      res.json({
        success: true,
        message: "প্রোফাইল সফলভাবে আপডেট করা হয়েছে।",
        user: {
          id: updatedUser._id,
          name: updatedUser.name,
          email: updatedUser.email,
          image: updatedUser.image,
          role: updatedUser.role,
          permissions: Array.isArray(updatedUser.permissions)
            ? updatedUser.permissions
            : [],
          isBanned: Boolean(
            updatedUser.isBanned || updatedUser.status === "banned",
          ),
          status:
            updatedUser.isBanned || updatedUser.status === "banned"
              ? "banned"
              : "active",
        },
      });
    } catch (error) {
      console.error("Profile update error:", error);
      res.status(500).json({
        success: false,
        message: "প্রোফাইল আপডেট করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * ২. সরাসরি পাসওয়ার্ড পরিবর্তন API (লগইন করা অবস্থায়)
   * Endpoint: POST /api/user/change-password
   */
  router.post("/api/user/change-password", async (req, res) => {
    try {
      const { userId, email, currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: "বর্তমান ও নতুন পাসওয়ার্ড উভয়ই প্রদান করতে হবে।",
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: "নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।",
        });
      }

      let user = null;
      if (userId) {
        user = await usersCollection.findOne({
          _id: ObjectId.isValid(userId) ? new ObjectId(userId) : userId,
        });
      } else if (email) {
        user = await usersCollection.findOne({
          email: { $regex: new RegExp(`^${String(email).trim()}$`, "i") },
        });
      }

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "ব্যবহারকারী খুঁজে পাওয়া যায়নি।",
        });
      }

      // অ্যাকাউন্ট কালেকশন থেকে ক্রিডেনশিয়ালস যাচাই
      const account = await accountsCollection.findOne({
        $or: [
          { userId: user._id, providerId: "credential" },
          { userId: String(user._id), providerId: "credential" },
        ],
      });

      if (!account || !account.password) {
        return res.status(400).json({
          success: false,
          message:
            "এই অ্যাকাউন্টে কোনো পাসওয়ার্ড সেট করা নেই অথবা সামাজিক মাধ্যমে লগইন করা।",
        });
      }

      const isCurrentValid = await verifyUserPassword(
        account.password,
        currentPassword,
      );
      if (!isCurrentValid) {
        return res.status(400).json({
          success: false,
          message: "বর্তমান পাসওয়ার্ডটি সঠিক নয়।",
        });
      }

      const newHashedPassword = await hashUserPassword(newPassword);

      await accountsCollection.updateOne(
        { _id: account._id },
        {
          $set: {
            password: newHashedPassword,
            updatedAt: new Date(),
          },
        },
      );

      // সুরক্ষার জন্য নোটিফিকেশন ইমেইল প্রেরণ
      sendPasswordChangedNotification({
        to: user.email,
        name: user.name,
      }).catch((e) => console.error("Notification email error:", e));

      res.json({
        success: true,
        message: "পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে।",
      });
    } catch (error) {
      console.error("Change password error:", error);
      res.status(500).json({
        success: false,
        message: "পাসওয়ার্ড পরিবর্তন করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * ৩. ইমেইল পরিবর্তনের ভেরিফিকেশন লিংক পাঠানোর API
   * Endpoint: POST /api/user/request-email-update
   */
  router.post("/api/user/request-email-update", async (req, res) => {
    try {
      const { userId, email, newEmail } = req.body;

      if (!newEmail || !String(newEmail).includes("@")) {
        return res.status(400).json({
          success: false,
          message: "একটি বৈধ নতুন ইমেইল ঠিকানা প্রদান করুন।",
        });
      }

      const cleanNewEmail = String(newEmail).trim().toLowerCase();

      let user = null;
      if (userId) {
        user = await usersCollection.findOne({
          _id: ObjectId.isValid(userId) ? new ObjectId(userId) : userId,
        });
      } else if (email) {
        user = await usersCollection.findOne({
          email: { $regex: new RegExp(`^${String(email).trim()}$`, "i") },
        });
      }

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "ব্যবহারকারী খুঁজে পাওয়া যায়নি।",
        });
      }

      if (user.email && user.email.toLowerCase() === cleanNewEmail) {
        return res.status(400).json({
          success: false,
          message: "প্রদত্ত ইমেইলটি আপনার বর্তমান ইমেইলের অনুরূপ।",
        });
      }

      // নতুন ইমেইলটি অন্য কারো দ্বারা ব্যবহৃত কিনা পরীক্ষা
      const existingWithEmail = await usersCollection.findOne({
        email: { $regex: new RegExp(`^${cleanNewEmail}$`, "i") },
        _id: { $ne: user._id },
      });

      if (existingWithEmail) {
        return res.status(400).json({
          success: false,
          message: "এই ইমেইলটি ইতোমধ্যে অন্য একটি অ্যাকাউন্টে ব্যবহৃত হচ্ছে।",
        });
      }

      // সুরক্ষিত টোকেন তৈরি (মেয়াদ ১ ঘণ্টা)
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await verificationTokensCollection.deleteMany({
        userId: user._id,
        type: "email_update",
      });

      await verificationTokensCollection.insertOne({
        token,
        userId: user._id,
        type: "email_update",
        currentEmail: user.email,
        newEmail: cleanNewEmail,
        expiresAt,
        createdAt: new Date(),
      });

      const baseUrl = getClientBaseUrl(req);
      const verifyUrl = `${baseUrl}/verify-update?token=${token}&type=email`;

      await sendEmailVerificationEmail({
        to: cleanNewEmail,
        name: user.name,
        verifyUrl,
      });

      res.json({
        success: true,
        message:
          "নতুন ইমেইলে একটি নিশ্চিতকরণ লিংক পাঠানো হয়েছে। অনুগ্রহ করে ইনবক্স চেক করে লিংকটিতে ক্লিক করুন।",
        verifyUrl:
          process.env.NODE_ENV === "development" ? verifyUrl : undefined,
      });
    } catch (error) {
      console.error("Request email update error:", error);
      res.status(500).json({
        success: false,
        message: "ইমেইল ভেরিফিকেশন লিংক পাঠাতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * ৪. ইমেইল বা পরিবর্তন ভেরিফিকেশন API
   * Endpoint: POST /api/user/verify-update
   */
  router.post("/api/user/verify-update", async (req, res) => {
    try {
      const { token, type = "email" } = req.body;

      if (!token) {
        return res.status(400).json({
          success: false,
          message: "ভেরিফিকেশন টোকেন প্রদান করা হয়নি।",
        });
      }

      const tokenType = type === "email" ? "email_update" : type;
      const tokenDoc = await verificationTokensCollection.findOne({
        token,
        type: tokenType,
      });

      if (!tokenDoc) {
        return res.status(400).json({
          success: false,
          message: "ভেরিফিকেশন লিংকটি অবৈধ বা ইতিমধ্যে ব্যবহৃত হয়েছে।",
        });
      }

      if (new Date() > new Date(tokenDoc.expiresAt)) {
        await verificationTokensCollection.deleteOne({ _id: tokenDoc._id });
        return res.status(400).json({
          success: false,
          message:
            "ভেরিফিকেশন লিংকের মেয়াদ শেষ হয়ে গেছে। নতুন অনুরোধ করুন।",
        });
      }

      if (tokenDoc.type === "email_update" && tokenDoc.newEmail) {
        const newEmail = tokenDoc.newEmail.toLowerCase().trim();

        // ইউজার কালেকশনে ইমেইল আপডেট
        await usersCollection.updateOne(
          { _id: tokenDoc.userId },
          { $set: { email: newEmail, updatedAt: new Date() } },
        );

        // অ্যাকাউন্ট কালেকশনেও ইমেইল/অ্যাকাউন্ট আইডি আপডেট (যদি credential থাকে)
        await accountsCollection.updateOne(
          {
            $or: [
              { userId: tokenDoc.userId, providerId: "credential" },
              { userId: String(tokenDoc.userId), providerId: "credential" },
            ],
          },
          { $set: { updatedAt: new Date() } },
        );

        // টোকেন মুছে ফেলা
        await verificationTokensCollection.deleteOne({ _id: tokenDoc._id });

        return res.json({
          success: true,
          message:
            "ইমেইল ঠিকানা সফলভাবে পরিবর্তিত হয়েছে! এখন নতুন ইমেইল দিয়ে লগইন করতে পারেন।",
          newEmail,
        });
      }

      res.status(400).json({
        success: false,
        message: "অপরিচিত ভেরিফিকেশন অনুরোধ।",
      });
    } catch (error) {
      console.error("Verify update error:", error);
      res.status(500).json({
        success: false,
        message: "ভেরিফিকেশন সম্পন্ন করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  /**
   * ৬. বর্তমান লগইনকৃত ইউজার তথ্য (GET /api/user/me)
   */
  router.get("/api/user/me", async (req, res) => {
    try {
      const email =
        req.headers["x-user-email"] ||
        req.query.email ||
        req.query.userEmail;
      const userId = req.headers["x-user-id"] || req.query.userId;

      if (!email && !userId) {
        return res.status(400).json({
          success: false,
          message: "ইমেইল বা ইউজার আইডি প্রদান করুন।",
        });
      }

      const query = {};
      if (userId) {
        query._id = ObjectId.isValid(userId) ? new ObjectId(userId) : userId;
      } else if (email) {
        query.email = {
          $regex: new RegExp(`^${String(email).trim()}$`, "i"),
        };
      }

      const user = await usersCollection.findOne(query);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "ব্যবহারকারী খুঁজে পাওয়া যায়নি।",
        });
      }

      res.status(200).json({
        success: true,
        user: {
          id: user._id.toString(),
          _id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          permissions: Array.isArray(user.permissions) ? user.permissions : [],
          isBanned: Boolean(user.isBanned || user.status === "banned"),
          status:
            user.isBanned || user.status === "banned" ? "banned" : "active",
          image: user.image || "",
          phone: user.phone || "",
          createdAt: user.createdAt,
        },
      });
    } catch (error) {
      console.error("Fetch current user error:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভারে ইউজার লোড করতে সমস্যা হয়েছে।",
        error: error.message,
      });
    }
  });

  return router;
}

module.exports = userRoutes;
