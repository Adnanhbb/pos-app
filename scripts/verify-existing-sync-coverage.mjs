#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { verifyPackagedUiSync } from "./verify-packaged-ui-sync.mjs";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro-rehearsal/api").replace(/\/+$/, "");
const runId = `rehearsal-sync-coverage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const jsonPath = "sync-coverage-verification-report.json";
const mdPath = "sync-coverage-verification-report.md";
const ACCOUNTING_FIELDS = ["invoices", "payable", "paid", "balance"];

const sourceChecks = [
  ["categories UI", "src/Categories.tsx", ["categoriesRepository.create", "categoriesRepository.update", "categoriesRepository.remove"]],
  ["brands UI", "src/Brands.tsx", ["brandsRepo.create", "brandsRepo.update", "brandsRepo.remove"]],
  ["units UI", "src/Units.tsx", ["unitRepository.create", "unitRepository.update", "unitRepository.remove"]],
  ["customers UI", "src/Customers.tsx", ["customersRepository as customersRepo", "customersRepo.create", "customersRepo.update", "customersRepo.remove"]],
  ["suppliers UI", "src/Suppliers.tsx", ["suppliersRepository as suppliersRepo", "suppliersRepo.create", "suppliersRepo.update", "suppliersRepo.remove"]],
  ["expenses UI", "src/Expenses.tsx", ["expenseRepository.create", "expenseRepository.update", "expenseRepository.remove"]],
  ["units", "src/repositories/unitRepository.ts", ["entityApi.create", "entityApi.update", "entityApi.remove", "queueEntityCreate", "queueEntityUpdate", "queueEntityDelete"]],
  ["taxes", "src/repositories/taxRepository.ts", ["entityApi.create", "entityApi.update", "entityApi.remove", "queueEntityCreate", "queueEntityUpdate", "queueEntityDelete"]],
  ["discounts", "src/repositories/discountRepository.ts", ["entityApi.create", "entityApi.update", "entityApi.remove", "queueEntityCreate", "queueEntityUpdate", "queueEntityDelete"]],
  ["brands", "src/repositories/brandsRepository.ts", ["entityApi.create", "entityApi.update", "entityApi.remove", "queueEntityCreate", "queueEntityUpdate", "queueEntityDelete"]],
  ["categories", "src/repositories/categoriesRepository.ts", ["entityApi.create", "entityApi.update", "entityApi.remove", "queueEntityCreate", "queueEntityUpdate", "queueEntityDelete"]],
  ["expenses", "src/repositories/expenseRepository.ts", ["entityApi.create", "entityApi.update", "entityApi.remove", "prepareRemoteRecordForLocalInsert", "queueEntityCreate", "queueEntityUpdate", "queueEntityDelete"]],
  ["users/staff", "src/repositories/staffRepository.ts", ["entityApi.create", "entityApi.update", "entityApi.remove", "queueEntityCreate", "queueEntityUpdate", "queueEntityDelete"]],
  ["settings", "src/repositories/settingsRepository.ts", ["entityApi.update", "queueEntityOperation", "applyRemoteMirror"]],
  ["held", "src/repositories/heldRepository.ts", ["entityApi.create", "entityApi.remove", "queueEntityOperation", "items"]],
  ["customers", "src/repositories/customerRepository.ts", ["entityApi.create", "entityApi.update", "entityApi.remove", "stripAccountingFields(cust)", "stripAccountingFields(syncableCustomer)", "hasAccountingFieldChange"]],
  ["suppliers", "src/repositories/suppliersRepository.ts", ["entityApi.create", "entityApi.update", "entityApi.remove", "stripAccountingFields(sup)", "stripAccountingFields(syncableSupplier)", "hasAccountingFieldChange"]],
  ["items", "src/repositories/itemsRepository.ts", ["entityApi.update", "pickSafeItemProfilePayload", "hasUnsafeItemFieldChange", "Item create is intentionally local-only"]],
  ["developer control panel dashboard visibility", "src/Dashboard.tsx", ["...(user?.role === \"Dev\" ? [", "if (key === \"developer_control_panel\" && user.role !== \"Dev\") return;"]],
  ["developer control panel self guard", "src/DeveloperControlPanel.tsx", ["const canAccess = user.role === \"Dev\";", "restricted to developer support users"]],
  ["admin Sync Status Settings tab", "src/Settings.tsx", ["Sync Status", "currentRole === \"admin\" || currentRole === \"Dev\"", "currentRole === \"Dev\"", "Sync Now", "Some records need support"]],
  ["invoice read-only view and print", "src/Invoices.tsx", ["handlePrintInvoice", "printInvoice({"]],
  ["manual replay failed-row handling", "src/services/syncEngine.ts", ["await syncQueueRepository.incrementRetry(item.id, message);", "await syncQueueRepository.markFailed(item.id, message);"]],
];

const backendChecks = [
  ["units", "units.php", "name", () => ({ name: `Rehearsal Verify Unit ${runId}`, shortName: "rvu", itemCount: 0 }), () => ({ name: `Rehearsal Verify Unit Updated ${runId}`, shortName: "rvu2" }), null, { shortName: "rvu2" }, false, "hard"],
  ["taxes", "taxes.php", "name", () => ({ name: `Rehearsal Verify Tax ${runId}`, value: 6, type: "percentage" }), () => ({ value: 7 }), null, { value: 7 }, false, "hard"],
  ["discounts", "discounts.php", "name", () => ({ name: `Rehearsal Verify Discount ${runId}`, value: 4, type: "amount" }), () => ({ value: 5 }), null, { value: 5 }, false, "hard"],
  ["brands", "brands.php", "name", () => ({ name: `Rehearsal Verify Brand ${runId}`, itemCount: 0 }), () => ({ itemCount: 1 }), null, { itemCount: 1 }, false, "hard"],
  ["categories", "categories.php", "name", () => ({ name: `Rehearsal Verify Category ${runId}`, itemCount: 0 }), () => ({ itemCount: 1 }), null, { itemCount: 1 }, false, "hard"],
  ["expenses", "expenses.php", "category", () => ({ date: "2026-05-31", category: `Rehearsal Verify Expense ${runId}`, amount: 12, description: "safe rehearsal expense create" }), () => ({ amount: 13, description: "safe rehearsal expense updated" }), null, { amount: 13, description: "safe rehearsal expense updated" }, false, "soft"],
  ["customers", "customers.php", "name", () => ({ name: `Rehearsal Verify Customer ${runId}`, mobile: "03000000001", cnic: "RV-CNIC", address: "safe rehearsal customer" }), () => ({ address: "safe rehearsal customer updated" }), "profile fields only; no accounting fields sent", { address: "safe rehearsal customer updated" }, true, "soft"],
  ["suppliers", "suppliers.php", "name", () => ({ name: `Rehearsal Verify Supplier ${runId}`, mobile: "03000000002", cnic: "RV-SCNIC", address: "safe rehearsal supplier" }), () => ({ address: "safe rehearsal supplier updated" }), "profile fields only; no accounting fields sent", { address: "safe rehearsal supplier updated" }, true, "soft"],
];

const skipped = [
  ["users/staff live mutation", "Skipped because authentication actor mutation is security-sensitive; covered by auth-specific tests."],
  ["settings live mutation", "Skipped because settings update mutates global business configuration; source wiring is inspected only."],
  ["items safe profile update", "Skipped because it requires an existing serverId item fixture; item create/delete/stock/batch/cylinder paths must not be exercised here."],
  ["sales/sale_items/payments/batches/cylinders/item stock", "Skipped because these are transaction/replay-owned and excluded from direct CRUD verification."],
];

function redact(v) {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, e]) => [/password|token|secret|payload_json|response_json/i.test(k) ? k : k, /password|token|secret|payload_json|response_json/i.test(k) ? "[redacted]" : redact(e)]));
  return v;
}
function unwrap(body) { return body && typeof body === "object" && "data" in body ? body.data : body; }
function serverId(row) { return row?.serverId ?? row?.id ?? null; }
async function fetchJson(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}/${path}`, { ...options, headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) } });
  const text = await response.text();
  let body = null;
  if (text.trim()) { try { body = JSON.parse(text); } catch { body = text; } }
  return { status: response.status, ok: response.ok, body };
}

