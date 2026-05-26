// Shared hosting can expose PHP REST endpoints under /api, for example:
// /api/health.php, /api/items.php, /api/sales.php.
const env = (import.meta as ImportMeta & {
  env?: { VITE_API_BASE_URL?: string };
}).env;

function getDefaultApiBaseUrl() {
  if (typeof window !== "undefined") {
    const { hostname, port } = window.location;

    if ((hostname === "localhost" || hostname === "127.0.0.1") && port === "5173") {
      return "http://localhost/jawad-bro/api";
    }
  }

  return "/api";
}

export const API_BASE_URL = env?.VITE_API_BASE_URL || getDefaultApiBaseUrl();