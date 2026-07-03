// Mirrors https://code.claude.com/docs into this repo.
// llms.txt is the manifest: pages removed from it are removed from docs/ too,
// so deletions show up as regular git deletions in the sync commit.
// Any fetch failure throws, failing the job before a partial tree gets committed.

import { rm } from "node:fs/promises";

const BASE = "https://code.claude.com/docs";
const CONCURRENCY = 10;
const RETRIES = 3;

async function fetchText(url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
      return await res.text();
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) await Bun.sleep(1000 * attempt);
    }
  }
  throw lastError;
}

const manifest = await fetchText(`${BASE}/llms.txt`);
const urls = [
  ...new Set(
    [...manifest.matchAll(/https:\/\/code\.claude\.com\/docs\/en\/[^)\s]+\.md/g)].map((m) => m[0]),
  ),
];

// A broken manifest parse would otherwise commit a mass deletion.
if (urls.length < 10) throw new Error(`manifest parse failed: only ${urls.length} pages found`);

await Bun.write("llms.txt", manifest);
await Bun.write("llms-full.txt", await fetchText(`${BASE}/llms-full.txt`));

await rm("docs", { recursive: true, force: true });

const queue = [...urls];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    let url: string | undefined;
    while ((url = queue.shift())) {
      const rel = url.slice(`${BASE}/en/`.length);
      await Bun.write(`docs/${rel}`, await fetchText(url));
    }
  }),
);

console.log(`synced ${urls.length} pages`);
