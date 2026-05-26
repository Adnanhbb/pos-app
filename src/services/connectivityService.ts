import { healthApi } from "../api/healthApi";

type ConnectivityListener = (state: {
  browserOnline: boolean;
  apiReachable: boolean | null;
}) => void;

const listeners = new Set<ConnectivityListener>();

let started = false;
let lastApiReachable: boolean | null = null;

function hasNavigator() {
  return typeof navigator !== "undefined";
}

function hasWindow() {
  return typeof window !== "undefined";
}

function getBrowserOnline() {
  return hasNavigator() ? navigator.onLine : true;
}

function notify() {
  const state = {
    browserOnline: getBrowserOnline(),
    apiReachable: lastApiReachable,
  };

  listeners.forEach((listener) => listener(state));
}

async function checkApiReachable() {
  if (!getBrowserOnline()) {
    lastApiReachable = false;
    notify();
    return false;
  }

  const reachable = await healthApi.check();
  lastApiReachable = reachable;
  notify();
  return reachable;
}

function handleOnlineChange() {
  notify();
  void checkApiReachable();
}

export const connectivityService = {
  getBrowserOnline,

  checkApiReachable,

  getLastApiReachable() {
    return lastApiReachable;
  },

  async isFullyOnline() {
    if (!getBrowserOnline()) return false;
    return await checkApiReachable();
  },

  subscribe(listener: ConnectivityListener) {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  },

  start() {
    if (started) return;
    started = true;

    if (hasWindow()) {
      window.addEventListener("online", handleOnlineChange);
      window.addEventListener("offline", handleOnlineChange);
    }

    notify();
    void checkApiReachable();
  },

  stop() {
    if (!started) return;
    started = false;

    if (hasWindow()) {
      window.removeEventListener("online", handleOnlineChange);
      window.removeEventListener("offline", handleOnlineChange);
    }

    lastApiReachable = null;
    notify();
  },
};
