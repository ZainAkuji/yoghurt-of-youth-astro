import React, { useEffect, useMemo, useState } from "react";
import {
  GOOGLE_REVIEWS_FALLBACK_URL,
  GOOGLE_WRITE_REVIEW_URL,
  type GoogleReview,
  type GoogleReviewsData,
} from "../config/google-reviews";

import { ratingCounts, selectReviews, type ReviewSort } from "../../lib/review-display";

type ReviewsState = { data: GoogleReviewsData | null; loading: boolean };

export function useGoogleReviews(): ReviewsState {
  const [state, setState] = useState<ReviewsState>({ data: null, loading: true });
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 12_000);
    fetch("/api/google-reviews", { signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Reviews unavailable");
        const data = await response.json() as GoogleReviewsData;
        if (!Array.isArray(data.reviews) || !Number.isInteger(data.totalReviewCount)) throw new Error("Invalid reviews");
        if (!cancelled) setState({ data, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, loading: false });
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);
  return state;
}

export function ReviewStars({ rating }: { rating: number }) {
  const stars = Array.from({ length: 5 }, (_, index) => (
    <svg key={index} width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="shrink-0" aria-hidden="true">
      <path d="m12 2 3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.76 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2Z" />
    </svg>
  ));
  return (
    <span role="img" aria-label={`${rating.toFixed(1)} out of 5 stars`} className="relative inline-block shrink-0 align-middle">
      <span aria-hidden="true" className="flex gap-0.5 text-slate-300">{stars}</span>
      <span aria-hidden="true" className="absolute inset-y-0 left-0 overflow-hidden text-amber-500" style={{ width: `${Math.min(5, Math.max(0, rating)) * 20}%` }}>
        <span className="flex w-max gap-0.5">{stars}</span>
      </span>
    </span>
  );
}

export function GoogleReviewSummary({ data }: { data: GoogleReviewsData | null }) {
  return (
    <a href="#customer-reviews" className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-slate-800 hover:text-amber-600 transition">
      {data?.averageRating != null ? (
        <>
          <ReviewStars rating={data.averageRating} />
          <span>{data.averageRating.toFixed(1)} on Google</span>
          <span className="font-normal text-slate-500">({data.totalReviewCount} review{data.totalReviewCount === 1 ? "" : "s"})</span>
        </>
      ) : <span>Customer reviews on Google</span>}
    </a>
  );
}

function ReviewCard({ review }: { review: GoogleReview }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const long = review.text.length > 360;
  const initials = review.author.split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0] || "").join("").toUpperCase();
  return (
    <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <div aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
          {review.photoUrl && !photoFailed ? (
            <img src={review.photoUrl} alt="" width={40} height={40} loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={() => setPhotoFailed(true)} />
          ) : initials}
        </div>
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold text-slate-900">{review.author}</h3>
          {review.date && (
            <time dateTime={review.date} className="mt-0.5 block text-xs text-slate-500">
              {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(review.date))}
            </time>
          )}
        </div>
      </div>
      <div className="mt-4"><ReviewStars rating={review.rating} /></div>
      {review.text ? (
        <>
          <p id={`review-text-${review.id}`} className={`mt-3 whitespace-pre-line break-words text-sm leading-relaxed text-slate-700 ${long && !expanded ? "line-clamp-5" : ""}`}>{review.text}</p>
          {long && <button type="button" aria-expanded={expanded} aria-controls={`review-text-${review.id}`} onClick={() => setExpanded(!expanded)} className="mt-2 rounded text-sm font-semibold text-slate-800 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-amber-600">{expanded ? "Read less" : "Read full review"}</button>}
        </>
      ) : <p className="mt-3 text-sm italic text-slate-500">This customer left a star rating.</p>}
      {review.reply && (
        <details className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
          <summary className="cursor-pointer font-semibold text-slate-800">Response from Yoghurt of Youth</summary>
          <p className="mt-2 whitespace-pre-line break-words leading-relaxed">{review.reply.text}</p>
        </details>
      )}
      <p className="mt-4 text-xs font-medium text-slate-500">Posted on Google</p>
    </article>
  );
}

const EMPTY_REVIEWS: GoogleReview[] = [];
const CONTROL = "rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600";

