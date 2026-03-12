import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    proxy: {
      "/traffic": {
        target: "ws://localhost:3210",
        ws: true,
      },
    },
  },
});
