/**
 * pi-search-tool — Web search and content fetch extension for pi
 *
 * Provides two tools:
 * - search: Search the internet using `search-headless search` (Brave)
 * - fetch: Fetch and extract content from a URL using `search-headless fetch`
 *
 * Both tools run synchronously and return markdown-formatted results.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);

// ── Constants ──────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds
const MAX_TIMEOUT_MS = 120000; // 2 minutes

// ── Types (matching search-headless JSON structure) ────────────────────

type CommandStatus = "ok" | "partial" | "blocked" | "timeout" | "error";
type SearchEngine = "brave";
type FetchMethod = "http" | "browser";

interface ToolError {
  code: string;
  message: string;
  recoverable: boolean;
  details?: Record<string, unknown>;
}

interface FetchedContent {
  url: string;
  status: CommandStatus;
  title?: string;
  siteName?: string;
  byline?: string;
  publishedTime?: string;
  excerpt?: string;
  text?: string;
  method?: FetchMethod;
  truncated?: boolean;
  textLength?: number;
  errors: ToolError[];
}

interface SearchResult {
  rank: number;
  title: string;
  url: string;
  displayUrl?: string;
  snippet?: string;
  fetched?: FetchedContent;
}

interface SearchResponse {
  query: string;
  engine: SearchEngine;
  status: CommandStatus;
  results: SearchResult[];
  errors: ToolError[];
}

// Extension-specific details for UI rendering
interface SearchDetails {
  query: string;
  limit: number;
  engine: SearchEngine;
  status: CommandStatus;
  resultCount: number;
  hasErrors: boolean;
  errors: ToolError[];
}

interface FetchDetails {
  url: string;
  maxChars: number;
  status: CommandStatus;
  title?: string;
  siteName?: string;
  byline?: string;
  publishedTime?: string;
  textLength?: number;
  truncated?: boolean;
  method?: FetchMethod;
  hasErrors: boolean;
  errors: ToolError[];
}

// ── Helper Functions ──────────────────────────────────────────────────

/**
 * Resolve the path to the search-headless binary.
 *
 * search-headless is one executable with `search` and `fetch` subcommands; it
 * used to install two separate commands, `search-web` and `fetch-content`.
 */
async function resolveSearchHeadless(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("which", ["search-headless"]);
    return stdout.trim();
  } catch {
    throw new Error(
      "Command 'search-headless' not found. Please install search-headless: " +
      "cd ~/dev/search-headless && ./install.sh"
    );
  }
}

/**
 * Run search-headless with an argument vector and return stdout.
 *
 * No shell is involved: the query and the URL come from the model, and a shell
 * would run whatever `$(...)` or backticks they happened to contain.
 *
 * A non-zero exit is not on its own a failure to report. search-headless exits
 * 1 for `blocked`, `timeout` and `error` and still prints the whole structured
 * result, so anything on stdout is handed back for the caller to parse; the
 * status inside it says what went wrong. Only an exit that produced nothing to
 * parse - bad arguments, a missing binary - throws.
 */
async function runSearchHeadless(
  bin: string,
  args: string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string }> {
  const clampedTimeout = Math.min(timeoutMs, MAX_TIMEOUT_MS);

  try {
    return await execFileAsync(bin, args, {
      timeout: clampedTimeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      encoding: "utf-8",
    });
  } catch (error: any) {
    // Covers both a reported failure and a timeout that produced partial output.
    if (error.stdout) {
      return { stdout: error.stdout, stderr: error.stderr || "" };
    }
    throw new Error(
      `Command failed: ${error.message}\n` +
      (error.stderr ? `stderr: ${error.stderr}` : "")
    );
  }
}

// ── JSON to Markdown Conversion ──────────────────────────────────────

/**
 * Convert SearchResponse JSON to markdown (similar to `search --format markdown`)
 */
