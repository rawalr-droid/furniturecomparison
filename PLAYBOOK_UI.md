# PLAYBOOK_UI: couchpotato.ae front end (written 2026-10-17)

**Standing rule (owner, 2026-10-21): for ANY request in this chat, first invoke the `frontend-design` skill (Skill tool) and apply it. Brand rules in section 2 win on conflict.**

## 1. Source of truth
- LIVE = `final-website/dist/` (Render static site, publish dir `dist`, no build step; `render.yaml`). Repo is pushed by the agents, not by hand.
- WORKING COPY for big UI changes = `couchpotato_build/dist/` (its `data` is a symlink to live data: never write data through it). As of 16 Oct the pages match in size; diffs are the nightly-generated `c/` pages and data stamps.
- Promote working copy -> live with `agents/golive_couchpotato.sh [--local]` (backs up replaced files first; refuses while a nightly runs). Small fixes: edit live files directly, take a backup in `agents/state/site_backups/pre-<name>-<stamp>` first.
- CSS layering (later wins): `styles.css` > `theme.css` > `nordic.css` (Nordic phase 1, Inter) > `theme2.css` (cranberry v2 overrides, loaded after) > `couchpotato.css` (loaded LAST, owns the rebrand: put new rules here, do not touch the older layers). Others: `product-card.css`, `deals.css`, `pages.css`, `banner.css` (ffb hero).
- JS: `js/common.js` = shared layer (FF namespace, `FF.pcCard` card, `FF.imgFit` photo backdrop, `FF.db` database client, accounts/wishlist sync, `LOGIN` switch). Page scripts: home.js, browse.js (+ filters.json), product.js, wishlist.js, boards.js, home-tiles.js, cat-redirects.js. `js/db-config.js` = Supabase URL + publishable key (public by design).
- Cache busting: every page links assets as `file?v=<tag>`; bump the tag in ALL pages (index, browse, product, wishlist, board, moodboards) whenever a css/js file changes.

