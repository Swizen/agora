import type { NextConfig } from 'next';

const config: NextConfig = {
  // Le dossier parent contient un autre package-lock.json : on fixe la racine du projet ici.
  outputFileTracingRoot: import.meta.dirname,
  turbopack: { root: import.meta.dirname },
  // `npm test` lance son propre next dev dans un dossier séparé, pour tourner à côté de `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};

export default config;
