import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["client/tests/**/*.test.js"],
    // Section T2 (specs/phase5/test-stability.md, backlog A10): the real
    // Argon2/PBKDF2/AES tests exceed vitest's default 5s under concurrent
    // CPU load (stress run: 71 timeout failures at 5s, still 10 at 30s
    // under full-core saturation). 60s clears moderate contention (the
    // realistic CI case) with headroom; a genuinely hung test still fails,
    // just slower. pow.test.js's per-test raises stay (lower, harmless).
    testTimeout: 60000,
    hookTimeout: 60000
  }
});
