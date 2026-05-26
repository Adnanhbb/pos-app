const AUTH_TOKEN_STORAGE_KEY = "jawadBro.authToken";

function canUseLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function getAuthToken(): string | null {
  if (!canUseLocalStorage()) return null;

  const token = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  const trimmed = token?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export function setAuthToken(token: string): void {
  if (!canUseLocalStorage()) return;

  const trimmed = token.trim();
  if (trimmed === "") {
    clearAuthToken();
    return;
  }

  window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, trimmed);
}

export function clearAuthToken(): void {
  if (!canUseLocalStorage()) return;
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
}

export const authTokenStorageKey = AUTH_TOKEN_STORAGE_KEY;
