import React, { useEffect, useState, useRef } from "react";
import { fetchCrudAuthDiagnostics, type CrudAuthDiagnostics } from "./api/authDiagnostics";
import { getAuthToken } from "./api/authToken";
import { fetchCurrentSession } from "./api/authSession";
import { settingsRepository } from "./repositories/settingsRepository";
import { syncQueueRepository } from "./repositories/syncQueueRepository";
import { syncEngine } from "./services/syncEngine";
import { getPOSActivityState, type POSActivityState } from "./services/posActivityState";
import type { Settings } from "./types/entities";
import { useLang } from "./i18n/LanguageContext";

const placeholderImg = "https://via.placeholder.com/150?text=No+Logo";

type ManualSyncDiagnostics = Awaited<ReturnType<typeof syncEngine.processPending>>;

type SyncQueueCounts = {
  pending: number;
  failed: number;
  lastReplayAt: number | null;
};

type LastReplayAuthStatus = "none" | "absent" | "valid" | "invalid" | "401" | "403" | "unknown";
type ReplayAuthGateState = "authenticated" | "unauthenticated" | "authUnknown" | "enforcementDisabled";

type ReplayAuthGateResult = {
  allowed: boolean;
  state: ReplayAuthGateState;
  message: string;
  checkedAt: number;
  enforcement: CrudAuthDiagnostics["backendAuthEnforcement"];
  authStatus: CrudAuthDiagnostics["backendAuthStatus"];
};

function getSafeSyncErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Manual sync replay failed.";
}

