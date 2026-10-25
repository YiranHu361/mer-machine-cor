import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  // The live views need only the Convex deployment URL, taken from the root
  // .env (CONVEX_URL, or the name inside the deploy key). The key itself never
  // reaches the browser bundle.
  const env = { ...loadEnv(mode, "..", ""), ...process.env };
  const name = /^(?:dev|prod):([a-z0-9-]+)\|/.exec(
    env.CONVEX_DEPLOY_KEY ?? "",
  )?.[1];
  const convexUrl =
    env.VITE_CONVEX_URL ||
    env.CONVEX_URL ||
    (name ? `https://${name}.convex.cloud` : "");
  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_CONVEX_URL": JSON.stringify(convexUrl),
      "import.meta.env.VITE_FABYN_CLOUD": JSON.stringify(env.VERCEL === "1" || env.FABYN_CLOUD_BUILD === "1" ? "1" : "0"),
    },
    // Scan only the app. The static pages in fabyn-reference/ use a dynamic
    // import() esbuild cannot resolve, which made the dependency scan fail.
    optimizeDeps: { entries: ["index.html"] },
    server: {
      proxy: {
        "/api": "http://127.0.0.1:4318",
        "/assets": "http://127.0.0.1:4318",
      },
    },
  };
});
