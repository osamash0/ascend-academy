import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0",
    port: 5000,
    strictPort: true,
    allowedHosts: true,
    // Local dev: the app builds request URLs as `${VITE_API_URL}${path}`, and
    // with VITE_API_URL=/api that yields `/api/api/...`. In Docker, nginx's
    // `location /api/ { proxy_pass http://api:8000/; }` strips the leading
    // `/api` before forwarding. Mirror that here so `npm run dev` reaches the
    // local FastAPI backend instead of getting index.html back (which caused
    // "Failed to load courses/assignments" — a JSON.parse on '<!doctype').
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
