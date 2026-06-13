import React, { useEffect, useMemo, useState } from "react";
import { fetchCrudAuthDiagnostics, type CrudAuthDiagnostics } from "./api/authDiagnostics";
import { API_BASE_URL } from "./api/config";
import { healthApi } from "./api/healthApi";
import { getAuthToken } from "./api/authToken";
import { fetchCurrentSession, type AuthActor } from "./api/authSession";
import { initDB } from "./db";
import { getPOSActivityState, type POSActivityState } from "./services/posActivityState";

const PROTECTED_INDEXEDDB_STORE_COUNT = 22;

type UserRole = "admin" | "saleboy" | "Dev";

type DeveloperControlPanelProps = {
  user: {
    username: string;
    role: UserRole;
  };
};

type QueueStatusCounts = {
  total: number;
  pending: number;
  processing: number;
  failed: number;
  done: number;
  other: number;
};

type AutoSyncEligibilityPreview = {
  allowed: boolean;
  blockers: string[];
  warnings: string[];
};

type PanelState = {
  backendReachable: boolean | null;
  queueCounts: QueueStatusCounts;
  authDiagnostics: CrudAuthDiagnostics;
  sessionActor: AuthActor | null;
  sessionCheckedAt: number | null;
  posActivity: POSActivityState;
  refreshedAt: number | null;
  refreshError: string | null;
};

const initialAuthDiagnostics: CrudAuthDiagnostics = {
  tokenPresent: Boolean(getAuthToken()),
  backendAuthEnforcement: "unknown",
  backendAuthStatus: "unknown",
  actorType: null,
  actorId: null,
  actorRole: null,
};

const initialQueueCounts: QueueStatusCounts = {
  total: 0,
  pending: 0,
  processing: 0,
  failed: 0,
  done: 0,
  other: 0,
};

function formatDateTime(value: number | null | undefined) {
  if (!value) return "Not available";
  return new Date(value).toLocaleString();
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unable to refresh diagnostics.";
}

function statusTone(value: "good" | "warn" | "bad" | "neutral") {
  switch (value) {
    case "good":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "warn":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "bad":
      return "border-red-200 bg-red-50 text-red-800";
    default:
      return "border-gray-200 bg-gray-50 text-gray-700";
  }
}

async function readQueueStatusCounts(): Promise<QueueStatusCounts> {
  const db = await initDB();
  const rows = await db.getAll("sync_queue");
  const counts = { ...initialQueueCounts, total: rows.length };

  for (const row of rows) {
    if (row.status === "pending") counts.pending += 1;
    else if (row.status === "processing") counts.processing += 1;
    else if (row.status === "failed") counts.failed += 1;
    else if (row.status === "done") counts.done += 1;
    else counts.other += 1;
  }

  return counts;
}

function buildEligibilityPreview(state: PanelState): AutoSyncEligibilityPreview {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (state.backendReachable === false) blockers.push("Backend health is unreachable.");
  if (state.backendReachable === null) warnings.push("Backend health has not been refreshed yet.");
  if (state.authDiagnostics.backendAuthEnforcement === "unknown") blockers.push("CRUD auth enforcement state is unknown.");
  if (!state.authDiagnostics.tokenPresent) blockers.push("No frontend bearer token is present.");
  if (state.authDiagnostics.backendAuthStatus === "invalid") blockers.push("Backend auth status is invalid.");
  if (state.queueCounts.failed > 0) blockers.push("Local sync queue has failed rows.");
  if (state.queueCounts.processing > 0) warnings.push("Local sync queue has processing rows.");
  if (state.posActivity.active) blockers.push("POS/cart activity is active.");

  warnings.push("Full CLI evaluator, hydration, replay-lock, and backend failed-replay checks are not run from this read-only browser panel yet.");

  return {
    allowed: blockers.length === 0,
    blockers,
    warnings,
  };
}

