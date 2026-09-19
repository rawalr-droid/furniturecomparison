import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const [cataloguePath, retailerName = 'Pan Home', outputRoot = '.'] = process.argv.slice(2);
if (!cataloguePath) {
  throw new Error('Usage: node scripts/split-retailer-catalogue.mjs <catalogue.js> [retailer name] [output root]');
}

const source = await fs.readFile(cataloguePath, 'utf8');
const context = {window: {}};
vm.runInNewContext(source, context, {filename: cataloguePath});
const products = (context.window.CATALOGUE || []).filter(product => product.store === retailerName);
if (!products.length) throw new Error(`No ${retailerName} products found in ${cataloguePath}`);

const maxBytes = 820_000;
const chunks = [];
let current = [];
let currentBytes = 2;
for (const product of products) {
  const encoded = JSON.stringify(product);
  const extraBytes = Buffer.byteLength(encoded) + (current.length ? 1 : 0);
  if (current.length && currentBytes + extraBytes > maxBytes) {
    chunks.push(current);
    current = [];
    currentBytes = 2;
  }
  current.push(product);
  currentBytes += extraBytes;
}
if (current.length) chunks.push(current);

const slug = retailerName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
for (const directory of [path.join(outputRoot, 'catalogue-data'), path.join(outputRoot, 'dist', 'catalogue-data')]) {
  await fs.mkdir(directory, {recursive: true});
  for (let index = 0; index < chunks.length; index += 1) {
    const filename = `${slug}-${String(index).padStart(3, '0')}.js`;
    const content = `window.PAN_HOME_CATALOGUE_CHUNKS=window.PAN_HOME_CATALOGUE_CHUNKS||[];window.PAN_HOME_CATALOGUE_CHUNKS[${index}]=${JSON.stringify(chunks[index])};\n`;
    await fs.writeFile(path.join(directory, filename), content);
  }
}

console.log(`Split ${products.length.toLocaleString()} ${retailerName} products into ${chunks.length} browser chunks`);
