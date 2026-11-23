import { join } from "node:path";

/**
 * Resolves a runtime source module path (`src/...`) relative to the current
 * working directory. Worker threads always load the TypeScript sources: the
 * production image runs TypeScript directly and has no `dist/` build.
 */
export function resolveSourceModule(...segments: string[]): string {
  return join(process.cwd(), "src", ...segments);
}

/** Resolves the shared worker-thread bootstrap module. */
export function resolveWorkerScriptPath(): string {
  return resolveSourceModule("shared", "utils", "worker.ts");
}
