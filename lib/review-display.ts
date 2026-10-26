import type { GoogleReview } from "../src/config/google-reviews.js";

export type ReviewSort = "relevant" | "newest" | "oldest" | "highest" | "lowest";

export function ratingCounts(reviews: GoogleReview[]): Record<number, number> {
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const review of reviews) if (counts[review.rating] !== undefined) counts[review.rating]++;
  return counts;
}

function timestamp(review: GoogleReview): number {
  return review.date ? Date.parse(review.date) || 0 : 0;
}

// Our own ordering, not Google's relevance ranking. Text/detail and recency
// contribute; star rating never does. Long reviews cap at 150 words.
function relevance(review: GoogleReview, now: number): number {
  const words = review.text.trim() ? review.text.trim().split(/\s+/).length : 0;
  const ageDays = Math.max(0, (now - timestamp(review)) / 86_400_000);
  return (words ? 2 : 0) + Math.log1p(Math.min(words, 150)) / Math.log(151) + 0.5 / (1 + ageDays / 180);
}

export function selectReviews(
  reviews: GoogleReview[],
  { sort = "relevant", rating = 0, query = "", now = Date.now() }: {
    sort?: ReviewSort; rating?: number; query?: string; now?: number;
  } = {},
): GoogleReview[] {
  const terms = query.trim().toLocaleLowerCase("en-GB").split(/\s+/).filter(Boolean);
  return reviews.filter(review => {
    if (rating && review.rating !== rating) return false;
    const text = `${review.author} ${review.text}`.toLocaleLowerCase("en-GB");
    return terms.every(term => text.includes(term));
  }).sort((a, b) => {
    let comparison = 0;
    if (sort === "newest") comparison = timestamp(b) - timestamp(a);
    else if (sort === "oldest") comparison = timestamp(a) - timestamp(b);
    else if (sort === "highest") comparison = b.rating - a.rating;
    else if (sort === "lowest") comparison = a.rating - b.rating;
    else comparison = relevance(b, now) - relevance(a, now);
    return comparison || timestamp(b) - timestamp(a) || a.id.localeCompare(b.id);
  });
}
