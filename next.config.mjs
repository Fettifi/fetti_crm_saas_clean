import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to THIS project. Without this, a stray
  // package-lock.json in the home directory makes Next treat ~/ as the root
  // and try to compile unrelated files (e.g. ~/.gemini/...), breaking the build.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
