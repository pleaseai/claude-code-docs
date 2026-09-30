// Mirrors https://code.claude.com/docs into this repo.
// llms.txt is the manifest: pages removed from it are removed from docs/ too,
// so deletions show up as regular git deletions in the sync commit. Manifest
// entries that redirect off the docs site are treated the same way.
// Any fetch failure throws, failing the job before a partial tree gets committed.

import { rm } from "node:fs/promises";
import { dirname, relative } from "node:path/posix";

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
      // GitHub removes slashes from generated heading IDs, while the source
      // site percent-encodes them in fragments (for example, `%2F`).
      const githubAnchor = anchor.replace(/%2F/gi, "");
      return `${target}${githubAnchor}`;
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
  const text = await fetchPage(url);
  if (text === null) throw new Error(`${url} redirected off ${BASE}`);
  return text;
}

// Returns null when the URL redirects off the docs site: the page has moved
// elsewhere (e.g. claude-tag.md -> claude.com/docs) and is no longer part of
// this mirror. Following it would save another site's HTML as markdown, and
// that site may block CI runners outright (claude.com answers 403 there).
async function fetchPage(url: string): Promise<string | null> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status >= 300 && res.status < 400) {
        const location = new URL(res.headers.get("location") ?? "", url).href;
        if (!location.startsWith(`${BASE}/`)) return null;
        return await fetchPage(location);
      }
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

// Fetch everything first: which pages we actually mirror is only known once
// moved pages have been skipped, and link rewriting depends on that set.
const pages = new Map<string, string>(); // rel path -> raw content
const queue = [...urls];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    let url: string | undefined;
    while ((url = queue.shift())) {
      const content = await fetchPage(url);
      if (content === null) {
        console.log(`skipped ${url}: moved off ${BASE}`);
        continue;
      }
      pages.set(url.slice(`${BASE}/en/`.length), content);
    }
  }),
);

// Slugs of every page we mirror (rel without the `.md`), used to decide which
// cross-links can be rewritten to a local file vs. left as an absolute URL.
const knownSlugs = new Set([...pages.keys()].map((rel) => rel.slice(0, -".md".length)));

for (const [rel, content] of pages) {
  await Bun.write(`docs/${rel}`, rewriteLinks(content, rel, knownSlugs));
}

console.log(`synced ${pages.size} pages`);
