import { jevPlugin } from "./server/jev-plugin.ts";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    jevPlugin(
      loadEnv(mode, process.cwd(), "TYPESAFE_").TYPESAFE_API_KEY?.trim() ?? "",
    ),
  ],
  base: "./",
  build: { chunkSizeWarningLimit: 1100 },
}));
