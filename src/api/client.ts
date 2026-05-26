import { API_BASE_URL } from "./config";
import { getAuthToken } from "./authToken";

export class ApiError extends Error {
  status?: number;
  details?: any;

  constructor(message: string, status?: number, details?: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

type RequestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function buildUrl(path: string) {
  const base = API_BASE_URL.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

async function parseResponse(response: Response) {
  if (response.status === 204) return undefined;

  const text = await response.text();
  if (!text) return undefined;

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return JSON.parse(text);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(
  method: RequestMethod,
  path: string,
  body?: any
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  const authToken = getAuthToken();
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const init: RequestInit = {
    method,
    headers,
    // Enable this later if the PHP backend uses cookie/session auth.
    // credentials: "include",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  let response: Response;

  try {
    response = await fetch(buildUrl(path), init);
  } catch (error) {
    throw new ApiError("Network request failed", undefined, error);
  }

  let data: any;

  try {
    data = await parseResponse(response);
  } catch (error) {
    throw new ApiError("Failed to parse API response", response.status, error);
  }

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "message" in data
        ? String(data.message)
        : `API request failed with status ${response.status}`;

    throw new ApiError(message, response.status, data);
  }

  return data as T;
}

export const apiClient = {
  get<T>(path: string) {
    return request<T>("GET", path);
  },

  post<T>(path: string, body?: any) {
    return request<T>("POST", path, body);
  },

  put<T>(path: string, body?: any) {
    return request<T>("PUT", path, body);
  },

  patch<T>(path: string, body?: any) {
    return request<T>("PATCH", path, body);
  },

  delete<T>(path: string) {
    return request<T>("DELETE", path);
  },
};

