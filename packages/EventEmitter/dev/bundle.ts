export {};

console.log("🚀 Starting optimized Bun build...\n");
const startTime = performance.now();

try {
  console.log("📦 Building minimal bundle with Bun...");

  const result = await Bun.build({
    entrypoints: [
      './src/index'
    ],
    outdir: "./dist",
    target: "bun",          
    format: "esm",          
    minify: {
       whitespace: true,
       identifiers: true,
       syntax: true,
       keepNames: true, 
    },          
    sourcemap: false,       
    splitting: false,  
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    naming: {
      entry: "[name].js",  
      chunk: "[name].js",
      asset: "[name][ext]",
    },
    loader: {
      ".ts": "ts",
      ".json": "json",
    },
    plugins: [], 
    banner: `
/*
 * Copyright (c) ${new Date().getFullYear()} @avonryle
 * 
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 3 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
 *
 * For the full license terms, see: https://www.gnu.org/licenses/lgpl-3.0.html
 */
`,
     footer: `
/*
  Konami code idk (i panicked)
*/
`
  });

  const endTime = performance.now();
  const buildTime = ((endTime - startTime) / 1000).toFixed(7);

  if (!result.success) {
    console.error("\n❌ Build failed!");
    if (result.logs.length > 0) {
      console.error("Build logs:");
      result.logs.forEach((log) => console.error(`  - ${log.message}`));
    }
    process.exit(1);
  }

  console.log("\n✅ Build completed successfully!");
  console.log(`⏱️  Build time: ${buildTime}s`);
  console.log(`📄 Output files: ${result.outputs.length}\n`);

  result.outputs.forEach((output, i) => {
    const sizeKB = (output.size / 1024).toFixed(2);
    console.log(`  ${i + 1}. ${output.path} (${sizeKB} KB)`);
  });
} catch (error) {
  const endTime = performance.now();
  const buildTime = ((endTime - startTime) / 1000).toFixed(2);
  console.error("\n❌ Build process encountered an error!");
  console.error(`⏱️  Failed after: ${buildTime}s`);
  console.error("\nError details:");
  console.error(error);
  process.exit(1);
}

console.log("\n✨ Build process finished!\n");
