import fs from 'fs';
import path from 'path';
import { build as esbuild } from 'esbuild';

const rootDir = process.cwd();
const outDir = path.join(rootDir, 'dist-standalone');
const distDir = path.join(rootDir, 'dist');

async function buildStandaloneArtifacts() {
  fs.mkdirSync(outDir, { recursive: true });

  // 1. Compile zero-dependency PC runtime bundle (CJS, minified, includes express & ws)
  await esbuild({
    entryPoints: [path.join(rootDir, 'src/standalone/pcServer.ts')],
    outfile: path.join(outDir, 'runtime.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    minify: true,
    sourcemap: false,
    logLevel: 'silent',
  });

  // 2. Compile self-contained single-file HTML app for Android & PC offline/portable launch
  const pwaStubPlugin = {
    name: 'pwa-register-stub',
    setup(buildObj) {
      buildObj.onResolve({ filter: /^virtual:pwa-register$/ }, () => ({
        path: 'virtual:pwa-register',
        namespace: 'pwa-stub',
      }));
      buildObj.onLoad({ filter: /.*/, namespace: 'pwa-stub' }, () => ({
        contents: 'export function registerSW() { return function() {}; }',
        loader: 'js',
      }));
    },
  };

  const clientBundle = await esbuild({
    entryPoints: [path.join(rootDir, 'src/main.tsx')],
    bundle: true,
    platform: 'browser',
    target: ['es2020'],
    format: 'iife',
    minify: true,
    write: false,
    plugins: [pwaStubPlugin],
    define: {
      'process.env.NODE_ENV': '"production"',
      'import.meta.env.DEV': 'false',
      'import.meta.env.PROD': 'true',
      'import.meta.env.MODE': '"production"',
    },
    loader: {
      '.css': 'empty',
    },
    logLevel: 'silent',
  });

  const jsCode = clientBundle.outputFiles?.[0]?.text ?? '';

  // Read compiled CSS from dist/assets/*.css if available
  let cssCode = '';
  const assetsDir = path.join(distDir, 'assets');
  if (fs.existsSync(assetsDir)) {
    const cssFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.css'));
    for (const f of cssFiles) {
      cssCode += fs.readFileSync(path.join(assetsDir, f), 'utf8') + '\n';
    }
  }

  let iconDataUri = '';
  const iconPng = path.join(rootDir, 'public/pwa-192x192.png');
  if (fs.existsSync(iconPng)) {
    iconDataUri = `data:image/png;base64,${fs.readFileSync(iconPng).toString('base64')}`;
  }

  // Safely escape closing tags inside inline script/style
  const safeCss = cssCode.replace(/<\/style>/gi, '<\\/style>');
  const safeJs = jsCode.replace(/<\/script>/gi, '<\\/script>');

  const standaloneHtml = `<!doctype html>
<html lang="th" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="theme-color" content="#0B111E" />
  <title>FlowTrend IQ — แอปสแกนกราฟ 1 นาที</title>
  ${iconDataUri ? `<link rel="icon" type="image/png" href="${iconDataUri}" />` : ''}
  <style>${safeCss}</style>
</head>
<body class="bg-[#0F131D] text-[#E6ECF5] antialiased">
  <div id="root"></div>
  <script>${safeJs}</script>
</body>
</html>`;

  fs.writeFileSync(path.join(outDir, 'FlowTrend-IQ-App.html'), standaloneHtml, 'utf8');
  console.log('Built standalone artifacts in dist-standalone/');
}

buildStandaloneArtifacts().catch((err) => {
  console.error('Failed to build standalone artifacts:', err);
  process.exit(1);
});
