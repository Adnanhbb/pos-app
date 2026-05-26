#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro-rehearsal/api").replace(/\/+$/, "");
const runId = `rehearsal-sync-coverage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const jsonPath = "sync-coverage-verification-report.json";
const mdPath = "sync-coverage-verification-report.md";

const sourceChecks = [
  ["units", "src/repositories/unitRepository.ts", ["entityApi.create", "entityApi.update", "entityApi.remove", "queueEntityCreate", "queueEntityUpdate", "queueEntityDelete"]],
  ["taxes", "src/repositories/taxRepository.ts", ["entityApi.create", "entityApi.update", "entityApi.remove", "queueEntityCreate", "queueEntityUpdate", "queueEntityDelete"]],
  ["discounts", "src/repositories/discountRepository.ts", ["entityApi.create", "entityApi.update", "entityApi.remove", "queueEntityCreate", "queueEntityUpdate", "queueEntityDelete"]],
  ["brands", "src/repositories/brandsRepository.ts", ["entityApi.create", "entityApi.update", "entityApi.remove", "queueEntityCreate", "queueEntityUpdate", "queueEntityDelete"]],
  ["categories", "src/repositories/categoriesRepository.ts", ["entityApi.create", "entityApi.update", "entityApi.remove", "queueEntityCreate", "queueEntityUpdate", "queueEntityDelete"]],
  ["expenses", "src/repositories/expenseRepository.ts", ["entityApi.create", "entityApi.update", "entityApi.remove", "queueEntityCreate", "queueEntityUpdate", "queueEntityDelete"]],
  ["users/staff", "src/repositories/staffRepository.ts", ["entityApi.create", "entityApi.update", "entityApi.remove", "queueEntityCreate", "queueEntityUpdate", "queueEntityDelete"]],
  ["settings", "src/repositories/settingsRepository.ts", ["entityApi.update", "queueEntityOperation", "applyRemoteMirror"]],
  ["held", "src/repositories/heldRepository.ts", ["entityApi.create", "entityApi.remove", "queueEntityOperation", "items"]],
  ["customers", "src/repositories/customerRepository.ts", ["entityApi.create", "entityApi.update", "entityApi.remove", "stripAccountingFields", "hasAccountingFieldChange"]],
  ["suppliers", "src/repositories/suppliersRepository.ts", ["entityApi.create", "entityApi.update", "entityApi.remove", "stripAccountingFields", "hasAccountingFieldChange"]],
  ["items", "src/repositories/itemsRepository.ts", ["entityApi.update", "pickSafeItemProfilePayload", "hasUnsafeItemFieldChange", "Item create is intentionally local-only"]],
];

const backendChecks = [
  ["units", "units.php", "name", () => ({ name: `Rehearsal Verify Unit ${runId}`, shortName: "rvu", itemCount: 0 }), () => ({ name: `Rehearsal Verify Unit Updated ${runId}` })],
  ["taxes", "taxes.php", "name", () => ({ name: `Rehearsal Verify Tax ${runId}`, value: 6, type: "percentage" }), () => ({ value: 7 })],
  ["discounts", "discounts.php", "name", () => ({ name: `Rehearsal Verify Discount ${runId}`, value: 4, type: "amount" }), () => ({ value: 5 })],
  ["brands", "brands.php", "name", () => ({ name: `Rehearsal Verify Brand ${runId}`, itemCount: 0 }), () => ({ itemCount: 1 })],
  ["categories", "categories.php", "name", () => ({ name: `Rehearsal Verify Category ${runId}`, itemCount: 0 }), () => ({ itemCount: 1 })],
  ["expenses", "expenses.php", "category", () => ({ date: "2026-05-26", category: `Rehearsal Verify Expense ${runId}`, amount: 12, description: "safe rehearsal expense verification" }), () => ({ amount: 13 })],
  ["customers", "customers.php", "name", () => ({ name: `Rehearsal Verify Customer ${runId}`, mobile: "03000000001", cnic: "RV-CNIC", address: "safe rehearsal customer" }), () => ({ address: "safe rehearsal customer updated" }), "profile fields only; no accounting fields sent"],
  ["suppliers", "suppliers.php", "name", () => ({ name: `Rehearsal Verify Supplier ${runId}`, mobile: "03000000002", cnic: "RV-SCNIC", address: "safe rehearsal supplier" }), () => ({ address: "safe rehearsal supplier updated" }), "profile fields only; no accounting fields sent"],
  ["users", "users.php", "Username", () => ({ Username: `rv-user-${runId}`.slice(0, 90), Name: `Rehearsal Verify User ${runId}`, Mobile: "03000000003", Role: "admin", Password: `RvPass-${runId}` }), () => ({ Mobile: "03000000004" }), "password is sent only as create credential and is redacted from reports"],
  ["held", "held.php", "invoiceNo", () => ({ invoiceNo: `RV-HELD-${runId}`.slice(0, 95), date: "2026-05-26", transactionType: "Sale", customerId: null, supplierId: null, customerName: `Rehearsal Verify Held ${runId}`, supplierName: "", subtotal: 10, discount: 0, tax: 0, grandTotal: 10, paid: 10, discountMode: "flat", discountValue: 0, taxMode: "flat", taxValue: 0, items: [{ itemId: 0, name: "rehearsal held item", qty: 1, price: 10 }] }), null, "held header+items logical payload only"],
];

const skipped = [
  ["settings live mutation", "Skipped because settings update mutates global business configuration; source wiring is inspected only."],
  ["items safe profile update", "Skipped because it requires an existing serverId item fixture; item create/delete/stock/batch/cylinder paths must not be exercised here."],
  ["live IndexedDB repository mirror", "Skipped in the packaged Laragon verifier because source repositories are not directly importable from the production build; serverId mirror behavior is covered here by source inspection and should stay covered by source-level sync tests."],
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

async function verifyEndpoint([entity, endpoint, labelField, makeCreate, makeUpdate, expectation]) {
  const payload = { ...makeCreate(), localId: `${runId}-${entity}` };
  const createdResponse = await fetchJson(endpoint, { method: "POST", body: JSON.stringify(payload) });
  const created = unwrap(createdResponse.body);
  const id = serverId(created);
  const checks = [{ name: "create returns serverId", ok: createdResponse.ok && id != null, status: createdResponse.status, serverId: id }];
  let updateResponse = null;
  if (makeUpdate && id != null) {
    updateResponse = await fetchJson(`${endpoint}?id=${encodeURIComponent(String(id))}`, { method: "PUT", body: JSON.stringify(makeUpdate()) });
    checks.push({ name: "update succeeds", ok: updateResponse.ok, status: updateResponse.status });
  } else {
    checks.push({ name: "update skipped", ok: true, skipped: true, reason: "no safe update endpoint for this verification" });
  }
  let deleteResponse = null;
  if (id != null) {
    deleteResponse = await fetchJson(`${endpoint}?id=${encodeURIComponent(String(id))}`, { method: "DELETE" });
    checks.push({ name: "delete/soft-delete succeeds", ok: deleteResponse.ok, status: deleteResponse.status });
  }
  return { entity, endpoint, expectation: expectation ?? null, ok: checks.every((c) => c.ok), checks, safeMetadata: { serverId: id, label: created?.[labelField] ?? payload[labelField] ?? null, createdStatus: createdResponse.status, updatedStatus: updateResponse?.status ?? null, deletedStatus: deleteResponse?.status ?? null } };
}

function md(report) {
  const out = ["# Existing Sync Coverage Verification Report", "", `Generated: ${report.generatedAt}`, `Run id: ${report.runId}`, `API_BASE_URL: ${report.apiBaseUrl}`, "", "## Summary", "", `- ok: ${report.ok}`, `- sourceFailures: ${report.summary.sourceFailures}`, `- backendFailures: ${report.summary.backendFailures}`, `- autoSyncEnabled: ${report.safety.autoSyncEnabled}`, "", "## Source Coverage"];
  for (const r of report.sourceCoverage) out.push(`- ${r.ok ? "PASS" : "FAIL"}: ${r.repository}${r.missing?.length ? ` missing ${r.missing.join(", ")}` : ""}`);
  out.push("", "## Backend Endpoint Verification");
  for (const r of report.backendEndpoints) out.push(`- ${r.ok ? "PASS" : "FAIL"}: ${r.entity} serverId=${r.safeMetadata?.serverId ?? "none"}${r.expectation ? ` (${r.expectation})` : ""}`);
  out.push("", "## Skipped Unsafe Areas");
  for (const item of report.skipped) out.push(`- ${item.entity}: ${item.reason}`);
  out.push("", "No new repositories were migrated. No POS stock/accounting/transaction behavior, replay behavior, or auto-sync behavior was changed.", "");
  return out.join("\n");
}

async function main() {
  const generatedAt = new Date().toISOString();
  const health = await fetchJson("health.php").catch((error) => ({ ok: false, status: null, body: String(error) }));
  const sourceCoverage = inspectSources();
  const backendEndpoints = [];
  if (health.ok) for (const cfg of backendChecks) backendEndpoints.push(await verifyEndpoint(cfg).catch((error) => ({ entity: cfg[0], ok: false, error: String(error), checks: [], safeMetadata: {} })));
  const sourceFailures = sourceCoverage.filter((r) => !r.ok).length;
  const backendFailures = health.ok ? backendEndpoints.filter((r) => !r.ok).length : backendChecks.length;
  const report = { generatedAt, runId, apiBaseUrl: API_BASE_URL, ok: sourceFailures === 0 && backendFailures === 0, summary: { sourceChecks: sourceCoverage.length, sourceFailures, backendHealthOk: health.ok, backendEndpointChecks: backendEndpoints.length, backendFailures, skipped: skipped.length }, backendHealth: { ok: health.ok, status: health.status ?? null }, sourceCoverage, backendEndpoints, skipped: skipped.map(([entity, reason]) => ({ entity, reason })), safety: { safeTestRecordsOnly: true, noNewRepositoryMigration: true, runtimeBehaviorChanged: false, autoSyncEnabled: false, replayTriggered: false, posStockAccountingTransactionChanged: false, sensitiveBodiesLogged: false } };
  const safe = redact(report);
  writeFileSync(jsonPath, `${JSON.stringify(safe, null, 2)}\n`, "utf8");
  writeFileSync(mdPath, md(safe), "utf8");
  console.log(JSON.stringify({ ok: report.ok, runId, sourceFailures, backendFailures, reportFiles: { json: jsonPath, markdown: mdPath }, skipped: skipped.length }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => { console.error(JSON.stringify({ ok: false, error: String(error) }, null, 2)); process.exitCode = 1; });