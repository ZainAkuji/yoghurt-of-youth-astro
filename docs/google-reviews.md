# Google reviews for Yoghurt of Youth

This update connects the shop page to your approved Google Business Profile API.
Your successful Google response showed 11 reviews and an average rating of 4.9.
The website reads these values from Google; they are not hardcoded.

## What changes

- The rating beside the purchase options becomes live and links down to the reviews.
- A Customer reviews section appears below the three information accordions.
- Six review cards appear initially. Show more reveals the remaining cards.
- Cards show the reviewer's public name/photo, stars, date and complete review text.
- All ratings returned by Google are included, with the most recently updated first.
- Up to 50 reviews are fetched; a Google link gives access to the complete listing.
- The server caches the response for about one hour. New reviews do not require a deployment.
- If Google is unavailable, visitors see a link to read reviews on Google.
- A privacy notice explains the review display and profile images.

No dependency changes are required. Applying this update on your computer does not
publish it. Your existing Vercel deployment changes only when you deploy the code.

## 1. Apply the patch locally

Extract `google-reviews-update.zip` using **Extract All** in Windows. The folder
containing `google-reviews.patch` should be:

    C:\Users\zainu\Downloads\google-reviews-update

If Windows creates a second nested folder, use the path that actually contains the
patch file in the commands below.

Open PowerShell and run:

```powershell
cd "C:\Users\zainu\yoghurt-astro"
git status --short
git apply --check "C:\Users\zainu\Downloads\google-reviews-update\google-reviews.patch"
```

The check succeeds silently. If it prints an error, stop and share the error text.
Do not reset your work or force the patch. It was prepared against repository commit
`737e40b3edf029d57d219720dc2d68325fe816c0`; different local edits can need an adjusted patch.

When the check succeeds, apply it:

```powershell
git apply "C:\Users\zainu\Downloads\google-reviews-update\google-reviews.patch"
```

The patch creates the new code files automatically. Review the edits with:

```powershell
git diff
git status --short
```

New files also appear in VS Code's Source Control view. A `changed-files` folder
in the download contains readable copies for inspection; applying the patch is
enough, so you do not need to copy those files over your project.

## 2. Add your private settings

From the same PowerShell window, open the project's local settings file:

```powershell
notepad .env
```

If it exists, keep all its current lines. If Notepad asks to create it, choose Yes.
Append the following five lines, replacing only the first three placeholder values:

```dotenv
GOOGLE_REVIEWS_CLIENT_ID=replace_with_your_client_id
GOOGLE_REVIEWS_CLIENT_SECRET=replace_with_your_client_secret
GOOGLE_REVIEWS_REFRESH_TOKEN=replace_with_your_refresh_token
GOOGLE_REVIEWS_ACCOUNT_ID=114985333408060752381
GOOGLE_REVIEWS_LOCATION_ID=8067163330755797364
```

Where the values come from:

| Setting | Copy this value |
| --- | --- |
| CLIENT_ID | `client_id` in the OAuth client JSON you downloaded from Google |
| CLIENT_SECRET | `client_secret` in that same JSON |
| REFRESH_TOKEN | **Refresh token** in OAuth Playground Step 2, from the successful exchange |
| ACCOUNT_ID | Already filled in above; use the number without `accounts/` |
| LOCATION_ID | Already filled in above; use the number without `locations/` |

Copy only the value, without JSON field names, surrounding quotes or commas.
Use the **refresh token**, not the short-lived access token or authorisation code.
Your own OAuth credentials must be selected in Playground, as in the working setup.
Your OAuth app should remain **In production** with offline access authorised.

Save the file as `.env`, not `.env.txt`, in `C:\Users\zainu\yoghurt-astro`.
These values stay private: do not paste them in chat, put them in React files,
prefix them with `PUBLIC_`/`VITE_`, or commit the filled `.env` to Git.
The patch includes `.env.google-reviews.example` as a reference, and ignores local
environment files in Git. The example is not loaded automatically.

## 3. Test on your computer

Stop any existing dev server with Ctrl+C, then run:

```powershell
npm run dev
```

Open `http://localhost:4321/shop` (or the address printed by the terminal if that
port is busy). Scroll below the information accordions. You should see the current
Google rating and review cards, with a button to show the remaining reviews.

The update includes a local endpoint so this works with ordinary `npm run dev`.
No Google sign-in is required for shop visitors.

If only the Google link appears, open `http://localhost:4321/api/google-reviews`:

- `REVIEWS_NOT_CONFIGURED`: check all five variable names and values, the `.env`
  filename and its location, then restart the dev server.
- `REVIEWS_UNAVAILABLE`: the terminal reports a short diagnostic without credentials.
  `TOKEN_HTTP_400` can mean a wrong or revoked refresh token or mismatched OAuth
  credentials. `REVIEWS_HTTP_403` can mean access, scope or API enablement needs
  checking. Share only that diagnostic and the error code, never your credentials.
- A JSON response with `reviews` means the endpoint is working. Refresh the shop.

Updates are cached for about an hour. Restarting the local dev server clears its
cache. On the deployed site, the next request after cache expiry refreshes reviews;
the CDN may briefly show the previous response while that refresh completes.

## 4. When you decide to publish

First check the local production build:

```powershell
npm run build
```

In your existing Vercel project's environment-variable settings, add the same five
variables with the same values for Production. Include Preview only if you also
want reviews on preview deployments. Do not replace existing Stripe/email settings.

Then commit and push the code when you are ready. Vercel needs a new deployment to
use newly added environment variables. Never commit your filled `.env`.

The `/api/google-reviews` handler uses the same Vercel Node function arrangement as
your existing root `/api` handlers. A static-only host would also need a server for
this endpoint. `npm run preview` by itself does not run Vercel API functions; use
`npm run dev` for the local integration test described above.

## Undo this update before publishing

Provided you have not subsequently edited the same patch lines, run:

```powershell
git apply -R --check "C:\Users\zainu\Downloads\google-reviews-update\google-reviews.patch"
git apply -R "C:\Users\zainu\Downloads\google-reviews-update\google-reviews.patch"
```

Run the second command only if the check succeeds. This reverses this patch and
does not remove your private `.env` settings. If the check fails, stop and share the
error so later work can be preserved.

## Code map

| File | Purpose |
| --- | --- |
| `src/components/Shop.tsx` | Places the summary and review section on the shop |
| `src/components/GoogleReviews.tsx` | Loads and displays the reviews |
| `src/config/google-reviews.ts` | Public review links and data types |
| `lib/google-reviews.ts` | Refreshes Google access and fetches/caches public review data on the server |
| `api/google-reviews.ts` | Production Vercel endpoint |
| `integrations/google-reviews-dev.ts` | Runs the endpoint locally with Astro |
| `astro.config.mjs` | Registers the local integration |
| `src/pages/privacy.astro` | Describes Google review display and profile images |
| `.env.google-reviews.example` | Settings template with your account/location IDs |
| `.gitignore` | Keeps local environment files out of Git |
| `docs/google-reviews.md` | This guide |

The browser receives public review data only. Refresh tokens and client secrets are
used on the server. Reviews are temporarily cached, not committed into source files.
The Google API permission is `business.manage`; this implementation only reads
reviews and location metadata and does not post replies or edit the profile.

References: [Google reviews endpoint](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list),
[OAuth Playground](https://developers.google.com/oauthplayground/),
[Business Profile API policies](https://developers.google.com/my-business/content/policies).
