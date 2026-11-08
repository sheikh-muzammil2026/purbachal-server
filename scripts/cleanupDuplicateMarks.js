/**
 * Migration & Cleanup Script: Detect and remove duplicate subject mark documents
 * in the `marks` collection (e.g., for studentIds 04348, 04168, etc.), and enforce
 * a compound unique index on `{ studentId: 1, year: 1, subject: 1 }`.
 *
 * Usage:
 *   node scripts/cleanupDuplicateMarks.js
 */
require("dotenv").config();
const { connectDB, client } = require("../config/db");

const getStudentClass = (s) => {
  if (!s) return "N/A";
  if (s.divisionAcademy?.active && s.divisionAcademy?.class)
    return s.divisionAcademy.class;
  if (s.divisionHifz?.active && s.divisionHifz?.class)
    return s.divisionHifz.class;
  if (s.divisionPreHifz?.active && s.divisionPreHifz?.class)
    return s.divisionPreHifz.class;
  return (
    s.divisionHifz?.class ||
    s.divisionPreHifz?.class ||
    s.divisionAcademy?.class ||
    s.officeUse?.recommendedClass ||
    s.class ||
    "N/A"
  );
};

async function runCleanup() {
  try {
    const { collections } = await connectDB();
    const { marksCollection, studentsCollection, admissionCollection } =
      collections;

    console.log("🔍 Scanning `marks` collection for duplicate (studentId, year, subject) entries...");

    const duplicateGroups = await marksCollection
      .aggregate([
        {
          $group: {
            _id: {
              studentId: "$studentId",
              year: "$year",
              subject: "$subject",
            },
            count: { $sum: 1 },
            docs: { $push: "$$ROOT" },
          },
        },
        {
          $match: {
            count: { $gt: 1 },
          },
        },
      ])
      .toArray();

    console.log(
      `📊 Found ${duplicateGroups.length} duplicate (studentId, year, subject) group(s).`,
    );

    let deletedTotal = 0;

    if (duplicateGroups.length > 0) {
      // Fetch active class for affected students
      const affectedStudentIds = [
        ...new Set(duplicateGroups.map((g) => String(g._id.studentId))),
      ];

      const [students, admissions] = await Promise.all([
        studentsCollection
          .find({ studentId: { $in: affectedStudentIds } })
          .toArray(),
        admissionCollection
          .find({ studentId: { $in: affectedStudentIds } })
          .toArray(),
      ]);

      const studentClassMap = new Map();
      admissions.forEach((a) => {
        studentClassMap.set(String(a.studentId), getStudentClass(a));
      });
      students.forEach((s) => {
        studentClassMap.set(String(s.studentId), getStudentClass(s));
      });

      const idsToDelete = [];

      for (const group of duplicateGroups) {
        const studentId = String(group._id.studentId);
        const preferredClass = studentClassMap.get(studentId) || "N/A";

        const getScore = (item) => {
          let score = 0;
          if (
            preferredClass &&
            preferredClass !== "N/A" &&
            item.class === preferredClass
          ) {
            score += 100;
          }
          if (
            item.isPublished ||
            item.term1?.isPublished ||
            item.term2?.isPublished ||
            item.annual?.isPublished
          ) {
            score += 50;
          }
          return score;
        };

        const getTimestamp = (item) => {
          const t = new Date(item.updatedAt || item.createdAt || 0).getTime();
          return Number.isFinite(t) ? t : 0;
        };

        // Sort descending so index 0 is the canonical document to keep
        const sortedDocs = [...group.docs].sort((a, b) => {
          const scoreDiff = getScore(b) - getScore(a);
          if (scoreDiff !== 0) return scoreDiff;
          return getTimestamp(b) - getTimestamp(a);
        });

        const keepDoc = sortedDocs[0];
        const removeDocs = sortedDocs.slice(1);

        console.log(
          `  • Student ${studentId} | Year: ${group._id.year} | Subject: ${group._id.subject} -> Keeping _id=${keepDoc._id} (class: "${keepDoc.class}", updatedAt: ${keepDoc.updatedAt ? new Date(keepDoc.updatedAt).toISOString() : "N/A"}), removing ${removeDocs.length} stale duplicate(s): [${removeDocs.map((d) => `${d._id} (class: "${d.class}")`).join(", ")}]`,
        );

        removeDocs.forEach((d) => idsToDelete.push(d._id));
      }

      if (idsToDelete.length > 0) {
        const deleteResult = await marksCollection.deleteMany({
          _id: { $in: idsToDelete },
        });
        deletedTotal = deleteResult.deletedCount;
        console.log(`✅ Removed ${deletedTotal} duplicate mark document(s).`);
      }
    }

    // Verify specifically for 04348 and 04168
    for (const targetId of ["04348", "04168"]) {
      const remaining = await marksCollection
        .find({ studentId: targetId, year: "২০২৬" })
        .project({ subject: 1, class: 1, "term2.ct": 1, "term2.exam": 1, "term2.isPublished": 1 })
        .toArray();
      console.log(
        `📋 Verification for studentId ${targetId} (Year ২০২৬): ${remaining.length} unique subject document(s):`,
        remaining.map((r) => `${r.subject} (${r.class}): CT=${r.term2?.ct}, Exam=${r.term2?.exam}`),
      );
    }

    // Create compound unique index to prevent future duplicates
    console.log(
      "🔒 Ensuring compound unique index `{ studentId: 1, year: 1, subject: 1 }` on `marks` collection...",
    );
    const indexName = await marksCollection.createIndex(
      { studentId: 1, year: 1, subject: 1 },
      { unique: true, name: "unique_student_year_subject" },
    );
    console.log(`✅ Compound unique index active: ${indexName}`);
  } catch (error) {
    console.error("❌ Cleanup script failed:", error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

runCleanup();
