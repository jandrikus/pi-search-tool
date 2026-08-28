/**
 * How the tools drive the CLI, and what the model gets back.
 *
 * Every test goes through the real `execute` the agent calls; the only thing
 * swapped out is the binary on PATH, so the argv assertions are assertions
 * about the command that would really be run.
 */

import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadTools, StubBinary, hideSearchHeadless, type Tool } from "./harness";

let stub: StubBinary;
let search: Tool;
let fetchTool: Tool;

beforeEach(() => {
  stub = new StubBinary();
  const tools = loadTools();
  search = tools.get("search")!;
  fetchTool = tools.get("fetch")!;
});

afterEach(() => stub.restore());

const OK_SEARCH = {
  query: "example",
  engine: "brave",
  status: "ok",
  results: [
    {
      rank: 1,
      title: "First Result",
      url: "https://example.com/one",
      displayUrl: "example.com › one",
      snippet: "A snippet about the first result.",
    },
    { rank: 2, title: "Second Result", url: "https://example.org/two" },
  ],
  errors: [],
};

const OK_FETCH = {
  url: "https://example.com/article",
  status: "ok",
  title: "An Article",
  siteName: "Example Site",
  byline: "A Writer",
  publishedTime: "2026-08-29",
  excerpt: "The standfirst.",
  text: "The body of the article.",
  method: "http",
  truncated: false,
  textLength: 24,
  errors: [],
};

describe("the command that gets run", () => {
  it("registers exactly the two tools pi exposes to the model", () => {
    const tools = loadTools();
    expect([...tools.keys()].sort()).toEqual(["fetch", "search"]);
  });

  it("invokes the search subcommand with the query as its own argument", async () => {
    stub.respondWith(OK_SEARCH);
    await search.execute("call-1", { query: "rust async runtime", limit: 5 });

    expect(stub.argv()).toEqual([
      "search",
      "--limit",
      "5",
      "--format",
      "json",
      "--",
      "rust async runtime",
    ]);
  });

  it("invokes the fetch subcommand with the url as its own argument", async () => {
    stub.respondWith(OK_FETCH);
    await fetchTool.execute("call-1", { url: "https://example.com/article", maxChars: 4000 });

    expect(stub.argv()).toEqual([
      "fetch",
      "--max-chars",
      "4000",
      "--format",
      "json",
      "--",
      "https://example.com/article",
    ]);
  });

  it("clamps the limit and max-chars the model asked for", async () => {
    stub.respondWith(OK_SEARCH);
    await search.execute("c", { query: "q", limit: 999 });
    expect(stub.argv()).toContain("20");

    await search.execute("c", { query: "q", limit: 0 });
    expect(stub.argv()).toContain("1");

    stub.respondWith(OK_FETCH);
    await fetchTool.execute("c", { url: "https://example.com", maxChars: 10 });
    expect(stub.argv()).toContain("1000");
  });

  it("defaults to a limit of 10 and 50000 max chars when the model omits them", async () => {
    stub.respondWith(OK_SEARCH);
    await search.execute("c", { query: "q" });
    expect(stub.argv()).toEqual(["search", "--limit", "10", "--format", "json", "--", "q"]);

    stub.respondWith(OK_FETCH);
    await fetchTool.execute("c", { url: "https://example.com" });
    expect(stub.argv()).toEqual([
      "fetch",
      "--max-chars",
      "50000",
      "--format",
      "json",
      "--",
      "https://example.com",
    ]);
  });
});

describe("no shell is involved", () => {
  /**
   * The regression this guards: the query used to be interpolated into a shell
   * string with only `"` escaped, so a query the model wrote could run commands.
   */
  it("passes shell metacharacters through as text instead of executing them", async () => {
    const marker = stub.path("pwned");
    const query = `harmless $(touch ${marker}) and \`touch ${marker}\` query`;
    stub.respondWith(OK_SEARCH);

    await search.execute("call-1", { query });

    expect(existsSync(marker)).toBe(false);
    expect(stub.argv()!.at(-1)).toBe(query);
  });

  it("keeps a url containing a semicolon in one piece", async () => {
    const marker = stub.path("pwned-url");
    const url = `https://example.com/a?x=1;touch ${marker}`;
    stub.respondWith(OK_FETCH);

    await fetchTool.execute("call-1", { url });

    expect(existsSync(marker)).toBe(false);
    expect(stub.argv()!.at(-1)).toBe(url);
  });

  /**
   * Without the `--` separator the CLI reads a leading-dash query as a flag,
   * prints its help text, and the JSON parse then fails.
   */
  it("sends a query that starts with a dash after the -- separator", async () => {
    stub.respondWith(OK_SEARCH);
    await search.execute("call-1", { query: "--help" });

    const argv = stub.argv()!;
    expect(argv.indexOf("--")).toBeLessThan(argv.indexOf("--help"));
    expect(argv.at(-1)).toBe("--help");
  });
});

