"use strict";

const API_URL = "/api/complaints";
const STATUSES = ["Pending", "In Progress", "Resolved"];

const elements = {
  studentView: document.querySelector("#student-view"),
  adminView: document.querySelector("#admin-view"),
  breadcrumb: document.querySelector("#breadcrumb-current"),
  backendStatus: document.querySelector("#backend-status-text"),
  backendIndicator: document.querySelector("#backend-status-indicator"),
  form: document.querySelector("#complaint-form"),
  name: document.querySelector("#student-name"),
  department: document.querySelector("#department"),
  category: document.querySelector("#category"),
  description: document.querySelector("#description"),
  charCount: document.querySelector("#char-count"),
  suggestion: document.querySelector("#ai-suggestion"),
  studentList: document.querySelector("#student-complaints"),
  studentCount: document.querySelector("#student-count"),
  emptyState: document.querySelector("#empty-state"),
  emptyTitle: document.querySelector("#empty-title"),
  emptyMessage: document.querySelector("#empty-message"),
  searchForm: document.querySelector("#search-form"),
  searchInput: document.querySelector("#search-id"),
  clearSearch: document.querySelector("#clear-search"),
  categoryFilter: document.querySelector("#filter-category"),
  statusFilter: document.querySelector("#filter-status"),
  adminRows: document.querySelector("#admin-rows"),
  adminCount: document.querySelector("#admin-count"),
  adminEmpty: document.querySelector("#admin-empty"),
  tableSummary: document.querySelector("#table-summary"),
  toastRegion: document.querySelector("#toast-region")
};

let complaints = [];
let activeSearch = "";
let syncErrorShown = false;

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

async function refreshComplaints() {
  const [records, health] = await Promise.all([
    apiRequest(API_URL),
    apiRequest("/api/health")
  ]);
  complaints = records;
  elements.backendStatus.textContent = health.storage === "mongodb" ? "MongoDB connected" : "Local JSON storage";
  elements.backendIndicator.classList.toggle("offline", false);
  renderStudent();
  renderAdmin();
}

async function syncComplaints() {
  try {
    await refreshComplaints();
    syncErrorShown = false;
  } catch (error) {
    console.error("Could not sync with the CampusCare backend.", error);
    elements.backendStatus.textContent = "Database unavailable";
    elements.backendIndicator.classList.add("offline");
    if (!syncErrorShown) {
      notify("Could not sync with the server. Check your connection and keep the server running.", "error");
      syncErrorShown = true;
    }
  }
}

