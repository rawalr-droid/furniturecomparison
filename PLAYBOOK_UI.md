# PLAYBOOK_UI: couchpotato.ae front end (written 2026-10-17)

## 1. Source of truth
- LIVE = `final-website/dist/` (Render static site, publish dir `dist`, no build step; `render.yaml`). Repo is pushed by the agents, not by hand.
- WORKING COPY for big UI changes = `couchpotato_build/dist/` (its `data` is a symlink to live data: never write data through it). As of 16 Oct the pages match in size; diffs are the nightly-generated `c/` pages and data stamps.
- Promote working copy -> live with `agents/golive_couchpotato.sh [--local]` (backs up replaced files first; refuses while a nightly runs). Small fixes: edit live files directly, take a backup in `agents/state/site_backups/pre-<name>-<stamp>` first.
- CSS layering (later wins): `styles.css` > `theme.css` > `nordic.css` (Nordic phase 1, Inter) > `theme2.css` (cranberry v2 overrides, loaded after) > `couchpotato.css` (loaded LAST, owns the rebrand: put new rules here, do not touch the older layers). Others: `product-card.css`, `deals.css`, `pages.css`, `banner.css` (ffb hero).
- JS: `js/common.js` = shared layer (FF namespace, `FF.pcCard` card, `FF.imgFit` photo backdrop, `FF.db` database client, accounts/wishlist sync, `LOGIN` switch). Page scripts: home.js, browse.js (+ filters.json), product.js, wishlist.js, boards.js, home-tiles.js, cat-redirects.js. `js/db-config.js` = Supabase URL + publishable key (public by design).
- Cache busting: every page links assets as `file?v=<tag>`; bump the tag in ALL pages (index, browse, product, wishlist, board, moodboards) whenever a css/js file changes.

## 2. Design rules (CouchPotato_Brand_Guidelines.md, repo root)
- Name: wordmark `couchpotato` (Fraunces 800, #EE5A0B) + `.ae` (#121316), lowercase; logo orange ONLY for the wordmark.
- Base: cream #F4EDE0 bg, white surfaces, ink #121316, muted #6C707A; one terracotta accent for money; mood colours only in Shop-by-mood.
- Type: Fraunces only for logo, page title, section titles. Plus Jakarta Sans for everything else (all prices/numbers sans). Caveat for one handwriting line per page. `font-display: swap`.
- Photos always in a cream frame; non-square photos get a blurred backdrop (`.pc-media.has-bars::before`, theme2.css).
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

## 8. Open UI items
- Adaptive filters phase 2b: colour family, material, storage, shape (needs nightly build step + DB columns + `browse_v2` args; clean bad prices first, max AED 38M in Beds). Phase 2a is live (spec PRD s.5.9).
- Nordic phases 2-3 (PRD `FurnishFinder_UI_PRD_NordicNest.md`): category landing without old "Find the right piece" hero, multi-select filter bar polish, product page, wishlist restyle; phase 3 mega-menu, drawer, stores page. Partly superseded by the couchpotato brand book: check against it first.
- Card photo framing (trim blank borders) + code names: planned, `agents/state/plans/card_framing_and_names_PLAN.md`; in-stock default option: `instock_default_option_PLAN.md`.
- Canonical/sitemap -> couchpotato.ae once the owner connects the domain in Render.
- Product pages are script-only (not readable by search engines); Search Console/Bing not set up.

## Lessons (updated at each weekly close; keep under 25 lines, replace stale ones)
- (none yet)
