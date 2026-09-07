# Furnish Finder UAE

A static, Render-ready furniture discovery MVP built from the master catalogue.

## Features

- Search across retailer catalogues
- Filter by category, room, store, price and sale status
- Sort by price and discount
- Product detail view with outbound retailer links
- Similar-items suggestions across stores
- Compare up to three items side by side
- Responsive desktop and mobile layout

## Deploy on Render

1. Push this folder to a GitHub repository.
2. In Render, choose **New > Static Site** and connect the repository.
3. Render will detect `render.yaml`. If entering settings manually, leave the build command blank and use `dist` as the publish directory.
4. Deploy.

## Refresh the catalogue

Run the exporter with the master workbook and commit the updated `dist/catalogue.js` file:

```bash
$CODEX_PRIMARY_RUNTIME_NODE scripts/export-catalogue.mjs /path/to/UAE_Furniture_Master_Catalogue.xlsx dist/catalogue.js
```

The current similarity engine is a transparent MVP based on product type, category, room, material, price and name overlap. It can later be upgraded to image/text embeddings without changing the page design.
