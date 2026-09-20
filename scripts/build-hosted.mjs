import { cpSync, writeFileSync } from "node:fs";
cpSync("site", "dist/about", {
  recursive: true,
  filter: (path) => !path.endsWith("_headers"),
});
writeFileSync(
  "dist/_routes.json",
  JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }),
);
writeFileSync(
  "dist/_headers",
  `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(self), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
`,
);
