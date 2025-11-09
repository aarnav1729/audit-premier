// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // ⛔ remove these — they cause duplicate module IDs for React
      // "react": path.resolve(__dirname, "node_modules/react"),
      // "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
    },
    // ✅ this is the safe, recommended way
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    // ⛔ do NOT prebundle React — let Vite/React plugin handle it
    exclude: ["react", "react-dom"],
    // ⛔ and remove your previous "include: ['react','react-dom']"
  },
  build: {
    rollupOptions: {
      output: {
        // optional: put amCharts in its own chunk
        manualChunks: {
          amcharts: ["@amcharts/amcharts5"]
        }
      }
    }
  }
});