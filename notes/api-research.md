# Platform API Research — verified 2026-07-05

Live-verified facts for specs 003/005. Sources inline. Anything below marked UNVERIFIED needs an empirical test before code depends on it.

## X (Twitter) API v2

- **Pricing moved to pay-per-use (PPU) for new signups on 2026-02-06** — subscriptions are dead for new accounts. Post read **$0.005/resource** ($5/1k), user read $0.010, deduplicated per 24h UTC day, configurable spend caps, no monthly read bucket (https://docs.x.com/x-api/getting-started/pricing). Legacy Basic ($200/mo, 15k reads) is closed to new signups and being force-migrated since 2026-06-01.
- **Recent search (7-day): available to all developers.** Full-archive: PPU + Enterprise (https://docs.x.com/x-api/posts/search/introduction).
- **`$CASHTAG` operator**: historically ERRORED below Pro ("Operator is not available in current product"); current operator docs list `$` with no tier restriction (https://docs.x.com/x-api/posts/search/integrate/operators). **UNVERIFIED on PPU — smoke-test `$ANSEM` before relying on it**; fallback query: `"$ANSEM" OR ansem` keyword form.
- **`public_metrics.impression_count` (views) IS returned for ANY author's posts** on app-only bearer auth — likes/replies/retweets/quotes/bookmarks/impressions (https://docs.x.com/x-api/fundamentals/metrics). X is the only platform whose official API gives views for arbitrary posts.
- Rate limits (current docs, not tier-split): recent search 450 req/15min per app (https://docs.x.com/x-api/fundamentals/rate-limits).
- **Economics**: search-based discovery is cheap (results include public_metrics — snapshot at discovery is free data). Bulk REFRESH via official lookup = $5/1k; SocialData.tools = $0.20/1k with views (25× cheaper, outside X ToS).

## TikTok — no compliant third-party read path. Confirmed.

- Display API (`/v2/video/query|list/`): **authorized user's own videos only**, but DOES return `view_count/like_count/comment_count/share_count` (https://developers.tiktok.com/doc/tiktok-api-v2-video-query) → **creator OAuth = official view counts for entrants' own clips**.
- Research API: has arbitrary-video metrics but eligibility = non-commercial academic/nonprofit only; FAQ explicitly answers "commercial user?" → "No."
- oEmbed: zero counts (live-verified 2026-07-05).

## Instagram

- Basic Display API is dead (Dec 2024). Two flavors remain; **hashtag search** (Facebook-Login flavor + app-review-gated "Instagram Public Content Access") returns caption/like_count/comments_count — **no view counts, no username** — and caps at **30 unique hashtags per rolling 7 days**.
- **Business Discovery is the compliant needle-mover**: returns other **professional** accounts' media incl. **`view_count` for Reels (since 2025-06-16)**, queried **by username** not URL (https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery). Requires `instagram_basic` + `instagram_manage_insights` + `pages_read_engagement`, Meta App Review + business verification (officially ~1 week; realistically weeks — start early). Personal accounts return nothing.
- Insights `views` metric: own media only.

## Third-party providers (all outside platform ToS — accepted-risk decision)

| Platform   | Recommended                          | Price (verified)                                                                                           | Notes                                                       |
| ---------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| X          | SocialData.tools                     | **$0.20/1k**, bulk tweets-by-ids, `views_count` included, failed reqs free (https://docs.socialdata.tools) | best-in-class economics                                     |
| TikTok     | Apify `clockworks/tiktok-scraper`    | from $1.70/1k, `postURLs` batch, playCount/digg/comment/share, 91% run success                             | ScrapeCreators alt: $0.99–1.88/1k                           |
| Instagram  | Apify `apify/instagram-post-scraper` | from $1.00/1k, by post URL, videoViewCount (likes −1 if hidden)                                            | HikerAPI cheaper but by-URL endpoint slated for deprecation |
| All-in-one | ScrapeCreators                       | non-expiring credits $47/25k → $497/500k, per-URL endpoints for all three, no bulk                         | single-vendor simplicity                                    |

**Budget envelope at 1–5k posts × 1–4 polls/day**: ~$100–300/mo per-platform-optimized; ~$150–600/mo single-vendor; + X PPU search spend (capped in console).

## $ANSEM token (canonical identity — copycats abound)

- The Black Bull ($ANSEM), Solana, **mint `9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump`** (CoinGecko: the-black-bull). Pump.fun launch; main pool 2026-06-16. As of 2026-07-05: ~$0.32, mcap ~$135M, 24h vol ~$80M, ATH 2026-07-04. Community: blackbullsol.com, X @blackbullsol. Hardcode the mint wherever the token is displayed/verified; never resolve by symbol.

## Mechanics precedent (Whop Content Rewards — the strongest template)

Submission-first (entrants submit post URLs), reward per 1k views, allowed-platform list, minimum view threshold before review, per-video payout cap, 48h review hold, AI/manual fraud review. Known fraud: bot views calibrated under caps → **velocity anomaly detection on snapshot deltas is the best signal** (we already store the time series). Candidate future spec 011-anti-gaming.
