import { stripVTControlCharacters } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { loadTools } from "./harness";

beforeAll(() => initTheme("dark"));

const titles = ["Boot Manager Configuration", "Offered Boot Managers", "CachyOS FAQ"];
const warning = "1 upstream search engine(s) failed. Results may be incomplete.";

function result(status = "partial", resultTitles: string[] = titles) {
  const errors = status === "ok" ? [] : [{ code: "SEARXNG_ENGINE_ERROR", message: warning }];
  return {
    isError: !["ok", "partial"].includes(status),
    details: { engine: "searxng", status, resultCount: resultTitles.length, resultTitles, hasErrors: errors.length > 0, errors },
    content: [{ type: "text", text: [
      "# Search results for `query`", "",
      ...resultTitles.map((title, index) => `${index + 1}. [${title}](https://example.org/${index})`),
      ...(errors.length ? ["", "## Warnings", "", warning] : []),
    ].join("\n") }],
  };
}

function render(value: any, expanded = false, width = 100, isPartial = false) {
  const colors: [string, string][] = [];
  const theme = {
    fg: (color: string, text: string) => { colors.push([color, text]); return text; },
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
  const component = loadTools().get("search")!.renderResult(value, { expanded, isPartial }, theme, {});
  const lines = component.render(width).map(stripVTControlCharacters);
  return { text: lines.map(line => line.trimEnd()).join("\n"), lines, colors };
}

describe("search result widget", () => {
  it("shows usable results and an amber warning count instead of a failure", () => {
    const { text, colors } = render(result());
    expect(text).toBe("✓ [searxng] 3 results · 1 warning\n  Boot Manager Configuration\n  Offered Boot Managers\n  CachyOS FAQ");
    expect(text).not.toContain(warning);
    expect(text).not.toContain("query");
    expect(colors).toContainEqual(["success", "✓"]);
    expect(colors).toContainEqual(["warning", "1 warning"]);
    expect(colors.some(([color]) => color === "error")).toBe(false);
  });

  it("shows warning details when expanded", () => {
    const { text } = render(result(), true);
    expect(text).toContain(warning);
    expect(text).toContain("Warnings");
    expect(text).toContain(titles[0]);
  });

  it.each(["error", "blocked", "timeout"])("keeps %s failures visible while collapsed", status => {
    const { text, colors } = render(result(status, []));
    expect(text).toContain("✗ [searxng]");
    expect(text).toContain(warning);
    expect(text).not.toContain("1 warning");
    expect(colors).toContainEqual(["error", "✗"]);
  });

  it("shows zero results and singular result counts correctly", () => {
    expect(render(result("ok", [])).text).toBe("✓ [searxng] 0 results");
    expect(render(result("ok", ["Only result"])).text).toBe("✓ [searxng] 1 result\n  Only result");
  });

  it("limits the preview to three titles and counts remaining results", () => {
    const { text } = render(result("ok", [...titles, "Fourth", "Fifth"]));
    expect(text).toContain("5 results");
    expect(text).toContain("... 2 more results");
    expect(text).not.toContain("Fourth");
  });

  it("renders older session entries without resultTitles", () => {
    const value: any = result();
    delete value.details.resultTitles;
    expect(render(value).text).toContain("  Boot Manager Configuration");
    expect(render(value).text).not.toContain(warning);
  });

  it("retains result titles when a later page is blocked", () => {
    const { text } = render(result("blocked"));
    expect(text).toContain("✗ [searxng] 3 results");
    expect(text).toContain("  Boot Manager Configuration");
  });

  it("does not report success while a tool call is still running", () => {
    expect(render({ content: [] }, false, 80, true).text).toBe("Searching...");
  });

  it("uses a partial label when no individual warnings were supplied", () => {
    const value = result();
    value.details.errors = [];
    expect(render(value).text).toContain("3 results · partial");
  });

  it("keeps narrow Unicode previews within the terminal width", () => {
    const value = result("ok", ["配置管理器 日本語の長いタイトル 🔎", "\u001b[31mRed\u001b[0m\ncontinued"]);
    const { lines, text } = render(value, false, 24);
    expect(lines.every(line => visibleWidth(line) <= 24)).toBe(true);
    expect(text).toContain("Red continued");
  });
});
