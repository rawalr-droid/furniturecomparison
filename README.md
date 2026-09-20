# Furnish Finder UAE

A static, Render-ready furniture and home discovery site: 106,000+ products from 17 UAE stores, browsed through a
3-level category tree (category > sub-category > type).

## How it works

Everything is served from `dist/`. There is no build step and no server.

- `dist/data/meta.json`  category tree, stores and rooms
- `dist/data/l/*.json.gz`  listing rows, one file per sub-category (loaded as the visitor browses)
- `dist/data/d/*.json.gz`  full product details, 32 chunks (loaded when a product page opens)
- `dist/data/home.json`  deals and category tiles for the home page
- `dist/js/`             common.js (data layer), home.js, browse.js, product.js

The big data files are gzip-compressed to keep the repo small (about 25 MB in total); the browser unpacks them.

## Deploy on Render

Static Site, build command blank, publish directory `dist` (this is also what `render.yaml` says).

## Refreshing the catalogue

Regenerate the `dist/data/` folder from the master catalogue and commit it. The pages need no changes.
