# pi-search-tool

A [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) extension that provides web search and content fetch tools using [search-headless](https://github.com/jandrikus/search-headless).

## Features

- **`search`** searches using a configured SearXNG instance by default, or Brave when selected.
  It returns titles, URLs and snippets in Markdown.
- **`fetch`** extracts content from a public HTTP or HTTPS URL.
  It tries HTTP + Readability first and falls back to an Obscura render when appropriate.

Both tools provide rich metadata in the UI (result count, content size, truncation status, etc.) and clean markdown output for the LLM.

## Prerequisites

This extension requires [`search-headless`](https://github.com/jandrikus/search-headless) to be installed on your machine. The extension shells out to its `search` and `fetch` subcommands.

### Install search-headless

Follow the [search-headless installation instructions](https://github.com/jandrikus/search-headless#install-on-a-machine).
The first prebuilt release is planned for Apple Silicon macOS and x86-64 Linux.
Until it is published, install from source using Git and Rust.

**Verify installation:**

```bash
search-headless search "rust async" --limit 5 --timeout 15000
search-headless fetch https://example.com --max-chars 500
```

If the command is not found, put the install directory on PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

On macOS, add that line to `~/.zshrc` to keep it for new shells.

For more details, see the [search-headless README](https://github.com/jandrikus/search-headless).

## Install pi-search-tool

### Option 1: Install from npm (recommended)

```bash
pi install npm:pi-search-tool
```

The currently published npm version may lag behind this repository.
SearXNG support requires a release containing the SearXNG changes.

### Option 2: Install from git

```bash
pi install git:github.com/jandrikus/pi-search-tool
```

### Option 3: Try without installing

To try the extension without installing it permanently:

```bash
pi -e npm:pi-search-tool
```

Or from a local path:

```bash
pi -e /path/to/pi-search-tool/extensions/index.ts
```

### Option 4: Install from local source (for development)

If you've cloned the repository locally:

```bash
pi install /path/to/pi-search-tool
```

Or run the extension directly without installing:

```bash
pi -e /path/to/pi-search-tool/extensions/index.ts
```

## Configuration

When you install a pi package, it's automatically added to your settings. You can also manually add it to your Pi configuration:

The extension defaults to SearXNG.
Set its HTTPS base URL in **user settings** (`~/.pi/agent/settings.json`):

```json
{
  "packages": ["npm:pi-search-tool"],
  "searchTool": {
    "engine": "searxng",
    "searxngUrl": "https://your-searxng.example"
  }
}
```

Set `SEARXNG_USER` and `SEARXNG_PASS` in the environment that starts Pi.
The backend requires both variables for HTTP Basic authentication, even if the instance is public.
The username must not contain a colon.
Do not put credentials in the URL or settings.
The instance must enable JSON in `search.formats` in `settings.yml`.
The URL must be the final HTTPS base URL, without credentials, a query string or a fragment.
Authenticated requests do not follow redirects.

`searchTool.searxngUrl` takes precedence over the `SEARXNG_URL` environment variable.
Set `searchTool.engine` to `brave` to use Brave instead.
There is no automatic fallback between engines.
The extension reads `searchTool` only from user settings, not project settings, so a project cannot choose where credentials are sent.
Pi can still load the package through project settings.

## Usage

### Search

Search the web for information:

```
search(query: "best practices for REST API design", limit: 10)
```

**Parameters:**
- `query` (required) — The search query. Can be a question, keywords, or phrase.
- `limit` (optional) — Maximum number of results to return (default: 10, max: 20).
- `paginate` (optional) — Follow more result pages until the limit is reached (default: false).

Without `paginate`, the tool reads one result page even if fewer results than the limit are returned.

**Returns:** Markdown-formatted results with titles, URLs, and snippets.

### Fetch

Fetch full content from a URL:

```
fetch(url: "https://example.com/article", maxChars: 50000)
```

**Parameters:**
- `url` (required) — The URL to fetch. Must be a valid HTTP/HTTPS URL.
- `maxChars` (optional) — Maximum characters to return (default: 50000, max: 200000).

**Returns:** Clean, readable markdown content extracted from the page.

## UI Features

The extension provides rich UI rendering with collapsed and expanded views:

**Search:**
- Collapsed: Shows query, result count, and preview of results
- Expanded: Shows full markdown content of all results

**Fetch:**
- Collapsed: Shows URL, title, content size, fetch method, and preview of content
- Expanded: Shows full markdown content of the page

**Metadata displayed:**
- Search engine used (SearXNG or Brave)
- Number of search results
- Content size in human-readable format
- Truncation indicator
- Fetch method (HTTP/browser)
- Site name, author, and publish date (when available)

## How It Works

1. The extension calls `search-headless search --format json` and `search-headless fetch --format json`
2. Parses the JSON response to extract structured metadata
3. Converts the JSON to clean markdown for the LLM
4. Displays rich metadata in the UI with collapsed/expanded states

## Search engines

| Engine | Backend | Authentication |
|--------|---------|----------------|
| SearXNG | JSON API of the configured instance | HTTP Basic credentials from the environment |
| Brave | Obscura | None |

The Pi extension defaults to SearXNG.
The standalone `search-headless` CLI defaults to Brave, so choose `--engine searxng` when using the CLI directly.
SearXNG upstream failures are reported alongside any usable results.

Brave searches are spaced 10 seconds apart.
If Brave serves a bot challenge, the tool reports it instead of working around it and pauses uncached Brave searches for 15 minutes.
Cached Brave results remain available during the cooldown.
SearXNG does not use the Brave cooldown, but its instance may have its own rate limits.

Obscura is the only browser backend.
There is no Playwright or Chromium download.

## Development

```bash
bun install
bun run typecheck   # source and tests
bun run test
```

The suite has two halves. `tests/tools.test.ts` registers the extension against
a stand-in `pi`, puts a recording stub on PATH in place of `search-headless`,
and drives the very `execute` functions the agent calls - so it pins the exact
argv the tools build and the markdown the model reads back. `tests/contract.test.ts`
runs the real binary instead, against a local HTTP server and a SERP fixture, so
a change to the CLI or its JSON is caught here rather than in a session. It skips
itself when `search-headless` is not installed. Neither half touches the network.

## License

Apache-2.0
