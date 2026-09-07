import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_rhdfctguthbwtcjgsvyx",
  dirs: ["./src/trigger"],
  runtime: "node-22",
  maxDuration: 300,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 10_000,
      factor: 2,
      randomize: true,
    },
  },
});
