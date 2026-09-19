import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const [inputPath, cataloguePath, retailerName = 'Pan Home'] = process.argv.slice(2);
if (!inputPath || !cataloguePath) {
  throw new Error('Usage: node scripts/merge-retailer-json.mjs <products.json> <catalogue.js> [retailer name]');
}

const EXCLUDED_FIELDS = /video|remaining quantity|salable qty|low.?stock|pre.?order|on.?demand|swatch|durability/i;
const MARKETING_ROOTS = /sale|offer|discount|price drop|low price|best seller|online exclusive|pan friday|additional/i;
const SHOPPING_ROOTS = new Set(['furniture', 'accessories', 'kids', 'outdoor', 'pan bloom']);

function text(value) {
  return value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
}

function number(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function unique(values) {
  return [...new Set((values || []).map(text).filter(Boolean))];
}

function plainText(value) {
  return text(String(value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'"));
}

function categoryPath(product) {
  const candidates = (product.source_categories || [])
    .map(item => Array.isArray(item?.path) ? item.path.map(text).filter(Boolean) : [])
    .filter(parts => parts.length && SHOPPING_ROOTS.has(parts[0].toLowerCase()))
    .sort((a, b) => b.length - a.length);
  if (candidates.length) return candidates[0];

  const fallback = text(product.category);
  return fallback && !MARKETING_ROOTS.test(fallback) ? [fallback] : ['Other'];
}

function inferredRoom(product, parts) {
  if (text(product.room)) return text(product.room);
  const source = parts.join(' ').toLowerCase();
  const rooms = [
    ['Living Room', ['living', 'sofa', 'coffee table', 'tv unit']],
    ['Bedroom', ['bedroom', 'bed', 'mattress', 'wardrobe']],
    ['Dining Room', ['dining']],
    ['Kitchen', ['kitchen']],
    ['Bathroom', ['bath']],
    ['Kids', ['kids', 'nursery']],
    ['Outdoor', ['outdoor', 'garden']],
    ['Home Office', ['office', 'desk']],
  ];
  return rooms.find(([, terms]) => terms.some(term => source.includes(term)))?.[0] || 'Unspecified';
}

function attributeValue(product, key) {
  const item = product.attributes?.[key];
  const value = item && typeof item === 'object' ? item.value : item;
  return Array.isArray(value) ? value.map(text).filter(Boolean) : text(value);
}

function compactSpecs(product) {
  const specs = [];
  for (const [key, item] of Object.entries(product.attributes || {})) {
    const label = text(item?.label || key.replace(/_/g, ' '));
    if (!label || EXCLUDED_FIELDS.test(`${key} ${label}`)) continue;
    let value = item && typeof item === 'object' ? item.value : item;
    if (Array.isArray(value)) value = value.map(text).filter(Boolean).join(', ');
    value = text(value);
    if (!value || value === '0' || value.length > 500) continue;
    specs.push({label, value});
    if (specs.length === 14) break;
  }
  return specs;
}

function normalisePanHome(product) {
  const parts = categoryPath(product);
  const price = number(product.price);
  const candidateOriginal = number(product.original);
  const original = candidateOriginal > price ? candidateOriginal : price;
  let discount = number(product.discount);
  if (discount > 1) discount /= 100;
  if (!discount && original > price) discount = (original - price) / original;
  const images = unique([product.image, ...(Array.isArray(product.images) ? product.images : [])]);
  const features = Array.isArray(product.features) ? product.features.map(text).filter(Boolean) : attributeValue(product, 'features');
  const description = plainText(product.description || product.short_description).slice(0, 1200);
  const sku = text(product.sku || product.source_product_id || product.id);

  return {
    id: `pan_home:${sku}`,
    sku,
    store: retailerName,
    name: text(product.name),
    variant: text(product.size || product.color),
    category: parts[0] || 'Other',
    room: inferredRoom(product, parts),
    type: parts.at(-1) || text(product.category) || 'Other',
    material: text(product.material || attributeValue(product, 'material')),
    dimensions: text(product.dimensions || attributeValue(product, 'dimensions')),
    price,
    original,
    discount: Math.max(0, Math.min(1, discount)),
    image: images[0] || '',
    images,
    url: text(product.url),
    description,
    color: text(product.color || attributeValue(product, 'color')),
    style: text(product.style || attributeValue(product, 'style')),
    features: Array.isArray(features) ? features : features ? [features] : [],
    care: text(product.care_instructions || attributeValue(product, 'care_instruction')),
    assembly: text(product.assembly_required || product.assembly_provided || attributeValue(product, 'assembly_provided')),
    warranty: text(product.warranty || attributeValue(product, 'item_warranty')),
    country: text(product.country_of_origin || attributeValue(product, 'country_of_origin')),
    inStock: Boolean(product.in_stock),
    specs: compactSpecs(product),
  };
}

async function readCatalogue(filePath) {
  const source = await fs.readFile(filePath, 'utf8');
  const context = {window: {}};
  vm.runInNewContext(source, context, {filename: filePath});
  if (!Array.isArray(context.window.CATALOGUE)) throw new Error(`No window.CATALOGUE array found in ${filePath}`);
  return context.window.CATALOGUE;
}

const [existing, incoming] = await Promise.all([
  readCatalogue(cataloguePath),
  fs.readFile(inputPath, 'utf8').then(JSON.parse),
]);

const retained = existing.filter(product => text(product.store).toLowerCase() !== retailerName.toLowerCase());
const replacement = incoming
  .map(normalisePanHome)
  .filter(product => product.id && product.name && product.price > 0 && product.url && product.image);
const merged = [...retained, ...replacement];

await fs.mkdir(path.dirname(cataloguePath), {recursive: true});
await fs.writeFile(cataloguePath, `window.CATALOGUE=${JSON.stringify(merged)};\n`);
console.log(`Retained ${retained.length.toLocaleString()} non-${retailerName} products`);
console.log(`Replaced with ${replacement.length.toLocaleString()} ${retailerName} products`);
console.log(`Wrote ${merged.length.toLocaleString()} total products to ${cataloguePath}`);
