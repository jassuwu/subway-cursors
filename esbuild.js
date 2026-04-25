const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node18",
    outfile: "dist/extension.js",
    external: ["vscode"],
    sourcemap: true,
    minify: false,
    logLevel: "info",
  });

  if (watch) {
    await ctx.watch();
    console.log("[subway-cursors] watching for changes...");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log("[subway-cursors] build complete.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
