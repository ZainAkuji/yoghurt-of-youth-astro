import test from "node:test";
import assert from "node:assert/strict";
import { createGoogleReviewsService } from "../lib/google-reviews.js";
import { ratingCounts, selectReviews } from "../lib/review-display.js";
import type { GoogleReview } from "../src/config/google-reviews.js";

const reviews: GoogleReview[] = [
  { id: "negative", rating: 1, author: "Detailed Reviewer", text: "Delivery was delayed. This is a detailed account of a disappointing experience.", date: "2026-10-20T12:00:00Z", photoUrl: null },
  { id: "positive", rating: 5, author: "Same Detail", text: "Delivery was delayed. This is a detailed account of a disappointing experience.", date: "2026-10-20T12:00:00Z", photoUrl: null },
  { id: "rating", rating: 5, author: "Stars Only", text: "", date: "2026-10-22T12:00:00Z", photoUrl: null },
  { id: "short", rating: 4, author: "Earlier Reviewer", text: "Arrived chilled", date: "2026-09-01T12:00:00Z", photoUrl: null },
];
test("all ratings count, search combines with filtering, ordering never mutates source", () => {
  assert.deepEqual(ratingCounts(reviews), { 1: 1, 2: 0, 3: 0, 4: 1, 5: 2 });
  assert.deepEqual(selectReviews(reviews, { rating: 5, query: "delayed" }).map(r => r.id), ["positive"]);
  assert.equal(selectReviews(reviews, { query: " EARLIER  chilled " })[0].id, "short");
  assert.equal(selectReviews(reviews, { rating: 3 }).length, 0);
  assert.equal(selectReviews(reviews, { sort: "newest" })[0].id, "rating");
  assert.equal(selectReviews(reviews, { sort: "oldest" })[0].id, "short");
  assert.equal(selectReviews(reviews, { sort: "highest" })[0].rating, 5);
  assert.equal(selectReviews(reviews, { sort: "lowest" })[0].rating, 1);
  const ranked = selectReviews(reviews, { now: Date.parse("2026-10-26T12:00:00Z") });
  assert.equal(ranked[0].id, "negative"); // changing stars must not improve relevance
  assert.deepEqual(reviews.map(r => r.id), ["negative", "positive", "rating", "short"]);
});
const env = {
  GOOGLE_REVIEWS_CLIENT_ID: "test", GOOGLE_REVIEWS_CLIENT_SECRET: "test", GOOGLE_REVIEWS_REFRESH_TOKEN: "test",
  GOOGLE_REVIEWS_ACCOUNT_ID: "123", GOOGLE_REVIEWS_LOCATION_ID: "456",
};
const rawReview = (id: string, rating = "FIVE") => ({ reviewId: id, starRating: rating, reviewer: { displayName: `Reviewer ${id}` }, createTime: "2026-10-01T12:00:00Z" });

test("fetches subsequent pages, deduplicates, includes ratings-only and replies, caches result", async () => {
  const requests: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input); requests.push(url);
    let body: unknown;
    if (url.includes("oauth2")) body = { access_token: "test-token" };
    else if (url.includes("businessinformation")) body = { metadata: { mapsUri: "https://maps.google.com/?cid=123" } };
    else if (url.includes("pageToken=")) body = { reviews: [rawReview("49"), { ...rawReview("50", "ONE"), comment: "<script>untrusted</script>", reviewReply: { comment: "Thanks for the feedback", updateTime: "2026-10-02T12:00:00Z" } }] };
    else body = { reviews: Array.from({ length: 50 }, (_, i) => rawReview(String(i))), totalReviewCount: 51, averageRating: 4.92, nextPageToken: "page/2+token" };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  const service = createGoogleReviewsService(fetcher, () => Date.parse("2026-10-26T12:00:00Z"));
  const result = await service("GET", env);
  assert.equal(result.status, 200);
  assert.ok("reviews" in result.body);
  if (!("reviews" in result.body)) return;
  assert.equal(result.body.reviews.length, 51);
  assert.equal(result.body.reviews[0].text, "");
  assert.equal(result.body.reviews[50].reply?.text, "Thanks for the feedback");
  assert.equal(result.body.reviews[50].text, "<script>untrusted</script>"); // UI renders as text
  assert.equal(ratingCounts(result.body.reviews)[1], 1);
  assert.equal(result.body.averageRating, 4.9);
  assert.ok(requests.some(url => url.includes("pageToken=page%2F2%2Btoken")));
  assert.equal(requests.length, 4);
  await service("GET", env);
  assert.equal(requests.length, 4);
  assert.equal(JSON.stringify(result.body).includes("test-token"), false);
});

test("unconfigured/errors fail safely and do not invent ratings", async () => {
  const unavailable = createGoogleReviewsService((async () => new Response("{}", { status: 500 })) as typeof fetch);
  assert.equal((await unavailable("GET", {})).status, 503);
  assert.equal((await unavailable("POST", env)).status, 405);
  assert.equal((await unavailable("GET", env)).status, 503);
});
