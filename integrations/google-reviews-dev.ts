import type { AstroIntegration } from "astro";
import { loadEnv } from "vite";
import { getGoogleReviewsResponse } from "../lib/google-reviews";

// The deployed endpoint lives in /api, which plain `astro dev` does not serve.
// This integration runs the same handler locally, without changing production routing.
export default function googleReviewsDev(): AstroIntegration {
  return {
    name: "yoy-google-reviews-dev",
    hooks: {
      "astro:server:setup": ({ server }) => {
        server.middlewares.use(async (req, res, next) => {
          const path = (req.url || "").split("?")[0];
          if (path !== "/api/google-reviews" && path !== "/api/google-reviews/") return next();
          const env = loadEnv(server.config.mode, server.config.envDir, "");
          try {
            const result = await getGoogleReviewsResponse(req.method, env);
            res.writeHead(result.status, { ...result.headers, "Cache-Control": "no-store" });
            res.end(req.method === "HEAD" ? undefined : JSON.stringify(result.body));
          } catch {
            res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
            res.end(JSON.stringify({ error: "REVIEWS_UNAVAILABLE" }));
          }
        });
      },
    },
  };
}
