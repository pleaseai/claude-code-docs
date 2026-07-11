// Mirrors https://code.claude.com/docs into this repo.
// llms.txt is the manifest: pages removed from it are removed from docs/ too,
// so deletions show up as regular git deletions in the sync commit.
// Any fetch failure throws, failing the job before a partial tree gets committed.

import { rm } from "node:fs/promises";
import { dirname, relative } from "node:path";

const BASE = "https://code.claude.com/docs";
const CONCURRENCY = 10;
const RETRIES = 3;

// The source pages link to each other with site-absolute paths like
// `/en/sub-agents` (no `.md`), which don't resolve when the mirror is browsed
// as files (e.g. on GitHub). Rewrite each such link relative to the file it
// lives in: pages we actually mirror become `../sub-agents.md`, everything else
// falls back to the canonical absolute URL so the link still goes somewhere.
function rewriteLinks(content: string, rel: string, knownSlugs: Set<string>): string {
  const fromDir = dirname(rel); // "." for top-level pages, e.g. "agent-sdk" for nested
  const resolve = (slug: string, anchor: string): string => {
    if (knownSlugs.has(slug)) {
      let target = relative(fromDir, `${slug}.md`);
      if (!target.startsWith(".")) target = `./${target}`;
      return `${target}${anchor}`;
    }
    return `${BASE}/en/${slug}${anchor}`;
  };
  // Markdown links: ](/en/slug) and ](/en/slug#anchor)
  content = content.replace(
    /\]\(\/en\/([^)#\s]+)(#[^)\s]*)?\)/g,
    (_m, slug, anchor = "") => `](${resolve(slug, anchor)})`,
  );
  // JSX/MDX component links: href="/en/slug"
  content = content.replace(
    /href="\/en\/([^"#\s]+)(#[^"\s]*)?"/g,
    (_m, slug, anchor = "") => `href="${resolve(slug, anchor)}"`,
  );
  return content;
}

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

// Slugs of every page we mirror (rel without the `.md`), used to decide which
// cross-links can be rewritten to a local file vs. left as an absolute URL.
const knownSlugs = new Set(urls.map((url) => url.slice(`${BASE}/en/`.length, -".md".length)));

const queue = [...urls];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    let url: string | undefined;
    while ((url = queue.shift())) {
      const rel = url.slice(`${BASE}/en/`.length);
      await Bun.write(`docs/${rel}`, rewriteLinks(await fetchText(url), rel, knownSlugs));
    }
  }),
);

console.log(`synced ${urls.length} pages`);
