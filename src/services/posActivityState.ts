export type POSActivitySource = "pos-cart" | "invoice-finalization" | "unknown";

export type POSActivityState = {
  active: boolean;
  startedAt?: number;
  source?: POSActivitySource;
};

const STORAGE_KEY = "jawadBro.posActivityState";
const DEFAULT_STATE: POSActivityState = { active: false };
let memoryState: POSActivityState = DEFAULT_STATE;

function isBrowserStorageAvailable() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function sanitizeState(value: unknown): POSActivityState {
  if (!value || typeof value !== "object") return DEFAULT_STATE;

  const candidate = value as Partial<POSActivityState>;
  const active = Boolean(candidate.active);
  const startedAt = typeof candidate.startedAt === "number" && Number.isFinite(candidate.startedAt)
    ? candidate.startedAt
    : undefined;
  const source = candidate.source === "pos-cart" || candidate.source === "invoice-finalization" || candidate.source === "unknown"
    ? candidate.source
    : undefined;

  return {
    active,
    ...(active && startedAt ? { startedAt } : {}),
    ...(active && source ? { source } : {}),
  };
}

function readStoredState(): POSActivityState {
  if (!isBrowserStorageAvailable()) return memoryState;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return memoryState;
    return sanitizeState(JSON.parse(raw));
  } catch {
    return memoryState;
  }
}

function writeState(nextState: POSActivityState) {
  memoryState = sanitizeState(nextState);

  if (!isBrowserStorageAvailable()) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryState));
  } catch {
    // Best-effort diagnostics state only; POS behavior must not depend on this write.
  }
}

export function markPOSActivityStarted(source: POSActivitySource = "unknown") {
  const current = readStoredState();
  writeState({
    active: true,
    startedAt: current.active && current.startedAt ? current.startedAt : Date.now(),
    source,
  });
}

export function markPOSActivityStopped() {
  writeState({ active: false });
}

export function getPOSActivityState(): POSActivityState {
  return readStoredState();
}