function notify(message, type) {
  if (!elements.toastRegion) return;
  const toast = document.createElement("div");
  toast.className = `toast${type === "error" ? " error" : ""}`;
  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.textContent = type === "error" ? "!" : "✓";
  const text = document.createElement("span");
  text.textContent = message;
  toast.append(icon, text);
  elements.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function statusClass(status) {
  return status.toLowerCase().replace(/\s+/g, "-");
}

function analyzeComplaint(description) {
  const text = description.toLowerCase();
  const rules = [
    { category: "Wi-Fi", terms: ["wifi", "wi-fi", "internet", "network", "connection", "router", "signal"] },
    { category: "Drinking water", terms: ["water", "dispenser", "drinking", "tap", "filter", "fountain"] },
    { category: "Laboratory equipment", terms: ["lab", "laboratory", "microscope", "centrifuge", "equipment", "apparatus", "experiment"] },
    { category: "Washroom", terms: ["washroom", "restroom", "toilet", "bathroom", "flush", "urinal"] },
    { category: "Classroom", terms: ["classroom", "lecture", "projector", "desk", "chair", "blackboard", "whiteboard", "class"] }
  ];
  const hostelContext = ["hostel", "dorm", "residence"].some((term) => text.includes(term));
  const maintenanceIssue = ["leak", "plumbing", "ceiling", "bed", "maintenance", "repair", "broken", "damaged", "damage"].some((term) => text.includes(term));
  let matched = hostelContext && maintenanceIssue
    ? { category: "Hostel maintenance" }
    : rules.find((rule) => rule.terms.some((term) => text.includes(term)));
  if (!matched && maintenanceIssue) matched = { category: "Hostel maintenance" };
  if (!matched) {
    const category = elements.category.value;
    matched = rules.find((rule) => rule.category === category) || { category: category || "Other" };
  }
  const urgentWords = ["urgent", "emergency", "danger", "dangerous", "sparking", "smoke", "fire", "flood", "flooding", "injury", "injured", "unsafe", "serious", "leak"];
  const high = urgentWords.some((word) => text.includes(word));
  const low = ["minor", "small issue", "already fixed", "thank you", "resolved"].some((word) => text.includes(word));
  return { category: matched.category, priority: high ? "High" : low ? "Low" : "Medium" };
}

function updateSuggestion() {
  const text = elements.description.value;
  elements.charCount.textContent = `${text.length} / 1000`;
  if (!text.trim()) {
    elements.suggestion.innerHTML = '<span class="ai-icon" aria-hidden="true">✦</span><span class="suggestion-copy"><strong>Smart assist</strong><span>Start describing your issue for a category and priority suggestion.</span></span>';
    return;
  }
  const suggestion = analyzeComplaint(text);
  elements.suggestion.innerHTML = `<span class="ai-icon" aria-hidden="true">✦</span><span class="suggestion-copy"><strong>Smart assist</strong><span>Suggested: ${escapeText(suggestion.category)} · ${escapeText(suggestion.priority)} priority</span></span>`;
}

function visibleStudentComplaints() {
  return complaints
    .filter((complaint) => !activeSearch || complaint.id.toLowerCase() === activeSearch)
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function renderStudent() {
  const visible = visibleStudentComplaints();
  elements.studentCount.textContent = String(visible.length);
  elements.studentList.replaceChildren();
  for (const complaint of visible) {
    const card = document.createElement("article");
    card.className = "complaint-card";
    card.innerHTML = `<div><div class="complaint-id">${escapeText(complaint.id)}</div><div class="complaint-category">${escapeText(complaint.category)}</div></div><div class="complaint-description">${escapeText(complaint.description)}</div><div class="complaint-meta"><span class="status-pill status-${statusClass(complaint.status)}">${escapeText(complaint.status)}</span><span class="complaint-date">${escapeText(formatDate(complaint.createdAt))}</span></div>`;
    elements.studentList.append(card);
  }
  const hasResults = visible.length > 0;
  elements.emptyState.hidden = hasResults;
  if (!hasResults) {
    elements.emptyTitle.textContent = activeSearch ? "No complaint found" : "No complaints yet";
    elements.emptyMessage.textContent = activeSearch
      ? `We couldn't find ${elements.searchInput.value.trim() || "that complaint ID"}. Check the ID and try again.`
      : "Submit a complaint above and it will appear here.";
  }
}

function updateStats() {
  document.querySelector("#stat-total").textContent = String(complaints.length);
  document.querySelector("#stat-pending").textContent = String(complaints.filter((item) => item.status === "Pending").length);
  document.querySelector("#stat-progress").textContent = String(complaints.filter((item) => item.status === "In Progress").length);
  document.querySelector("#stat-resolved").textContent = String(complaints.filter((item) => item.status === "Resolved").length);
}

function renderAdmin() {
  updateStats();
  const filtered = complaints
    .filter((item) => !elements.categoryFilter.value || item.category === elements.categoryFilter.value)
    .filter((item) => !elements.statusFilter.value || item.status === elements.statusFilter.value)
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  elements.adminCount.textContent = String(filtered.length);
  elements.adminRows.replaceChildren();
  for (const complaint of filtered) {
    const row = document.createElement("tr");
    row.innerHTML = `<td><span class="table-id">${escapeText(complaint.id)}</span><span class="table-issue" title="${escapeText(complaint.description)}">${escapeText(complaint.description)}</span></td><td><span class="table-student">${escapeText(complaint.name)}</span><span class="table-department">${escapeText(complaint.department)}</span></td><td>${escapeText(complaint.category)}</td><td><span class="priority-pill priority-${escapeText(complaint.priority.toLowerCase())}">${escapeText(complaint.priority)}</span></td><td><span class="table-date">${escapeText(formatDate(complaint.createdAt))}</span></td><td><label class="sr-only" for="status-${escapeText(complaint.id)}">Status for ${escapeText(complaint.id)}</label><select class="status-select" id="status-${escapeText(complaint.id)}" data-complaint-id="${escapeText(complaint.id)}">${STATUSES.map((status) => `<option${complaint.status === status ? " selected" : ""}>${status}</option>`).join("")}</select></td>`;
    elements.adminRows.append(row);
  }
  elements.adminEmpty.hidden = filtered.length !== 0;
  elements.tableSummary.textContent = `Showing ${filtered.length} of ${complaints.length} complaint${complaints.length === 1 ? "" : "s"}`;
}

function setView(view) {
  const isAdmin = view === "admin";
  elements.studentView.hidden = isAdmin;
  elements.adminView.hidden = !isAdmin;
  elements.breadcrumb.textContent = isAdmin ? "Admin dashboard" : "Student portal";
  document.querySelectorAll(".nav-item").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  if (isAdmin) renderAdmin();
}

elements.description.addEventListener("input", updateSuggestion);
elements.category.addEventListener("change", updateSuggestion);

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!elements.form.reportValidity()) return;
  const name = elements.name.value.trim();
  const description = elements.description.value.trim();
  if (description.length < 10) {
    elements.description.setCustomValidity("Please describe the issue in at least 10 characters.");
    elements.description.reportValidity();
    return;
  }
  elements.description.setCustomValidity("");
  const suggestion = analyzeComplaint(description);
  const payload = {
    name,
    department: elements.department.value,
    category: elements.category.value,
    description,
    priority: suggestion.priority
  };
  const submitButton = elements.form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const complaint = await apiRequest(API_URL, { method: "POST", body: JSON.stringify(payload) });
    complaints.unshift(complaint);
    elements.form.reset();
    updateSuggestion();
    activeSearch = "";
    elements.searchInput.value = "";
    elements.clearSearch.hidden = true;
    renderStudent();
    renderAdmin();
    notify(`Complaint submitted. Your ID is ${complaint.id}.`);
    document.querySelector("#complaints-title").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    console.error("Could not submit complaint.", error);
    notify(error.message || "Could not submit the complaint. Please try again.", "error");
  } finally {
    submitButton.disabled = false;
  }
});

