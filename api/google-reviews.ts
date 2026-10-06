import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getGoogleReviewsResponse } from "../lib/google-reviews";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const result = await getGoogleReviewsResponse(req.method, process.env);
  for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
  if (req.method === "HEAD") return res.status(result.status).end();
  return res.status(result.status).json(result.body);
}
