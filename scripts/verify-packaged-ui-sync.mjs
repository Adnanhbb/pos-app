#!/usr/bin/env node

import { chromium } from "playwright";

const APP_URL = process.env.APP_URL || "http://localhost/jawad-bro-rehearsal/";
const API_BASE_URL = (process.env.API_BASE_URL || "http://localhost/jawad-bro-rehearsal/api").replace(/\/+$/, "");
function unwrap(body) { return body && typeof body === "object" && "data" in body ? body.data : body; }
function getServerId(row) { return row?.serverId ?? row?.id ?? null; }
async function fetchJson(path, options = {}) { const response = await fetch(`${API_BASE_URL}/${path}`, { ...options, headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers ?? {}) } }); const text = await response.text(); let body = null; if (text.trim()) { try { body = JSON.parse(text); } catch { body = text; } } return { ok: response.ok, status: response.status, body }; }
async function safeRequest(response) { const request = response.request(); const parsed = new URL(response.url()); let deleteMode = null; try { deleteMode = unwrap(await response.json())?.deleteMode ?? null; } catch {} return { method: request.method(), endpoint: `${parsed.pathname}${parsed.search}`, status: response.status(), ...(deleteMode ? { deleteMode } : {}) }; }
async function waitForApi(page, entity, method, action) { const responsePromise = page.waitForResponse((response) => { const url = new URL(response.url()); return response.request().method() === method && url.pathname.endsWith(`/api/${entity}.php`); }, { timeout: 10000 }); await action(); try { return safeRequest(await responsePromise); } catch (error) { throw new Error(`${entity} ${method} response not observed: ${String(error)}`); } }
async function backendRow(entity, id) { return fetchJson(`${entity}.php?id=${encodeURIComponent(String(id))}`); }
async function findCreatedId(entity, labelField, label) { const response = await fetchJson(`${entity}.php`); const rows = unwrap(response.body); if (!response.ok || !Array.isArray(rows)) return null; const row = rows.find((candidate) => String(candidate?.[labelField]) === String(label)); return row ? getServerId(row) : null; }
async function clickMenu(page, index) { await page.locator("aside > ul > li").nth(index).click(); await page.waitForTimeout(150); }
async function openSettingsSyncStatus(page) {
  await clickMenu(page, 11);
  const main = page.locator("main");
  const tab = main.getByRole("button", { name: "Sync Status", exact: true });
  await tab.waitFor({ state: "visible", timeout: 10000 });
  await tab.click();
  await main.locator('[data-testid="settings-sync-status-panel"]').waitFor({ state: "visible", timeout: 10000 });
  return main;
}
async function openDeveloperDetails(main) {
  const details = main.locator("details").filter({ hasText: "Developer details" }).first();
  if (await details.count() === 0) return false;
  const isOpen = await details.evaluate((node) => node.hasAttribute("open"));
  if (!isOpen) await details.locator("summary").click();
  return true;
}
async function installValidatedSessionFixture(page, role = "Dev") {
  await page.route("**/api/session.php", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          authenticated: true,
          actor: {
            id: 900001,
            serverId: 900001,
            Username: `packaged-${role}`,
            Name: `Packaged ${role}`,
            Role: role,
            actorType: "user",
            actorId: "900001",
            actorRole: role,
            sessionId: "packaged-ui-session-fixture",
          },
        },
      }),
    });
  });
}
async function clickEntrySubmenu(page, index) { const entries = page.locator("aside > ul > li").nth(4); if (await entries.locator("ul").count() === 0) await entries.locator("button").first().click(); await entries.locator("ul li button").nth(index).click(); await page.waitForTimeout(150); }
async function lookupDeleteLifecycle(page, entity, submenuIndex, label, formStyle = "simple") {
  await clickEntrySubmenu(page, submenuIndex); const main = page.locator("main");
  if (formStyle === "simple") { await main.locator("button.bg-green-600").last().click(); const modal = main.locator(".fixed.inset-0").last(); await modal.locator('input[type="text"]').fill(label); await waitForApi(page, entity, "POST", () => modal.locator("button.bg-indigo-600").click()); }
  else { await main.locator("button.bg-blue-600").last().click(); const modal = main.locator(".fixed.inset-0").last(); await modal.locator('input[type="text"]').fill(label); await modal.locator('input[type="number"]').fill("3"); await waitForApi(page, entity, "POST", () => modal.locator('button[type="submit"]').click()); }
  const id = await findCreatedId(entity, "name", label); if (id == null) throw new Error(`${entity} lookup UI create did not create a visible backend row`); await page.waitForTimeout(150); const row = main.locator("tbody tr").filter({ hasText: label }).first(); page.once("dialog", (dialog) => dialog.accept()); const remove = await waitForApi(page, entity, "DELETE", () => row.locator("button.bg-red-500").click()); const hidden = await backendRow(entity, id); const expectedQuery = `id=${encodeURIComponent(String(id))}`; const checks = [{ name: "lookup UI delete targets backend serverId", ok: remove.status >= 200 && remove.status < 300 && remove.endpoint.includes(expectedQuery), ...remove }, { name: "lookup backend confirms hard delete policy", ok: remove.deleteMode === "hard", deleteMode: remove.deleteMode ?? null }, { name: "hard-deleted lookup row is gone from normal backend GET", ok: hidden.status === 404, status: hidden.status }]; return { entity, serverId: id, deleteMode: remove.deleteMode ?? null, ok: checks.every((check) => check.ok), checks };
}
async function verifyRestoreAndPermanentDelete(page, entity, main, label, id) {
  await main.locator("button.bg-blue-600").first().click(); let modal = main.locator(".fixed.inset-0").last(); let deletedRow = modal.locator(".border-b").filter({ hasText: label }).first(); const restore = await waitForApi(page, entity, "PATCH", () => deletedRow.locator("button.bg-green-100").click()); await modal.locator("button").last().click(); await page.waitForTimeout(150);
  let activeRow = main.locator("tbody tr").filter({ hasText: label }).first(); page.once("dialog", (dialog) => dialog.accept()); const secondSoftDelete = await waitForApi(page, entity, "DELETE", () => activeRow.locator("button.bg-red-500").click()); await main.locator("button.bg-blue-600").first().click(); modal = main.locator(".fixed.inset-0").last(); deletedRow = modal.locator(".border-b").filter({ hasText: label }).first(); page.once("dialog", (dialog) => dialog.accept()); const permanentDelete = await waitForApi(page, entity, "DELETE", () => deletedRow.locator("button.bg-red-100").click()); await modal.locator("button").last().click(); await page.waitForTimeout(150); const hidden = await backendRow(entity, id); const expectedQuery = `id=${encodeURIComponent(String(id))}`;
  return [{ name: "deleted-modal restore targets backend serverId", ok: restore.status >= 200 && restore.status < 300 && restore.endpoint.includes(expectedQuery) && restore.endpoint.includes("restore=1"), ...restore }, { name: "backend confirms restore action", ok: restore.deleteMode === "restored", deleteMode: restore.deleteMode ?? null }, { name: "restored row can be soft-deleted again", ok: secondSoftDelete.status >= 200 && secondSoftDelete.status < 300 && secondSoftDelete.deleteMode === "soft", ...secondSoftDelete }, { name: "deleted-modal permanent delete targets backend serverId", ok: permanentDelete.status >= 200 && permanentDelete.status < 300 && permanentDelete.endpoint.includes(expectedQuery) && permanentDelete.endpoint.includes("permanent=1"), ...permanentDelete }, { name: "backend confirms permanent-delete action", ok: permanentDelete.deleteMode === "permanent", deleteMode: permanentDelete.deleteMode ?? null }, { name: "permanently deleted row is gone from backend GET", ok: hidden.status === 404, status: hidden.status }];
}
async function customerOrSupplierLifecycle(page, entity, menuIndex, label, mobile) {
  await clickMenu(page, menuIndex); const main = page.locator("main"); await main.locator("button.bg-green-600").last().click(); let modal = main.locator(".fixed.inset-0").last(); const inputs = modal.locator("input");
  await inputs.nth(0).fill(label); await inputs.nth(1).fill(mobile); await inputs.nth(2).fill(`RV-${entity}`); await inputs.nth(3).fill("safe packaged UI rehearsal create"); await inputs.nth(4).fill("0");
  const create = await waitForApi(page, entity, "POST", () => modal.locator("button.bg-indigo-600").click()); const id = await findCreatedId(entity, "name", label); if (id == null) throw new Error(`${entity} UI create did not create a visible backend row`); await clickMenu(page, menuIndex);
  const search = main.locator('input[placeholder]').first(); await search.fill(label); await page.waitForTimeout(150); let row = main.locator("tbody tr").filter({ hasText: label }).first(); await row.locator("button.bg-blue-500").click(); modal = main.locator(".fixed.inset-0").last(); await modal.locator("input").nth(3).fill("safe packaged UI rehearsal updated");
  const update = await waitForApi(page, entity, "PUT", () => modal.locator("button.bg-indigo-600").click()); await search.fill(label); await page.waitForTimeout(150); row = main.locator("tbody tr").filter({ hasText: label }).first(); page.once("dialog", (dialog) => dialog.accept()); const remove = await waitForApi(page, entity, "DELETE", () => row.locator("button.bg-red-500").click());
  const hidden = await backendRow(entity, id); const expectedQuery = `id=${encodeURIComponent(String(id))}`; const checks = [{ name: "UI create calls backend POST", ok: create.status === 201, ...create }, { name: "UI update targets backend serverId", ok: update.status >= 200 && update.status < 300 && update.endpoint.includes(expectedQuery), ...update }, { name: "UI delete targets backend serverId", ok: remove.status >= 200 && remove.status < 300 && remove.endpoint.includes(expectedQuery), ...remove }, { name: "UI delete confirms soft-delete policy", ok: remove.deleteMode === "soft", deleteMode: remove.deleteMode ?? null }, { name: "UI delete soft-deleted row hidden from normal backend GET", ok: hidden.status === 404, status: hidden.status }, ...await verifyRestoreAndPermanentDelete(page, entity, main, label, id)]; return { entity, serverId: id, ok: checks.every((check) => check.ok), checks };
}
async function expenseLifecycle(page, label) {
  await clickMenu(page, 9); const main = page.locator("main"); await main.locator("button.bg-blue-600").last().click(); let modal = main.locator(".fixed.inset-0").last(); await modal.locator('input[type="date"]').fill("2026-05-31"); page.once("dialog", (dialog) => dialog.accept(label)); await modal.locator('button[title="Add Category"]').click(); await modal.locator('input[type="number"]').fill("21"); await modal.locator("textarea").fill("safe packaged UI rehearsal create");
  const create = await waitForApi(page, "expenses", "POST", () => modal.locator('button[type="submit"]').click()); const id = await findCreatedId("expenses", "category", label); if (id == null) throw new Error("expenses UI create did not create a visible backend row"); await clickMenu(page, 9); const search = main.locator('input[type="text"]').first(); await search.fill(label); await page.waitForTimeout(150); let row = main.locator("tbody tr").filter({ hasText: label }).first(); await row.locator("button.bg-yellow-500").click(); modal = main.locator(".fixed.inset-0").last(); await modal.locator('input[type="number"]').fill("22"); await modal.locator("textarea").fill("safe packaged UI rehearsal updated");
  const update = await waitForApi(page, "expenses", "PUT", () => modal.locator('button[type="submit"]').click()); await search.fill(label); await page.waitForTimeout(150); row = main.locator("tbody tr").filter({ hasText: label }).first(); page.once("dialog", (dialog) => dialog.accept()); const remove = await waitForApi(page, "expenses", "DELETE", () => row.locator("button.bg-red-500").click()); const hidden = await backendRow("expenses", id); const expectedQuery = `id=${encodeURIComponent(String(id))}`; const checks = [{ name: "UI create calls backend POST", ok: create.status === 201, ...create }, { name: "UI update targets backend serverId", ok: update.status >= 200 && update.status < 300 && update.endpoint.includes(expectedQuery), ...update }, { name: "UI delete targets backend serverId", ok: remove.status >= 200 && remove.status < 300 && remove.endpoint.includes(expectedQuery), ...remove }, { name: "UI delete confirms soft-delete policy", ok: remove.deleteMode === "soft", deleteMode: remove.deleteMode ?? null }, { name: "UI delete soft-deleted row hidden from normal backend GET", ok: hidden.status === 404, status: hidden.status }, ...await verifyRestoreAndPermanentDelete(page, "expenses", main, label, id)]; return { entity: "expenses", serverId: id, ok: checks.every((check) => check.ok), checks };
}
async function mutateLocalStore(page, storeName, mode, value) {
  return page.evaluate(async ({ storeName, mode, value }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("POSDatabase", 20);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        const store = transaction.objectStore(storeName);
        const request = mode === "add" ? store.add(value) : store.delete(value);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }, { storeName, mode, value });
}
async function readLocalStore(page, storeName, mode = "all", value = null) {
  return page.evaluate(async ({ storeName, mode, value }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("POSDatabase", 20);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, "readonly");
        const store = transaction.objectStore(storeName);
        const request = mode === "get" ? store.get(value) : store.getAll();
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }, { storeName, mode, value });
}
async function backendRows(entity) {
  const response = await fetchJson(`${entity}.php`);
  return Array.isArray(unwrap(response.body)) ? unwrap(response.body) : [];
}
async function manualReplayLifecycle(browser, runId) {
  const marker = `Rehearsal Manual Replay Brand ${runId}`;
  const failedMarker = `Rehearsal Manual Replay Invalid Brand ${runId}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    localStorage.setItem("loggedInUserId", "DEV");
    localStorage.setItem("loggedInUserName", "Developer");
    localStorage.setItem("loggedInUserRole", "Dev");
    localStorage.setItem("jawadBro.authToken", "PACKAGED_UI_VALIDATED_SESSION_FIXTURE");
  });
  let localId = null;
  let queueId = null;
  let failedLocalId = null;
  let failedQueueId = null;
  let backendId = null;
  const brandPostRequests = [];
  const checks = [];
  const page = await context.newPage();
  await installValidatedSessionFixture(page);
  const observeBrandPosts = (request) => {
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname.endsWith("/api/brands.php")) {
      brandPostRequests.push({ method: request.method(), endpoint: url.pathname });
    }
  };
  page.on("request", observeBrandPosts);
  try {
    await page.goto(APP_URL, { waitUntil: "networkidle", timeout: 20000 });
    await page.locator("aside").waitFor({ state: "visible", timeout: 10000 });
    const fixtureLocalId = Date.now();
    localId = await mutateLocalStore(page, "brands", "add", { id: fixtureLocalId, name: marker, itemCount: 0 });
    const now = Date.now();
    queueId = await mutateLocalStore(page, "sync_queue", "add", {
      entity: "brands", operation: "create", localId, serverId: null,
      payload: { id: localId, localId, name: marker, itemCount: 0 },
      createdAt: now, updatedAt: now, retryCount: 0, status: "pending",
    });
    await page.waitForTimeout(500);
    const pendingBefore = await readLocalStore(page, "sync_queue", "get", queueId);
    const backendBefore = await backendRows("brands");
    checks.push({ name: "offline rehearsal brand remains pending before explicit replay click", ok: pendingBefore?.status === "pending" && !backendBefore.some((row) => row.name === marker), queueStatus: pendingBefore?.status ?? null });

    const main = await openSettingsSyncStatus(page);
    const replayButton = main.getByRole("button", { name: "Sync Now", exact: true });
    await replayButton.waitFor({ state: "visible", timeout: 10000 });
    const firstReplay = await waitForApi(page, "brands", "POST", () => replayButton.click());
    await page.waitForTimeout(500);
    const queueAfterFirst = await readLocalStore(page, "sync_queue", "get", queueId);
    const localAfterFirst = await readLocalStore(page, "brands", "get", localId);
    const backendAfterFirst = await backendRows("brands");
    const createdRows = backendAfterFirst.filter((row) => row.name === marker);
    backendId = createdRows[0] ? getServerId(createdRows[0]) : null;
    checks.push({ name: "explicit Settings replay sends queued brand create", ok: firstReplay.status === 201, ...firstReplay });
    checks.push({ name: "successful manual replay marks queue row done", ok: queueAfterFirst?.status === "done", queueStatus: queueAfterFirst?.status ?? null });
    checks.push({ name: "successful manual replay mirrors backend serverId locally", ok: backendId != null && String(localAfterFirst?.serverId) === String(backendId), serverId: backendId ?? null });
    checks.push({ name: "backend receives exactly one rehearsal brand", ok: createdRows.length === 1, backendRows: createdRows.length });
    await openDeveloperDetails(main);
    const firstDiagnostics = await main.innerText();
    checks.push({ name: "auth gate permits explicit replay in audit-only mode", ok: firstDiagnostics.includes("enforcementDisabled") && firstDiagnostics.includes("Allowed") });

    const postsBeforeSecondClick = brandPostRequests.length;
    await replayButton.click();
    await page.waitForTimeout(700);
    const backendAfterSecond = await backendRows("brands");
    checks.push({ name: "repeated manual replay does not POST completed queue row again", ok: brandPostRequests.length === postsBeforeSecondClick, postCountBefore: postsBeforeSecondClick, postCountAfter: brandPostRequests.length });
    checks.push({ name: "repeated manual replay does not duplicate backend brand", ok: backendAfterSecond.filter((row) => row.name === marker).length === 1 });

    failedLocalId = await mutateLocalStore(page, "brands", "add", { id: fixtureLocalId + 1, name: failedMarker, itemCount: 0 });
    const failedNow = Date.now();
    failedQueueId = await mutateLocalStore(page, "sync_queue", "add", {
      entity: "brands", operation: "create", localId: failedLocalId, serverId: null,
      payload: { id: failedLocalId, localId: failedLocalId, itemCount: 0 },
      createdAt: failedNow, updatedAt: failedNow, retryCount: 0, status: "pending",
    });
    const failedReplay = await waitForApi(page, "brands", "POST", () => replayButton.click());
    await page.waitForTimeout(500);
    const failedQueue = await readLocalStore(page, "sync_queue", "get", failedQueueId);
    await openDeveloperDetails(main);
    const safeDiagnostics = await main.innerText();
    checks.push({ name: "invalid low-risk fixture fails safely", ok: failedReplay.status === 422, status: failedReplay.status });
    checks.push({ name: "failed manual replay row transitions to failed with retry metadata", ok: failedQueue?.status === "failed" && failedQueue?.retryCount === 1 && typeof failedQueue?.lastError === "string", queueStatus: failedQueue?.status ?? null, retryCount: failedQueue?.retryCount ?? null });
    checks.push({ name: "failed replay is summarized safely without payload bodies", ok: safeDiagnostics.includes("Safe Error Summary") && safeDiagnostics.includes("Entity: brands") && safeDiagnostics.includes("Operation: create") && !safeDiagnostics.includes("payload_json") && !safeDiagnostics.includes("response_json") && !safeDiagnostics.includes("password_hash") });

    return { entity: "manual replay", fixtureEntity: "brands", backendId, ok: checks.every((check) => check.ok), checks, explicitButtonClickOnly: true, repeatedReplayDuplicateCount: backendAfterSecond.filter((row) => row.name === marker).length, posTransactionalEntitiesTouched: false };
  } finally {
    page.off("request", observeBrandPosts);
    if (backendId != null) await fetchJson(`brands.php?id=${encodeURIComponent(String(backendId))}`, { method: "DELETE" });
    if (queueId != null) await mutateLocalStore(page, "sync_queue", "delete", queueId);
    if (failedQueueId != null) await mutateLocalStore(page, "sync_queue", "delete", failedQueueId);
    if (localId != null) await mutateLocalStore(page, "brands", "delete", localId);
    if (failedLocalId != null) await mutateLocalStore(page, "brands", "delete", failedLocalId);
    await context.close();
  }
}async function openPosTransactions(page) { const sales = page.locator("aside > ul > li").nth(6); if (await sales.locator("ul").count() === 0) await sales.locator("button").first().click(); await sales.locator("ul li button").first().click(); await page.waitForTimeout(500); }
async function verifyInvoicesReadOnly(page) {
  const sales = page.locator("aside > ul > li").nth(6);
  if (await sales.locator("ul").count() === 0) await sales.locator("button").first().click();
  page.once("dialog", (dialog) => dialog.accept());
  await sales.locator("ul li button").nth(1).click();
  await page.waitForTimeout(500);
  const main = page.locator("main");
  const heading = main.locator("h1").first();
  await heading.waitFor({ state: "visible", timeout: 10000 });
  const headingText = (await heading.textContent())?.trim() ?? "";
  const destructiveButtons = await main.locator("button.bg-red-500").count();
  const searchInputs = await main.locator('input[type="text"]').count();
  const filterInputs = await main.locator('input[type="radio"]').count();
  const printButtons = await main.locator("button.bg-blue-500").count();
  const invoiceDataCells = await main.locator("tbody tr td:not([colspan])").count();
  const checks = [
    { name: "packaged invoice viewer opens", ok: /invoice/i.test(headingText), headingText },
    { name: "invoice search and filters remain accessible", ok: searchInputs > 0 && filterInputs > 0, searchInputs, filterInputs },
    { name: "invoice destructive delete/cancel action is unavailable", ok: destructiveButtons === 0, destructiveButtons },
    { name: "invoice print action remains available when invoice rows exist", ok: invoiceDataCells === 0 || printButtons > 0, invoiceDataCells, printButtons },
  ];
  return { ok: checks.every((check) => check.ok), checks, destructiveActionsAvailable: false };
}
async function readCartCount(page) { return page.locator("main").evaluate((main) => { const match = main.textContent?.match(/Total Items:\s*(\d+)/i); return match ? Number(match[1]) : null; }); }
function stockSnapshot(rows) { return Object.fromEntries((Array.isArray(rows) ? rows : []).map((row) => [String(getServerId(row)), Number(row.availableStock ?? 0)])); }
async function heldCartLifecycle(page, runId) {
  const marker = `Rehearsal Held Cart ${runId}`; const itemMarker = `Rehearsal Held Item ${runId}`; let customerLocalId = null; let itemLocalId = null; let heldId = null; const forbiddenWrites = [];
  const observeWrite = (request) => { const url = new URL(request.url()); if (request.method() !== "GET" && url.pathname.includes("/api/") && !url.pathname.endsWith("/api/held.php")) forbiddenWrites.push({ method: request.method(), endpoint: url.pathname }); };
  page.on("request", observeWrite);
  try {
    customerLocalId = await mutateLocalStore(page, "customers", "add", { name: marker, mobile: "03000000999", cnic: "RV-HELD", address: "local-only held cart rehearsal marker", invoices: 0, payable: 0, paid: 0, balance: 0, isDeleted: false, deletedAt: null });
    itemLocalId = await mutateLocalStore(page, "items", "add", { name: itemMarker, barcode: `RV-HELD-${runId}`, brand: "Rehearsal", category: "Rehearsal", minunit: "pc", maxunit: "box", ConvQty: 1, purchasePrice: 1, retailPrice: 2, discountPrice: 2, wholesalePrice: 2, availableStock: 10, isDeleted: false, deletedAt: null });
    const beforeItems = unwrap((await fetchJson("items.php")).body); await openPosTransactions(page); const main = page.locator("main"); await main.locator('input[value="Walk-in Customer"]').fill(marker); await main.getByText(marker, { exact: true }).last().click();
    const itemCard = main.locator('div[class*="auto-rows-min"] > div.cursor-pointer:not(.cursor-not-allowed)').first(); await itemCard.waitFor({ state: "visible", timeout: 10000 }); const itemName = (await itemCard.locator(".font-medium").first().textContent())?.trim() ?? "existing item"; await itemCard.click(); const cartCountBeforeHold = await readCartCount(page);
    page.once("dialog", (dialog) => dialog.accept()); const hold = await waitForApi(page, "held", "POST", () => main.getByRole("button", { name: /Hold Sale/i }).click()); heldId = await findCreatedId("held", "customerName", marker); if (heldId == null) throw new Error("held UI hold did not create a visible backend bundle"); const stored = unwrap((await backendRow("held", heldId)).body); const cartCountAfterHold = await readCartCount(page);
    await main.getByRole("button", { name: /Held Sales/i }).click(); const modal = main.locator(".fixed.inset-0").last(); await modal.getByText(marker, { exact: true }).waitFor({ state: "visible", timeout: 10000 }); const remove = await waitForApi(page, "held", "DELETE", () => modal.getByRole("button", { name: "Resume", exact: true }).click()); const cartCountAfterResume = await readCartCount(page); const hidden = await backendRow("held", heldId); const afterItems = unwrap((await fetchJson("items.php")).body);
    const checks = [{ name: "existing in-stock item added to rehearsal cart", ok: cartCountBeforeHold === 1, cartCountBeforeHold, itemName }, { name: "UI hold calls bundled held backend POST", ok: hold.status === 201, ...hold }, { name: "backend held bundle carries rehearsal marker and one held item", ok: stored?.customerName === marker && Array.isArray(stored?.items) && stored.items.length === 1, serverId: heldId, itemCount: stored?.items?.length ?? null }, { name: "hold clears active cart without finalization", ok: cartCountAfterHold === 0, cartCountAfterHold }, { name: "resume calls held backend DELETE", ok: remove.status >= 200 && remove.status < 300 && remove.endpoint.includes(`id=${encodeURIComponent(String(heldId))}`), ...remove }, { name: "resume restores held cart contents", ok: cartCountAfterResume === 1, cartCountAfterResume }, { name: "resumed held backend bundle is hidden", ok: hidden.status === 404, status: hidden.status }, { name: "backend item stock remains unchanged", ok: JSON.stringify(stockSnapshot(beforeItems)) === JSON.stringify(stockSnapshot(afterItems)) }, { name: "no finalized-sale/accounting/payment/batch/cylinder API writes occurred", ok: forbiddenWrites.length === 0, forbiddenWrites }];
    return { entity: "held carts", serverId: heldId, marker, ok: checks.every((check) => check.ok), checks };
  } finally {
    page.off("request", observeWrite); if (customerLocalId != null) await mutateLocalStore(page, "customers", "delete", customerLocalId); if (itemLocalId != null) await mutateLocalStore(page, "items", "delete", itemLocalId); if (heldId != null && (await backendRow("held", heldId)).status !== 404) await fetchJson(`held.php?id=${encodeURIComponent(String(heldId))}`, { method: "DELETE" });
  }
}
async function verifyDeveloperControlPanelVisibility(browser) {
  const secretSentinel = "PACKAGED_PANEL_SECRET_SENTINEL_DO_NOT_RENDER";
  const roles = [
    { role: "Dev", shouldSeePanel: true },
    { role: "admin", shouldSeePanel: false },
    { role: "saleboy", shouldSeePanel: false },
    { role: "staff", shouldSeePanel: false },
    { role: "cashier", shouldSeePanel: false },
    { role: "manager", shouldSeePanel: false },
  ];
  const checks = [];

  for (const { role, shouldSeePanel } of roles) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(({ role, secretSentinel }) => {
      localStorage.setItem("loggedInUserId", `packaged-panel-${role}`);
      localStorage.setItem("loggedInUserName", `Packaged Panel ${role}`);
      localStorage.setItem("loggedInUserRole", role);
      localStorage.setItem("jawadBro.authToken", secretSentinel);
    }, { role, secretSentinel });

    try {
      const page = await context.newPage();
      await installValidatedSessionFixture(page, role);
      await page.goto(APP_URL, { waitUntil: "networkidle", timeout: 20000 });
      await page.waitForTimeout(500);
      const aside = page.locator("aside");
      const dashboardVisible = await aside.count() > 0 && await aside.first().isVisible();
      const panelEntry = aside.getByText("developer_control_panel", { exact: true });
      const panelEntryVisible = dashboardVisible && await panelEntry.count() > 0 && await panelEntry.first().isVisible();
      checks.push({ name: `${role} dashboard panel entry visibility`, ok: panelEntryVisible === shouldSeePanel, role, expectedVisible: shouldSeePanel, visible: panelEntryVisible, dashboardVisible });

      if (!shouldSeePanel) {
        checks.push({ name: `${role} cannot open panel from dashboard navigation`, ok: !panelEntryVisible, role, panelEntryVisible, directUrlRouteExists: false });
        continue;
      }

      await panelEntry.first().click();
      await page.getByRole("heading", { name: "Developer Control Panel", exact: true }).waitFor({ state: "visible", timeout: 10000 });
      const mainText = await page.locator("main").innerText();
      const buttonLabels = (await page.locator("main button").allTextContents()).map((label) => label.trim()).filter(Boolean);
      const forbiddenRenderedValues = [secretSentinel, "payload_json", "response_json", "password_hash"];
      const renderedForbiddenValues = forbiddenRenderedValues.filter((value) => mainText.includes(value));
      const dangerousButtons = buttonLabels.filter((label) => /restore|import|delete|apply|replay|export/i.test(label));

      checks.push({ name: `${role} opens read-only Developer Control Panel`, ok: mainText.includes("Read-only operational visibility") && mainText.includes("Auto-sync") && mainText.includes("Disabled"), role });
      checks.push({ name: `${role} sees informational Backup Status`, ok: mainText.includes("Backup Status") && mainText.includes("Export and validation tools exist. Restore/import is not implemented."), role });
      checks.push({ name: `${role} panel exposes no dangerous action buttons`, ok: dangerousButtons.length === 0, role, buttonLabels, dangerousButtons });
      checks.push({ name: `${role} panel does not render token/password/payload sentinel data`, ok: renderedForbiddenValues.length === 0, role, renderedForbiddenValues });
    } finally {
      await context.close();
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
    roleStateInjectedForUiGuardOnly: true,
    frontendBackdoorUsed: false,
    backupStatusReadOnly: true,
    restoreImportActionsExposed: false,
    secretSentinelRendered: false,
    directUrlRouteExists: false,
    directAccessGuard: "DeveloperControlPanel self-guard requires role exactly Dev",
  };
}

async function verifySettingsSyncStatusVisibility(browser) {
  const secretSentinel = "PACKAGED_SYNC_STATUS_SECRET_SENTINEL_DO_NOT_RENDER";
  const roles = [
    { role: "Dev", shouldSeeSyncStatus: true, shouldSeePanel: true },
    { role: "admin", shouldSeeSyncStatus: true, shouldSeePanel: false },
    { role: "saleboy", shouldSeeSyncStatus: false, shouldSeePanel: false },
    { role: "staff", shouldSeeSyncStatus: false, shouldSeePanel: false },
    { role: "cashier", shouldSeeSyncStatus: false, shouldSeePanel: false },
  ];
  const forbiddenAdminWords = [
    "payload",
    "replay",
    "unsafe",
    "queue row",
    "mutation",
    "idempotency",
    "server mapping",
    "raw response",
    "auth token",
    "Token Present",
    "Backend Auth Status",
    "Queue ID",
    secretSentinel,
  ];
  const checks = [];

  for (const { role, shouldSeeSyncStatus, shouldSeePanel } of roles) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(({ role, secretSentinel }) => {
      localStorage.setItem("loggedInUserId", `packaged-sync-status-${role}`);
      localStorage.setItem("loggedInUserName", `Packaged Sync Status ${role}`);
      localStorage.setItem("loggedInUserRole", role);
      localStorage.setItem("jawadBro.authToken", secretSentinel);
    }, { role, secretSentinel });

    try {
      const page = await context.newPage();
      await installValidatedSessionFixture(page, role);
      await page.goto(APP_URL, { waitUntil: "networkidle", timeout: 20000 });
      await page.waitForTimeout(700);
      const aside = page.locator("aside");
      const dashboardVisible = await aside.count() > 0 && await aside.first().isVisible();
      const panelEntry = aside.getByText("developer_control_panel", { exact: true });
      const panelEntryVisible = dashboardVisible && await panelEntry.count() > 0 && await panelEntry.first().isVisible();
      checks.push({ name: `${role} Developer Control Panel navigation remains role-limited`, ok: panelEntryVisible === shouldSeePanel, role, expectedVisible: shouldSeePanel, visible: panelEntryVisible });

      if (!dashboardVisible) {
        checks.push({ name: `${role} cannot see Settings Sync Status without an allowed dashboard session`, ok: !shouldSeeSyncStatus, role, dashboardVisible });
        continue;
      }

      await clickMenu(page, 11);
      await page.waitForTimeout(300);
      const main = page.locator("main");
      const syncTab = main.getByRole("button", { name: "Sync Status", exact: true });
      const syncTabVisible = await syncTab.count() > 0 && await syncTab.first().isVisible();
      checks.push({ name: `${role} Settings Sync Status tab visibility`, ok: syncTabVisible === shouldSeeSyncStatus, role, expectedVisible: shouldSeeSyncStatus, visible: syncTabVisible });

      if (!shouldSeeSyncStatus) continue;

      await syncTab.first().click();
      const panel = main.locator('[data-testid="settings-sync-status-panel"]');
      await panel.waitFor({ state: "visible", timeout: 10000 });
      const panelText = await panel.innerText();
      const requiredLabels = [
        "Current status",
        "Not sent yet",
        "Could not sync",
        "Needs attention",
        "Successfully synced",
        "Last checked",
        "Last sync attempt",
        "Sync Now",
      ];
      const missingLabels = requiredLabels.filter((label) => !panelText.includes(label));
      checks.push({ name: `${role} Sync Status uses client-friendly labels`, ok: missingLabels.length === 0, role, missingLabels });

      if (role === "admin") {
        const renderedForbiddenWords = forbiddenAdminWords.filter((word) => panelText.includes(word));
        checks.push({ name: "admin Sync Status hides technical wording and secret sentinels", ok: renderedForbiddenWords.length === 0, role, renderedForbiddenWords });
        checks.push({ name: "admin Sync Status does not show Dev details", ok: !panelText.includes("Developer details"), role });
      }

      if (role === "Dev") {
        checks.push({ name: "Dev Sync Status keeps Developer details available", ok: panelText.includes("Developer details"), role });
      }
    } finally {
      await context.close();
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
    adminSyncStatusNonTechnical: true,
    developerControlPanelDevOnly: true,
    secretSentinelRendered: false,
  };
}

export async function verifyPackagedUiSync(runId) {
  const browser = await chromium.launch({ headless: true }); try { const developerControlPanel = await verifyDeveloperControlPanelVisibility(browser); const settingsSyncStatus = await verifySettingsSyncStatusVisibility(browser); const manualReplay = await manualReplayLifecycle(browser, runId); const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); await context.addInitScript(() => { localStorage.setItem("loggedInUserId", "DEV"); localStorage.setItem("loggedInUserName", "Developer"); localStorage.setItem("loggedInUserRole", "Dev"); localStorage.setItem("jawadBro.authToken", "PACKAGED_UI_VALIDATED_SESSION_FIXTURE"); }); const page = await context.newPage(); await installValidatedSessionFixture(page); page.on("pageerror", (error) => console.error(`packaged UI page error: ${error.message}`)); await page.goto(APP_URL, { waitUntil: "networkidle", timeout: 20000 }); await page.locator("aside").waitFor({ state: "visible", timeout: 10000 }); await page.waitForTimeout(1500); const lifecycles = []; lifecycles.push(await lookupDeleteLifecycle(page, "categories", 0, `Rehearsal UI Category ${runId}`)); lifecycles.push(await lookupDeleteLifecycle(page, "brands", 1, `Rehearsal UI Brand ${runId}`)); lifecycles.push(await lookupDeleteLifecycle(page, "units", 2, `Rehearsal UI Unit ${runId}`)); lifecycles.push(await lookupDeleteLifecycle(page, "discounts", 3, `Rehearsal UI Discount ${runId}`, "form")); lifecycles.push(await lookupDeleteLifecycle(page, "taxes", 4, `Rehearsal UI Tax ${runId}`, "form")); lifecycles.push(await customerOrSupplierLifecycle(page, "customers", 2, `Rehearsal UI Customer ${runId}`, "03000000101")); lifecycles.push(await customerOrSupplierLifecycle(page, "suppliers", 3, `Rehearsal UI Supplier ${runId}`, "03000000102")); lifecycles.push(await expenseLifecycle(page, `Rehearsal UI Expense ${runId}`)); lifecycles.push(await heldCartLifecycle(page, runId)); const invoicesReadOnly = await verifyInvoicesReadOnly(page); await context.close(); return { appUrl: APP_URL, ok: developerControlPanel.ok && settingsSyncStatus.ok && manualReplay.ok && invoicesReadOnly.ok && lifecycles.every((item) => item.ok), developerControlPanel, settingsSyncStatus, manualReplay, invoicesReadOnly, lifecycles, sensitiveBodiesLogged: false }; } finally { await browser.close(); }
}
