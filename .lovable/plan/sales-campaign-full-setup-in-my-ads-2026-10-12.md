# Sales campaign — full setup in My Ads

My Ads already has basic Website Sales (Pixel + event, CBO/ABO, budget, simple bid). This plan adds the remaining Sales pieces inside the same wizard, keeping the same wallet/charge rules for shared accounts.

## 1. Website Sales (Pixel) — complete
- Campaign: bid strategy adds **Highest value** and **ROAS goal** (min ROAS input); Advantage+ Sales campaign toggle (simplified flow: no detailed targeting, Advantage+ placements forced).
- Ad set:
  - Conversion location: Website, Website & Messaging, Messaging (existing), Shop/Catalog (via section 2).
  - Pixel event list fetched live from the pixel's received events (Purchase, AddToCart, InitiateCheckout, ViewContent, CompleteRegistration, Lead, etc.) + Custom Conversions.
  - Performance goal: Maximize number of conversions / Maximize value of conversions.
  - Attribution setting: 7-day click or 1-day view, 7-day click, 1-day click, 1-day click or 1-day view.
  - Audience: Custom Audience include/exclude + Lookalikes (fetched), saved audiences, Advantage+ Audience on/off, languages.
  - Placements: Advantage+ vs Manual with full checkbox list (Facebook Feed/Reels/In-stream/Search/Marketplace/Stories, Instagram Feed/Explore/Reels/Stories/Shop, Messenger, Audience Network).
  - Ad scheduling (dayparting) when lifetime budget.
- Ad: Display link, URL parameters (UTM), all Meta CTAs (Shop now, Buy now, Order now, Learn more, Sign up, Get offer, Book now, Contact us, Subscribe, Download…), Advantage+ creative enhancements toggle.

## 2. Catalog / Product Set
- Fetch catalogs of the ad account's business and their product sets.
- Catalog selected → campaign gets the catalog, ad set gets product set, ad becomes Advantage+ catalog ad (dynamic template with product name/price tokens).
- If the account has no catalog: clear message "admin-কে catalog যুক্ত করতে বলুন".

## 3. Carousel + 5 text variations
- Ad format: Single image/video or Carousel (2–10 cards, each with image, headline, description, link).
- Primary text and Headline: up to 5 variations each (sent as Meta's multi-text option), Description field.

## 4. Sales report
- In the campaign list: new columns Purchases, Cost per purchase, Purchase value, ROAS, with date filter Today / Yesterday / Last 7 / Last 30 (existing picker).
- Disapproval reason shown on rejected ads.

## Technical details
- All Meta calls go through `/api/managed-ads` (new actions: `sales_assets` → pixels events, custom conversions, custom audiences, saved audiences, catalogs, product sets; `create` extended with promoted_object value/catalog, attribution_spec, bid_strategy LOWEST_COST_WITH_MIN_ROAS, targeting_automation, publisher_platforms/positions, asset_feed_spec for text variations, child_attachments for carousel, template_data for catalog ads).
- Report fields: `actions`, `action_values`, `purchase_roas` added to insights request; `resultOf` gets purchase-specific helpers.
- Ownership checks unchanged (shared account assignment / own account with Campaign Management).
- No database changes.
- Not included (Meta API limits or outside website goal): App promotion, Phone calls location, Collection/Instant Experience, Offline events, A/B test (stays disabled).