elements.description.addEventListener("input", () => elements.description.setCustomValidity(""));

elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  activeSearch = elements.searchInput.value.trim().toLowerCase();
  elements.clearSearch.hidden = !activeSearch;
  renderStudent();
  if (activeSearch && !complaints.some((item) => item.id.toLowerCase() === activeSearch)) {
    notify("No complaint found for that ID. Please check and try again.", "error");
  }
});

elements.clearSearch.addEventListener("click", () => {
  activeSearch = "";
  elements.searchInput.value = "";
  elements.clearSearch.hidden = true;
  renderStudent();
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

elements.categoryFilter.addEventListener("change", renderAdmin);
elements.statusFilter.addEventListener("change", renderAdmin);

elements.adminRows.addEventListener("change", async (event) => {
  const select = event.target.closest("[data-complaint-id]");
  if (!select) return;
  const complaint = complaints.find((item) => item.id === select.dataset.complaintId);
  if (!complaint || !STATUSES.includes(select.value)) return;
  const status = select.value;
  select.disabled = true;
  try {
    const updated = await apiRequest(`${API_URL}/${encodeURIComponent(complaint.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    Object.assign(complaint, updated);
    renderAdmin();
    renderStudent();
    notify(`${complaint.id} moved to ${complaint.status}.`);
  } catch (error) {
    console.error("Could not update complaint status.", error);
    notify(error.message || "Could not update the status. Please try again.", "error");
    renderAdmin();
  }
});

document.querySelector("#export-button").addEventListener("click", () => {
  const headers = ["Complaint ID", "Student", "Department", "Category", "Description", "Priority", "Status", "Submitted"];
  const rows = complaints.map((item) => [item.id, item.name, item.department, item.category, item.description, item.priority, item.status, formatDate(item.createdAt)]);
  const csv = [headers, ...rows]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `campuscare-complaints-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  notify("Complaint report exported as CSV.");
});

syncComplaints();
window.setInterval(() => {
  if (!document.hidden) syncComplaints();
}, 15000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) syncComplaints();
});
