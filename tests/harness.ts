/**
 * Test harness: load the real extension and control the binary it shells out to.
 *
 * The tools are only reachable through `pi.registerTool`, so the tests register
 * against a stand-in `pi` and then call the very `execute` functions pi would
 * call. Nothing is re-implemented here.
 */

import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import extension from "../extensions/index";

export interface Tool {
  name: string;
  description: string;
  promptGuidelines?: string[];
  execute(
    toolCallId: string,
    params: any,
    signal?: any,
    onUpdate?: any,
    ctx?: any,
  ): Promise<{ content: { type: "text"; text: string }[]; details?: any; isError?: boolean }>;
}

/** Register the extension against a stand-in pi and hand back its tools. */
export function loadTools(): Map<string, Tool> {
  const tools = new Map<string, Tool>();
  const pi = {
    registerTool: (tool: Tool) => tools.set(tool.name, tool),
    on: () => {},
  };
  extension(pi as any);
  return tools;
}

/**
 * A stand-in `search-headless` on PATH that records its argv and prints
 * whatever the test told it to.
 *
 * argv is recorded NUL-separated so an argument containing spaces, newlines or
 * shell metacharacters is still one unambiguous entry - which is the whole
 * point of the assertions that use it.
 */
export class StubBinary {
  readonly dir: string;
  private readonly originalPath: string | undefined;

  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), "pi-search-stub-"));
    const bin = join(this.dir, "search-headless");
    writeFileSync(
      bin,
      [
        "#!/usr/bin/env bash",
        'dir="$(dirname "$0")"',
        'printf \'%s\\0\' "$@" > "$dir/argv"',
        'if [[ -f "$dir/stdout" ]]; then cat "$dir/stdout"; fi',
        'if [[ -f "$dir/exit-code" ]]; then exit "$(cat "$dir/exit-code")"; fi',
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(bin, 0o755);

    this.originalPath = process.env.PATH;
    process.env.PATH = `${this.dir}:${process.env.PATH ?? ""}`;
  }

  /** What the stub prints on stdout. */
  respondWith(payload: unknown): void {
    writeFileSync(join(this.dir, "stdout"), typeof payload === "string" ? payload : JSON.stringify(payload));
  }

  failWith(exitCode: number, stdout = ""): void {
    writeFileSync(join(this.dir, "stdout"), stdout);
    writeFileSync(join(this.dir, "exit-code"), String(exitCode));
  }

  /** The argv of the last invocation, or undefined if it was never run. */
  argv(): string[] | undefined {
    const path = join(this.dir, "argv");
    if (!existsSync(path)) return undefined;
    // Trailing NUL leaves an empty final element.
    return readFileSync(path, "utf-8").split("\0").slice(0, -1);
  }

  /** Absolute path inside the stub's directory, for side-effect markers. */
  path(name: string): string {
    return join(this.dir, name);
  }

  restore(): void {
    if (this.originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = this.originalPath;
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/** Remove every directory holding a `search-headless` from PATH. */
export function hideSearchHeadless(): () => void {
  const original = process.env.PATH;
  const kept = (original ?? "")
    .split(":")
    .filter((dir) => dir && !existsSync(join(dir, "search-headless")));
  process.env.PATH = kept.join(":");
  return () => {
    if (original === undefined) delete process.env.PATH;
    else process.env.PATH = original;
  };
}

/** A throwaway HTTP server on a free port, for the real-binary tests. */
export async function serve(body: string, contentType = "text/html"): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": contentType });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("could not bind the test server");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