function searchResponseToMarkdown(response: SearchResponse): string {
  const lines: string[] = [`# Search results for \`${response.query}\``, ""];
  
  for (const result of response.results) {
    lines.push(`${result.rank}. [${result.title}](${result.url})`);
    if (result.displayUrl) lines.push(`   - URL: ${result.displayUrl}`);
    if (result.snippet) lines.push(`   - Snippet: ${result.snippet}`);
    if (result.fetched?.text) {
      lines.push("", "   ## Fetched content", "");
      // Indent fetched content
      const indented = result.fetched.text.split("\n").map(l => `   ${l}`).join("\n");
      lines.push(indented);
    }
    lines.push("");
  }
  
  if (response.errors.length > 0) {
    lines.push("## Errors", "");
    for (const error of response.errors) {
      lines.push(`- ${error.code}: ${error.message}`);
    }
  }
  
  return lines.join("\n").trim() + "\n";
}

/**
 * Convert FetchedContent JSON to markdown (similar to `fetch --format markdown`)
 */
function fetchedContentToMarkdown(content: FetchedContent): string {
  const lines: string[] = [];
  
  // Title
  if (content.title) {
    lines.push(`# ${content.title}`);
  } else {
    lines.push(`# ${content.url}`);
  }
  lines.push("");
  
  // URL
  lines.push(`URL: ${content.url}`);
  lines.push("");
  
  // Excerpt
  if (content.excerpt) {
    lines.push(`> ${content.excerpt}`);
    lines.push("");
  }
  
  // Content
  if (content.text) {
    lines.push(content.text);
    lines.push("");
  }
  
  // Errors
  if (content.errors.length > 0) {
    lines.push("## Errors", "");
    for (const error of content.errors) {
      lines.push(`- ${error.code}: ${error.message}`);
    }
  }
  
  return lines.join("\n").trim() + "\n";
}

/**
 * Whether a status carries something the model can use.
 *
 * Mirrors the CLI's exit codes: `ok` and `partial` exit 0, everything else
 * exits 1.
 */
function isUsable(status: CommandStatus): boolean {
  return status === "ok" || status === "partial";
}

