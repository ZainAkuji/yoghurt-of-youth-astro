import React, { useEffect, useState } from "react";
import {
  GOOGLE_REVIEWS_FALLBACK_URL,
  GOOGLE_WRITE_REVIEW_URL,
  type GoogleReview,
  type GoogleReviewsData,
} from "../config/google-reviews";

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
        <p className="mt-3 whitespace-pre-line break-words text-sm leading-relaxed text-slate-700">{review.text}</p>
      ) : <p className="mt-3 text-sm italic text-slate-500">This customer left a star rating.</p>}
      <p className="mt-4 text-xs font-medium text-slate-500">Posted on Google</p>
    </article>
  );
}

export default function GoogleReviews({ data, loading }: ReviewsState) {
  const [visible, setVisible] = useState(6);
  const reviews = data?.reviews ?? [];
  const mapsUrl = data?.googleMapsUrl || GOOGLE_REVIEWS_FALLBACK_URL;
  const more = Math.min(6, Math.max(0, reviews.length - visible));

  return (
    <section id="customer-reviews" aria-labelledby="customer-reviews-title" className="mt-14 scroll-mt-28 border-t border-slate-200 pt-10">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h2 id="customer-reviews-title" className="text-xl font-bold text-slate-900 sm:text-2xl">Customer reviews</h2>
          {data?.averageRating != null && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <ReviewStars rating={data.averageRating} />
              <p className="text-sm text-slate-600"><strong className="text-slate-900">{data.averageRating.toFixed(1)} out of 5</strong> · {data.totalReviewCount} review{data.totalReviewCount === 1 ? "" : "s"} on Google</p>
            </div>
          )}
        </div>
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-slate-800 underline underline-offset-4 hover:text-amber-600 transition">
          Read reviews on Google <span aria-hidden="true">↗</span>
        </a>
      </div>

      {loading ? (
        <p role="status" className="mt-6 text-sm text-slate-500">Loading Google reviews…</p>
      ) : reviews.length > 0 ? (
        <>
          <p className="mt-4 text-xs text-slate-500">Most recently updated reviews first.</p>
          <div className="mt-5 grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {reviews.slice(0, visible).map((review) => <ReviewCard key={review.id} review={review} />)}
          </div>
          {more > 0 && (
            <div className="mt-6 text-center">
              <button type="button" onClick={() => setVisible((n) => n + 6)} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition">
                Show {more} more review{more === 1 ? "" : "s"}
              </button>
            </div>
          )}
          {data && data.totalReviewCount > reviews.length && (
            <p className="mt-4 text-sm text-slate-500">Showing the {reviews.length} most recently updated reviews. All {data.totalReviewCount} are available on Google.</p>
          )}
        </>
      ) : (
        <p className="mt-6 text-sm leading-relaxed text-slate-600">
          {data?.totalReviewCount === 0 ? "Be the first to share your experience on Google." : "You can read our customer reviews using the Google link above."}
        </p>
      )}

      <p className="mt-7 text-sm text-slate-600">Tried Yoghurt of Youth? <a href={GOOGLE_WRITE_REVIEW_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-800 underline underline-offset-4 hover:text-amber-600 transition">Leave a Google review <span aria-hidden="true">↗</span></a></p>
    </section>
  );
}
