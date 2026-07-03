# claude-code-docs

**Unofficial mirror** of the [Claude Code documentation](https://code.claude.com/docs), synced every 6 hours via GitHub Actions.

- `llms.txt` — manifest ([source](https://code.claude.com/docs/llms.txt))
- `llms-full.txt` — full docs in one file ([source](https://code.claude.com/docs/llms-full.txt))
- `docs/` — individual pages, mirrored from the manifest so page additions, changes, and **deletions** are all tracked in git history

Useful queries:

```bash
git log --diff-filter=D -- docs/   # when was a page deleted
git log -p -- docs/hooks.md        # full change history of one page
```

## How it works

[`sync.ts`](sync.ts) treats `llms.txt` as the source of truth: it rebuilds `docs/` from scratch on every run, so pages removed from the manifest are removed from the tree. Any download failure aborts the run before committing, so transient network errors never show up as fake deletions.

## Using with [ASK](https://github.com/pleaseai/ask)

[ASK (Agent Skills Kit)](https://github.com/pleaseai/ask) gives AI coding agents lazy, on-demand access to this mirror instead of stuffing 5MB of docs into context.

```bash
# Install the CLI
brew install pleaseai/tap/ask        # or: npm install -g @pleaseai/ask

# One-off: resolve the cached docs path (clones + caches on first use)
ask docs github:pleaseai/claude-code-docs    # → ~/.ask/github/.../claude-code-docs/main/docs
ask src  github:pleaseai/claude-code-docs    # → repo root (llms.txt, llms-full.txt included)
```

To wire it into a project so agents get a generated skill:

```bash
ask add github:pleaseai/claude-code-docs   # appends to ask.json
ask install                                # generates AGENTS.md + a Claude Code skill with lazy doc references
```

Agents then read individual pages from the cached checkout on demand — always at the ref this mirror was last synced to.

### Semantic search with `ask search`

`ask search` delegates to [csp (Code Search Please)](https://github.com/pleaseai/code-search) for token-efficient semantic search over the cached checkout — ask "how does X work" instead of reading whole pages:

```bash
ask search github:pleaseai/claude-code-docs "how do hooks intercept tool calls" --content docs
ask search github:pleaseai/claude-code-docs "sandbox network policy" --content docs --top-k 10
```

Pass `--content docs` so csp indexes the per-page markdown under `docs/` (skipping the 5MB `llms-full.txt` bundle, which would only duplicate every result).

csp is optional: without it on `PATH`, `ask search` prints the resolved checkout path plus a runnable recipe (`csp search "<query>" "$(ask src github:pleaseai/claude-code-docs)/docs"`) instead of failing.

## Claude Code plugin: fetch docs as markdown

This repo is also a Claude Code plugin. A `PreToolUse` hook rewrites `code.claude.com/docs` page URLs to their `.md` source before WebFetch runs, so Claude reads the clean markdown twin instead of the HTML app shell:

```bash
/plugin install claude-code-docs@pleaseai
```

| WebFetch input | Rewritten to |
|---|---|
| `https://code.claude.com/docs/en/agents` | `https://code.claude.com/docs/en/agents.md` |
| `https://code.claude.com/docs/en/hooks#pretooluse-decision-control` | `https://code.claude.com/docs/en/hooks.md` |

Left untouched: URLs already ending in a file extension (`.md`, `llms.txt`, images), the docs root, and everything outside `code.claude.com/docs`. The hook returns [`updatedInput` with `permissionDecision: "allow"`](https://code.claude.com/docs/en/hooks#pretooluse-decision-control), so the rewritten fetch runs without an extra prompt.

Hook tests: `bash hooks/rewrite-docs-url.test.sh`

## Copyright

All documentation content is © [Anthropic](https://www.anthropic.com). This is an unofficial, unmodified mirror maintained for reference and tooling purposes; the canonical documentation lives at [code.claude.com/docs](https://code.claude.com/docs). This repository will be removed upon request by Anthropic.
