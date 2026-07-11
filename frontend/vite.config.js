import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// API + WS are proxied to the backend in dev so the frontend can use
// same-origin relative paths everywhere.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/art": { target: "http://localhost:8000", changeOrigin: true },
      "/stream": { target: "http://localhost:8000", changeOrigin: true },
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
});
