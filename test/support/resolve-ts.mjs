import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EXTENSIONS = [".ts", ".tsx", "/index.ts"];

export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  if (relative && context.parentURL && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    for (const ext of EXTENSIONS) {
      const candidate = new URL(specifier + ext, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