function inspectSources() {
  return sourceChecks.map(([repo, file, required]) => {
    if (!existsSync(file)) return { repository: repo, file, ok: false, missing: required, reason: "missing file" };
    const src = readFileSync(file, "utf8");
    const missing = required.filter((needle) => !src.includes(needle));
    return { repository: repo, file, ok: missing.length === 0, missing, required };
  });
}

function isDeletedRow(row) {
  if (!row || typeof row !== "object") return false;
  return row.is_deleted === 1 || row.is_deleted === true || row.isDeleted === true;
}

function hasDeletedAt(row) { return row?.deleted_at != null || row?.deletedAt != null; }
function valuesMatch(row, expected) { return !expected || Object.entries(expected).every(([key, value]) => String(row?.[key]) === String(value)); }
function accountingSnapshot(row) { return Object.fromEntries(ACCOUNTING_FIELDS.map((field) => [field, Number(row?.[field] ?? 0)])); }
function accountingIsZero(row) { return ACCOUNTING_FIELDS.every((field) => Number(row?.[field] ?? 0) === 0); }
async function verifyEndpoint([entity, endpoint, labelField, makeCreate, makeUpdate, expectation, expectedUpdate, profileOnly = false, deleteMode = "soft"]) {
  const payload = { ...makeCreate(), localId: `${runId}-${entity}` };
  const updatePayload = makeUpdate ? makeUpdate() : null;
  const checks = [];
  if (profileOnly) {
    checks.push({ name: "create payload excludes accounting fields", ok: ACCOUNTING_FIELDS.every((field) => !(field in payload)) });
    checks.push({ name: "update payload excludes accounting fields", ok: ACCOUNTING_FIELDS.every((field) => !(field in (updatePayload ?? {}))) });
  }
  const createdResponse = await fetchJson(endpoint, { method: "POST", body: JSON.stringify(payload) });
  const created = unwrap(createdResponse.body);
  const id = serverId(created);
  checks.push({ name: "POST create returns serverId", method: "POST", endpoint, ok: createdResponse.status === 201 && id != null, status: createdResponse.status, serverId: id });
  let updateResponse = null;
  let deleteResponse = null;
  let deletedGetResponse = null;
  let listAfterDeleteResponse = null;
  if (id != null) {
    const createdGetResponse = await fetchJson(`${endpoint}?id=${encodeURIComponent(String(id))}`);
    const createdGet = unwrap(createdGetResponse.body);
    checks.push({ name: "GET confirms backend row exists", method: "GET", endpoint: `${endpoint}?id=<serverId>`, ok: createdGetResponse.ok && String(serverId(createdGet)) === String(id), status: createdGetResponse.status });
    if (profileOnly) checks.push({ name: "accounting fields remain unchanged after create", ok: accountingIsZero(createdGet), accounting: accountingSnapshot(createdGet) });
    if (updatePayload) {
      updateResponse = await fetchJson(`${endpoint}?id=${encodeURIComponent(String(id))}`, { method: "PUT", body: JSON.stringify(updatePayload) });
      checks.push({ name: "PUT update succeeds using serverId", method: "PUT", endpoint: `${endpoint}?id=<serverId>`, ok: updateResponse.ok, status: updateResponse.status });
      const updatedGetResponse = await fetchJson(`${endpoint}?id=${encodeURIComponent(String(id))}`);
      const updatedGet = unwrap(updatedGetResponse.body);
      checks.push({ name: "GET confirms backend row updated", method: "GET", endpoint: `${endpoint}?id=<serverId>`, ok: updatedGetResponse.ok && valuesMatch(updatedGet, expectedUpdate), status: updatedGetResponse.status, expectedUpdate });
      if (profileOnly) checks.push({ name: "accounting fields remain unchanged after update", ok: accountingIsZero(updatedGet), accounting: accountingSnapshot(updatedGet) });
    } else {
      checks.push({ name: "update skipped", ok: true, skipped: true, reason: "no safe update endpoint for this verification" });
    }
    deleteResponse = await fetchJson(`${endpoint}?id=${encodeURIComponent(String(id))}`, { method: "DELETE" });
    const deletedRow = unwrap(deleteResponse.body);
    if (deleteMode === "hard") {
      checks.push({ name: "DELETE hard-deletes backend lookup row using serverId", method: "DELETE", endpoint: `${endpoint}?id=<serverId>`, ok: deleteResponse.ok && deletedRow?.deleteMode === "hard" && !isDeletedRow(deletedRow) && !hasDeletedAt(deletedRow), status: deleteResponse.status, deleteMode: deletedRow?.deleteMode ?? null });
    } else {
      checks.push({ name: "DELETE soft-deletes backend row using serverId", method: "DELETE", endpoint: `${endpoint}?id=<serverId>`, ok: deleteResponse.ok && deletedRow?.deleteMode === "soft" && isDeletedRow(deletedRow) && hasDeletedAt(deletedRow), status: deleteResponse.status, deleteMode: deletedRow?.deleteMode ?? null, softDeleted: isDeletedRow(deletedRow), deletedAtPresent: hasDeletedAt(deletedRow) });
    }
    deletedGetResponse = await fetchJson(`${endpoint}?id=${encodeURIComponent(String(id))}`);
    checks.push({ name: `${deleteMode}-deleted row is hidden from normal GET`, method: "GET", endpoint: `${endpoint}?id=<serverId>`, ok: deletedGetResponse.status === 404, status: deletedGetResponse.status });
    listAfterDeleteResponse = await fetchJson(endpoint);
    const rows = Array.isArray(unwrap(listAfterDeleteResponse.body)) ? unwrap(listAfterDeleteResponse.body) : [];
    checks.push({ name: `${deleteMode}-deleted row is hidden from normal list`, method: "GET", endpoint, ok: listAfterDeleteResponse.ok && !rows.some((row) => String(serverId(row)) === String(id)), status: listAfterDeleteResponse.status });
    if (deleteMode === "soft") {
      const restoreResponse = await fetchJson(`${endpoint}?id=${encodeURIComponent(String(id))}&restore=1`, { method: "PATCH" });
      const restoredRow = unwrap(restoreResponse.body);
      checks.push({ name: "PATCH restore revives backend row", method: "PATCH", endpoint: `${endpoint}?id=<serverId>&restore=1`, ok: restoreResponse.ok && restoredRow?.deleteMode === "restored" && !isDeletedRow(restoredRow) && !hasDeletedAt(restoredRow), status: restoreResponse.status, deleteMode: restoredRow?.deleteMode ?? null });
      const restoredGetResponse = await fetchJson(`${endpoint}?id=${encodeURIComponent(String(id))}`);
      checks.push({ name: "restored row is visible through normal GET", method: "GET", endpoint: `${endpoint}?id=<serverId>`, ok: restoredGetResponse.ok, status: restoredGetResponse.status });
      const secondSoftDeleteResponse = await fetchJson(`${endpoint}?id=${encodeURIComponent(String(id))}`, { method: "DELETE" });
      const secondSoftDeletedRow = unwrap(secondSoftDeleteResponse.body);
      checks.push({ name: "DELETE soft-deletes restored backend row again", method: "DELETE", endpoint: `${endpoint}?id=<serverId>`, ok: secondSoftDeleteResponse.ok && secondSoftDeletedRow?.deleteMode === "soft" && isDeletedRow(secondSoftDeletedRow), status: secondSoftDeleteResponse.status, deleteMode: secondSoftDeletedRow?.deleteMode ?? null });
      const permanentDeleteResponse = await fetchJson(`${endpoint}?id=${encodeURIComponent(String(id))}&permanent=1`, { method: "DELETE" });
      const permanentlyDeletedRow = unwrap(permanentDeleteResponse.body);
      checks.push({ name: "DELETE permanent removes backend row", method: "DELETE", endpoint: `${endpoint}?id=<serverId>&permanent=1`, ok: permanentDeleteResponse.ok && permanentlyDeletedRow?.deleteMode === "permanent", status: permanentDeleteResponse.status, deleteMode: permanentlyDeletedRow?.deleteMode ?? null });
      const permanentGetResponse = await fetchJson(`${endpoint}?id=${encodeURIComponent(String(id))}`);
      checks.push({ name: "permanently deleted row is gone from backend GET", method: "GET", endpoint: `${endpoint}?id=<serverId>`, ok: permanentGetResponse.status === 404, status: permanentGetResponse.status });
    }
  }
  return { entity, endpoint, expectation: expectation ?? null, localMirrorContract: "backend id stored as serverId; IndexedDB key generated separately", ok: checks.every((check) => check.ok), checks, safeMetadata: { serverId: id, label: created?.[labelField] ?? payload[labelField] ?? null, createdStatus: createdResponse.status, updatedStatus: updateResponse?.status ?? null, deletedStatus: deleteResponse?.status ?? null, hiddenGetStatus: deletedGetResponse?.status ?? null, hiddenFromList: listAfterDeleteResponse?.ok ?? null, deleteMode } };
}