describe("what the model reads back", () => {
  it("renders search results as a numbered list of links with their snippets", async () => {
    stub.respondWith(OK_SEARCH);
    const result = await search.execute("call-1", { query: "example" });
    const text = result.content[0].text;

    expect(text).toContain("# Search results for `example`");
    expect(text).toContain("1. [First Result](https://example.com/one)");
    expect(text).toContain("- URL: example.com › one");
    expect(text).toContain("- Snippet: A snippet about the first result.");
    expect(text).toContain("2. [Second Result](https://example.org/two)");
    expect(result.isError).toBeFalsy();
  });

  it("includes the page body when the search was run with content fetching", async () => {
    stub.respondWith({
      ...OK_SEARCH,
      results: [
        {
          ...OK_SEARCH.results[0],
          fetched: { url: "https://example.com/one", status: "ok", text: "Line one\nLine two", errors: [] },
        },
      ],
    });

    const text = (await search.execute("call-1", { query: "example" })).content[0].text;
    expect(text).toContain("## Fetched content");
    expect(text).toContain("   Line one");
    expect(text).toContain("   Line two");
  });

  it("renders a fetched page as a titled document with its excerpt and body", async () => {
    stub.respondWith(OK_FETCH);
    const result = await fetchTool.execute("call-1", { url: "https://example.com/article" });
    const text = result.content[0].text;

    expect(text).toContain("# An Article");
    expect(text).toContain("URL: https://example.com/article");
    expect(text).toContain("> The standfirst.");
    expect(text).toContain("The body of the article.");
  });

  it("falls back to the url as the heading when a page has no title", async () => {
    stub.respondWith({ ...OK_FETCH, title: undefined });
    const text = (await fetchTool.execute("c", { url: "https://example.com/article" })).content[0].text;
    expect(text).toContain("# https://example.com/article");
  });

  it("surfaces a blocked search rather than reporting an empty success", async () => {
    stub.respondWith({
      query: "example",
      engine: "brave",
      status: "blocked",
      results: [],
      errors: [{ code: "BRAVE_CHALLENGE", message: "Brave served a bot challenge.", recoverable: true }],
    });

    const result = await search.execute("call-1", { query: "example" });
    expect(result.content[0].text).toContain("BRAVE_CHALLENGE: Brave served a bot challenge.");
    expect(result.details.status).toBe("blocked");
    expect(result.details.hasErrors).toBe(true);
    expect(result.details.resultCount).toBe(0);
  });
});

describe("the metadata the UI renders", () => {
  it("carries the engine, status and result count from the response", async () => {
    stub.respondWith(OK_SEARCH);
    const { details } = await search.execute("call-1", { query: "example", limit: 5 });

    expect(details).toMatchObject({
      query: "example",
      limit: 5,
      engine: "brave",
      status: "ok",
      resultCount: 2,
      hasErrors: false,
    });
  });

  it("carries the provenance fields a fetched page reports", async () => {
    stub.respondWith({ ...OK_FETCH, truncated: true, textLength: 120000, method: "browser" });
    const { details } = await fetchTool.execute("call-1", { url: "https://example.com/article" });

    expect(details).toMatchObject({
      url: "https://example.com/article",
      status: "ok",
      title: "An Article",
      siteName: "Example Site",
      byline: "A Writer",
      publishedTime: "2026-08-29",
      textLength: 120000,
      truncated: true,
      method: "browser",
      hasErrors: false,
    });
  });
});

describe("failures reach the model as text, not as a thrown error", () => {
  it("reports a missing binary with the command that installs it", async () => {
    const restore = hideSearchHeadless();
    try {
      const result = await search.execute("call-1", { query: "example" });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("search-headless");
      expect(result.content[0].text).toContain("./install.sh");
      expect(result.details.errors[0].code).toBe("execution_error");
    } finally {
      restore();
    }
  });

  /**
   * The CLI exits 1 for blocked, timeout and error but still prints the full
   * structured result. Treating that exit code alone as a failure threw the
   * reason away and handed the model "Command failed" plus the command line.
   */
  it("keeps the structured reason when the CLI exits non-zero with a result", async () => {
    stub.failWith(1, JSON.stringify({
      url: "https://example.com/missing",
      status: "error",
      errors: [{ code: "FETCH_HTTP_ERROR", message: "Server responded 404 Not Found.", recoverable: false }],
    }));

    const result = await fetchTool.execute("call-1", { url: "https://example.com/missing" });

    expect(result.content[0].text).toContain("FETCH_HTTP_ERROR: Server responded 404 Not Found.");
    expect(result.content[0].text).not.toContain("Command failed");
    expect(result.details.status).toBe("error");
    expect(result.details.errors[0].code).toBe("FETCH_HTTP_ERROR");
    expect(result.isError).toBe(true);
  });

  it("keeps a blocked search readable when the CLI exits non-zero", async () => {
    stub.failWith(1, JSON.stringify({
      query: "example",
      engine: "brave",
      status: "blocked",
      results: [],
      errors: [{ code: "BRAVE_CHALLENGE", message: "Brave served a bot challenge.", recoverable: true }],
    }));

    const result = await search.execute("call-1", { query: "example" });

    expect(result.content[0].text).toContain("BRAVE_CHALLENGE: Brave served a bot challenge.");
    expect(result.details.status).toBe("blocked");
    expect(result.isError).toBe(true);
  });

  it("reports a non-zero exit with nothing on stdout as a plain failure", async () => {
    stub.failWith(2, "");
    const result = await search.execute("call-1", { query: "example" });

    expect(result.isError).toBe(true);
    expect(result.details.status).toBe("error");
    expect(result.details.errors[0].code).toBe("execution_error");
  });

  it("reports unparseable stdout as a failure", async () => {
    stub.respondWith("not json at all");
    const result = await fetchTool.execute("call-1", { url: "https://example.com" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Fetch failed");
  });

  it("rejects a malformed url without running anything", async () => {
    stub.respondWith(OK_FETCH);
    const result = await fetchTool.execute("call-1", { url: "not a url" });

    expect(result.isError).toBe(true);
    expect(result.details.errors[0].code).toBe("invalid_url");
    expect(stub.argv()).toBeUndefined();
  });
});
