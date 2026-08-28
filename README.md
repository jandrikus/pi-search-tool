# pi-search-tool

A [Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent) extension that provides web search and content fetch tools using [search-headless](https://github.com/jandrikus/search-headless).

## Features

- **`search`** — Search the internet using Brave Search (default). Returns titles, URLs, and snippets in markdown format.
- **`fetch`** — Fetch and extract clean content from any URL. Tries HTTP + Readability first and falls back to a real browser render for pages written by script.

Both tools provide rich metadata in the UI (result count, content size, truncation status, etc.) and clean markdown output for the LLM.

## Prerequisites

This extension requires [`search-headless`](https://github.com/jandrikus/search-headless) to be installed on your machine. The extension shells out to its `search` and `fetch` subcommands.

### Install search-headless

**Requirements:**
- `git`
- `cargo` (see [rustup.rs](https://rustup.rs))

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
- Install `obscura` automatically if not found
- Build the binary with `cargo build --release`
- Copy it to `~/.local/bin`

**Verify installation:**

```bash
search-headless search "rust async" --limit 5 --timeout 15000
search-headless fetch https://example.com --max-chars 500
```

If the command is not found, put the install directory on PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
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
- Collapsed: Shows query, result count, and preview of results
- Expanded: Shows full markdown content of all results

**Fetch:**
- Collapsed: Shows URL, title, content size, fetch method, and preview of content
- Expanded: Shows full markdown content of the page

**Metadata displayed:**
- Search engine used (Brave)
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

## Search Engines

| Engine | Backend | Challenge | Login |
|--------|---------|-----------|-------|
| **Brave** | Obscura | Reported as `blocked`, never solved | Not required |

Brave is the only engine. Obscura is the only browser — there is no Playwright, and no Chromium
download. If Brave serves a bot challenge, the tool reports it rather than working around it.

## Rate Limiting

Brave searches are automatically spaced 10 seconds apart to avoid triggering bot detection. No configuration needed.

## License

Apache-2.0
