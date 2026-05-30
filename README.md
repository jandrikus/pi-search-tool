# pi-search-tool

A pi extension that provides web search and content fetch tools using [search-headless](https://github.com/jandrikus/search-headless).

## Features

- **search** — Search the internet using Brave Search (default). Returns titles, URLs, and snippets in markdown format.
- **fetch** — Fetch and extract clean content from any URL. Uses multiple extraction methods (Obscura, HTTP+Readability, Playwright) for best results.

## Prerequisites

This extension requires `search-headless` to be installed:

```bash
cd ~/dev/search-headless
./install.sh
```

This installs the `search-web` and `fetch-content` CLI commands globally.

## Installation

Add this extension to your pi configuration:

```json
{
  "extensions": ["pi-search-tool"]
}
```

Or install via npm:

```bash
npm install pi-search-tool
```

## Usage

### Search

Search the web for information:

```
search(query: "best practices for REST API design", limit: 10)
```

Returns markdown-formatted results with titles, URLs, and snippets.

### Fetch

Fetch full content from a URL:

```
fetch(url: "https://example.com/article", maxChars: 50000)
```

Returns clean, readable markdown content extracted from the page.

## How It Works

1. **Search** calls `search-web --format markdown` from search-headless
2. **Fetch** calls `fetch-content --format markdown` from search-headless
3. Both tools run synchronously and return results directly
4. Output is in markdown format for easy reading by LLMs

## Tool Guidelines

### When to Use Search
- Finding relevant web pages for a topic
- Discovering documentation, tutorials, or examples
- Researching best practices or solutions

### When to Use Fetch
- Reading full content of URLs found via search
- Accessing primary sources in depth
- Extracting clean content from complex web pages

## Configuration

The extension uses sensible defaults:
- **Search limit**: 10 results (configurable, max 20)
- **Fetch max chars**: 50,000 characters (configurable, max 200,000)
- **Timeout**: 30 seconds (max 2 minutes)

## License

Apache-2.0
