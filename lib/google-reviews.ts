// SERVER ONLY: never import this module into a React component.
import {
  GOOGLE_REVIEWS_FALLBACK_URL,
  type GoogleReview,
  type GoogleReviewsData,
} from "../src/config/google-reviews.js";

type Environment = Record<string, string | undefined>;
type JsonObject = Record<string, unknown>;
type ApiResult = {
  status: number;
  headers: Record<string, string>;
  body: GoogleReviewsData | { error: string };
};

const HOUR = 60 * 60 * 1000;
const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const BASE_HEADERS = { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" };

class ReviewsError extends Error {}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReviewsError("INVALID_GOOGLE_RESPONSE");
  }
  return value as JsonObject;
}

function googleUrl(value: unknown, photo = false): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const allowed = photo
      ? url.hostname === "googleusercontent.com" || url.hostname.endsWith(".googleusercontent.com")
      : ["google.com", "www.google.com", "maps.google.com"].includes(url.hostname);
    return url.protocol === "https:" && !url.username && !url.password && allowed ? url.href : null;
  } catch {
    return null;
  }
}

function publicData(raw: JsonObject, mapsUrl: string, fetchedAt: number): GoogleReviewsData {
  const count = raw.totalReviewCount ?? 0;
  const average = raw.averageRating;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0 ||
      (count > 0 && (typeof average !== "number" || !Number.isFinite(average) || average < 1 || average > 5.001))) {
    throw new ReviewsError("INVALID_GOOGLE_RESPONSE");
  }
  const entries = raw.reviews ?? [];
  if (!Array.isArray(entries)) throw new ReviewsError("INVALID_GOOGLE_RESPONSE");
  const reviews: GoogleReview[] = entries.map((entry) => {
    const review = object(entry);
    const reviewer = object(review.reviewer ?? {});
    const rating = STARS[String(review.starRating)];
    if (!rating || typeof review.reviewId !== "string") throw new ReviewsError("INVALID_GOOGLE_RESPONSE");
    const date = typeof review.createTime === "string" && Number.isFinite(Date.parse(review.createTime))
      ? review.createTime : null;
    return {
      id: review.reviewId,
      author: reviewer.isAnonymous === true ? "Anonymous Google reviewer"
        : typeof reviewer.displayName === "string" && reviewer.displayName.trim() ? reviewer.displayName : "Google reviewer",
      photoUrl: reviewer.isAnonymous === true ? null : googleUrl(reviewer.profilePhotoUrl, true),
      rating,
      text: typeof review.comment === "string" ? review.comment : "",
      date,
    };
  });
  return {
    averageRating: count > 0 ? Math.round(Math.min(5, average as number) * 10) / 10 : null,
    totalReviewCount: count,
    reviews,
    googleMapsUrl: mapsUrl,
    fetchedAt: new Date(fetchedAt).toISOString(),
  };
}

// Each server instance shares one short-lived cache and one in-flight request.
// Vercel's CDN also caches the public response. No tokens are stored in that response.
export function createGoogleReviewsService(
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
) {
  let cache: { key: string; raw: JsonObject; mapsUrl: string; fetchedAt: number } | null = null;
  let pending: { key: string; promise: Promise<void> } | null = null;
  let failure: { key: string; until: number } | null = null;

  function unavailable(code: string, status = 503): ApiResult {
    return {
      status,
      headers: { ...BASE_HEADERS, "Cache-Control": "no-store", ...(status === 503 ? { "Retry-After": "60" } : {}) },
      body: { error: code },
    };
  }

  async function googleJson(url: string, init: RequestInit, stage: string): Promise<JsonObject> {
    const response = await fetcher(url, { ...init, redirect: "error" });
    if (!response.ok) throw new ReviewsError(`${stage}_HTTP_${response.status}`);
    return object(await response.json());
  }

  return async function getReviews(method: string | undefined, env: Environment): Promise<ApiResult> {
    if (method !== "GET" && method !== "HEAD") {
      const result = unavailable("METHOD_NOT_ALLOWED", 405);
      result.headers.Allow = "GET, HEAD";
      return result;
    }

    const clientId = env.GOOGLE_REVIEWS_CLIENT_ID?.trim();
    const clientSecret = env.GOOGLE_REVIEWS_CLIENT_SECRET?.trim();
    const refreshToken = env.GOOGLE_REVIEWS_REFRESH_TOKEN?.trim();
    const accountId = env.GOOGLE_REVIEWS_ACCOUNT_ID?.trim();
    const locationId = env.GOOGLE_REVIEWS_LOCATION_ID?.trim();
    if (!clientId || !clientSecret || !refreshToken || !accountId || !locationId ||
        !/^\d+$/.test(accountId) || !/^\d+$/.test(locationId)) {
      return unavailable("REVIEWS_NOT_CONFIGURED");
    }

    const key = `${clientId}/${accountId}/${locationId}`;
    // Expired or differently configured content is discarded, not served indefinitely.
    if (cache && (cache.key !== key || now() - cache.fetchedAt >= HOUR)) cache = null;

    if (!cache) {
      if (failure?.key === key && now() < failure.until) return unavailable("REVIEWS_UNAVAILABLE");
      if (!pending || pending.key !== key) {
        const promise = (async () => {
          // One deadline covers the token exchange and both read-only Google requests.
          const signal = AbortSignal.timeout(8000);
          const token = await googleJson("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              refresh_token: refreshToken,
              grant_type: "refresh_token",
            }),
            signal,
          }, "TOKEN");
          if (typeof token.access_token !== "string" || !token.access_token) throw new ReviewsError("INVALID_TOKEN_RESPONSE");
          const options = { headers: { Authorization: `Bearer ${token.access_token}` }, signal };
          const [raw, location] = await Promise.all([
            googleJson(
              `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews?pageSize=50&orderBy=updateTime%20desc`,
              options, "REVIEWS",
            ),
            // A maps-link lookup failure should not prevent reviews being displayed.
            googleJson(
              `https://mybusinessbusinessinformation.googleapis.com/v1/locations/${locationId}?readMask=metadata`,
              options, "LOCATION",
            ).catch(() => ({} as JsonObject)),
          ]);
          const metadata = location.metadata && typeof location.metadata === "object"
            ? location.metadata as JsonObject : {};
          const mapsUrl = googleUrl(metadata.mapsUri) || GOOGLE_REVIEWS_FALLBACK_URL;
          const fetchedAt = now();
          publicData(raw, mapsUrl, fetchedAt); // Validate before putting anything in the cache.
          cache = { key, raw, mapsUrl, fetchedAt };
          failure = null;
        })();
        pending = { key, promise };
      }
      const request = pending;
      try {
        await request.promise;
      } catch (error) {
        failure = { key, until: now() + 60_000 };
        // Never log Google's response body, request headers, or OAuth credentials.
        console.warn("[google-reviews]", error instanceof ReviewsError ? error.message : "REQUEST_FAILED");
        return unavailable("REVIEWS_UNAVAILABLE");
      } finally {
        if (pending === request) pending = null;
      }
    }

    const current = cache;
    if (!current || current.key !== key) return unavailable("REVIEWS_UNAVAILABLE");
    const remaining = Math.max(1, Math.ceil((HOUR - (now() - current.fetchedAt)) / 1000));
    return {
      status: 200,
      headers: {
        ...BASE_HEADERS,
        "Cache-Control": `public, max-age=0, s-maxage=${remaining}, stale-while-revalidate=300`,
      },
      body: publicData(current.raw, current.mapsUrl, current.fetchedAt),
    };
  };
}

export const getGoogleReviewsResponse = createGoogleReviewsService();
