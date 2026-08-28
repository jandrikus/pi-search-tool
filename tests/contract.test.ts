/**
 * The contract with search-headless itself.
 *
 * The stub tests pin what the extension sends and how it renders what comes
 * back, but they cannot notice search-headless changing its CLI or its JSON -
 * which is exactly what has broken this extension before, twice. These run the
 * real binary and assert that the fields the tools read are really there.
 *
 * No network: `fetch` goes at a local server, `search` at a fixture the CLI is
 * told to read instead of a live SERP. Skipped when the binary is not installed.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadTools, serve, type Tool } from "./harness";

const execFileAsync = promisify(execFile);

const FIXTURE = join(import.meta.dirname, "fixtures/brave-serp.html");

const ARTICLE = `<!doctype html><html><head>
  <title>Contract Article</title>
  <meta name="description" content="The standfirst of the contract article.">
  <meta property="og:site_name" content="Contract Site">
  <meta name="author" content="A Writer">
  <meta property="article:published_time" content="2026-08-29">
</head><body><article><h1>Contract Article</h1>
  <p>${"A paragraph with enough real prose that the extractor keeps it. ".repeat(40)}</p>
</article></body></html>`;

async function searchHeadlessInstalled(): Promise<boolean> {
  try {
    await execFileAsync("which", ["search-headless"]);
    return true;
  } catch {
    return false;
  }
}

const installed = await searchHeadlessInstalled();
const describeWithBinary = installed ? describe : describe.skip;

if (!installed) {
  console.warn("skipping contract tests: search-headless is not on PATH");
}

describeWithBinary("against the real search-headless binary", () => {
  let sandbox: string;
  let saved: Record<string, string | undefined>;
  let search: Tool;
  let fetchTool: Tool;

  const ENV_KEYS = [
    "SEARCH_HEADLESS_CACHE_DIR",
    "SEARCH_HEADLESS_RATE_FILE",
    "SEARCH_HEADLESS_NO_RATE_LIMIT",
    "SEARCH_HEADLESS_ALLOW_PRIVATE_URLS_FOR_TESTS",
    "SEARCH_HEADLESS_BRAVE_FIXTURE",
  ];

  beforeAll(() => {
    sandbox = mkdtempSync(join(tmpdir(), "pi-search-contract-"));
  });

  afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    // Keep the suite off the developer's real cache and out of the 10s search spacing.
    process.env.SEARCH_HEADLESS_CACHE_DIR = join(sandbox, "cache");
    process.env.SEARCH_HEADLESS_RATE_FILE = join(sandbox, "last-search");
    process.env.SEARCH_HEADLESS_NO_RATE_LIMIT = "1";
    process.env.SEARCH_HEADLESS_ALLOW_PRIVATE_URLS_FOR_TESTS = "1";

    const tools = loadTools();
    search = tools.get("search")!;
    fetchTool = tools.get("fetch")!;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("parses a real fetch and keeps every field the tool reports", async () => {
    const server = await serve(ARTICLE);
    try {
      const result = await fetchTool.execute("c", { url: `${server.url}/article`, maxChars: 50000 });

      expect(result.isError).toBeFalsy();
      expect(result.details.status).toBe("ok");
      // The tool renders these; a rename in search-headless silently blanks them.
      expect(result.details.title).toBe("Contract Article");
      expect(result.details.siteName).toBe("Contract Site");
      expect(result.details.byline).toBe("A Writer");
      expect(result.details.publishedTime).toBe("2026-08-29");
      expect(result.details.method).toBe("http");
      expect(result.details.textLength).toBeGreaterThan(0);
      expect(result.details.truncated).toBe(false);

      expect(result.content[0].text).toContain("# Contract Article");
      expect(result.content[0].text).toContain("> The standfirst of the contract article.");
      expect(result.content[0].text).toContain("A paragraph with enough real prose");
    } finally {
      await server.close();
    }
  });

  it("reports truncation the way the UI badge expects", async () => {
    const server = await serve(ARTICLE);
    try {
      const result = await fetchTool.execute("c", { url: `${server.url}/article`, maxChars: 1000 });

      expect(result.details.truncated).toBe(true);
      expect(result.details.textLength).toBeGreaterThan(1000);
    } finally {
      await server.close();
    }
  });

  /**
   * The regression that motivated this file: search-headless exits 1 here and
   * still prints the reason. The model must get the reason.
   */
  it("surfaces a real HTTP failure as its own error code, not as 'Command failed'", async () => {
    const result = await fetchTool.execute("c", { url: "http://127.0.0.1:1/nothing-is-listening" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).not.toContain("Command failed");
    expect(result.details.errors.length).toBeGreaterThan(0);
    expect(result.details.errors[0].code).toMatch(/^[A-Z_]+$/);
  });

  it("rejects a private url through the CLI's own guard", async () => {
    delete process.env.SEARCH_HEADLESS_ALLOW_PRIVATE_URLS_FOR_TESTS;
    const result = await fetchTool.execute("c", { url: "http://127.0.0.1:8080/admin" });

    expect(result.isError).toBe(true);
    expect(result.details.errors[0].code).toBe("PRIVATE_URL_BLOCKED");
  });

  it("parses a real search and keeps the fields the result list renders", async () => {
    process.env.SEARCH_HEADLESS_BRAVE_FIXTURE = FIXTURE;
    const result = await search.execute("c", { query: "contract", limit: 5 });

    expect(result.isError).toBeFalsy();
    expect(result.details.status).toBe("ok");
    expect(result.details.engine).toBe("brave");
    expect(result.details.resultCount).toBe(2);

    const text = result.content[0].text;
    expect(text).toContain("1. [First Contract Result](https://example.com/first)");
    expect(text).toContain("- URL: example.com › first");
    expect(text).toContain("- Snippet: A snippet the extension renders under the link.");
    expect(text).toContain("2. [Second Contract Result](https://example.org/second)");
    // Standalone snippets are not organic results.
    expect(text).not.toContain("A Standalone Video");
  });

  it("honours the limit the model asked for", async () => {
    process.env.SEARCH_HEADLESS_BRAVE_FIXTURE = FIXTURE;
    const result = await search.execute("c", { query: "contract", limit: 1 });

    expect(result.details.resultCount).toBe(1);
    expect(result.content[0].text).not.toContain("Second Contract Result");
  });

  it("still accepts a query that starts with a dash", async () => {
    process.env.SEARCH_HEADLESS_BRAVE_FIXTURE = FIXTURE;
    const result = await search.execute("c", { query: "--limit", limit: 2 });

    // Without `--` the CLI would print its help and the JSON parse would fail.
    expect(result.isError).toBeFalsy();
    expect(result.details.query).toBe("--limit");
  });
});
