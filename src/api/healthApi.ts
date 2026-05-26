import { apiClient } from "./client";

export const healthApi = {
  async check(): Promise<boolean> {
    try {
      await apiClient.get("/health.php");
      return true;
    } catch {
      return false;
    }
  },
};
