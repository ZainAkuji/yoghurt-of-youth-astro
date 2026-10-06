// Public display settings only. OAuth credentials belong in server environment variables.
export const GOOGLE_REVIEWS_FALLBACK_URL =
  "https://www.google.com/maps/search/?api=1&query=Yoghurt%20of%20Youth%20Blackburn";
export const GOOGLE_WRITE_REVIEW_URL = "https://g.page/r/CWkxtud6iKYlEAE/review";

export interface GoogleReview {
  id: string;
  author: string;
  photoUrl: string | null;
  rating: number;
  text: string;
  date: string | null;
}

export interface GoogleReviewsData {
  averageRating: number | null;
  totalReviewCount: number;
  reviews: GoogleReview[];
  googleMapsUrl: string;
  fetchedAt: string;
}
