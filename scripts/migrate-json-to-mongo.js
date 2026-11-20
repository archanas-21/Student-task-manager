"use strict";

require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const databaseName = process.env.MONGODB_DATABASE || "campuscare";
const collectionName = process.env.MONGODB_COLLECTION || "complaints";
const dataFile = process.env.JSON_DATA_FILE || path.join(__dirname, "..", "data", "complaints.json");

async function main() {
  if (!fs.existsSync(dataFile)) {
    throw new Error(`JSON data file not found: ${dataFile}`);
  }
  const complaints = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  if (!Array.isArray(complaints) || complaints.some((item) =>
    !item || typeof item.id !== "string" || typeof item.name !== "string" ||
    typeof item.department !== "string" || typeof item.category !== "string" ||
    typeof item.description !== "string" || typeof item.priority !== "string" ||
    typeof item.status !== "string" || typeof item.createdAt !== "string"
  )) {
    throw new Error("The JSON data file does not contain valid complaint records.");
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const collection = client.db(databaseName).collection(collectionName);
    await collection.createIndex({ id: 1 }, { unique: true });
    const result = complaints.length === 0
      ? { upsertedCount: 0 }
      : await collection.bulkWrite(complaints.map((complaint) => ({
        updateOne: {
          filter: { id: complaint.id },
          update: { $setOnInsert: complaint },
          upsert: true
        }
      })), { ordered: true });
    console.log(`Imported ${result.upsertedCount} complaint(s) into ${databaseName}.${collectionName}.`);
    console.log("Existing MongoDB records were left unchanged.");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("Could not migrate complaints to MongoDB:", error);
  process.exitCode = 1;
});
