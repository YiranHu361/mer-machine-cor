import "dotenv/config";
import {
  buildProfile,
  PUBLISHED_PROFILES,
} from "../server/orchestration/knowledge.ts";
import { ContextDevClient } from "../server/orchestration/context-dev.ts";

// Onboarding/build time only: reads at most two public pages about one model
// with context.dev and prints a candidate profile for review. It never runs
// during an order and never edits the published profiles itself.
// Usage: npm run profile:build -- "Phomemo M02Pro" [official-url ...]
const [model, ...officialUrls] = process.argv.slice(2);
const current = model ? PUBLISHED_PROFILES[model] : undefined;
if (!current) {
  console.error(
    `Name a published model: ${Object.keys(PUBLISHED_PROFILES).join(", ")}`,
  );
  process.exit(2);
}
const apiKey = process.env.CONTEXT_DEV_API_KEY;
if (!apiKey) {
  console.error("CONTEXT_DEV_BLOCKED: set CONTEXT_DEV_API_KEY in .env");
  process.exit(2);
}
// Manufacturer domains searched when no official page is given.
const OFFICIAL_DOMAINS: Record<string, string[]> = {
  "Phomemo M02Pro": ["phomemo.com"],
  "Instax Mini Link 3": ["instax.com", "fujifilm.com"],
  "Bambu Lab A1 mini": ["bambulab.com"],
};
const domains = officialUrls.length
  ? officialUrls.map((u) => new URL(u).hostname)
  : (OFFICIAL_DOMAINS[model] ?? []);
const result = await buildProfile(new ContextDevClient({ apiKey }), {
  model,
  process: current.process,
  officialUrls,
  includeDomains: [...new Set(domains)],
  current,
});
console.log(JSON.stringify(result, null, 2));
if (result.conflicts.length) process.exitCode = 1;
