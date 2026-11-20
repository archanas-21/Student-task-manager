# CampusCare — Smart Campus Complaint Management

A responsive campus complaint portal with a student submission and tracking experience, an administrator dashboard, and a Node.js HTTP backend. The backend supports MongoDB for shared storage and a local JSON database for offline development; no paid AI or other external APIs are required.

## Run locally

1. Install Node.js 18 or newer if it is not already installed.
2. In this folder, run `npm install`.
3. Ensure the MongoDB service is running, then run `npm start`.
4. Open `http://localhost:3000` in a browser.
5. Select **Student portal** to submit a complaint or search by complaint ID.
6. Select **Admin dashboard** to filter complaints, update statuses, view live counts, or export a CSV report.

### Configure MongoDB

MongoDB is the default storage mode. The server and migration script load settings from `.env` in the project folder. The included local defaults connect to `mongodb://127.0.0.1:27017` and store complaints in the `campuscare.complaints` collection. Update `MONGODB_URI` in `.env` to use MongoDB Atlas or another MongoDB server, then run `npm start`. The app header reports whether the database connection is healthy.

To use a different local MongoDB URL or a MongoDB Atlas cluster, set `MONGODB_URI` before starting the server.

Example `.env` settings for a local MongoDB server:

```dotenv
STORAGE_MODE=mongodb
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DATABASE=campuscare
MONGODB_COLLECTION=complaints
```

For MongoDB Atlas, use your cluster connection string in `.env`:

```dotenv
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster-host>/
MONGODB_DATABASE=campuscare
```

Replace the Atlas placeholders with the database user's credentials and your cluster host. Keep connection strings private; `.env` is ignored by Git. The database name defaults to `campuscare`, and the collection defaults to `complaints`. Override them with `MONGODB_DATABASE` or `MONGODB_COLLECTION`. The server creates a unique complaint-ID index and seeds the sample complaints when the collection is empty. MongoDB connection/configuration errors stop startup and are printed to the terminal.

To inspect stored complaints, open MongoDB Compass and connect using `MONGODB_URI`, then open the `campuscare` database and `complaints` collection. Alternatively, with `mongosh` connected to your MongoDB server, run `use campuscare` and `db.complaints.find().pretty()`. The app's `GET http://localhost:3000/api/complaints` endpoint also returns complaint records.

### Migrate existing JSON complaints

With MongoDB running and `data/complaints.json` present, run `npm run migrate:json` before starting the app in MongoDB mode. The script inserts complaints whose IDs are not already in MongoDB and leaves existing MongoDB records unchanged. Set `MONGODB_URI`, `MONGODB_DATABASE`, or `MONGODB_COLLECTION` first if you are not using the default local connection.

JSON storage remains available only when explicitly selected with `$env:STORAGE_MODE = "json"` before `npm start`. MongoDB is the default, so startup fails visibly rather than silently switching to JSON if MongoDB is unavailable.

## Features

- Required-field validation, character count, inline confirmation/error notifications, and automatically generated complaint IDs (`CC-YEAR-NNN`).
- Student request list with status and exact-ID search.
- Admin statistics, category/status filters, inline status updates, and CSV export.
- Keyword-based category and priority suggestions run locally in the browser, without an AI service or paid API. Urgent safety terms (for example, *fire*, *unsafe*, or *leak*) suggest high priority; minor or already-fixed wording can suggest low priority.
- Node.js REST API validates requests, creates unique IDs, updates statuses, and persists records to MongoDB by default. A database health endpoint reports the active storage mode.
- Run the built-in backend tests with `npm test`.
- Responsive layouts for desktop, tablet, and mobile.

## Project structure

```text
index.html    Application structure and accessible form/table controls
styles.css    Responsive styling
app.js        UI behavior, REST API integration, and suggestion rules
server.js     Node.js HTTP server, REST API, and MongoDB/JSON persistence
scripts/      One-time JSON-to-MongoDB migration utility
data/         Server-created JSON fallback database (not checked into source control)
server.test.js Backend API tests
package.json  Start/test commands and MongoDB driver dependency
README.md     Setup and usage instructions
```

## Deployment and access-control note

This local demo has no login or role-based access control: anyone who can reach the server can view complaints and change statuses. Do not expose it to a public network or use it for sensitive information without adding authentication and authorization.
