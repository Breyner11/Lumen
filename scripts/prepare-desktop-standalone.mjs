import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");
const out = join(root, "out-desktop");

if (!existsSync(standalone)) {
  console.error("Falta .next/standalone. Ejecuta `npm run build` antes (output: 'standalone').");
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(standalone, out, { recursive: true });

const staticSrc = join(root, ".next", "static");
const staticDest = join(out, ".next", "static");
if (existsSync(staticSrc)) {
  mkdirSync(join(out, ".next"), { recursive: true });
  cpSync(staticSrc, staticDest, { recursive: true });
}

const publicSrc = join(root, "public");
if (existsSync(publicSrc)) {
  cpSync(publicSrc, join(out, "public"), { recursive: true });
}

console.log("Standalone listo en out-desktop/ (sidecar Tauri).");
