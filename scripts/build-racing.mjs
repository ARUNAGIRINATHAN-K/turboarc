import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

async function main() {
  const result = await build({
    entryPoints: [path.join(rootDir, 'src/game/standalone.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    minify: true,
    target: ['es2020'],
    platform: 'browser',
  });

  const jsBundle = result.outputFiles[0].text.replace(/<\/script>/gi, '<\\/script>');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Apex Circuit — 3D Arcade Car Racing</title>
  <meta name="description" content="3D arcade car racing circuit with 6 cars, drift physics, AI rivals, chase & cockpit cameras, and deterministic race benchmarking." />
</head>
<body>
  <div id="root"></div>
  <script>${jsBundle}</script>
</body>
</html>
`;

  const outRoot = path.join(rootDir, 'racing.html');
  const outPublicDir = path.join(rootDir, 'public');
  const outPublic = path.join(outPublicDir, 'racing.html');

  fs.writeFileSync(outRoot, html, 'utf8');
  fs.mkdirSync(outPublicDir, { recursive: true });
  fs.writeFileSync(outPublic, html, 'utf8');

  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log(`Built self-contained racing.html (${kb} KB) -> /racing.html & /public/racing.html`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