export default function GoogleReviews({ data, loading }: ReviewsState) {
  const [visible, setVisible] = useState(6);
  const [sort, setSort] = useState<ReviewSort>("relevant");
  const [rating, setRating] = useState(0);
  const [query, setQuery] = useState("");
  const reviews = data?.reviews ?? EMPTY_REVIEWS;
  const counts = useMemo(() => ratingCounts(reviews), [reviews]);
  const filtered = useMemo(() => selectReviews(reviews, {
    sort, rating, query, now: data?.fetchedAt ? Date.parse(data.fetchedAt) : Date.now(),
  }), [reviews, sort, rating, query, data?.fetchedAt]);
  const mapsUrl = data?.googleMapsUrl || GOOGLE_REVIEWS_FALLBACK_URL;
  const more = Math.min(6, Math.max(0, filtered.length - visible));
  const partial = !!data && data.totalReviewCount !== reviews.length;
  const reset = () => { setRating(0); setQuery(""); setVisible(6); };

  return (
    <section id="customer-reviews" aria-labelledby="customer-reviews-title" className="mt-16 scroll-mt-28">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="customer-reviews-title" className="text-xl font-bold text-slate-900 sm:text-2xl">Customer reviews</h2>
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-slate-800 underline underline-offset-4 hover:text-amber-600 transition">Read reviews on Google <span aria-hidden="true">↗</span></a>
      </div>

      {loading ? <p role="status" className="mt-6 text-sm text-slate-500">Loading Google reviews…</p> : data ? (
        <>
          <div className="mt-6 grid gap-6 rounded-2xl bg-slate-50 p-5 sm:grid-cols-[1fr_1.4fr] sm:gap-10 sm:p-7">
            <div>
              {data.averageRating != null ? <>
                <div className="flex items-baseline gap-2"><span className="text-5xl font-bold tracking-tight text-slate-900">{data.averageRating.toFixed(1)}</span><span className="text-sm text-slate-500">out of 5</span></div>
                <div className="mt-3"><ReviewStars rating={data.averageRating} /></div>
              </> : <p className="font-semibold text-slate-900">Share your first impression</p>}
              <p className="mt-2 text-sm text-slate-600">Based on {data.totalReviewCount} Google review{data.totalReviewCount === 1 ? "" : "s"}</p>
              <a href={GOOGLE_WRITE_REVIEW_URL} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600">Write a Google review <span className="ml-2" aria-hidden="true">↗</span></a>
            </div>
            <div role="group" aria-label="Filter reviews by star rating">
              {[5, 4, 3, 2, 1].map(stars => {
                const count = counts[stars];
                const percentage = reviews.length ? count / reviews.length * 100 : 0;
                return <button key={stars} type="button" disabled={count === 0} aria-pressed={rating === stars}
                  aria-label={`${stars} star${stars === 1 ? "" : "s"}: ${count} review${count === 1 ? "" : "s"}. ${rating === stars ? "Clear rating filter" : "Filter reviews"}`}
                  onClick={() => { setRating(rating === stars ? 0 : stars); setVisible(6); }}
                  className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-2 text-sm transition focus-visible:outline-2 focus-visible:outline-amber-600 disabled:cursor-default disabled:opacity-50 ${rating === stars ? "bg-amber-100 ring-1 ring-amber-300" : "enabled:hover:bg-slate-200/60"}`}>
                  <span className="w-12 shrink-0 text-left font-medium text-slate-700">{stars} star{stars === 1 ? "" : "s"}</span>
                  <span aria-hidden="true" className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200"><span className="block h-full rounded-full bg-amber-500" style={{ width: `${percentage}%` }} /></span>
                  <span className="w-8 shrink-0 text-right tabular-nums text-slate-600">{count}</span>
                </button>;
              })}
              <p className="mt-2 text-xs text-slate-500">Select a rating to read those reviews.{partial && ` Breakdown is based on the ${reviews.length} reviews currently loaded.`}</p>
            </div>
          </div>

          {reviews.length > 0 ? <>
            <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs font-semibold text-slate-600 sm:max-w-sm">
                Search reviews
                <input type="search" placeholder="Search words or reviewer names" value={query} maxLength={200} onChange={event => { setQuery(event.target.value); setVisible(6); }} className={CONTROL} />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600">
                Sort by
                <select value={sort} onChange={event => { setSort(event.target.value as ReviewSort); setVisible(6); }} className={CONTROL}>
                  <option value="relevant">Most relevant</option><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="highest">Highest rating</option><option value="lowest">Lowest rating</option>
                </select>
              </label>
            </div>
            {sort === "relevant" && <p className="mt-3 text-xs text-slate-500">Most relevant highlights detailed, recent reviews. All star ratings are included.</p>}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <p role="status" aria-live="polite" className="text-sm text-slate-600">Showing {Math.min(visible, filtered.length)} of {filtered.length} {rating ? `${rating}-star ` : ""}review{filtered.length === 1 ? "" : "s"}{query.trim() ? " matching your search" : ""}</p>
              {(rating > 0 || query.trim()) && <button type="button" onClick={reset} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200">Clear filters ×</button>}
            </div>
            {filtered.length ? <div className="mt-5 grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">{filtered.slice(0, visible).map(review => <ReviewCard key={review.id} review={review} />)}</div>
              : <p className="mt-5 rounded-xl bg-slate-50 p-5 text-sm text-slate-600">No reviews match these filters. Try another search or clear the filters.</p>}
            {more > 0 && <div className="mt-6 text-center"><button type="button" onClick={() => setVisible(n => n + 6)} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-amber-600">Show {more} more review{more === 1 ? "" : "s"}</button></div>}
            {partial && <p className="mt-4 text-sm text-slate-500">Filters and sorting apply to {reviews.length} loaded reviews. All reviews are available on Google.</p>}
          </> : <p className="mt-6 text-sm text-slate-600">Be the first to share your experience on Google.</p>}
        </>
      ) : <p className="mt-6 text-sm leading-relaxed text-slate-600">Reviews are temporarily unavailable here. You can still read them on Google using the link above.</p>}
    </section>
  );
}