function md(report) {
  const out = ["# Existing Sync Coverage Verification Report", "", `Generated: ${report.generatedAt}`, `Run id: ${report.runId}`, `API_BASE_URL: ${report.apiBaseUrl}`, "", "## Summary", "", `- ok: ${report.ok}`, `- sourceFailures: ${report.summary.sourceFailures}`, `- backendFailures: ${report.summary.backendFailures}`, `- packagedUiFailures: ${report.summary.packagedUiFailures}`, `- autoSyncEnabled: ${report.safety.autoSyncEnabled}`, "", "## Source Coverage"];
  for (const r of report.sourceCoverage) out.push(`- ${r.ok ? "PASS" : "FAIL"}: ${r.repository}${r.missing?.length ? ` missing ${r.missing.join(", ")}` : ""}`);
  out.push("", "## Backend Endpoint Verification");
  for (const r of report.backendEndpoints) {
    out.push(`- ${r.ok ? "PASS" : "FAIL"}: ${r.entity} serverId=${r.safeMetadata?.serverId ?? "none"}${r.expectation ? ` (${r.expectation})` : ""}`);
    for (const check of r.checks) out.push(`  - ${check.ok ? "PASS" : "FAIL"}: ${check.method ? `${check.method} ` : ""}${check.endpoint ?? ""} ${check.name}${check.status != null ? ` status=${check.status}` : ""}${check.softDeleted != null ? ` softDeleted=${check.softDeleted}` : ""}${check.deletedAtPresent != null ? ` deletedAtPresent=${check.deletedAtPresent}` : ""}${check.deleteMode ? ` deleteMode=${check.deleteMode}` : ""}`);
  }
  out.push("", "## Packaged Laragon UI Verification");
  for (const r of report.packagedUi.lifecycles ?? []) {
    out.push(`- ${r.ok ? "PASS" : "FAIL"}: ${r.entity} packaged UI lifecycle serverId=${r.serverId ?? "none"}`);
    for (const check of r.checks) out.push(`  - ${check.ok ? "PASS" : "FAIL"}: ${check.name}${check.method ? ` ${check.method}` : ""}${check.endpoint ? ` ${check.endpoint}` : ""}${check.status != null ? ` status=${check.status}` : ""}`);
  }
  out.push("", "## Developer Control Panel Packaged Visibility Verification");
  for (const check of report.packagedUi.developerControlPanel?.checks ?? []) {
    out.push(`- ${check.ok ? "PASS" : "FAIL"}: ${check.name}${check.role ? ` role=${check.role}` : ""}`);
  }
  out.push("", "## Settings Sync Status Packaged Visibility Verification");
  for (const check of report.packagedUi.settingsSyncStatus?.checks ?? []) {
    out.push(`- ${check.ok ? "PASS" : "FAIL"}: ${check.name}${check.role ? ` role=${check.role}` : ""}`);
  }
  out.push("", "## Packaged Invoice Read-Only Verification");
  for (const check of report.packagedUi.invoicesReadOnly?.checks ?? []) {
    out.push(`- ${check.ok ? "PASS" : "FAIL"}: ${check.name}`);
  }
  out.push("", "## Packaged Settings Manual Replay Verification");
  for (const check of report.packagedUi.manualReplay?.checks ?? []) {
    out.push(`- ${check.ok ? "PASS" : "FAIL"}: ${check.name}${check.queueStatus ? ` queueStatus=${check.queueStatus}` : ""}${check.status != null ? ` status=${check.status}` : ""}`);
  }
  out.push("", "The manual replay fixture is an isolated low-risk `brands` create row. The verifier inserts a clearly named local rehearsal queue item, proves it remains pending before the explicit Settings `Sync Now` button click, confirms backend creation and local `serverId` mirroring, proves repeated replay does not duplicate the backend row, exercises a safely rejected invalid fixture, and removes its fixture rows afterward.");
  out.push("", "The browser verification injects isolated role state only to exercise packaged UI guards. It does not use the disabled frontend backdoor, create auth tokens, or expose backup export actions in the panel. Replay is triggered only by an explicit Settings button click for isolated low-risk rehearsal brand fixtures. There is no direct URL route for the panel; the component self-guard also requires role exactly `Dev`.");
  out.push("", "## Skipped Unsafe Areas");
  for (const item of report.skipped) out.push(`- ${item.entity}: ${item.reason}`);
  out.push("", "No new repositories were migrated. No POS stock/accounting/transaction behavior or auto-sync behavior was changed. Manual low-risk CRUD replay failure handling now transitions rejected queue rows from `processing` to `failed` after retry metadata is recorded.", "");
  return out.join("\n");
}

