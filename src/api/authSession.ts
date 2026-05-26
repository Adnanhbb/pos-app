import { apiClient } from "./client";
import { clearAuthToken, setAuthToken } from "./authToken";

export interface AuthActor {
  id?: number;
  serverId?: number;
  username?: string;
  Username?: string;
  name?: string;
  Name?: string;
  mobile?: string | null;
  Mobile?: string | null;
  role?: string;
  Role?: string;
  actorType?: string;
  actorId?: string;
  actorRole?: string;
  sessionId?: string | null;
}

export interface LoginResponse {
  success: true;
  data: {
    token: string;
    tokenType: "Bearer" | string;
    sessionId?: string;
    actor: AuthActor;
  };
}

export interface SessionResponse {
  success: true;
  data: {
    authenticated: boolean;
    actor: AuthActor;
  };
}

export async function loginWithPassword(username: string, password: string): Promise<AuthActor> {
  const response = await apiClient.post<LoginResponse>("/login.php", { username, password });
  const token = response?.data?.token?.trim();

  if (!token) {
    throw new Error("Login response did not include a bearer token.");
  }

  setAuthToken(token);
  return response.data.actor;
}

export async function fetchCurrentSession(): Promise<AuthActor | null> {
  const response = await apiClient.get<SessionResponse>("/session.php");
  return response?.data?.authenticated ? response.data.actor : null;
}

export async function logoutSession(): Promise<void> {
  try {
    await apiClient.post("/logout.php", {});
  } finally {
    clearAuthToken();
  }
}