## 2. Design rules (CouchPotato_Brand_Guidelines.md, repo root)
- Name: wordmark `COUCHPOTATO` + small `.AE` below, uppercase, tracked, ink (#111) (orange/Fraunces wordmark retired 22 Oct 2026).
- Base (E look, 22 Oct 2026): white page, soft grey #F4F4F2 tiles/frames, rules #E6E6E6, ink #111, muted #6B6B6B; accent #C23115 for money/sale only; primary buttons ink, sharp corners (2px); black price-cuts bar under the header; light footer. Plan: agents/state/plans/homepage_redesign_E_D_PLAN.md.
- Type: Inter Tight only (300 for big display lines, 500 for titles, 400-600 UI; prices sans). No serif, no handwriting font. `.cp-note` for small captions. No timing phrases ("last night", "tonight", "nightly", "at last check"); sold-out reads "Out of Stock".
- Photos always in a soft grey frame; non-square photos get a blurred backdrop (`.pc-media.has-bars::before`, theme2.css).
- Decoration only on the homepage; product grid stays calm. Never imply data we do not have (brand book s.10). Header full width, 88px (72 phone).
- Check every change at 1440, 1024, 768, 390px with console and network clean.
- DO NOT RENAME (breaks saved data/scripts): localStorage `ff-wishlist-rooms`/`ff-wishlist`, `FF.` namespace, `ff_agents`, `ffb` classes and `<!-- ffb:start/end -->` markers, data file names, rollback scripts.

## 3. Change and preview
- Preview servers in `.claude/launch.json` (python http.server): `cp-preview` 8770 = `couchpotato_build/dist`; `ff-local-site` 8766 = live `final-website/dist`; others (`ff-db-test` 8773, `ff-nordic-test`, etc.) point at old scratchpad copies and may be stale.
- Flow: edit in `couchpotato_build/dist` -> `preview_start cp-preview` -> check 4 widths -> show owner (screenshots) -> go live. Debug DB vs files with `?db=0` (forces files). Sign-in UI preview: `?login=1`.
- New feature/scope: ask owner first. Owner-requested fix: fix, verify, publish, report (CLAUDE.md).

## 4. Publish and verify
- Publish = `golive_couchpotato.sh` (pages + common/home/browse/product/boards js) or the nightly 22:00 run (`python3 -m ff_agents.nightly`; copies page shell from live dist, so live files are what ships). Never publish while a nightly is running.
- Verify: poll the file with a throw-away param (`file?x=<timestamp>`), NOT the real `?v=` URL or real page URL. Render CDN caches per exact URL for 300 s and keeps the OLD file under the NEW tag if requested early. If hit early: wait 5 min, do not republish.
- Record each publish in `MASTER_HANDOFF.md` (what, commit, rollback, verified).

## 5. Rollback scripts (`bash agents/<script> [--local]`; each restores page/script/style files from `agents/state/site_backups/`, leaves product data alone, then publishes)
- `rollback_couchpotato.sh`: rename + new look -> previous Furnish Finder pages (backup `LATEST_PRE_COUCHPOTATO`).
- `rollback_theme_v2.sh`: cranberry/beige theme, homepage banner, Option C card, 30 deals -> pre-theme look.
- `rollback_nordic.sh`: Nordic phase 1 (Inter, header/footer/cards/home) -> look before 28 Sep.
- `rollback_moodboards.sh`: menu item, homepage strip, moodboards.html, board.html (nightly keeps writing data/boards, harmless).
- `rollback_featured.sh`: "Featured" ranking -> biggest discount first; switches off, takes ~20 min (data update).
- `rollback_taxonomy_v2.sh`: categories back to pre-4 Oct (restores data, browse, master catalogue, 3 code files).
- No script: photo backdrop (delete the `.has-bars::before` rule in theme2.css + bump `?v=`), Google login (set `LOGIN='off'` in common.js), size/colour cards, rooms (presentation only: `room_map.py`).

## 6. Nightly-generated: do NOT hand-edit (edits are overwritten at 22:00)
- `data/` entirely (meta.json, home.json incl. Top deals + room tiles, rooms.json, `l/*.json.gz`, `d/*.json.gz`, `s/`, `boards/`), `sitemap.xml`, version stamps (`data-v=` on pages).
- `c/**/index.html` (212 static category + room pages, `static_pages.py`).
- Homepage hero/banner inside `ffb` markers (`design_hook.py`; design session owns `design/`). Restyle via CSS only.
- Mood boards (`boards.py`), Featured order numbers (`featured.py`), colour fill (`colour.py`). Change their rules in `agents/ff_agents/`, not in output files.
- Hand-editable: page shells (html outside generated blocks), css, js, `js/filters.json`, `privacy.html`, `404.html`, `robots.txt`.

## 7. Database vs file fallback
- Supabase (Mumbai) mirror via `db_sync.py` (nightly). Browse, search and product pages read DB functions (`browse_cards`/`browse_v2`, `browse_facets`, `cards_by_ids`, `product_detail`) through `FF.db` (6 s timeout, 1 retry); on failure they fall back to the `data/` files. Homepage and wishlist read files (+ `cards_by_ids`).
- Any new filter/feature must work in BOTH paths; SQL lives in `agents/ff_agents/db_api.sql` (install: `python3 -m ff_agents.db_sync api`). DB near free limit (~453/500 MB): new `cards` columns need trimming or Pro.
- Accounts: Supabase Auth Google + table `wishlists` (RLS, own row only); vendored `js/vendor/supabase-2.117.3.js`. Never print `agents/.env` values.

## 7b. Homepage (28 Oct 2026)
- Order: static photo hero (search on it), What does couchpotato.ae do + 3 steps, Collections (3 fixed tiles, js/home-tiles.js), Top deals (18 from the daily pool, feature tiles), Shop by room (phone: first/last tile full width), Shop by mood (js/home.js, data/boards), Popular searches (fixed list, js/home-tiles.js), stores strip. Category/browse grid has the same editorial rhythm (browse.js decorate()).

## 8. Open UI items
- Adaptive filters phase 2b: colour family, material, storage, shape (needs nightly build step + DB columns + `browse_v2` args; clean bad prices first, max AED 38M in Beds). Phase 2a is live (spec PRD s.5.9).
- Nordic phases 2-3 (PRD `FurnishFinder_UI_PRD_NordicNest.md`): category landing without old "Find the right piece" hero, multi-select filter bar polish, product page, wishlist restyle; phase 3 mega-menu, drawer, stores page. Partly superseded by the couchpotato brand book: check against it first.
- Card photo framing (trim blank borders) + code names: planned, `agents/state/plans/card_framing_and_names_PLAN.md`; in-stock default option: `instock_default_option_PLAN.md`.
- Canonical/sitemap -> couchpotato.ae once the owner connects the domain in Render.
- Product pages are script-only (not readable by search engines); Search Console/Bing not set up.

## Lessons (updated at each weekly close; keep under 25 lines, replace stale ones)
- Flow: owner iterates on a MOCKUP first (design/mockup_*/; the owner is often on a phone over Remote Control, so publish a self-contained Artifact with images embedded as data: URIs, not a localhost link), says "build it", then build in a COPY: rsync dist (exclude data) to the scratchpad + symlink data/, serve with `python3 -m http.server <port>`, test, then deliver agents/state/plans/<name>_work/ (files + apply_tags.py) + backup agents/state/site_backups/pre-<name>-<stamp>/. Master copies in and publishes; I never edit live dist when Master says so.
- Before building, cmp the live dist files against the last hand-off (Master installs and sometimes tweaks). If two pending hand-offs touch the same file, base the new one on the superset and say which to skip. Pipeline keeps live index.html + js/home.js (nightly.py ~253), so edits there survive.
- Cache tags: bump css/js tags in ALL ~220 html (python glob over **/*.html, skip data/); static_pages.py builds c/ and room/ from browse.html (test on a temp copy with symlinked data/: 212 pages). In a test copy a CSS edit under the SAME ?v tag is served from the browser cache: bump the tag in the copy.
- Check 390 and 1440 (and 768/1000 for breakpoints) by measuring in the pane (getBoundingClientRect on the INNER elements, not just the tile: a feature tile looked right but its photo was one row tall). Screenshots go stale after scrollTo/resize: use the computer scroll action, then screenshot.
- CSS fights: theme2/nordic/product-card set badge/body/aspect with !important; override with the #id selector plus !important. product-card.css gives .pc-body flex:1 (stops a flex column photo growing); grid items need explicit align-self/flex settings.
- Editorial grid rhythm (category + home deals): blocks of 4 cells (row of 4, feature + 4 beside, ...), feature = full width on phones, 2 cols x 2 rows >=1050px (home deals >=700), every 2nd on the right; a feature only if 4 cards follow; promo takes one beside cell. Feature photos use cover, landscape ones (.is-wide) contain.
- Never claim what data does not show: no "last night/nightly", no unverified "up to X% off" in new copy, cap deal badges (pcCard hides >80%); exclude As Is / clearance / display / sets / office / pouf / shelving from the front deals. Brand name in text: couchpotato.ae in the logo typeface (.cp-brand). Orange #EE5A0B only for hero label, chip dots, hero search button.
- Top deals: pool of ~40 in home.json "pool" (site_patch.py refresh_pool, try/except, 10 days, staggered); home.js shows 18/day seeded by the Dubai date. Pipeline code changes go through Master and a dry run.
- GA4 (js/common.js, FF.track, consent/GPC/localhost guards): test in a copy with the localhost guard sed'ed off and read window.dataLayer. Keep item_id raw case, string params, one page_view per product load (product.html uses send_page_view:false + FF.pageReady). browse.html drops ?q= from page_location so our view_search_results is the only one.
- Bandwidth (Render): headers in render.yaml are NOT applied (live is max-age=0, s-maxage=300 via Cloudflare); owner must set them in the dashboard (agents/state/plans/bandwidth_work/HEADERS.md). Room scenes ship as WebP (FF.sceneSrc, jpg fallback); Japandi stays jpg (design_hook can redraw it). Live index.html data-v is frozen (nightly overwrites it): do not give home data a long TTL until fixed.
- Store photos for tiles are hotlinked with onerror fallbacks (never copy store images into dist). Catalogue names may show a broken dash "â€“" (scraper encoding): report to FF Scraper, do not patch in the UI.
- When cutting code by slicing between markers, check you did not delete a neighbour; re-test every control after a removal. `.cp-sec > .cp-h2` styling is DOM-dependent. zsh: wrap `grep --include` in bash -c; paths with spaces break `set -- $p` loops.
- GA identity (1 Nov, built, not live): ff_vid in localStorage = random browser id, set (before config) as visitor_id; signed in = user_id + account_id (Supabase UUID only, cleared on sign-out); gated like GA (opt-out, GPC, blocked storage = nothing); Decline deletes ff_vid. Needs visitor_id/account_id as GA custom dimensions and the privacy wording in agents/state/plans/visitor_id_work/PRIVACY_TEXT.md.
- Colour-variant cards (found 1 Nov): the Supabase `cards` table has one card per colour (ids ending ~cream); 9,700 of 11,643 reuse the base photo (29 stores), so search shows the same chair 3 times. A pipeline fix (hide same-photo variants), not a UI one: owner asked, Master decides.
