require("dotenv").config();
const { MongoClient, ServerApiVersion } = require("mongodb");
const dns = require("node:dns");

try {
  dns.setDefaultResultOrder("ipv4first");
} catch (_) {}

const uri = process.env.MONGODB_URI;

// MongoDB Client Setup
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: false,
    deprecationErrors: true,
  },
});

let database = null;
let collections = {};

async function connectDB() {
  // ডাটাবেজ কানেকশন (স্বয়ংক্রিয় রিট্রাই সহ)
  let connected = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await client.connect();
      connected = true;
      console.log("MongoDB-র সাথে সফলভাবে কানেক্টেড হয়েছে! 🚀");
      break;
    } catch (connErr) {
      console.warn(
        `MongoDB কানেকশন প্রচেষ্টা ${attempt} ব্যর্থ: ${connErr.message}. ৩ সেকেন্ড পর পুনরায় চেষ্টা করা হচ্ছে...`,
      );
      if (attempt === 5) throw connErr;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  database = client.db("aimhabiganj");

  // কালেকশনসমূহ
  collections = {
    admissionCollection: database.collection("admissions"),
    countersCollection: database.collection("counters"),
    studentsCollection: database.collection("students"),
    deletedIdsCollection: database.collection("deleted_student_ids"),
    galleryCollection: database.collection("gallery"),
    settingsCollection: database.collection("settings"),
    fundsCollection: database.collection("finance_funds"),
    feeStructuresCollection: database.collection("fee_structures"),
    receiptsCollection: database.collection("finance_receipts"),
    marksCollection: database.collection("marks"),
    examsCollection: database.collection("exams"),
    feesCollection: database.collection("fees"),
    routinesCollection: database.collection("routine"),
    seatPlansCollection: database.collection("seat_plan"),
    financeIncomesCollection: database.collection("finance_incomes"),
    financeExpensesCollection: database.collection("finance_expenses"),
    financeCategoriesCollection: database.collection("finance_categories"),
    teachersCollection: database.collection("teachers"),
    usersCollection: database.collection("user"),
    accountsCollection: database.collection("account"),
    verificationTokensCollection: database.collection(
      "verification_tokens",
    ),
    syllabusCollection: database.collection("syllabus"),
    studentAttendanceCollection: database.collection(
      "students_attendance",
    ),
    staffCollection: database.collection("staff"),
    staffAttendanceCollection: database.collection("staffattendance"),
    teacherAttendanceCollection: database.collection("teacherattendance"),
  };

  // ডুপ্লিকেট মার্কস রোধে ইউনিক কম্পাউন্ড ইনডেক্স নিশ্চিত করা
  collections.marksCollection
    .createIndex(
      { studentId: 1, year: 1, subject: 1 },
      { unique: true, name: "unique_student_year_subject" },
    )
    .catch((idxErr) => {
      console.warn(
        "Marks unique index warning:",
        idxErr?.message || idxErr,
      );
    });

  return { client, database, collections };
}

const getDatabase = () => database;
const getCollections = () => collections;

module.exports = {
  client,
  connectDB,
  getDatabase,
  getCollections,
};
