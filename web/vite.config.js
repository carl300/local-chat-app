import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Forward /api/* requests to the Express backend.
    proxy: {
      "/api": "http://localhost:3001",
      "/auth": "http://localhost:3001",
      "/login": "http://localhost:3001",
    },
  },
});
