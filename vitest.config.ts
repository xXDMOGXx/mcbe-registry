import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@minecraft/server": path.join(root, "test/minecraft-server-stub.ts"),
      "mcbe-ipc": path.join(root, "test/mcbe-ipc-stub.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "engine/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    server: {
      deps: {
        inline: ["@mcbe-registry/client", "mcbe-ipc"],
      },
    },
  },
});
