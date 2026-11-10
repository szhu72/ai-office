import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/app.[ext]",
      },
    },
  },
  server: {
    watch: {
      ignored: ["**/public/mimi-reference.png", "**/docs/**", "**/.venv/**"],
    },
    // Forward AI requests to the Flask backend (app.py on port 5000)
    proxy: {
      "/api": "http://127.0.0.1:5000",
    },
  },
});
