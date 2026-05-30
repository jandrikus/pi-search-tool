# pi-search-tool

A [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) extension that provides web search and content fetch tools using [search-headless](https://github.com/jandrikus/search-headless).

## Features

- **`search`** — Search the internet using Brave Search (default). Returns titles, URLs, and snippets in markdown format.
- **`fetch`** — Fetch and extract clean content from any URL. Uses multiple extraction methods (Obscura, HTTP+Readability, Playwright) for best results.

Both tools provide rich metadata in the UI (search engine, result count, content size, truncation status, etc.) and clean markdown output for the LLM.

## Prerequisites

This extension requires [`search-headless`](https://github.com/jandrikus/search-headless) to be installed on your machine. The extension calls the `search-web` and `fetch-content` CLI commands provided by search-headless.

### Install search-headless

**Requirements:**
- `git`
- `bun` (recommended) or `npm`

**Steps:**

```bash
# 1. Clone the repository
mkdir -p ~/dev
git clone git@github.com:jandrikus/search-headless.git ~/dev/search-headless

# 2. Run the install script
cd ~/dev/search-headless
./install.sh
```

The install script will:
- Detect `bun` or `npm` (prefers bun, falls back to npm)
- Install `obscura` automatically if not found
- Install dependencies
- Install Playwright Chromium (for Google fallback)
- Link commands globally (`bun link` / `npm link`)

**Verify installation:**

```bash
search-web "bun typescript" --limit 5 --timeout 15000
fetch-content https://example.com --max-chars 500
```

If the commands are not found, ensure your global bin directory is on PATH:

```bash
# For bun
export PATH="$HOME/.bun/bin:$PATH"
# For npm
export PATH="$(npm bin -g):$PATH"
```

For more details, see the [search-headless README](https://github.com/jandrikus/search-headless).

## Install pi-search-tool

### Option 1: Install from npm (recommended)

Once published to npm:

```bash
pi install npm:pi-search-tool
```

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

**User settings** (`~/.pi/agent/settings.json`):
```json
{
  "packages": ["npm:pi-search-tool"]
}
```

**Project settings** (`.pi/settings.json`):
```json
{
  "packages": ["npm:pi-search-tool"]
}
```

## Usage

### Search

Search the web for information:

```
search(query: "best practices for REST API design", limit: 10)
```

**Parameters:**
- `query` (required) — The search query. Can be a question, keywords, or phrase.
- `limit` (optional) — Maximum number of results to return (default: 10, max: 20).

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
- Collapsed: Shows query, search engine, result count, and preview of results
- Expanded: Shows full markdown content of all results

**Fetch:**
- Collapsed: Shows URL, title, content size, fetch method, and preview of content
- Expanded: Shows full markdown content of the page

**Metadata displayed:**
- Search engine used (Brave/Google)
- Number of search results
- Content size in human-readable format
- Truncation indicator
- Fetch method (HTTP/browser)
- Site name, author, and publish date (when available)

## How It Works

1. The extension calls `search-web --format json` and `fetch-content --format json` from search-headless
2. Parses the JSON response to extract structured metadata
3. Converts the JSON to clean markdown for the LLM
4. Displays rich metadata in the UI with collapsed/expanded states

## Search Engines

| Engine | Default | Backend | CAPTCHA |
|--------|---------|---------|---------|
| **Brave** | ✅ Yes | Obscura | Auto-solved |
| **Google** | `--google` flag | Playwright | Human-in-the-loop |

Brave Search is the default — fast, lightweight, no session management needed.

## Rate Limiting

Brave searches are automatically spaced 10 seconds apart to avoid triggering bot detection. No configuration needed.

## License

Apache-2.0
