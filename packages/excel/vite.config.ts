import { defineConfig } from "vite";
import { resolve } from "path";
import { readFileSync } from "fs";
import { homedir } from "os";

const certDir = resolve(homedir(), ".office-addin-dev-certs");

export default defineConfig({
  root: "src",
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        taskpane: resolve(__dirname, "src/taskpane/taskpane.html"),
      },
    },
  },
  server: {
    port: 3000,
    https: {
      key: readFileSync(resolve(certDir, "localhost.key")),
      cert: readFileSync(resolve(certDir, "localhost.crt")),
    },
  },
});
