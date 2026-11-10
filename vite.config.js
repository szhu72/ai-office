import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    base: "./",
    plugins: [react()],
    server: {
        watch: {
            ignored: ["**/public/mimi-reference.png", "**/.venv/**"],
        },
        // Forward AI requests to the Flask backend (app.py on port 5000)
        proxy: {
            "/api": "http://127.0.0.1:5000",
        },
    },
});
