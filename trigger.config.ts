import { defineConfig } from "@trigger.dev/sdk";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "proj_rhdfctguthbwtcjgsvyx",
  dirs: ["./src/trigger"],
  runtime: "node-22",
  maxDuration: 300,
  build: {
    extensions: [
      syncEnvVars(() => {
        if (!process.env.APIFY_TOKEN) throw new Error("APIFY_TOKEN is required when deploying Trigger.dev");
        return [{ name: "APIFY_TOKEN", value: process.env.APIFY_TOKEN, isSecret: true }];
      }, { override: true }),
    ],
  },
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