async function main() {
  const generatedAt = new Date().toISOString();
  const health = await fetchJson("health.php").catch((error) => ({ ok: false, status: null, body: String(error) }));
  const sourceCoverage = inspectSources();
  const backendEndpoints = [];
  if (health.ok) for (const cfg of backendChecks) backendEndpoints.push(await verifyEndpoint(cfg).catch((error) => ({ entity: cfg[0], ok: false, error: String(error), checks: [], safeMetadata: {} })));
  const packagedUi = health.ok ? await verifyPackagedUiSync(runId).catch((error) => ({ ok: false, error: String(error), lifecycles: [] })) : { ok: false, error: "backend health check failed", lifecycles: [] };
  const sourceFailures = sourceCoverage.filter((r) => !r.ok).length;
  const backendFailures = health.ok ? backendEndpoints.filter((r) => !r.ok).length : backendChecks.length;
  const packagedUiFailures = packagedUi.ok ? 0 : 1;
  const report = { generatedAt, runId, apiBaseUrl: API_BASE_URL, bugFixes: ["customer/supplier UI pages use backend-aware profile repositories", "remote create mirror stores backend id as serverId with separate local IndexedDB key", "customer/supplier profile create and queue payloads exclude accounting fields", "customer/supplier PHP profile endpoints reject accounting-field writes by omission", "customer/supplier remote accounting summaries normalize to local numeric display values", "customer UI edit preserves mirrored serverId metadata", "expense IndexedDB normalization preserves mirrored serverId metadata", "lookup endpoints hard-delete while restore-capable endpoints remain soft-delete", "restore-capable endpoints expose explicit restore and permanent-delete actions", "held create normalization unwraps PHP success/data responses before mirroring serverId", "POS awaits bundled held-cart persistence before refresh and cart clear", "failed manual CRUD replay rows transition from processing to failed after retry metadata is recorded"], ok: sourceFailures === 0 && backendFailures === 0 && packagedUiFailures === 0, summary: { sourceChecks: sourceCoverage.length, sourceFailures, backendHealthOk: health.ok, backendEndpointChecks: backendEndpoints.length, backendFailures, packagedUiFailures, skipped: skipped.length }, backendHealth: { ok: health.ok, status: health.status ?? null }, sourceCoverage, backendEndpoints, packagedUi, skipped: skipped.map(([entity, reason]) => ({ entity, reason })), safety: { safeTestRecordsOnly: true, noNewRepositoryMigration: true, runtimeBehaviorChanged: true, runtimeChangeScope: "manual CRUD replay failed-row transition only", autoSyncEnabled: false, replayTriggered: "explicit Settings manual replay fixture only", posStockAccountingTransactionChanged: false, sensitiveBodiesLogged: false } };
  const safe = redact(report);
  writeFileSync(jsonPath, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  writeFileSync(mdPath, md(safe), "utf8");
  console.log(JSON.stringify({ ok: report.ok, runId, sourceFailures, backendFailures, packagedUiFailures, reportFiles: { json: jsonPath, markdown: mdPath }, skipped: skipped.length }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => { console.error(JSON.stringify({ ok: false, error: String(error) }, null, 2)); process.exitCode = 1; });