/**
 * Format file size in human-readable format
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} chars`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}k chars`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M chars`;
}

// ── Extension Registration ─────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Register the search tool
  pi.registerTool({
    name: "search",
    label: "Search",
    description:
      "Search the internet using one or more query terms. Returns titles, URLs, and snippets. " +
      "Use for initial discovery before fetching full content.",
    promptSnippet: "Search the internet with one or more query terms",
    promptGuidelines: [
      "Use search to find relevant web pages before fetching their content.",
      "Provide clear, specific search terms for better results.",
      "Results include titles, URLs, and snippets — use fetch to read full content.",
      "Brave is the only engine; a bot challenge is reported as blocked, never solved.",
    ],
    parameters: Type.Object({
      query: Type.String({
        description:
          "The search query. Can be a question, keywords, or phrase. " +
          "Examples: 'best practices for REST API design', 'TypeScript generics tutorial'",
      }),
      limit: Type.Optional(
        Type.Number({
          description: "Maximum number of results to return (default: 10, max: 20)",
          minimum: 1,
          maximum: 20,
        }),
      ),
    }),
    async execute(toolCallId: string, params: { query: string; limit?: number }, signal: any, onUpdate: any, ctx: any) {
      const { query, limit = 10 } = params;
      const limitArg = Math.min(Math.max(1, limit), 20);

      try {
        const bin = await resolveSearchHeadless();

        // `--` keeps a query that starts with a dash from being read as a flag.
        const { stdout, stderr } = await runSearchHeadless(bin, [
          "search",
          "--limit",
          String(limitArg),
          "--format",
          "json",
          "--",
          query,
        ]);

        // Parse JSON response
        let response: SearchResponse;
        try {
          response = JSON.parse(stdout);
        } catch (parseError: any) {
          throw new Error(`Failed to parse search response: ${parseError.message}`);
        }

        // Convert to markdown for LLM display
        const markdown = searchResponseToMarkdown(response);

        // Extract structured details for UI
        const details: SearchDetails = {
          query: response.query,
          limit: limitArg,
          engine: response.engine,
          status: response.status,
          resultCount: response.results.length,
          hasErrors: response.errors.length > 0,
          errors: response.errors,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: markdown || "No results found.",
            },
          ],
          details,
          // `partial` still carries usable results; blocked, timeout and error
          // do not, and the model should treat them as a failed call.
          isError: !isUsable(response.status),
        };
      } catch (error: any) {
        const details: SearchDetails = {
          query,
          limit: limitArg,
          engine: "brave", // default
          status: "error",
          resultCount: 0,
          hasErrors: true,
          errors: [{ code: "execution_error", message: error.message, recoverable: false }],
        };

        return {
          content: [
            {
              type: "text" as const,
              text: `Search failed: ${error.message}`,
            },
          ],
          details,
          isError: true,
        };
      }
    },
    renderCall(args: { query: string; limit?: number }, theme: any, context: any) {
      const queryPreview = args.query.length > 60 ? args.query.slice(0, 60) + "..." : args.query;
      let text = `${theme.fg("accent", "🔍")} ${theme.fg("toolTitle", theme.bold("search"))} — ${theme.fg("text", queryPreview)}`;
      if (context.executionStarted && !context.argsComplete) {
        text += `\n${theme.fg("dim", "  Searching...")}`;
      }
      return new Text(text, 0, 0);
    },
    renderResult(result: any, options: { expanded: boolean; isPartial: boolean }, theme: any, context: any) {
      const details = result.details as SearchDetails | undefined;
      const mdTheme = getMarkdownTheme();
      const isError = details?.status === "error" || details?.hasErrors;
      const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
      
      // Only show status/result, not the query (renderCall already shows it)
      let text = `${icon}`;
      if (details?.engine) {
        text += ` ${theme.fg("accent", `[${details.engine}]`)}`;
      }
      if (details?.status === "ok" && details.resultCount > 0) {
        text += ` — ${theme.fg("dim", `${details.resultCount} results`)}`;
      }

      // Show errors on new line if any
      if (isError && details?.errors?.length) {
        const errorMsg = details.errors[0].message;
        text += `\n${theme.fg("error", errorMsg)}`;
      }

      if (options.expanded && result.content?.[0]?.text) {
        const container = new Box(1, 1, (t: string) => theme.bg("customMessageBg", t));
        container.addChild(new Text(text, 0, 0));
        container.addChild(new Spacer(1));
        container.addChild(new Markdown(result.content[0].text, 0, 0, mdTheme));
        return container;
      }

      // Collapsed: show first few lines of results (no extra Box wrapper)
      if (result.content?.[0]?.text && !isError) {
        const lines = result.content[0].text.split("\n");
        const preview = lines.slice(0, 6).join("\n");
        text += `\n${theme.fg("dim", preview)}`;
        if (lines.length > 6) {
          text += `\n${theme.fg("muted", `... (${lines.length - 6} more lines)`)}`;
        }
      }

      return new Text(text, 0, 0);
    },
  });

  // Register the fetch tool
  pi.registerTool({
    name: "fetch",
    label: "Fetch",
    description:
      "Fetch the full content of a URL. Tries HTTP + Readability first and falls " +
      "back to a real browser render for pages written by script. " +
      "Use after search to read primary sources in depth.",
    promptSnippet: "Fetch full content of a URL",
    promptGuidelines: [
      "Use fetch to read the full content of URLs found via search.",
      "Extracts clean, readable content from web pages.",
      "Handles JavaScript-rendered pages automatically.",
      "Returns markdown-formatted content for easy reading.",
    ],
    parameters: Type.Object({
      url: Type.String({
        description:
          "The URL to fetch. Must be a valid HTTP/HTTPS URL. " +
          "Example: 'https://example.com/article'",
      }),
      maxChars: Type.Optional(
        Type.Number({
          description: "Maximum characters to return (default: 50000)",
          minimum: 1000,
          maximum: 200000,
        }),
      ),
    }),
    async execute(toolCallId: string, params: { url: string; maxChars?: number }, signal: any, onUpdate: any, ctx: any) {
      const { url, maxChars = 50000 } = params;
      const maxCharsArg = Math.min(Math.max(1000, maxChars), 200000);

      // Validate URL format
      try {
        new URL(url);
      } catch {
        const details: FetchDetails = {
          url,
          maxChars: maxCharsArg,
          status: "error",
          hasErrors: true,
          errors: [{ code: "invalid_url", message: "Invalid URL format", recoverable: false }],
        };

        return {
          content: [
            {
              type: "text" as const,
              text: `Invalid URL: ${url}. Please provide a valid HTTP/HTTPS URL.`,
            },
          ],
          details,
          isError: true,
        };
      }

      try {
        const bin = await resolveSearchHeadless();

        const { stdout, stderr } = await runSearchHeadless(bin, [
          "fetch",
          "--max-chars",
          String(maxCharsArg),
          "--format",
          "json",
          "--",
          url,
        ]);

        // Parse JSON response
        let response: FetchedContent;
        try {
          response = JSON.parse(stdout);
        } catch (parseError: any) {
          throw new Error(`Failed to parse fetch response: ${parseError.message}`);
        }

        // Convert to markdown for LLM display
        const markdown = fetchedContentToMarkdown(response);

        // Extract structured details for UI
        const details: FetchDetails = {
          url: response.url,
          maxChars: maxCharsArg,
          status: response.status,
          title: response.title,
          siteName: response.siteName,
          byline: response.byline,
          publishedTime: response.publishedTime,
          textLength: response.textLength || response.text?.length,
          truncated: response.truncated,
          method: response.method,
          hasErrors: response.errors.length > 0,
          errors: response.errors,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: markdown || "No content extracted.",
            },
          ],
          details,
          isError: !isUsable(response.status),
        };
      } catch (error: any) {
        const details: FetchDetails = {
          url,
          maxChars: maxCharsArg,
          status: "error",
          hasErrors: true,
          errors: [{ code: "execution_error", message: error.message, recoverable: false }],
        };

        return {
          content: [
            {
              type: "text" as const,
              text: `Fetch failed: ${error.message}`,
            },
          ],
          details,
          isError: true,
        };
      }
    },
    renderCall(args: { url: string; maxChars?: number }, theme: any, context: any) {
      const urlPreview = args.url.length > 60 ? args.url.slice(0, 60) + "..." : args.url;
      let text = `${theme.fg("accent", "📄")} ${theme.fg("toolTitle", theme.bold("fetch"))} — ${theme.fg("text", urlPreview)}`;
      if (context.executionStarted && !context.argsComplete) {
        text += `\n${theme.fg("dim", "  Fetching...")}`;
      }
      return new Text(text, 0, 0);
    },
    renderResult(result: any, options: { expanded: boolean; isPartial: boolean }, theme: any, context: any) {
      const details = result.details as FetchDetails | undefined;
      const mdTheme = getMarkdownTheme();
      const isError = details?.status === "error" || details?.hasErrors;
      const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
      
      // Only show status/result, not the URL (renderCall already shows it)
      let text = `${icon}`;
      if (details?.title) {
        text += ` — ${theme.fg("accent", details.title)}`;
      }
      if (details?.textLength) {
        text += ` — ${theme.fg("dim", formatSize(details.textLength))}`;
      }
      if (details?.truncated) {
        text += ` ${theme.fg("warning", "[truncated]")}`;
      }
      if (details?.method) {
        text += ` ${theme.fg("dim", `(${details.method})`)}`;
      }

      // Show errors on new line if any
      if (isError && details?.errors?.length) {
        const errorMsg = details.errors[0].message;
        text += `\n${theme.fg("error", errorMsg)}`;
      }

      // Show metadata on new line in collapsed view
      if (!options.expanded && details?.siteName) {
        const meta: string[] = [];
        if (details.siteName) meta.push(details.siteName);
        if (details.byline) meta.push(details.byline);
        if (details.publishedTime) meta.push(details.publishedTime);
        if (meta.length > 0) {
          text += `\n${theme.fg("dim", meta.join(" • "))}`;
        }
      }

      if (options.expanded && result.content?.[0]?.text) {
        const container = new Box(1, 1, (t: string) => theme.bg("customMessageBg", t));
        container.addChild(new Text(text, 0, 0));
        container.addChild(new Spacer(1));
        container.addChild(new Markdown(result.content[0].text, 0, 0, mdTheme));
        return container;
      }

      // Collapsed: show first few lines of content (no extra Box wrapper)
      if (result.content?.[0]?.text && !isError) {
        const lines = result.content[0].text.split("\n");
        const preview = lines.slice(0, 8).join("\n");
        text += `\n${theme.fg("dim", preview)}`;
        if (lines.length > 8) {
          text += `\n${theme.fg("muted", `... (${lines.length - 8} more lines)`)}`;
        }
      }

      return new Text(text, 0, 0);
    },
  });
}
