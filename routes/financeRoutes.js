const express = require("express");
const { ObjectId } = require("mongodb");

function financeRoutes(collections) {
  const router = express.Router();
  const {
    fundsCollection,
    financeIncomesCollection,
    financeExpensesCollection,
    financeCategoriesCollection,
    studentsCollection,
  } = collections;

  // প্রাথমিক ফান্ড ও প্রারম্ভিক ব্যালেন্স কনফিগারেশন (কার্যকরী তারিখ: ২০২৬-১০-০১)
  const INITIAL_FUNDS = [
    {
      fundKey: "general_fund",
      name: "As-Salam Ideal Madrasah",
      nameBn: "জেনারেল ব্যাংক হিসাব-১৫",
      accountNumber: "19071310000015",
      openingBalance: 25069.02,
      openingDate: "2026-10-01",
      openingMonth: "2026-10",
      isActive: true,
      isDefault: true,
    },
    {
      fundKey: "future_fund",
      name: "As-Salam Ideal Madrasah(Future Fund)",
      nameBn: "ফিউচার ফান্ড ব্যাংক হিসাব-৬৭৩",
      accountNumber: "19071213000673",
      openingBalance: 38220.52,
      openingDate: "2026-10-01",
      openingMonth: "2026-10",
      isActive: true,
      isDefault: false,
    },
    {
      fundKey: "donation_fund",
      name: "As-Salam Ideal Madrasah(Donation Fund)",
      nameBn: "ডোনেশন ফান্ড ব্যাংক হিসাব-৬৭৪",
      accountNumber: "19071210000674",
      openingBalance: 202892.51,
      openingDate: "2026-10-01",
      openingMonth: "2026-10",
      isActive: true,
      isDefault: false,
    },
    {
      fundKey: "zakath_fund",
      name: "As-Salam Ideal Madrasah(Zakath Fund)",
      nameBn: "যাকাত ফান্ড ব্যাংক হিসাব-৬৭৫",
      accountNumber: "19071210000675",
      openingBalance: 9371.1,
      openingDate: "2026-10-01",
      openingMonth: "2026-10",
      isActive: true,
      isDefault: false,
    },
    {
      fundKey: "yeatim_fund",
      name: "As-Salam Ideal Madrasah(Yeatim Fund)",
      nameBn: "এয়াতিম ফান্ড ব্যাংক হিসাব-৮০৪",
      accountNumber: "19071210000804",
      openingBalance: 169479.47,
      openingDate: "2026-10-01",
      openingMonth: "2026-10",
      isActive: true,
      isDefault: false,
    },
  ];

  const DEFAULT_ACCOUNT_NUMBER = "19071310000015";

  // ২ দশমিক স্থান পর্যন্ত নির্ভুলভাবে রাউন্ডিং হেল্পার (IEEE-754 ফ্লোটিং পয়েন্ট ত্রুটি রোধে)
  const round2 = (val) =>
    Math.round(((Number(val) || 0) + Number.EPSILON) * 100) / 100;

  // খাত বা অ্যাকাউন্ট নম্বর থেকে ফান্ড অ্যাট্রিবিউশন নির্ধারণ হেল্পার
  const resolveFundAttribution = (explicitAccountNumber, items = []) => {
    const cleanAcc = explicitAccountNumber
      ? String(explicitAccountNumber).trim()
      : "";
    if (cleanAcc) {
      const matched = INITIAL_FUNDS.find((f) => f.accountNumber === cleanAcc);
      if (matched) {
        return {
          accountNumber: matched.accountNumber,
          fundKey: matched.fundKey,
          fundName: matched.name,
          fundNameBn: matched.nameBn,
        };
      }
    }

    // খাতের নাম (head) থেকে স্বয়ংক্রিয় ফান্ড ডিটেকশন (যদি explicitAccountNumber না থাকে)
    if (Array.isArray(items)) {
      for (const item of items) {
        const head = String(item?.head || "");
        if (
          head.includes("৮০৪") ||
          head.includes("804") ||
          head.includes("এয়াতিম") ||
          head.includes("ইয়াতিম") ||
          head.includes("অরফান")
        ) {
          const f = INITIAL_FUNDS.find(
            (x) => x.accountNumber === "19071210000804",
          );
          return {
            accountNumber: f.accountNumber,
            fundKey: f.fundKey,
            fundName: f.name,
            fundNameBn: f.nameBn,
          };
        }
        if (
          head.includes("৬৭৫") ||
          head.includes("675") ||
          head.includes("যাকাত")
        ) {
          const f = INITIAL_FUNDS.find(
            (x) => x.accountNumber === "19071210000675",
          );
          return {
            accountNumber: f.accountNumber,
            fundKey: f.fundKey,
            fundName: f.name,
            fundNameBn: f.nameBn,
          };
        }
        if (
          head.includes("৬৭৪") ||
          head.includes("674") ||
          head.includes("ডোনেশন") ||
          head.includes("সাদাকাহ")
        ) {
          const f = INITIAL_FUNDS.find(
            (x) => x.accountNumber === "19071210000674",
          );
          return {
            accountNumber: f.accountNumber,
            fundKey: f.fundKey,
            fundName: f.name,
            fundNameBn: f.nameBn,
          };
        }
        if (
          head.includes("৬৭৩") ||
          head.includes("673") ||
          head.includes("ফিউচার")
        ) {
          const f = INITIAL_FUNDS.find(
            (x) => x.accountNumber === "19071213000673",
          );
          return {
            accountNumber: f.accountNumber,
            fundKey: f.fundKey,
            fundName: f.name,
            fundNameBn: f.nameBn,
          };
        }
      }
    }

    const defaultFund = INITIAL_FUNDS[0];
    return {
      accountNumber: defaultFund.accountNumber,
      fundKey: defaultFund.fundKey,
      fundName: defaultFund.name,
      fundNameBn: defaultFund.nameBn,
    };
  };

  // ফান্ড সিডিং, ইনডেক্সিং এবং পুরাতন লেনদেনের ফান্ড ব্যাকফিল হেল্পার (Idempotent)
  const initializeFinanceFundsAndIndexes = async () => {
    if (!fundsCollection) return [];
    try {
      await Promise.all([
        fundsCollection.createIndex({ accountNumber: 1 }, { unique: true }),
        financeIncomesCollection.createIndex({
          month: 1,
          accountNumber: 1,
          status: 1,
        }),
        financeExpensesCollection.createIndex({
          month: 1,
          accountNumber: 1,
          status: 1,
        }),
      ]);

      const now = new Date();
      for (const fund of INITIAL_FUNDS) {
        await fundsCollection.updateOne(
          { accountNumber: fund.accountNumber },
          {
            $setOnInsert: {
              ...fund,
              createdAt: now,
            },
          },
          { upsert: true },
        );
      }

      // পুরাতন লেনদেনগুলোতে accountNumber না থাকলে স্বয়ংক্রিয়ভাবে ব্যাকফিল করা
      const [legacyIncomes, legacyExpenses] = await Promise.all([
        financeIncomesCollection
          .find({
            $or: [
              { accountNumber: { $exists: false } },
              { accountNumber: null },
              { accountNumber: "" },
            ],
          })
          .toArray(),
        financeExpensesCollection
          .find({
            $or: [
              { accountNumber: { $exists: false } },
              { accountNumber: null },
              { accountNumber: "" },
            ],
          })
          .toArray(),
      ]);

      for (const inc of legacyIncomes) {
        const resolved = resolveFundAttribution(null, inc.items);
        await financeIncomesCollection.updateOne(
          { _id: inc._id },
          { $set: resolved },
        );
      }

      for (const exp of legacyExpenses) {
        const resolved = resolveFundAttribution(null, exp.items);
        await financeExpensesCollection.updateOne(
          { _id: exp._id },
          { $set: resolved },
        );
      }

      return await fundsCollection
        .find({})
        .sort({ isDefault: -1, accountNumber: 1 })
        .toArray();
    } catch (err) {
      console.error("Finance funds initialization error:", err);
      return [];
    }
  };

  // সার্ভার স্টার্টআপে স্বয়ংক্রিয়ভাবে ফান্ড ও ইনডেক্স নিশ্চিত করা
  initializeFinanceFundsAndIndexes();

  /**
   * ০.১. প্রাথমিক ফান্ড ও প্রারম্ভিক ব্যালেন্স সিড করার API (Idempotent)
   * Endpoint: POST /api/finance/funds/seed
   */
  router.post("/api/finance/funds/seed", async (req, res) => {
    try {
      const funds = await initializeFinanceFundsAndIndexes();
      res.status(200).json({
        success: true,
        message: "প্রাথমিক ফান্ড এবং প্রারম্ভিক ব্যালেন্স সফলভাবে সিঙ্ক করা হয়েছে!",
        data: funds,
      });
    } catch (error) {
      console.error("Error seeding finance funds:", error);
      res.status(500).json({
        success: false,
        message: "ফান্ড সিড করতে সমস্যা হয়েছে।",
      });
    }
  });

  // ডাইনামিক রসিদ ও ভাউচার আইডি জেনারেশন হেল্পার (EXP-MMYY<Serial> ও INC-MMYY<Serial>)
  const getNextFinanceId = async (type = "income", dateStr) => {
    let yy, mm;
    if (typeof dateStr === "string" && dateStr.includes("-")) {
      const parts = dateStr.split("-");
      if (parts.length >= 2) {
        yy = parts[0].trim().slice(-2);
        mm = parts[1].trim().padStart(2, "0");
      }
    }
    if (!yy || !mm) {
      const now = new Date();
      yy = String(now.getFullYear()).slice(-2);
      mm = String(now.getMonth() + 1).padStart(2, "0");
    }

    const isIncome = type === "income";
    // ফরম্যাট: EXP-MMYY<Serial> অথবা INC-MMYY<Serial> (e.g. EXP-10260007)
    const prefix = isIncome ? `INC-${mm}${yy}` : `EXP-${mm}${yy}`;
    const col = isIncome
      ? financeIncomesCollection
      : financeExpensesCollection;
    const idField = isIncome ? "receiptNo" : "voucherNo";

    // পূর্ববর্তী ভাউচার/রসিদ থেকে সিরিয়াল নম্বর এক্সট্র্যাক্ট করার হেল্পার
    const extractSerial = (val) => {
      if (!val || typeof val !== "string") return 0;
      // EXP-MMYY<serial>, EXP-YYMM<serial>, INC-MMYY<serial>, INC-YYMM<serial>
      const m = val.match(/^(?:EXP|INC)-\d{4}(\d+)$/i);
      if (m) {
        const num = parseInt(m[1], 10);
        if (!isNaN(num) && num < 1000000) return num;
      }
      // ট্রেইলিং ডিজিটস (e.g. EXP-0001, VOUCH-0001 ইত্যাদি)
      const m2 = val.match(/(\d+)$/);
      if (m2) {
        const num = parseInt(m2[1], 10);
        if (!isNaN(num) && num < 1000000) return num;
      }
      return 0;
    };

    // ডেটাবেজ থেকে সর্বশেষ পূর্ববর্তী রেকর্ড(সমূহ) নেওয়া
    const recentDocs = await col
      .find({ [idField]: { $exists: true, $nin: [null, ""] } })
      .sort({ _id: -1 })
      .limit(20)
      .toArray();

    let lastSerial = 0;
    if (recentDocs && recentDocs.length > 0) {
      for (const doc of recentDocs) {
        const s = extractSerial(doc[idField]);
        if (s > 0) {
          lastSerial = s;
          break;
        }
      }
    }

    // পূর্ববর্তী ভাউচার নম্বর থেকে ধারাবাহিক পরবর্তী সিরিয়াল (রিসেট না হয়ে সিকোয়েন্স বজায় থাকবে)
    let candidateCounter = lastSerial + 1;
    let candidateId = `${prefix}${String(candidateCounter).padStart(4, "0")}`;

    // ডেটাবেজে ইউনিকনেস নিশ্চিত করতে সংঘর্ষ প্রতিরোধ লুপ
    while (await col.findOne({ [idField]: candidateId })) {
      candidateCounter++;
      candidateId = `${prefix}${String(candidateCounter).padStart(4, "0")}`;
    }

    return candidateId;
  };

  /**
   * ০. অটো রসিদ / ভাউচার নম্বর জেনারেট করার API
   * Endpoint: GET /api/finance/next-receipt-no
   */
  router.get("/api/finance/next-receipt-no", async (req, res) => {
    try {
      const { date, type = "income" } = req.query;
      const nextId = await getNextFinanceId(type, date);
      res.json({
        success: true,
        nextReceiptNo: nextId,
        type,
      });
    } catch (error) {
      console.error("Error generating next finance ID:", error);
      res.status(500).json({
        success: false,
        message: "রসিদ নম্বর জেনারেট করতে সমস্যা হয়েছে।",
      });
    }
  });

  /**
   * ১. আয় এন্ট্রি করার API
   * Endpoint: POST /api/finance/income
   */
  router.post("/api/finance/income", async (req, res) => {
    try {
      const {
        receiptNo,
        accountNumber,
        payerName,
        payerType,
        donorName,
        studentId,
        studentName,
        className,
        discount,
        date,
        month,
        items,
        paymentMethod,
        description,
      } = req.body;

      if (!date || !month || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          success: false,
          message: "তারিখ, মাস এবং অন্তত একটি আয়ের খাত দেওয়া আবশ্যক।",
        });
      }

      // মোট আয় হিসাব (২ দশমিক স্থান পর্যন্ত রাউন্ডিং)
      const itemsTotal = round2(
        items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0),
      );
      const parsedDiscount = round2(parseFloat(discount) || 0);
      const totalIncome = round2(itemsTotal - parsedDiscount);
      let finalReceiptNo = receiptNo ? String(receiptNo).trim() : "";
      if (
        !finalReceiptNo ||
        (await financeIncomesCollection.findOne({
          receiptNo: finalReceiptNo,
        }))
      ) {
        finalReceiptNo = await getNextFinanceId("income", date);
      }

      const fundAttribution = resolveFundAttribution(accountNumber, items);

      const newIncome = {
        receiptNo: finalReceiptNo,
        ...fundAttribution,
        payerName: payerName || "N/A",
        payerType: payerType || "donor",
        donorName: donorName || "",
        studentId: studentId || "",
        studentName: studentName || "",
        className: className || "",
        discount: parsedDiscount,
        date,
        month, // format: YYYY-MM
        items: items.map((item) => ({
          head: item.head,
          amount: round2(parseFloat(item.amount) || 0),
          accountNumber: item.accountNumber || fundAttribution.accountNumber,
        })),
        totalIncome,
        paymentMethod: paymentMethod || "Cash",
        description: description || "",
        status: "approved",
        createdAt: new Date(),
      };

      const result = await financeIncomesCollection.insertOne(newIncome);
      res.status(201).json({
        success: true,
        message: "আয়ের তথ্য সফলভাবে সংরক্ষণ করা হয়েছে!",
        insertedId: result.insertedId,
        data: newIncome,
      });
    } catch (error) {
      console.error("Income save error:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভারে আয়ের তথ্য সংরক্ষণ করতে সমস্যা হয়েছে।",
      });
    }
  });

  /**
   * ২. ব্যয় (ভাউচার) এন্ট্রি করার API
   * Endpoint: POST /api/finance/expense
   */
  router.post("/api/finance/expense", async (req, res) => {
    try {
      const {
        voucherNo,
        accountNumber,
        receiverName,
        advanceAmount,
        chequeNo,
        date,
        month,
        items,
        description,
        reimbursement,
      } = req.body;

      if (!date || !month || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          success: false,
          message: "তারিখ, মাস এবং অন্তত একটি ব্যয়ের খাত দেওয়া আবশ্যক।",
        });
      }

      const totalExpense = round2(
        items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0),
      );
      const parsedAdvance = round2(parseFloat(advanceAmount) || 0);
      const balance = round2(parsedAdvance - totalExpense);
      let finalVoucherNo = voucherNo ? String(voucherNo).trim() : "";
      if (
        !finalVoucherNo ||
        (await financeExpensesCollection.findOne({
          voucherNo: finalVoucherNo,
        }))
      ) {
        finalVoucherNo = await getNextFinanceId("expense", date);
      }

      const fundAttribution = resolveFundAttribution(accountNumber, items);

      const newExpense = {
        voucherNo: finalVoucherNo,
        ...fundAttribution,
        receiverName: receiverName || "N/A",
        advanceAmount: parsedAdvance,
        chequeNo: chequeNo || "",
        date,
        month, // format: YYYY-MM
        items: items.map((item) => ({
          head: item.head,
          amount: round2(parseFloat(item.amount) || 0),
          accountNumber: item.accountNumber || fundAttribution.accountNumber,
          institutionName: item.institutionName || "",
          shopName: item.shopName || "",
          shopVoucher: item.shopVoucher || "",
        })),
        totalExpense,
        balance,
        description: description || "",
        reimbursement: reimbursement || null,
        status: "pending",
        createdAt: new Date(),
      };

      const result = await financeExpensesCollection.insertOne(newExpense);
      res.status(201).json({
        success: true,
        message: "ব্যয়ের তথ্য সফলভাবে ভাউচার হিসেবে সংরক্ষণ করা হয়েছে!",
        insertedId: result.insertedId,
        data: newExpense,
      });
    } catch (error) {
      console.error("Expense save error:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভারে ব্যয়ের তথ্য সংরক্ষণ করতে সমস্যা হয়েছে।",
      });
    }
  });

  /**
   * ০.২. সকল ফান্ড ও তাদের বর্তমান ব্যালেন্সের তালিকা পাওয়ার API
   * Endpoint: GET /api/finance/funds
   */
  router.get("/api/finance/funds", async (req, res) => {
    try {
      let funds = await fundsCollection
        .find({})
        .sort({ isDefault: -1, accountNumber: 1 })
        .toArray();

      if (!funds || funds.length === 0) {
        funds = await initializeFinanceFundsAndIndexes();
      }

      const [incomeByFundAgg, expenseByFundAgg] = await Promise.all([
        financeIncomesCollection
          .aggregate([
            {
              $match: {
                status: { $ne: "pending" },
                month: { $gte: "2026-10" },
              },
            },
            {
              $group: {
                _id: { $ifNull: ["$accountNumber", DEFAULT_ACCOUNT_NUMBER] },
                total: { $sum: "$totalIncome" },
              },
            },
          ])
          .toArray(),
        financeExpensesCollection
          .aggregate([
            {
              $match: {
                status: { $ne: "pending" },
                month: { $gte: "2026-10" },
              },
            },
            {
              $group: {
                _id: { $ifNull: ["$accountNumber", DEFAULT_ACCOUNT_NUMBER] },
                total: { $sum: "$totalExpense" },
              },
            },
          ])
          .toArray(),
      ]);

      const incomeMap = {};
      incomeByFundAgg.forEach((row) => {
        incomeMap[row._id] = round2(row.total);
      });

      const expenseMap = {};
      expenseByFundAgg.forEach((row) => {
        expenseMap[row._id] = round2(row.total);
      });

      const enrichedFunds = funds.map((f) => {
        const initOpening = round2(f.openingBalance);
        const inc = incomeMap[f.accountNumber] || 0;
        const exp = expenseMap[f.accountNumber] || 0;
        const availableBalance = round2(initOpening + inc);
        const currentBalance = round2(availableBalance - exp);
        return {
          ...f,
          openingBalance: initOpening,
          totalIncome: inc,
          availableBalance,
          totalExpense: exp,
          currentBalance,
        };
      });

      res.status(200).json({
        success: true,
        data: enrichedFunds,
      });
    } catch (error) {
      console.error("Error fetching finance funds:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভার থেকে ফান্ডের তালিকা আনতে সমস্যা হয়েছে।",
      });
    }
  });

  /**
   * ০.৩. ফান্ডের প্রারম্ভিক ব্যালেন্স বা তথ্য আপডেট করার API
   * Endpoint: PUT /api/finance/funds/:accountNumber
   */
  router.put("/api/finance/funds/:accountNumber", async (req, res) => {
    try {
      const { accountNumber } = req.params;
      const { openingBalance, openingDate, openingMonth, name, nameBn, isActive } =
        req.body;

      const updateFields = { updatedAt: new Date() };
      if (openingBalance !== undefined) {
        updateFields.openingBalance = round2(parseFloat(openingBalance) || 0);
      }
      if (openingDate) updateFields.openingDate = String(openingDate).trim();
      if (openingMonth) updateFields.openingMonth = String(openingMonth).trim();
      if (name) updateFields.name = String(name).trim();
      if (nameBn) updateFields.nameBn = String(nameBn).trim();
      if (typeof isActive === "boolean") updateFields.isActive = isActive;

      const result = await fundsCollection.updateOne(
        { accountNumber: String(accountNumber).trim() },
        { $set: updateFields },
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "নির্দিষ্ট ব্যাংক হিসাব / ফান্ডটি পাওয়া যায়নি।",
        });
      }

      const updatedFund = await fundsCollection.findOne({
        accountNumber: String(accountNumber).trim(),
      });

      res.status(200).json({
        success: true,
        message: "ফান্ডের তথ্য সফলভাবে আপডেট করা হয়েছে!",
        data: updatedFund,
      });
    } catch (error) {
      console.error("Error updating fund:", error);
      res.status(500).json({
        success: false,
        message: "ফান্ডের তথ্য আপডেট করতে সমস্যা হয়েছে।",
      });
    }
  });

  /**
   * ৩. মাসিক আয়ের ও ব্যয়ের সারসংক্ষেপ, রোলিং ব্যালেন্স এবং ফান্ড-ভিত্তিক হিসাব
   * Endpoint: GET /api/finance/summary
   */
  router.get("/api/finance/summary", async (req, res) => {
    try {
      const { month, year, accountNumber } = req.query;
      const selectedAcc =
        accountNumber && accountNumber !== "all"
          ? String(accountNumber).trim()
          : "all";

      // ১. সকল ফান্ড লোড করা
      let allFunds = await fundsCollection
        .find({})
        .sort({ isDefault: -1, accountNumber: 1 })
        .toArray();
      if (!allFunds || allFunds.length === 0) {
        allFunds = await initializeFinanceFundsAndIndexes();
      }

      const targetFunds =
        selectedAcc !== "all"
          ? allFunds.filter((f) => f.accountNumber === selectedAcc)
          : allFunds;

      // ২. পিরিয়ড এবং মাস/বছর ফিল্টার নির্ধারণ
      const periodIncomeFilter = { status: { $ne: "pending" } };
      const periodExpenseFilter = { status: { $ne: "pending" } };

      if (selectedAcc !== "all") {
        periodIncomeFilter.accountNumber = selectedAcc;
        periodExpenseFilter.accountNumber = selectedAcc;
      }

      let targetMonthLabel = "all";
      const resolvedYear =
        year && year !== "all"
          ? String(year).trim()
          : month && month !== "all"
            ? String(new Date().getFullYear())
            : "all";

      if (resolvedYear !== "all") {
        if (month && month !== "all") {
          const formattedMonth = String(month).padStart(2, "0");
          targetMonthLabel = `${resolvedYear}-${formattedMonth}`;
          periodIncomeFilter.month = targetMonthLabel;
          periodExpenseFilter.month = targetMonthLabel;
        } else {
          targetMonthLabel = `${resolvedYear}`;
          periodIncomeFilter.month = { $regex: `^${resolvedYear}-` };
          periodExpenseFilter.month = { $regex: `^${resolvedYear}-` };
        }
      }

      // ৩. পিরিয়ড অনুযায়ী ফান্ড-ভিত্তিক আয় ও ব্যয় এগ্রিগেশন
      const [periodIncomeByFund, periodExpenseByFund] = await Promise.all([
        financeIncomesCollection
          .aggregate([
            { $match: periodIncomeFilter },
            {
              $group: {
                _id: { $ifNull: ["$accountNumber", DEFAULT_ACCOUNT_NUMBER] },
                total: { $sum: "$totalIncome" },
              },
            },
          ])
          .toArray(),
        financeExpensesCollection
          .aggregate([
            { $match: periodExpenseFilter },
            {
              $group: {
                _id: { $ifNull: ["$accountNumber", DEFAULT_ACCOUNT_NUMBER] },
                total: { $sum: "$totalExpense" },
              },
            },
          ])
          .toArray(),
      ]);

      const periodIncMap = {};
      periodIncomeByFund.forEach((r) => {
        periodIncMap[r._id] = round2(r.total);
      });
      const periodExpMap = {};
      periodExpenseByFund.forEach((r) => {
        periodExpMap[r._id] = round2(r.total);
      });

      // ৪. রোলিং ওপেনিং ব্যালেন্স ক্যালকুলেশন (প্রতিটি ফান্ডের নিজস্ব openingMonth অ্যাঙ্কর থেকে)
      const isSpecificMonth = /^\d{4}-\d{2}$/.test(targetMonthLabel);
      const isSpecificYear = /^\d{4}$/.test(targetMonthLabel);

      const fundBreakdown = [];

      for (const fund of targetFunds) {
        const accNo = fund.accountNumber;
        const anchorMonth = fund.openingMonth || "2026-10";
        const initialSeed = round2(fund.openingBalance);

        let fundOpening = 0;

        if (isSpecificMonth) {
          if (targetMonthLabel >= anchorMonth) {
            // অ্যাঙ্কর মাস (যেমন 2026-10) বা তার পরবর্তী মাসগুলোর জন্য:
            // Opening(M) = InitialOpening(2026-10) + NetTransactions([2026-10, M))
            let priorInc = 0;
            let priorExp = 0;
            if (targetMonthLabel > anchorMonth) {
              const [pIncAgg, pExpAgg] = await Promise.all([
                financeIncomesCollection
                  .aggregate([
                    {
                      $match: {
                        accountNumber: accNo,
                        status: { $ne: "pending" },
                        month: { $gte: anchorMonth, $lt: targetMonthLabel },
                      },
                    },
                    { $group: { _id: null, total: { $sum: "$totalIncome" } } },
                  ])
                  .toArray(),
                financeExpensesCollection
                  .aggregate([
                    {
                      $match: {
                        accountNumber: accNo,
                        status: { $ne: "pending" },
                        month: { $gte: anchorMonth, $lt: targetMonthLabel },
                      },
                    },
                    { $group: { _id: null, total: { $sum: "$totalExpense" } } },
                  ])
                  .toArray(),
              ]);
              priorInc = round2(pIncAgg[0]?.total || 0);
              priorExp = round2(pExpAgg[0]?.total || 0);
            }
            fundOpening = round2(initialSeed + priorInc - priorExp);
          } else {
            // অ্যাঙ্কর মাসের পূর্ববর্তী মাসের (যেমন < 2026-10) জন্য শুধুমাত্র পূর্ববর্তী লেনদেনগুলোর সমষ্টি
            const [pIncAgg, pExpAgg] = await Promise.all([
              financeIncomesCollection
                .aggregate([
                  {
                    $match: {
                      accountNumber: accNo,
                      status: { $ne: "pending" },
                      month: { $lt: targetMonthLabel },
                    },
                  },
                  { $group: { _id: null, total: { $sum: "$totalIncome" } } },
                ])
                .toArray(),
              financeExpensesCollection
                .aggregate([
                  {
                    $match: {
                      accountNumber: accNo,
                      status: { $ne: "pending" },
                      month: { $lt: targetMonthLabel },
                    },
                  },
                  { $group: { _id: null, total: { $sum: "$totalExpense" } } },
                ])
                .toArray(),
            ]);
            fundOpening = round2(
              (pIncAgg[0]?.total || 0) - (pExpAgg[0]?.total || 0),
            );
          }
        } else if (isSpecificYear) {
          const yearStart = `${targetMonthLabel}-01`;
          const yearEnd = `${targetMonthLabel}-12`;
          if (yearStart > anchorMonth) {
            const [pIncAgg, pExpAgg] = await Promise.all([
              financeIncomesCollection
                .aggregate([
                  {
                    $match: {
                      accountNumber: accNo,
                      status: { $ne: "pending" },
                      month: { $gte: anchorMonth, $lt: yearStart },
                    },
                  },
                  { $group: { _id: null, total: { $sum: "$totalIncome" } } },
                ])
                .toArray(),
              financeExpensesCollection
                .aggregate([
                  {
                    $match: {
                      accountNumber: accNo,
                      status: { $ne: "pending" },
                      month: { $gte: anchorMonth, $lt: yearStart },
                    },
                  },
                  { $group: { _id: null, total: { $sum: "$totalExpense" } } },
                ])
                .toArray(),
            ]);
            fundOpening = round2(
              initialSeed +
                (pIncAgg[0]?.total || 0) -
                (pExpAgg[0]?.total || 0),
            );
          } else if (yearEnd >= anchorMonth) {
            fundOpening = initialSeed;
          } else {
            const [pIncAgg, pExpAgg] = await Promise.all([
              financeIncomesCollection
                .aggregate([
                  {
                    $match: {
                      accountNumber: accNo,
                      status: { $ne: "pending" },
                      month: { $lt: yearStart },
                    },
                  },
                  { $group: { _id: null, total: { $sum: "$totalIncome" } } },
                ])
                .toArray(),
              financeExpensesCollection
                .aggregate([
                  {
                    $match: {
                      accountNumber: accNo,
                      status: { $ne: "pending" },
                      month: { $lt: yearStart },
                    },
                  },
                  { $group: { _id: null, total: { $sum: "$totalExpense" } } },
                ])
                .toArray(),
            ]);
            fundOpening = round2(
              (pIncAgg[0]?.total || 0) - (pExpAgg[0]?.total || 0),
            );
          }
        } else {
          // "all" পিরিয়ডের ক্ষেত্রে ফান্ডের প্রারম্ভিক ব্যালেন্স
          fundOpening = initialSeed;
        }

        const fIncome = periodIncMap[accNo] || 0;
        const fExpense = periodExpMap[accNo] || 0;
        // Core Business Formula:
        // Available Balance = Opening Balance + Total Incomes
        // Closing Balance = Available Balance - Total Expenses
        const fAvailable = round2(fundOpening + fIncome);
        const fClosing = round2(fAvailable - fExpense);

        fundBreakdown.push({
          accountNumber: accNo,
          fundKey: fund.fundKey,
          name: fund.name,
          nameBn: fund.nameBn,
          initialOpeningBalance: initialSeed,
          openingDate: fund.openingDate || "2026-10-01",
          openingMonth: anchorMonth,
          openingBalance: fundOpening,
          totalIncome: fIncome,
          availableBalance: fAvailable,
          totalExpense: fExpense,
          closingBalance: fClosing,
        });
      }

      // ৫. সামগ্রিক (Consolidated) পিরিয়ড ব্যালেন্স হিসাব
      const openingBalance = round2(
        fundBreakdown.reduce((sum, f) => sum + f.openingBalance, 0),
      );
      const totalIncome = round2(
        fundBreakdown.reduce((sum, f) => sum + f.totalIncome, 0),
      );
      const totalUsableFund = round2(openingBalance + totalIncome);
      const totalExpense = round2(
        fundBreakdown.reduce((sum, f) => sum + f.totalExpense, 0),
      );
      const netBalance = round2(totalUsableFund - totalExpense);

      // ৬. সার্বিক (Overall all-time) মোট প্রারম্ভিক, আয়, ব্যয় ও বর্তমান উদ্বৃত্ত হিসাব
      const overallMatch = { status: { $ne: "pending" } };
      if (selectedAcc !== "all") {
        overallMatch.accountNumber = selectedAcc;
      }

      const [overallIncomeAgg, overallExpenseAgg] = await Promise.all([
        financeIncomesCollection
          .aggregate([
            { $match: overallMatch },
            { $group: { _id: null, total: { $sum: "$totalIncome" } } },
          ])
          .toArray(),
        financeExpensesCollection
          .aggregate([
            { $match: overallMatch },
            { $group: { _id: null, total: { $sum: "$totalExpense" } } },
          ])
          .toArray(),
      ]);

      const overallOpeningBalance = round2(
        targetFunds.reduce((sum, f) => sum + (f.openingBalance || 0), 0),
      );
      const overallIncome = round2(overallIncomeAgg[0]?.total || 0);
      const overallExpense = round2(overallExpenseAgg[0]?.total || 0);
      const overallUsableFund = round2(overallOpeningBalance + overallIncome);
      const overallBalance = round2(overallUsableFund - overallExpense);

      // ৭. খাত-ভিত্তিক আয়ের ও ব্যয়ের হিসাব
      const [incomeCategoryBreakdown, expenseCategoryBreakdown] =
        await Promise.all([
          financeIncomesCollection
            .aggregate([
              { $match: periodIncomeFilter },
              { $unwind: "$items" },
              {
                $group: {
                  _id: "$items.head",
                  total: { $sum: "$items.amount" },
                },
              },
              { $sort: { total: -1 } },
            ])
            .toArray(),
          financeExpensesCollection
            .aggregate([
              { $match: periodExpenseFilter },
              { $unwind: "$items" },
              {
                $group: {
                  _id: "$items.head",
                  total: { $sum: "$items.amount" },
                },
              },
              { $sort: { total: -1 } },
            ])
            .toArray(),
        ]);

      // ৮. সক্রিয় মাসসমূহ (Active months list, 2026-10 সহ)
      const [activeIncomeMonths, activeExpenseMonths] = await Promise.all([
        financeIncomesCollection.distinct("month", {
          status: { $ne: "pending" },
        }),
        financeExpensesCollection.distinct("month", {
          status: { $ne: "pending" },
        }),
      ]);
      const activeMonths = Array.from(
        new Set(["2026-10", ...activeIncomeMonths, ...activeExpenseMonths]),
      )
        .filter(Boolean)
        .sort()
        .reverse();

      res.status(200).json({
        success: true,
        data: {
          month: targetMonthLabel,
          accountNumber: selectedAcc,
          openingBalance,
          totalIncome,
          totalUsableFund,
          availableBalance: totalUsableFund,
          totalExpense,
          netBalance,
          closingBalance: netBalance,
          overallOpeningBalance,
          overallIncome,
          overallUsableFund,
          overallExpense,
          overallBalance,
          activeMonths,
          funds: allFunds,
          fundBreakdown,
          incomeBreakdown: incomeCategoryBreakdown.map((item) => ({
            head: item._id,
            amount: round2(item.total),
          })),
          expenseBreakdown: expenseCategoryBreakdown.map((item) => ({
            head: item._id,
            amount: round2(item.total),
          })),
        },
      });
    } catch (error) {
      console.error("Summary query error:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভার থেকে আর্থিক সারসংক্ষেপ আনতে সমস্যা হয়েছে।",
      });
    }
  });

  /**
   * ৪. লেনদেনের ইতিহাস ও অনুসন্ধান (Pagination & Search)
   * Endpoint: GET /api/finance/transactions
   */
  router.get("/api/finance/transactions", async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const type = req.query.type || "all"; // all, income, expense
      const search = req.query.search || "";
      const startDate = req.query.startDate;
      const endDate = req.query.endDate;
      const status = req.query.status;
      const accountNumber = req.query.accountNumber;

      const skip = (page - 1) * limit;

      const buildFilter = (isIncome) => {
        const filter = {};

        if (status && status !== "all") {
          filter.status = status;
        } else if (status !== "all") {
          filter.status = { $ne: "pending" };
        }

        if (accountNumber && accountNumber !== "all") {
          filter.accountNumber = String(accountNumber).trim();
        }

        if (search) {
          const regex = { $regex: search, $options: "i" };
          if (isIncome) {
            filter.$or = [
              { receiptNo: regex },
              { payerName: regex },
              { description: regex },
              { "items.head": regex },
              { accountNumber: regex },
              { fundName: regex },
              { fundNameBn: regex },
            ];
          } else {
            filter.$or = [
              { voucherNo: regex },
              { receiverName: regex },
              { chequeNo: regex },
              { description: regex },
              { "items.head": regex },
              { accountNumber: regex },
              { fundName: regex },
              { fundNameBn: regex },
            ];
          }
        }

        if (startDate || endDate) {
          filter.date = {};
          if (startDate) filter.date.$gte = startDate;
          if (endDate) filter.date.$lte = endDate;
        }

        return filter;
      };

      const attachFallbackFundInfo = (tx, txType) => {
        if (tx.accountNumber && tx.fundName) {
          return { ...tx, type: txType };
        }
        const resolved = resolveFundAttribution(tx.accountNumber, tx.items);
        return { ...tx, ...resolved, type: txType };
      };

      let transactions = [];
      let totalCount = 0;

      if (type === "income") {
        const filter = buildFilter(true);
        totalCount = await financeIncomesCollection.countDocuments(filter);
        const list = await financeIncomesCollection
          .find(filter)
          .sort({ date: -1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();
        transactions = list.map((item) =>
          attachFallbackFundInfo(item, "income"),
        );
      } else if (type === "expense") {
        const filter = buildFilter(false);
        totalCount = await financeExpensesCollection.countDocuments(filter);
        const list = await financeExpensesCollection
          .find(filter)
          .sort({ date: -1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();
        transactions = list.map((item) =>
          attachFallbackFundInfo(item, "expense"),
        );
      } else {
        const filterIncome = buildFilter(true);
        const filterExpense = buildFilter(false);

        const facetPipeline = [
          { $match: filterIncome },
          { $addFields: { type: "income" } },
          {
            $unionWith: {
              coll: "finance_expenses",
              pipeline: [
                { $match: filterExpense },
                { $addFields: { type: "expense" } },
              ],
            },
          },
          { $sort: { date: -1, createdAt: -1 } },
          {
            $facet: {
              metadata: [{ $count: "total" }],
              data: [{ $skip: skip }, { $limit: limit }],
            },
          },
        ];

        const result = await financeIncomesCollection
          .aggregate(facetPipeline)
          .toArray();
        const rawList = result[0]?.data || [];
        transactions = rawList.map((item) =>
          attachFallbackFundInfo(item, item.type),
        );
        totalCount = result[0]?.metadata[0]?.total || 0;
      }

      res.status(200).json({
        success: true,
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        data: transactions,
      });
    } catch (error) {
      console.error("Transactions query error:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভার থেকে লেনদেনের তালিকা আনতে সমস্যা হয়েছে।",
      });
    }
  });

  /**
   * ৪.৫. ট্রানজেকশন অনুমোদন করার API
   * Endpoint: PUT /api/finance/approve
   */
  router.put("/api/finance/approve", async (req, res) => {
    try {
      const { id, type } = req.body;
      if (!id || !type) {
        return res.status(400).json({
          success: false,
          message: "আইডি এবং প্রকার (income/expense) প্রদান করা আবশ্যক।",
        });
      }

      if (!ObjectId.isValid(id)) {
        return res
          .status(400)
          .json({ success: false, message: "অকার্যকর আইডি।" });
      }

      const collection =
        type === "income"
          ? financeIncomesCollection
          : financeExpensesCollection;
      const result = await collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "approved", updatedAt: new Date() } },
      );

      if (result.matchedCount === 0) {
        return res
          .status(404)
          .json({ success: false, message: "লেনদেনটি পাওয়া যায়নি।" });
      }

      res.json({
        success: true,
        message: "লেনদেনটি সফলভাবে অনুমোদন করা হয়েছে!",
      });
    } catch (error) {
      console.error("Approve transaction error:", error);
      res
        .status(500)
        .json({ success: false, message: "সার্ভারে সমস্যা হয়েছে।" });
    }
  });

  /**
   * ৪.৬ ট্রানজেকশন ডিলিট করার API
   * Endpoint: DELETE /api/finance/delete
   */
  router.delete("/api/finance/delete", async (req, res) => {
    try {
      const { id, type } = req.body;
      if (!id || !type) {
        return res.status(400).json({
          success: false,
          message: "আইডি এবং প্রকার (income/expense) প্রদান করা আবশ্যক।",
        });
      }

      if (!ObjectId.isValid(id)) {
        return res
          .status(400)
          .json({ success: false, message: "অকার্যকর আইডি।" });
      }

      const collection =
        type === "income"
          ? financeIncomesCollection
          : financeExpensesCollection;

      const result = await collection.deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount === 0) {
        return res
          .status(404)
          .json({ success: false, message: "লেনদেনটি পাওয়া যায়নি।" });
      }

      res.json({
        success: true,
        message: "লেনদেনটি সফলভাবে মুছে ফেলা হয়েছে!",
      });
    } catch (error) {
      console.error("Delete transaction error:", error);
      res
        .status(500)
        .json({ success: false, message: "সার্ভারে সমস্যা হয়েছে।" });
    }
  });

  /**
   * ১.৫. আয় আপডেট করার API
   * Endpoint: PUT /api/finance/income/:id
   */
  router.put("/api/finance/income/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res
          .status(400)
          .json({ success: false, message: "অকার্যকর আইডি।" });
      }

      const {
        receiptNo,
        accountNumber,
        payerName,
        payerType,
        donorName,
        studentId,
        studentName,
        className,
        discount,
        date,
        month,
        items,
        paymentMethod,
        description,
      } = req.body;

      if (!date || !month || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          success: false,
          message: "তারিখ, মাস এবং অন্তত একটি আয়ের খাত দেওয়া আবশ্যক।",
        });
      }

      // মোট আয় হিসাব (২ দশমিক স্থান পর্যন্ত রাউন্ডিং)
      const itemsTotal = round2(
        items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0),
      );
      const parsedDiscount = round2(parseFloat(discount) || 0);
      const totalIncome = round2(itemsTotal - parsedDiscount);
      const fundAttribution = resolveFundAttribution(accountNumber, items);

      const updateDoc = {
        $set: {
          receiptNo,
          ...fundAttribution,
          payerName: payerName || "N/A",
          payerType,
          donorName,
          studentId,
          studentName,
          className,
          discount: parsedDiscount,
          date,
          month,
          items: items.map((item) => ({
            head: item.head,
            amount: round2(parseFloat(item.amount) || 0),
            accountNumber: item.accountNumber || fundAttribution.accountNumber,
          })),
          totalIncome,
          paymentMethod: paymentMethod || "Cash",
          description: description || "",
          updatedAt: new Date(),
        },
      };

      const result = await financeIncomesCollection.updateOne(
        { _id: new ObjectId(id) },
        updateDoc,
      );
      if (result.matchedCount === 0) {
        return res
          .status(404)
          .json({ success: false, message: "আয়ের তথ্য পাওয়া যায়নি।" });
      }

      res.json({
        success: true,
        message: "আয়ের তথ্য সফলভাবে আপডেট করা হয়েছে!",
      });
    } catch (error) {
      console.error("Income update error:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভারে আয়ের তথ্য আপডেট করতে সমস্যা হয়েছে।",
      });
    }
  });

  /**
   * ২.৫. ব্যয় আপডেট করার API
   * Endpoint: PUT /api/finance/expense/:id
   */
  router.put("/api/finance/expense/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res
          .status(400)
          .json({ success: false, message: "অকার্যকর আইডি।" });
      }

      const {
        voucherNo,
        accountNumber,
        receiverName,
        advanceAmount,
        chequeNo,
        date,
        month,
        items,
        description,
        reimbursement,
      } = req.body;

      if (!date || !month || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          success: false,
          message: "তারিখ, মাস এবং অন্তত একটি ব্যয়ের খাত দেওয়া আবশ্যক।",
        });
      }

      const totalExpense = round2(
        items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0),
      );
      const parsedAdvance = round2(parseFloat(advanceAmount) || 0);
      const balance = round2(parsedAdvance - totalExpense);
      const fundAttribution = resolveFundAttribution(accountNumber, items);

      const updateDoc = {
        $set: {
          voucherNo,
          ...fundAttribution,
          receiverName: receiverName || "N/A",
          advanceAmount: parsedAdvance,
          chequeNo: chequeNo || "",
          date,
          month,
          items: items.map((item) => ({
            head: item.head,
            amount: round2(parseFloat(item.amount) || 0),
            accountNumber: item.accountNumber || fundAttribution.accountNumber,
            institutionName: item.institutionName || "",
            shopName: item.shopName || "",
            shopVoucher: item.shopVoucher || "",
          })),
          totalExpense,
          balance,
          description: description || "",
          reimbursement: reimbursement || null,
          updatedAt: new Date(),
        },
      };

      const result = await financeExpensesCollection.updateOne(
        { _id: new ObjectId(id) },
        updateDoc,
      );
      if (result.matchedCount === 0) {
        return res
          .status(404)
          .json({ success: false, message: "ব্যয়ের তথ্য পাওয়া যায়নি।" });
      }

      res.json({
        success: true,
        message: "ব্যয়ের তথ্য সফলভাবে আপডেট করা হয়েছে!",
      });
    } catch (error) {
      console.error("Expense update error:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভারে ব্যয়ের তথ্য আপডেট করতে সমস্যা হয়েছে।",
      });
    }
  });

  /**
   * ৫.১. ক্যাটাগরি তৈরি করার API
   * Endpoint: POST /api/finance/categories
   */
  router.post("/api/finance/categories", async (req, res) => {
    try {
      const { name, presetFee } = req.body;
      if (!name) {
        return res
          .status(400)
          .json({ success: false, message: "খাতের নাম দেওয়া আবশ্যক।" });
      }

      const newCategory = {
        name,
        presetFee: parseFloat(presetFee) || 0,
        createdAt: new Date(),
      };

      const result = await financeCategoriesCollection.insertOne(newCategory);
      res.status(201).json({
        success: true,
        message: "খাত সফলভাবে তৈরি করা হয়েছে!",
        data: newCategory,
        insertedId: result.insertedId,
      });
    } catch (error) {
      console.error("Category save error:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভারে খাত সংরক্ষণ করতে সমস্যা হয়েছে।",
      });
    }
  });

  /**
   * ৫.২. ক্যাটাগরি তালিকা পাওয়ার API
   * Endpoint: GET /api/finance/categories
   */
  router.get("/api/finance/categories", async (req, res) => {
    try {
      const categories = await financeCategoriesCollection.find({}).toArray();
      res.json({ success: true, data: categories });
    } catch (error) {
      console.error("Category fetch error:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভার থেকে খাতের তালিকা আনতে সমস্যা হয়েছে।",
      });
    }
  });

  /**
   * ৫.৩. ক্যাটাগরি ডিলিট করার API
   * Endpoint: DELETE /api/finance/categories/:id
   */
  router.delete("/api/finance/categories/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res
          .status(400)
          .json({ success: false, message: "অকার্যকর আইডি।" });
      }

      const result = await financeCategoriesCollection.deleteOne({
        _id: new ObjectId(id),
      });
      if (result.deletedCount === 0) {
        return res
          .status(404)
          .json({ success: false, message: "খাতটি পাওয়া যায়নি।" });
      }

      res.json({ success: true, message: "খাতটি সফলভাবে মুছে ফেলা হয়েছে।" });
    } catch (error) {
      console.error("Category delete error:", error);
      res.status(500).json({
        success: false,
        message: "সার্ভারে খাতটি মুছে ফেলতে সমস্যা হয়েছে।",
      });
    }
  });

  /**
   * ৬. স্টুডেন্ট আইডি দিয়ে খোঁজ করার API
   * Endpoint: GET /api/finance/students/:studentId
   */
  router.get("/api/finance/students/:studentId", async (req, res) => {
    try {
      const { studentId } = req.params;
      const student = await studentsCollection.findOne({
        studentId: String(studentId),
      });
      if (!student) {
        return res
          .status(404)
          .json({ success: false, message: "শিক্ষার্থী পাওয়া যায়নি।" });
      }

      let className = "N/A";
      if (student.divisionPreHifz?.active) {
        className = student.divisionPreHifz.class || "N/A";
      } else if (student.divisionHifz?.active) {
        className = student.divisionHifz.class || "N/A";
      } else if (student.divisionAcademy?.active) {
        className = student.divisionAcademy.class || "N/A";
      } else {
        className = student.officeUse?.recommendedClass || "N/A";
      }

      const name =
        student.studentNameBangla || student.studentNameEnglish || "N/A";
      res.json({ success: true, data: { name, className } });
    } catch (error) {
      console.error("Student fetch error:", error);
      res
        .status(500)
        .json({ success: false, message: "সার্ভারে সমস্যা হয়েছে।" });
    }
  });

  return router;
}

module.exports = financeRoutes;
