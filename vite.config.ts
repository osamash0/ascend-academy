import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    // SECURITY: bind to loopback only so the dev server is never reachable from
    // the host's public IP / 0.0.0.0. Reach it from another machine via the
    // university network or VPN (e.g. an SSH tunnel) — never bind it to
    // 0.0.0.0 without prior IT-security approval.
    host: "127.0.0.1",
    port: 5001,
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
      },
    },
    watch: {
      ignored: ['**/venv/**', '**/.venv/**'],
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    /*
     * `motion` depends on `framer-motion@^13` while the app pins `^12`, so npm
     * nests a second copy — and `motion/react` then resolved its own React too.
     * Every v4 route died in `MotionConfig` with "Cannot read properties of
     * null (reading 'useContext')": React's own "more than one copy of React"
     * failure, from a duplicated runtime rather than a duplicated import.
     *
     * Deduping forces one instance of each. Cheaper and more reversible than
     * migrating 99 old-product files off `framer-motion`.
     */
    dedupe: ['react', 'react-dom', 'motion', 'framer-motion'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-motion': ['framer-motion'],
          'vendor-ui': ['lucide-react', 'clsx', 'tailwind-merge'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-supabase': ['@supabase/supabase-js'],
        },
      },
    },
  },
}));
