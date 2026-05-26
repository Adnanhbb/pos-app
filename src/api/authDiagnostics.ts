import { getAuthToken } from "./authToken";
import { API_BASE_URL } from "./config";

export type CrudAuthDiagnostics = {
  tokenPresent: boolean;
  backendAuthEnforcement: "on" | "off" | "unknown";
  backendAuthStatus: "absent" | "valid" | "invalid" | "unknown";
  actorType: string | null;
  actorId: string | null;
  actorRole: string | null;
};

function buildUrl(path: string) {
  const base = API_BASE_URL.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

function parseEnforcement(value: string | null): CrudAuthDiagnostics["backendAuthEnforcement"] {
  if (value === "enabled") return "on";
  if (value === "disabled") return "off";
  return "unknown";
}

function parseAuthStatus(value: string | null): CrudAuthDiagnostics["backendAuthStatus"] {
  if (value === "absent" || value === "valid" || value === "invalid") return value;
  return "unknown";
}

export async function fetchCrudAuthDiagnostics(): Promise<CrudAuthDiagnostics> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(buildUrl("/brands.php"), {
    method: "GET",
    headers,
  });

  return {
    tokenPresent: Boolean(token),
    backendAuthEnforcement: parseEnforcement(response.headers.get("x-auth-enforcement")),
    backendAuthStatus: parseAuthStatus(response.headers.get("x-auth-status")),
    actorType: response.headers.get("x-auth-actor-type"),
    actorId: response.headers.get("x-auth-actor-id"),
    actorRole: response.headers.get("x-auth-actor-role"),
  };
}
