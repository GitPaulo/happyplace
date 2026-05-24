import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/happyplace/",
  server: {
    port: 5173,
  },
});
