// Post-build step for GitHub Pages (run after `next build` with output: "export").
//
// 1. `.nojekyll`: GitHub Pages runs Jekyll by default, which drops folders starting with "_"
//    (Next's `_next/` assets) — the site would load without any JavaScript.
// 2. Segment prefetch files: the export writes them nested (budget/__next.!KGFwcCk/budget/__PAGE__.txt)
//    while the client requests a flat, dotted name (budget/__next.!KGFwcCk.budget.__PAGE__.txt).
//    Copy each nested file to the flat name so prefetching does not 404 on a static host.
import { copyFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const OUT = process.argv[2] ?? "out";

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

writeFileSync(join(OUT, ".nojekyll"), "");

let copied = 0;
function flatten(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isDirectory()) continue;
    if (name.startsWith("__next.")) {
      for (const file of walk(path)) {
        const flat = [name, ...relative(path, file).split(sep)].join(".");
        copyFileSync(file, join(dir, flat));
        copied++;
      }
    } else {
      flatten(path);
    }
  }
}
flatten(OUT);
console.log(`prepare-pages: .nojekyll written, ${copied} prefetch files flattened in ${OUT}`);
