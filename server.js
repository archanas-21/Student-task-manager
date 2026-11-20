"use strict";

require("dotenv").config();

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { MongoClient } = require("mongodb");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const DEFAULT_DATA_FILE = path.join(__dirname, "data", "complaints.json");
const STATUSES = ["Pending", "In Progress", "Resolved"];
const CATEGORIES = ["Classroom", "Wi-Fi", "Drinking water", "Laboratory equipment", "Washroom", "Hostel maintenance", "Other"];
const PRIORITIES = ["Low", "Medium", "High"];
const SEED_COMPLAINTS = [
  { id: "CC-2026-001", name: "Meera Nair", department: "Computer Science", category: "Wi-Fi", description: "Wi-Fi keeps disconnecting in the second-floor library reading area.", priority: "Medium", status: "In Progress", createdAt: "2026-11-18T09:30:00.000Z" },
  { id: "CC-2026-002", name: "Arjun Patel", department: "Engineering", category: "Classroom", description: "The projector in Block B, Room 204 is not powering on before lectures.", priority: "Medium", status: "Pending", createdAt: "2026-11-19T07:15:00.000Z" },
  { id: "CC-2026-003", name: "Sara Joseph", department: "Life Sciences", category: "Laboratory equipment", description: "The centrifuge in Biology Lab 2 is making an unusual noise during use.", priority: "High", status: "In Progress", createdAt: "2026-11-19T11:40:00.000Z" },
  { id: "CC-2026-004", name: "Kabir Shah", department: "Business & Management", category: "Drinking water", description: "Water dispenser near the cafeteria has been fixed. Thank you.", priority: "Low", status: "Resolved", createdAt: "2026-11-17T13:05:00.000Z" },
  { id: "CC-2026-005", name: "Diya Thomas", department: "Arts & Humanities", category: "Hostel maintenance", description: "A serious water leak is spreading from the ceiling in hostel room 312.", priority: "High", status: "Pending", createdAt: "2026-11-20T05:20:00.000Z" }
];
const PUBLIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]]
]);
const MAX_BODY_BYTES = 16 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function writeComplaints(dataFile, complaints) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const temporaryFile = `${dataFile}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(complaints, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryFile, dataFile);
}

function readComplaints(dataFile, seedComplaints) {
  if (!fs.existsSync(dataFile)) {
    writeComplaints(dataFile, seedComplaints);
    return [...seedComplaints];
  }
  const complaints = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  if (!Array.isArray(complaints) || !complaints.every((item) =>
    item && typeof item.id === "string" && typeof item.name === "string" &&
    typeof item.department === "string" && CATEGORIES.includes(item.category) &&
    typeof item.description === "string" && PRIORITIES.includes(item.priority) &&
    STATUSES.includes(item.status) && typeof item.createdAt === "string"
  )) {
    throw new Error("The complaint database has an invalid format.");
  }
  return complaints;
}

function getHighestSequence(complaints, year) {
  const prefix = `CC-${year}-`;
  return complaints.reduce((highest, complaint) => {
    if (!complaint.id.startsWith(prefix)) return highest;
    const number = Number(complaint.id.slice(prefix.length));
    return Number.isSafeInteger(number) ? Math.max(highest, number) : highest;
  }, 0);
}

function createJsonStore(dataFile, seedComplaints) {
  let complaints = readComplaints(dataFile, seedComplaints);
  return {
    kind: "json",
    async health() {
      return { status: "ok", storage: "json" };
    },
    async list() {
      return complaints.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },
    async create(values) {
      const year = new Date().getFullYear();
      const complaint = {
        id: `CC-${year}-${String(getHighestSequence(complaints, year) + 1).padStart(3, "0")}`,
        ...values,
        status: "Pending",
        createdAt: new Date().toISOString()
      };
      const updatedComplaints = [...complaints, complaint];
      writeComplaints(dataFile, updatedComplaints);
      complaints = updatedComplaints;
      return complaint;
    },
    async updateStatus(id, status) {
      const existing = complaints.find((item) => item.id === id);
      if (!existing) return null;
      const updated = { ...existing, status };
      const updatedComplaints = complaints.map((item) => item.id === id ? updated : item);
      writeComplaints(dataFile, updatedComplaints);
      complaints = updatedComplaints;
      return updated;
    }
  };
}

async function createMongoStore(uri, options, seedComplaints) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: options.serverSelectionTimeoutMS || 10000 });
  await client.connect();
  try {
    const database = client.db(options.databaseName || "campuscare");
    const collection = database.collection(options.collectionName || "complaints");
    const counters = database.collection("counters");
    await collection.createIndex({ id: 1 }, { unique: true });

    if (await collection.estimatedDocumentCount() === 0 && seedComplaints.length > 0) {
      await collection.insertMany(seedComplaints);
    }

    const year = new Date().getFullYear();
    const existing = await collection.find({ id: new RegExp(`^CC-${year}-`) }, { projection: { id: 1 } }).toArray();
    await counters.updateOne(
      { _id: `complaint-${year}` },
      { $max: { value: getHighestSequence(existing, year) } },
      { upsert: true }
    );

    return {
      kind: "mongodb",
      async health() {
        await database.command({ ping: 1 });
        return { status: "ok", storage: "mongodb", database: database.databaseName };
      },
      async list() {
        return collection.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
      },
      async create(values) {
        const counter = await counters.findOneAndUpdate(
          { _id: `complaint-${year}` },
          { $inc: { value: 1 } },
          { upsert: true, returnDocument: "after", includeResultMetadata: false }
        );
        const complaint = {
          id: `CC-${year}-${String(counter.value).padStart(3, "0")}`,
          ...values,
          status: "Pending",
          createdAt: new Date().toISOString()
        };
        await collection.insertOne(complaint);
        return complaint;
      },
      async updateStatus(id, status) {
        return collection.findOneAndUpdate(
          { id },
          { $set: { status } },
          { returnDocument: "after", includeResultMetadata: false, projection: { _id: 0 } }
        );
      },
      async close() {
        await client.close();
      }
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(value));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "Request body is too large."));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (size > MAX_BODY_BYTES) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function validateComplaint(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "A complaint object is required.");
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const department = typeof body.department === "string" ? body.department.trim() : "";
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const priority = body.priority;
  if (name.length < 1 || name.length > 70) throw new HttpError(400, "Name must be between 1 and 70 characters.");
  if (department.length < 1 || department.length > 100) throw new HttpError(400, "A valid department is required.");
  if (!CATEGORIES.includes(category)) throw new HttpError(400, "Choose a valid complaint category.");
  if (description.length < 10 || description.length > 1000) throw new HttpError(400, "Description must be between 10 and 1000 characters.");
  if (!PRIORITIES.includes(priority)) throw new HttpError(400, "Choose a valid priority.");
  return { name, department, category, description, priority };
}

async function createServer(options = {}) {
  const dataFile = options.dataFile || DEFAULT_DATA_FILE;
  const seedComplaints = options.seedComplaints || SEED_COMPLAINTS;
  const store = options.store || (options.mongoUri
    ? await createMongoStore(options.mongoUri, options.mongoOptions || {}, seedComplaints)
    : createJsonStore(dataFile, seedComplaints));

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        sendJson(response, 200, await store.health());
        return;
      }

      if (url.pathname === "/api/complaints" && request.method === "GET") {
        sendJson(response, 200, await store.list());
        return;
      }

      if (url.pathname === "/api/complaints" && request.method === "POST") {
        const values = validateComplaint(await readJsonBody(request));
        const complaint = await store.create(values);
        sendJson(response, 201, complaint);
        return;
      }

      const statusMatch = url.pathname.match(/^\/api\/complaints\/([^/]+)$/);
      if (statusMatch && request.method === "PATCH") {
        const id = decodeURIComponent(statusMatch[1]);
        const body = await readJsonBody(request);
        if (!body || typeof body !== "object" || !STATUSES.includes(body.status)) {
          throw new HttpError(400, "Choose a valid complaint status.");
        }
        const updated = await store.updateStatus(id, body.status);
        if (!updated) throw new HttpError(404, "Complaint not found.");
        sendJson(response, 200, updated);
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        throw new HttpError(404, "API endpoint not found.");
      }

      const publicFile = PUBLIC_FILES.get(url.pathname);
      if (request.method !== "GET" || !publicFile) {
        throw new HttpError(404, "Page not found.");
      }
      const [filename, contentType] = publicFile;
      const content = fs.readFileSync(path.join(__dirname, filename));
      response.writeHead(200, {
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache"
      });
      response.end(content);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }
      console.error("CampusCare request failed:", error);
      sendJson(response, 500, { error: "The server could not complete the request." });
    }
  });
  server.store = store;
  return server;
}

if (require.main === module) {
  const storageMode = (process.env.STORAGE_MODE || "mongodb").toLowerCase();
  if (!["mongodb", "json"].includes(storageMode)) {
    console.error('STORAGE_MODE must be either "mongodb" or "json".');
    process.exit(1);
  }
  const mongoUri = storageMode === "mongodb"
    ? (process.env.MONGODB_URI || "mongodb://127.0.0.1:27017")
    : undefined;
  const startup = createServer({
    mongoUri,
    mongoOptions: {
      databaseName: process.env.MONGODB_DATABASE,
      collectionName: process.env.MONGODB_COLLECTION
    }
  }).then((server) => {
    server.listen(PORT, HOST, () => {
      console.log(`CampusCare is running at http://${HOST}:${PORT}`);
      console.log(storageMode === "mongodb"
        ? `Complaint data is stored in MongoDB database "${process.env.MONGODB_DATABASE || "campuscare"}".`
        : `Complaint data is stored in ${DEFAULT_DATA_FILE}`);
    });
    server.on("error", (error) => {
      console.error("Could not start CampusCare server:", error);
      process.exitCode = 1;
    });
    return server;
  }).catch((error) => {
    console.error("Could not start CampusCare server:", error);
    process.exitCode = 1;
  });
  process.on("SIGINT", async () => {
    const server = await startup;
    if (server) {
      server.close();
      await server.store.close?.();
    }
    process.exit(0);
  });
}

module.exports = { createMongoStore, createServer };
