import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const viteBasePath = process.env.VITE_BASE_PATH || "/pos-app/";

export default defineConfig({
  plugins: [react()],
  base: viteBasePath,
});
