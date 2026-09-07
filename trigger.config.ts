import { defineConfig } from "@trigger.dev/sdk";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "proj_hhnfycbasptmcwkxjlcd",
  dirs: ["./src/trigger"],
  runtime: "node-22",
  maxDuration: 300,
  build: {
    extensions: [
      syncEnvVars(() => {
        const names = ["APIFY_TOKEN", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_DEPLOYMENT"] as const;
        const missing = names.filter((name) => !process.env[name]);
        if (missing.length) throw new Error(`${missing.join(", ")} required when deploying Trigger.dev`);
        return names.map((name) => ({ name, value: process.env[name]!, isSecret: name.endsWith("KEY") || name === "APIFY_TOKEN" }));
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