function formatTimestamp(value: number | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function fallbackAuthDiagnostics(): CrudAuthDiagnostics {
  return {
    tokenPresent: Boolean(getAuthToken()),
    backendAuthEnforcement: "unknown",
    backendAuthStatus: "unknown",
    actorType: null,
    actorId: null,
    actorRole: null,
  };
}

function getLastReplayAuthStatus(result: ManualSyncDiagnostics): LastReplayAuthStatus {
  const authError = result.errors.find(error => error.authError || error.status === 401 || error.status === 403);

  if (authError?.status === 401) return "401";
  if (authError?.status === 403) return "403";
  return "none";
}

export default function SettingsPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [formData, setFormData] = useState<Omit<Settings, "id">>({
    businessName: "",
    email: "",
    contact: "",
    address: "",
    logo: undefined,
    cylBPrice: "",
    cylSPrice: "",
    cylDPrice: "",
    cylWPrice: "",
    printer: "pos",
    language: "en",
  });

  const [loading, setLoading] = useState(true);
  const [syncCounts, setSyncCounts] = useState<SyncQueueCounts>({ pending: 0, failed: 0, lastReplayAt: null });
  const [syncDiagnostics, setSyncDiagnostics] = useState<ManualSyncDiagnostics | null>(null);
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [authDiagnostics, setAuthDiagnostics] = useState<CrudAuthDiagnostics>(fallbackAuthDiagnostics);
  const [lastReplayAuthStatus, setLastReplayAuthStatus] = useState<LastReplayAuthStatus>("none");
  const [lastReplayAuthGate, setLastReplayAuthGate] = useState<ReplayAuthGateResult | null>(null);
  const [posActivity, setPosActivity] = useState<POSActivityState>(() => getPOSActivityState());

  const { t, setLang } = useLang();
  const validateManualReplayAuthGate = async (): Promise<ReplayAuthGateResult> => {
    const checkedAt = Date.now();

    try {
      const diagnostics = await fetchCrudAuthDiagnostics();
      setAuthDiagnostics(diagnostics);

      if (diagnostics.backendAuthEnforcement === "off") {
        return {
          allowed: true,
          state: "enforcementDisabled",
          message: "CRUD auth enforcement is disabled; manual replay is allowed in audit mode.",
          checkedAt,
          enforcement: diagnostics.backendAuthEnforcement,
          authStatus: diagnostics.backendAuthStatus,
        };
      }

      if (diagnostics.backendAuthEnforcement !== "on") {
        return {
          allowed: false,
          state: "authUnknown",
          message: "Auth enforcement state is unknown. Manual replay was not started.",
          checkedAt,
          enforcement: diagnostics.backendAuthEnforcement,
          authStatus: diagnostics.backendAuthStatus,
        };
      }

      if (!diagnostics.tokenPresent) {
        return {
          allowed: false,
          state: "unauthenticated",
          message: "Authentication is required before manual replay can run.",
          checkedAt,
          enforcement: diagnostics.backendAuthEnforcement,
          authStatus: diagnostics.backendAuthStatus,
        };
      }

      const actor = await fetchCurrentSession();
      if (!actor) {
        return {
          allowed: false,
          state: "unauthenticated",
          message: "Current session is invalid or expired. Manual replay was not started.",
          checkedAt,
          enforcement: diagnostics.backendAuthEnforcement,
          authStatus: diagnostics.backendAuthStatus,
        };
      }

      return {
        allowed: true,
        state: "authenticated",
        message: "Authenticated session validated for manual replay.",
        checkedAt,
        enforcement: diagnostics.backendAuthEnforcement,
        authStatus: "valid",
      };
    } catch {
      const fallback = fallbackAuthDiagnostics();
      setAuthDiagnostics(fallback);
      return {
        allowed: false,
        state: "authUnknown",
        message: "Could not validate the current session. Manual replay was not started.",
        checkedAt,
        enforcement: fallback.backendAuthEnforcement,
        authStatus: fallback.backendAuthStatus,
      };
    }
  };

  const refreshSyncQueueCounts = async () => {
    const [pending, failed] = await Promise.all([
      syncQueueRepository.getPending(),
      syncQueueRepository.getFailed(),
    ]);

    setSyncCounts(prev => ({
      ...prev,
      pending: pending.length,
      failed: failed.length,
    }));

    try {
      setAuthDiagnostics(await fetchCrudAuthDiagnostics());
    } catch {
      setAuthDiagnostics(fallbackAuthDiagnostics());
    }
  };

  const runManualSyncReplay = async () => {
    if (syncRunning) return;

    setSyncRunning(true);
    setSyncError(null);

    try {
      const authGate = await validateManualReplayAuthGate();
      setLastReplayAuthGate(authGate);

      if (!authGate.allowed) {
        setLastReplayAuthStatus(authGate.authStatus === "invalid" ? "invalid" : authGate.authStatus === "absent" ? "absent" : "unknown");
        setSyncError(authGate.message);
        await refreshSyncQueueCounts();
        return;
      }

      setLastReplayAuthStatus(authGate.state === "authenticated" ? "valid" : authGate.state === "enforcementDisabled" ? "absent" : "unknown");

      const result = await syncEngine.processPending();
      setSyncDiagnostics(result);
      setLastReplayAuthStatus(getLastReplayAuthStatus(result));
      setSyncCounts(prev => ({ ...prev, lastReplayAt: Date.now() }));
      await refreshSyncQueueCounts();
    } catch (error) {
      setSyncError(getSafeSyncErrorMessage(error));
    } finally {
      setSyncRunning(false);
    }
  };

  useEffect(() => {
    async function load() {
      const settings = await settingsRepository.getRaw();
      if (settings) {
        setFormData(prev => ({ ...prev, ...settings }));
      }
      await refreshSyncQueueCounts();
      setLoading(false);
    }
    load();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setFormData(p => ({ ...p, logo: reader.result as string }));
    reader.readAsDataURL(file);
  };

  const saveGeneralSettings = async () => {
    const currentSettings = await settingsRepository.getRaw();
    if (!currentSettings) return;

    const updated = {
      ...currentSettings,
      businessName: formData.businessName,
      email: formData.email,
      contact: formData.contact,
      address: formData.address,
      logo: formData.logo,
      printer: formData.printer,
      language: formData.language,
    };

    await settingsRepository.save(updated);

    setLang(formData.language);
    window.dispatchEvent(new Event("settingsUpdated"));

    alert("General settings saved!");
  };

  if (loading) return <p>Loading...</p>;

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-screen-lg mx-auto">
      <h2 className="text-xl font-semibold mb-4 text-center">{t("settings_title")}</h2>

      <div className="flex flex-col md:flex-row gap-8">
        <div className="md:w-1/3 flex flex-col items-center">
          <div className="w-40 h-40 border rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
            <img
              src={formData.logo || placeholderImg}
              alt="Logo Preview"
              className="object-contain w-full h-full"
            />
          </div>
          <input type="file" accept="image/*" onChange={handleFileChange} ref={fileInputRef} className="hidden" />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-3 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500"
          >
            {t("choose_logo")}
          </button>
        </div>

        <div className="md:w-2/3 space-y-4">
          <div className="grid grid-cols-3 items-center gap-4">
            <label className="font-medium col-span-1">{t("business_name")}</label>
            <input
              type="text"
              className="border rounded px-3 py-2 w-full col-span-2"
              value={formData.businessName}
              onChange={e => setFormData(p => ({ ...p, businessName: e.target.value }))}
              required
            />
          </div>

          <div className="grid grid-cols-3 items-center gap-4">
            <label className="font-medium col-span-1">{t("email")}</label>
            <input
              type="email"
              className="border rounded px-3 py-2 w-full col-span-2"
              value={formData.email}
              onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-3 items-center gap-4">
            <label className="font-medium col-span-1">{t("contact")}</label>
            <input
              type="text"
              className="border rounded px-3 py-2 w-full col-span-2"
              value={formData.contact}
              onChange={e => setFormData(p => ({ ...p, contact: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-3 items-start gap-4">
            <label className="font-medium col-span-1 pt-2">{t("address")}</label>
            <textarea
              className="border rounded px-3 py-2 w-full col-span-2"
              value={formData.address}
              onChange={e => setFormData(p => ({ ...p, address: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-3 items-center gap-4">
            <label className="font-medium col-span-1">{t("printer_settings")}</label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="printerType"
                value="pos"
                checked={formData.printer === "pos"}
                onChange={e => setFormData(p => ({ ...p, printer: e.target.value as "pos" | "a4" }))}
                className="accent-indigo-600"
              />
              <span>{t("printer_pos")}</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="printerType"
                value="a4"
                checked={formData.printer === "a4"}
                onChange={e => setFormData(p => ({ ...p, printer: e.target.value as "pos" | "a4" }))}
                className="accent-indigo-600"
              />
              <span>{t("printer_a4")}</span>
            </label>
          </div>

          <div className="grid grid-cols-3 items-center gap-4">
            <label className="font-medium col-span-1">{t("language_settings")}</label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="langType"
                value="en"
                checked={formData.language === "en"}
                onChange={e => setFormData(p => ({ ...p, language: e.target.value as "en" | "ur" }))}
                className="accent-indigo-600"
              />
              <span>{t("language_en")}</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="langType"
                value="ur"
                checked={formData.language === "ur"}
                onChange={e => setFormData(p => ({ ...p, language: e.target.value as "en" | "ur" }))}
                className="accent-indigo-600"
              />
              <span>{t("language_ur")}</span>
            </label>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={saveGeneralSettings}
              className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-500"
            >
              {t("update")}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-8 border-t pt-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-semibold">Developer Sync Replay</h3>
            <p className="text-sm text-gray-600">Manual replay only. This does not start auto-sync or background polling.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={refreshSyncQueueCounts}
              disabled={syncRunning}
              className="px-4 py-2 border rounded hover:bg-gray-50 disabled:opacity-60"
            >
              Refresh Counts
            </button>
            <button
              type="button"
              onClick={runManualSyncReplay}
              disabled={syncRunning}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-500 disabled:opacity-60"
            >
              {syncRunning ? "Replay Running..." : "Run Manual Replay"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="border rounded p-3">
            <div className="text-gray-500">Pending</div>
            <div className="text-xl font-semibold">{syncCounts.pending}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-gray-500">Failed</div>
            <div className="text-xl font-semibold">{syncCounts.failed}</div>
          </div>
          <div className="border rounded p-3 md:col-span-2">
            <div className="text-gray-500">Last Manual Replay</div>
            <div className="font-medium">{formatTimestamp(syncCounts.lastReplayAt)}</div>
          </div>
        </div>

        <div className="mt-4 border rounded p-4 text-sm">
          <div className="font-medium mb-3">Auth Diagnostics</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <div className="text-gray-500">Token Present</div>
              <div className="font-semibold">{authDiagnostics.tokenPresent ? "Yes" : "No"}</div>
            </div>
            <div>
              <div className="text-gray-500">Backend Enforcement</div>
              <div className="font-semibold">{authDiagnostics.backendAuthEnforcement}</div>
            </div>
            <div>
              <div className="text-gray-500">Backend Auth Status</div>
              <div className="font-semibold">{authDiagnostics.backendAuthStatus}</div>
            </div>
            <div>
              <div className="text-gray-500">Last Replay Auth</div>
              <div className="font-semibold">{lastReplayAuthStatus}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <div>
              <div className="text-gray-500">Replay Auth Gate</div>
              <div className="font-semibold">{lastReplayAuthGate?.state ?? "none"}</div>
            </div>
            <div>
              <div className="text-gray-500">Session Checked At</div>
              <div className="font-semibold">{formatTimestamp(lastReplayAuthGate?.checkedAt ?? null)}</div>
            </div>
            <div>
              <div className="text-gray-500">Gate Result</div>
              <div className="font-semibold">{lastReplayAuthGate ? (lastReplayAuthGate.allowed ? "Allowed" : "Blocked") : "n/a"}</div>
            </div>
          </div>

          {lastReplayAuthGate && (
            <div className="mt-3 rounded border bg-gray-50 p-2 text-gray-700">
              {lastReplayAuthGate.message}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <div>
              <div className="text-gray-500">POS Active</div>
              <div className="font-semibold">{posActivity.active ? "Yes" : "No"}</div>
            </div>
            <div>
              <div className="text-gray-500">POS Started At</div>
              <div className="font-semibold">{formatTimestamp(posActivity.startedAt ?? null)}</div>
            </div>
            <div>
              <div className="text-gray-500">POS Source</div>
              <div className="font-semibold">{posActivity.source ?? "n/a"}</div>
            </div>
          </div>

          {(authDiagnostics.actorType || authDiagnostics.actorId || authDiagnostics.actorRole) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <div>
                <div className="text-gray-500">Actor Type</div>
                <div className="font-semibold">{authDiagnostics.actorType ?? "n/a"}</div>
              </div>
              <div>
                <div className="text-gray-500">Actor ID</div>
                <div className="font-semibold break-all">{authDiagnostics.actorId ?? "n/a"}</div>
              </div>
              <div>
                <div className="text-gray-500">Actor Role</div>
                <div className="font-semibold">{authDiagnostics.actorRole ?? "n/a"}</div>
              </div>
            </div>
          )}
        </div>

        {syncError && (
          <div className="mt-4 border border-red-200 bg-red-50 text-red-700 rounded p-3 text-sm">
            {syncError}
          </div>
        )}

        {syncDiagnostics && (
          <div className="mt-4 border rounded p-4 text-sm">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <div className="text-gray-500">Processed</div>
                <div className="font-semibold">{syncDiagnostics.processed}</div>
              </div>
              <div>
                <div className="text-gray-500">Succeeded</div>
                <div className="font-semibold">{syncDiagnostics.succeeded}</div>
              </div>
              <div>
                <div className="text-gray-500">Failed</div>
                <div className="font-semibold">{syncDiagnostics.failed}</div>
              </div>
              <div>
                <div className="text-gray-500">Skipped</div>
                <div className="font-semibold">{syncDiagnostics.skipped}</div>
              </div>
            </div>

            {syncDiagnostics.errors.length > 0 && (
              <div className="mt-4">
                <div className="font-medium mb-2">Safe Error Summary</div>
                <div className="space-y-2">
                  {syncDiagnostics.errors.map((error, index) => (
                    <div key={`${error.id ?? "no-id"}-${index}`} className="border rounded p-2 bg-gray-50">
                      <div>Queue ID: {error.id ?? "n/a"}</div>
                      <div>Entity: {error.entity}</div>
                      <div>Operation: {error.operation}</div>
                      {error.status && <div>Status: {error.status}</div>}
                      {error.authError && <div>Auth: action required</div>}
                      <div>Message: {error.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


