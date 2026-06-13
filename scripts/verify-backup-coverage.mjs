#!/usr/bin/env node

/*
 * Read-only backup coverage verifier.
 *
 * This checks the declared IndexedDB inventory, live schema source, exporter,
 * and validator. It does not open IndexedDB, write backup files, restore data,
 * contact MySQL, or trigger replay.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BUSINESS_CRITICAL_INDEXEDDB_STORES,
  compareStoreCoverage,
} from "./lib/indexeddb-store-inventory.mjs";

const REQUIRED_STORES = [
  "users",
  "settings",
  "customers",
  "suppliers",
  "items",
  "categories",
  "brands",
  "units",
  "discounts",
  "taxes",
  "sales",
  "sale_items",
  "customer_payments",
  "supplier_payments",
  "expenses",
  "expCategories",
  "item_batches",
  "held",
  "held_items",
  "cylinders",
  "cylinder_customers",
  "sync_queue",
];

function readText(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function findSchemaStores(source) {
  const stores = new Set();
  const pattern = /createObjectStore\(\s*["']([^"']+)["']/g;
  let match;
  while ((match = pattern.exec(source))) stores.add(match[1]);
  return [...stores].sort();
}

function check(name, ok, details = {}) {
  return { name, ok, ...details };
}

const dbSource = readText("src/db.ts");
const exporterSource = readText("scripts/export-indexeddb-backup.mjs");
const validatorSource = readText("scripts/validate-backup-file.mjs");
const schemaStores = findSchemaStores(dbSource);
const schemaCoverage = compareStoreCoverage(schemaStores, REQUIRED_STORES);
const declaredCoverage = compareStoreCoverage(
  BUSINESS_CRITICAL_INDEXEDDB_STORES,
  REQUIRED_STORES
);

const checks = [
  check(
    "required store inventory matches business-critical inventory",
    declaredCoverage.missingStores.length === 0 &&
      declaredCoverage.unexpectedStores.length === 0,
    declaredCoverage
  ),
  check(
    "all required stores exist in IndexedDB schema source",
    schemaCoverage.missingStores.length === 0,
    schemaCoverage
  ),
  check(
    "exporter enumerates every runtime object store",
    exporterSource.includes("Array.from(db.objectStoreNames)") &&
      exporterSource.includes("for (const storeName of storeNames)") &&
      exporterSource.includes("stores[storeName] = await getAll(store)")
  ),
  check(
    "export includes schema and format metadata",
    exporterSource.includes("formatVersion") &&
      exporterSource.includes("dbVersion") &&
      exporterSource.includes("exportedAt") &&
      exporterSource.includes("storeCounts")
  ),
  check(
    "export excludes active browser authentication state",
    exporterSource.includes("authTokenPresentButNotExported") &&
      exporterSource.includes("Raw auth tokens/passwords/session secrets are not exported")
  ),
  check(
    "validator rejects missing business-critical stores",
    validatorSource.includes("missingExpectedIndexedDbStores") &&
      validatorSource.includes("BUSINESS_CRITICAL_INDEXEDDB_STORES")
  ),
  check(
    "validator checks row counts and sensitive fields",
    validatorSource.includes("storeCountMismatch") &&
      validatorSource.includes("unsafeSensitiveFields")
  ),
];

const result = {
  ok: checks.every((entry) => entry.ok),
  verificationOnly: true,
  generatedAt: new Date().toISOString(),
  requiredStores: REQUIRED_STORES,
  coveredStores: REQUIRED_STORES.filter((store) => schemaStores.includes(store)),
  missingStores: schemaCoverage.missingStores,
  unexpectedSchemaStores: schemaCoverage.unexpectedStores,
  restoreImplementedForLiveDatabase: false,
  indexedDbOpened: false,
  indexedDbMutated: false,
  mysqlContacted: false,
  replayTriggered: false,
  autoSyncEnabled: false,
  checks,
  warnings: [
    "User passwords and active browser authentication state are intentionally redacted or excluded; a restored device must use the approved login recovery process.",
    "Coverage proves export inclusion, not permission to restore into the live POSDatabase.",
  ],
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
