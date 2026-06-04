#!/usr/bin/env node

/*
 * Consolidated manual replay regression gate for implemented finalized
 * transaction replay paths. This script orchestrates the narrow per-type
 * harnesses and performs source-level checks that replay remains manual-only.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");

const transactionTests = [
  {
    name: "Sale",
    script: "scripts/test-finalized-sale-manual-replay.mjs",
    tablesTouched: [
      "sales",
      "sale_items",
      "items",
      "item_batches",
      "customers",
      "customer_payments",
      "cylinders",
      "cylinder_customers",
      "sync_transactions",
      "transaction_replay_audit",
    ],
    requiredSignals: {
      readyReplay: "ready Sale commits exactly once",
      unsafeBlocked: "unsafe replay is rejected without mutation",
      idempotent: "second replay is idempotent",
      localIdsNotMutationTargets: "local ids are not backend mutation targets",
      replayAuthRequired: "endpoint requires replay auth before execution",
      manualOnly: "manual sync router stores then explicitly replays ready finalized Sale",
    },
  },
  {
    name: "Purchase",
    script: "scripts/test-finalized-purchase-manual-replay.mjs",
    tablesTouched: [
      "sales",
      "sale_items",
      "items",
      "item_batches",
      "suppliers",
      "supplier_payments",
      "cylinders",
      "sync_transactions",
      "transaction_replay_audit",
    ],
    requiredSignals: {
      readyReplay: "ready supplier Purchase commits exactly once",
      unsafeBlocked: "unsafe Purchase is rejected without mutation",
      idempotent: "second Purchase replay is idempotent",
      localIdsNotMutationTargets: "local ids are not backend mutation targets",
      replayAuthRequired: "endpoint requires replay auth before execution",
      manualOnly: "manual sync router stores then explicitly replays ready finalized Purchase",
    },
  },
  {
    name: "Customer Return",
    script: "scripts/test-finalized-customer-return-manual-replay.mjs",
    tablesTouched: [
      "sales",
      "sale_items",
      "items",
      "item_batches",
      "customers",
      "customer_payments",
      "cylinders",
      "cylinder_customers",
      "sync_transactions",
      "transaction_replay_audit",
    ],
    requiredSignals: {
      readyReplay: "ready Customer Return commits exactly once",
      unsafeBlocked: "unsafe Customer Return is rejected without mutation",
      idempotent: "second Customer Return replay is idempotent",
      localIdsNotMutationTargets: "local ids are not backend mutation targets",
      replayAuthRequired: "Customer Return endpoint requires replay auth before execution",
      manualOnly:
        "manual sync router stores then explicitly replays ready finalized Customer Return",
    },
  },
  {
    name: "Supplier Return",
    script: "scripts/test-finalized-supplier-return-manual-replay.mjs",
    tablesTouched: [
      "sales",
      "sale_items",
      "items",
      "item_batches",
      "suppliers",
      "supplier_payments",
      "cylinders",
      "sync_transactions",
      "transaction_replay_audit",
    ],
    requiredSignals: {
      readyReplay: "ready Supplier Return commits exactly once",
      unsafeBlocked: "unsafe Supplier Return is rejected without mutation",
      idempotent: "second Supplier Return replay is idempotent",
      localIdsNotMutationTargets: "local ids are not backend mutation targets",
      replayAuthRequired: "Supplier Return endpoint requires replay auth before execution",
      manualOnly:
        "manual sync router stores then explicitly replays ready finalized Supplier Return",
    },
  },
];

function runNodeScript(scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
    windowsHide: true,
    maxBuffer: 40 * 1024 * 1024,
  });
  return {
    status: result.status,
    error: result.error ? String(result.error) : null,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function parseSummary(output) {
  const match = output.match(/Summary:\s+(\d+)\s+passed,\s+(\d+)\s+failed/i);
  if (!match) return { passed: 0, failed: 1, found: false };
  return {
    passed: Number(match[1]),
    failed: Number(match[2]),
    found: true,
  };
}

function source(filePath) {
  const absolutePath = resolve(projectRoot, filePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
}

function checkNoForbiddenSourcePatterns() {
  const syncEngine = source("src/services/syncEngine.ts");
  const transactionApi = source("src/api/transactionApi.ts");
  const app = source("src/App.tsx");
  const main = source("src/main.tsx");
  const settings = source("src/Settings.tsx");
  const manualReplayStart = settings.indexOf("const runManualSyncReplay");
  const manualReplayEnd =
    manualReplayStart >= 0
      ? settings.indexOf("useEffect", manualReplayStart)
      : -1;
  const manualReplayBody =
    manualReplayStart >= 0 && manualReplayEnd > manualReplayStart
      ? settings.slice(manualReplayStart, manualReplayEnd)
      : "";

  const forbidden = [
    {
      name: "syncEngine has no timer-driven processPending",
      ok:
        !/setInterval\s*\([\s\S]{0,500}processPending/.test(syncEngine) &&
        !/setTimeout\s*\([\s\S]{0,500}processPending/.test(syncEngine),
    },
    {
      name: "startup files do not call syncEngine.processPending",
      ok: !/syncEngine\.processPending\s*\(/.test(app + "\n" + main),
    },
    {
      name: "manual replay UI still gates the only UI processPending call",
      ok:
        manualReplayBody.includes("validateManualReplayAuthGate") &&
        manualReplayBody.indexOf("validateManualReplayAuthGate") <
          manualReplayBody.indexOf("syncEngine.processPending"),
    },
    {
      name: "no standalone Payment replay endpoint is wired",
      ok:
        !transactionApi.includes("/replay/payment") &&
        !transactionApi.includes("replayStandalonePayment") &&
        !syncEngine.includes("replayStandalonePayment"),
    },
    {
      name: "only implemented finalized transaction replay endpoints are routed",
      ok:
        transactionApi.includes("/replay/sale.php") &&
        transactionApi.includes("/replay/purchase.php") &&
        transactionApi.includes("/replay/customer-return.php") &&
        transactionApi.includes("/replay/supplier-return.php"),
    },
  ];

  return forbidden.map((entry) => ({
    ...entry,
    status: entry.ok ? "pass" : "fail",
  }));
}

const transactionResults = transactionTests.map((test) => {
  const result = runNodeScript(test.script);
  const output = `${result.stdout}\n${result.stderr}`;
  const summary = parseSummary(output);
  const signals = Object.fromEntries(
    Object.entries(test.requiredSignals).map(([key, signal]) => [
      key,
      output.includes(`PASS ${signal}`),
    ])
  );
  const ok =
    !result.error &&
    result.status === 0 &&
    summary.found &&
    summary.failed === 0 &&
    Object.values(signals).every(Boolean);

  return {
    transactionType: test.name,
    ok,
    script: test.script,
    passed: summary.passed,
    failed: summary.failed,
    summaryFound: summary.found,
    signals,
    tablesTouched: test.tablesTouched,
    error: result.error,
    exitStatus: result.status,
    failureOutput: ok ? undefined : output.trim().slice(0, 8000),
  };
});

const sourceChecks = checkNoForbiddenSourcePatterns();
const ok =
  transactionResults.every((result) => result.ok) &&
  sourceChecks.every((result) => result.ok);

const report = {
  ok,
  generatedAt: new Date().toISOString(),
  scope: ["Sale", "Purchase", "Customer Return", "Supplier Return"],
  addedTransactionTypes: [],
  standalonePaymentReplayAdded: false,
  autoSyncEnabled: false,
  backgroundReplayEnabled: false,
  startupReplayEnabled: false,
  transactionResults,
  sourceChecks,
};

for (const result of transactionResults) {
  const status = result.ok ? "PASS" : "FAIL";
  console.log(
    `${status} ${result.transactionType}: ${result.passed} passed, ${result.failed} failed`
  );
  console.log(`  tables: ${result.tablesTouched.join(", ")}`);
  console.log(
    `  idempotent=${result.signals.idempotent ? "yes" : "no"} unsafeBlocked=${
      result.signals.unsafeBlocked ? "yes" : "no"
    } authRequired=${result.signals.replayAuthRequired ? "yes" : "no"} manualOnly=${
      result.signals.manualOnly ? "yes" : "no"
    }`
  );
  if (!result.ok && result.failureOutput) {
    console.error(result.failureOutput);
  }
}

for (const result of sourceChecks) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}`);
}

console.log(JSON.stringify(report, null, 2));
if (!ok) process.exitCode = 1;