function MetricCard({ label, value, tone = "neutral" }: { label: string; value: React.ReactNode; tone?: "good" | "warn" | "bad" | "neutral" }) {
  return (
    <div className={`rounded border p-3 ${statusTone(tone)}`}>
      <div className="text-xs font-medium uppercase tracking-wide opacity-75">{label}</div>
      <div className="mt-1 text-lg font-semibold break-words">{value}</div>
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function DeveloperControlPanel({ user }: DeveloperControlPanelProps) {
  const canAccess = user.role === "Dev";
  const [refreshing, setRefreshing] = useState(false);
  const [state, setState] = useState<PanelState>({
    backendReachable: null,
    queueCounts: initialQueueCounts,
    authDiagnostics: initialAuthDiagnostics,
    sessionActor: null,
    sessionCheckedAt: null,
    posActivity: getPOSActivityState(),
    refreshedAt: null,
    refreshError: null,
  });

  const eligibilityPreview = useMemo(() => buildEligibilityPreview(state), [state]);

  const refreshDiagnostics = async () => {
    if (refreshing) return;
    setRefreshing(true);

    try {
      const [backendReachable, queueCounts, authDiagnostics] = await Promise.all([
        healthApi.check(),
        readQueueStatusCounts(),
        fetchCrudAuthDiagnostics().catch(() => initialAuthDiagnostics),
      ]);

      let sessionActor: AuthActor | null = null;
      if (authDiagnostics.tokenPresent) {
        sessionActor = await fetchCurrentSession().catch(() => null);
      }

      setState({
        backendReachable,
        queueCounts,
        authDiagnostics,
        sessionActor,
        sessionCheckedAt: Date.now(),
        posActivity: getPOSActivityState(),
        refreshedAt: Date.now(),
        refreshError: null,
      });
    } catch (error) {
      setState(prev => ({
        ...prev,
        posActivity: getPOSActivityState(),
        refreshedAt: Date.now(),
        refreshError: safeErrorMessage(error),
      }));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (canAccess) {
      refreshDiagnostics();
    }
    // Manual refresh after initial load only; no polling or listeners are installed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  if (!canAccess) {
    return (
      <div className="mx-auto max-w-3xl rounded border border-amber-200 bg-amber-50 p-6 text-amber-900">
        <h2 className="text-lg font-semibold">Developer Control Panel</h2>
        <p className="mt-2 text-sm">This read-only diagnostics area is restricted to developer support users.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5">
      <div className="rounded border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">Developer Control Panel</h2>
            <p className="mt-1 max-w-3xl text-sm text-gray-600">
              Read-only operational visibility for sync, auth, backup, replay, POS activity, and future auto-sync gates. No replay, hydration, repair, restore, or background sync is triggered from this panel.
            </p>
          </div>
          <button
            type="button"
            onClick={refreshDiagnostics}
            disabled={refreshing}
            className="self-start rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
          >
            {refreshing ? "Refreshing..." : "Refresh Diagnostics"}
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Access" value={`${user.role} only`} tone="good" />
          <MetricCard label="Last Refresh" value={formatDateTime(state.refreshedAt)} />
          <MetricCard label="Runtime Mode" value="Manual / read-only" tone="good" />
          <MetricCard label="Auto-sync" value="Disabled" tone="good" />
        </div>
        {state.refreshError && (
          <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {state.refreshError}
          </div>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="System Health">
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCard label="Backend Health" value={state.backendReachable === null ? "Unknown" : state.backendReachable ? "Reachable" : "Unreachable"} tone={state.backendReachable ? "good" : state.backendReachable === false ? "bad" : "neutral"} />
            <MetricCard label="API Base URL" value={API_BASE_URL} />
            <MetricCard label="Frontend Mode" value="IndexedDB local-first" />
            <MetricCard label="Refresh Mode" value="Manual only" tone="good" />
          </div>
        </Section>

        <Section title="Sync Status">
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="Queue Total" value={state.queueCounts.total} />
            <MetricCard label="Pending" value={state.queueCounts.pending} tone={state.queueCounts.pending > 0 ? "warn" : "good"} />
            <MetricCard label="Failed" value={state.queueCounts.failed} tone={state.queueCounts.failed > 0 ? "bad" : "good"} />
            <MetricCard label="Processing" value={state.queueCounts.processing} tone={state.queueCounts.processing > 0 ? "warn" : "good"} />
            <MetricCard label="Done" value={state.queueCounts.done} />
            <MetricCard label="Other" value={state.queueCounts.other} tone={state.queueCounts.other > 0 ? "warn" : "neutral"} />
          </div>
        </Section>

        <Section title="Replay Status">
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCard label="Backend Failed Replay Count" value="CLI-only" tone="neutral" />
            <MetricCard label="Replay Audit" value="CLI-only" tone="neutral" />
            <MetricCard label="Replay Locks" value="CLI-only" tone="neutral" />
            <MetricCard label="Automatic Replay" value="Not installed" tone="good" />
          </div>
          <p className="mt-3 text-sm text-gray-600">
            Use `sync:report-transactions`, `sync:report-replay-audit`, and `sync:report-stale-replay-locks` for backend replay detail. This browser panel does not fetch payloads or run PHP CLI reports.
          </p>
        </Section>

        <Section title="Auth Status">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard label="Token Present" value={state.authDiagnostics.tokenPresent ? "Yes" : "No"} tone={state.authDiagnostics.tokenPresent ? "good" : "warn"} />
            <MetricCard label="CRUD Enforcement" value={state.authDiagnostics.backendAuthEnforcement} tone={state.authDiagnostics.backendAuthEnforcement === "on" ? "good" : state.authDiagnostics.backendAuthEnforcement === "unknown" ? "warn" : "neutral"} />
            <MetricCard label="Backend Auth" value={state.authDiagnostics.backendAuthStatus} tone={state.authDiagnostics.backendAuthStatus === "valid" ? "good" : state.authDiagnostics.backendAuthStatus === "invalid" ? "bad" : "neutral"} />
            <MetricCard label="Actor Type" value={state.authDiagnostics.actorType ?? state.sessionActor?.actorType ?? "Not available"} />
            <MetricCard label="Actor ID" value={state.authDiagnostics.actorId ?? state.sessionActor?.actorId ?? state.sessionActor?.id ?? "Not available"} />
            <MetricCard label="Actor Role" value={state.authDiagnostics.actorRole ?? state.sessionActor?.actorRole ?? state.sessionActor?.Role ?? state.sessionActor?.role ?? "Not available"} />
          </div>
          <p className="mt-3 text-sm text-gray-600">Session checked at: {formatDateTime(state.sessionCheckedAt)}. Raw tokens and passwords are never displayed.</p>
        </Section>

        <Section title="Backup Status">
          <div className="space-y-3 text-sm">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="Last Backup" value="Not recorded in app" tone="warn" />
              <MetricCard label="Backup Status" value="Manual export available" tone="good" />
              <MetricCard label="Records Protected" value={`${PROTECTED_INDEXEDDB_STORE_COUNT} data sections`} />
              <MetricCard label="Backup Recommended" value="Before deployment and daily" tone="warn" />
            </div>
            <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">
              Export and validation tools exist. Restore/import is not implemented.
            </div>
            <p className="text-gray-600">
              Backup files and validation dates are recorded outside the app. No backup content, password, token, or replay body is shown here.
            </p>
          </div>
        </Section>

        <Section title="Auto-sync Eligibility">
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricCard label="Preview Result" value={eligibilityPreview.allowed ? "Would pass browser-safe checks" : "Blocked"} tone={eligibilityPreview.allowed ? "good" : "bad"} />
            <MetricCard label="Full Evaluator" value="CLI-only" />
          </div>
          {eligibilityPreview.blockers.length > 0 && (
            <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <div className="font-semibold">Blockers</div>
              <ul className="mt-2 list-disc pl-5">
                {eligibilityPreview.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
            </div>
          )}
          <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <div className="font-semibold">Warnings</div>
            <ul className="mt-2 list-disc pl-5">
              {eligibilityPreview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        </Section>

        <Section title="POS Activity Status">
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="POS Active" value={state.posActivity.active ? "Yes" : "No"} tone={state.posActivity.active ? "bad" : "good"} />
            <MetricCard label="Started At" value={formatDateTime(state.posActivity.startedAt)} />
            <MetricCard label="Source" value={state.posActivity.source ?? "Not available"} />
          </div>
          <p className="mt-3 text-sm text-gray-600">Only safe POS activity metadata is shown. Cart contents, customer details, item rows, payment details, and invoice bodies are not displayed.</p>
        </Section>
      </div>
    </div>
  );
}
