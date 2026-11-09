require("dotenv").config();
const { MongoClient, ServerApiVersion } = require("mongodb");
const dns = require("node:dns");

try {
  dns.setDefaultResultOrder("ipv4first");
} catch (_) {}

const options = {
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 5000,
  socketTimeoutMS: 10000,
  maxPoolSize: 10,
  minPoolSize: 1,
  serverApi: {
    version: ServerApiVersion.v1,
    strict: false,
    deprecationErrors: true,
  },
};

let client = null;
let database = null;
let collections = {};

// Helper: check if a Mongo client instance is closed
function isClientClosed(c) {
  if (!c) return true;
  if (c.s?.hasBeenClosed) return true;
  if (
    c.topology &&
    (c.topology.isClosed?.() || c.topology.s?.state === "closed")
  ) {
    return true;
  }
  return false;
}

// Map collection names to their database collection
function initializeCollections(db) {
  return {
    admissionCollection: db.collection("admissions"),
    countersCollection: db.collection("counters"),
    studentsCollection: db.collection("students"),
    deletedIdsCollection: db.collection("deleted_student_ids"),
    galleryCollection: db.collection("gallery"),
    settingsCollection: db.collection("settings"),
    fundsCollection: db.collection("finance_funds"),
    feeStructuresCollection: db.collection("fee_structures"),
    receiptsCollection: db.collection("finance_receipts"),
    marksCollection: db.collection("marks"),
    examsCollection: db.collection("exams"),
    feesCollection: db.collection("fees"),
    routinesCollection: db.collection("routine"),
    seatPlansCollection: db.collection("seat_plan"),
    financeIncomesCollection: db.collection("finance_incomes"),
    financeExpensesCollection: db.collection("finance_expenses"),
    financeCategoriesCollection: db.collection("finance_categories"),
    teachersCollection: db.collection("teachers"),
    usersCollection: db.collection("user"),
    accountsCollection: db.collection("account"),
    verificationTokensCollection: db.collection("verification_tokens"),
    syllabusCollection: db.collection("syllabus"),
    studentAttendanceCollection: db.collection("students_attendance"),
    staffCollection: db.collection("staff"),
    staffsCollection: db.collection("staffs"),
    staffAttendanceCollection: db.collection("staffattendance"),
    teacherAttendanceCollection: db.collection("teacherattendance"),
  };
}

function sanitizeEnvValue(val, keyName = "") {
  if (!val || typeof val !== "string") return "";
  let cleaned = val.trim();
  while (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (keyName) {
    const prefixRegex = new RegExp(`^${keyName}\\s*=\\s*`, "i");
    cleaned = cleaned.replace(prefixRegex, "").trim();
  }
  while (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (keyName === "MONGODB_URI" && !cleaned.startsWith("mongodb")) {
    const match = cleaned.match(/(mongodb(?:\+srv)?:\/\/.+)/i);
    if (match) {
      cleaned = match[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return cleaned;
}

/**
 * Serverless-optimized MongoDB connection with global promise caching
 */
async function connectDB() {
  const uri = sanitizeEnvValue(process.env.MONGODB_URI, "MONGODB_URI");
  const dbName =
    sanitizeEnvValue(process.env.MONGODB_DB_NAME, "MONGODB_DB_NAME") ||
    "aimpurbachal";
  if (!uri) {
    throw new Error(
      "Missing MONGODB_URI environment variable. Please configure MONGODB_URI in your Vercel Project Settings."
    );
  }

  // Fast path: client already connected, URI matches, and topology is alive
  if (
    client &&
    !isClientClosed(client) &&
    database &&
    global._mongoClientUri === uri &&
    database.databaseName === dbName
  ) {
    return { client, database, collections };
  }

  // Reuse or initialize the global connection promise across serverless invocations
  if (
    !global._mongoClientPromise ||
    isClientClosed(client) ||
    global._mongoClientUri !== uri
  ) {
    if (client) {
      client.close().catch(() => {});
    }
    client = new MongoClient(uri, options);
    global._mongoClientUri = uri;
    global._mongoClientPromise = client.connect().catch((err) => {
      global._mongoClientPromise = null;
      global._mongoClientUri = null;
      throw err;
    });
  }

  try {
    const connectedClient = await global._mongoClientPromise;
    client = connectedClient;
    database = client.db(dbName);
    collections = initializeCollections(database);

    // Ensure compound index safely in background without blocking
    if (collections.marksCollection) {
      collections.marksCollection
        .createIndex(
          { studentId: 1, year: 1, subject: 1 },
          { unique: true, name: "unique_student_year_subject", background: true }
        )
        .catch((idxErr) => {
          console.warn("Marks unique index warning:", idxErr?.message || idxErr);
        });
    }

    return { client, database, collections };
  } catch (error) {
    global._mongoClientPromise = null;
    console.error("MongoDB Connection Error:", error.message);
    throw error;
  }
}

const getDatabase = () => database;
const getCollections = () => collections;

/**
 * Proxy for database object to allow synchronous routing setup
 */
const dbProxy = new Proxy({}, {
  get(target, prop) {
    if (prop === "then" || typeof prop === "symbol") {
      return undefined;
    }
    if (prop === "collection") {
      return (collectionName) => {
        return new Proxy({}, {
          get(colTarget, colProp) {
            if (colProp === "then" || typeof colProp === "symbol") {
              return undefined;
            }
            if (!database) {
              throw new Error("Database not connected yet. Await connectDB() before querying.");
            }
            const actualCol = database.collection(collectionName);
            const val = Reflect.get(actualCol, colProp);
            return typeof val === "function" ? val.bind(actualCol) : val;
          },
        });
      };
    }
    if (!database) {
      throw new Error("Database not connected yet. Await connectDB() before querying.");
    }
    const val = Reflect.get(database, prop);
    return typeof val === "function" ? val.bind(database) : val;
  },
});

/**
 * Proxy for collections object to allow synchronous routing setup
 */
const collectionsProxy = new Proxy({}, {
  get(target, prop) {
    if (prop === "then" || prop === "use" || typeof prop === "symbol") {
      return undefined;
    }
    if (database && !(prop in collections)) {
      return undefined;
    }
    return new Proxy({}, {
      get(colTarget, colProp) {
        if (colProp === "then" || typeof colProp === "symbol") {
          return undefined;
        }
        if (!database || !collections[prop]) {
          throw new Error(`Collection '${String(prop)}' accessed before database connection. Await connectDB() first.`);
        }
        const actualCol = collections[prop];
        const val = Reflect.get(actualCol, colProp);
        return typeof val === "function" ? val.bind(actualCol) : val;
      },
    });
  },
});

/**
 * Proxy for client object to avoid premature unhandled initialization
 */
const clientProxy = new Proxy({}, {
  get(target, prop) {
    if (!client) {
      throw new Error("MongoClient not initialized yet. Await connectDB() first.");
    }
    const val = Reflect.get(client, prop);
    return typeof val === "function" ? val.bind(client) : val;
  },
});

module.exports = {
  client: clientProxy,
  connectDB,
  getDatabase,
  getCollections,
  dbProxy,
  collectionsProxy,
};
