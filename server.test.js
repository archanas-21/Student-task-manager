"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { createServer } = require("./server");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "campuscare-test-"));
const dataFile = path.join(directory, "complaints.json");
let server;
let baseUrl;

before(async () => {
  server = await createServer({ dataFile, seedComplaints: [] });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  fs.rmSync(directory, { recursive: true, force: true });
});

test("serves the frontend and starts with an empty complaint list", async () => {
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /CampusCare/);
  const response = await fetch(`${baseUrl}/api/complaints`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", storage: "json" });
});

test("validates complaint submissions and assigns IDs on the server", async () => {
  const invalid = await fetch(`${baseUrl}/api/complaints`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "A", description: "short" })
  });
  assert.equal(invalid.status, 400);

  const payload = {
    name: "Test Student",
    department: "Computer Science",
    category: "Wi-Fi",
    description: "Wi-Fi is unavailable in the library.",
    priority: "High"
  };
  const first = await fetch(`${baseUrl}/api/complaints`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.equal(first.status, 201);
  const created = await first.json();
  assert.match(created.id, /^CC-\d{4}-001$/);
  assert.equal(created.status, "Pending");

  const second = await fetch(`${baseUrl}/api/complaints`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.match((await second.json()).id, /^CC-\d{4}-002$/);
});

test("updates status and persists changes to the JSON database", async () => {
  const listing = await fetch(`${baseUrl}/api/complaints`);
  const [complaint] = await listing.json();
  const response = await fetch(`${baseUrl}/api/complaints/${complaint.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "Resolved" })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "Resolved");

  const persisted = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  assert.equal(persisted.find((item) => item.id === complaint.id).status, "Resolved");
});

test("rejects invalid statuses and unknown complaint IDs", async () => {
  const invalid = await fetch(`${baseUrl}/api/complaints/CC-2099-999`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "Unknown" })
  });
  assert.equal(invalid.status, 400);
  const missing = await fetch(`${baseUrl}/api/complaints/CC-2099-999`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "Resolved" })
  });
  assert.equal(missing.status, 404);
});
