import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const input=process.argv[2];
const output=process.argv[3];
if(!input||!output) throw new Error('Usage: export-catalogue.mjs <input.xlsx> <output.js>');
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(input));
const values=wb.worksheets.getItem('Master Catalogue').getUsedRange(true).values;
const headers=values[0];
const idx=Object.fromEntries(headers.map((h,i)=>[h,i]));
const text=(row,key)=>row[idx[key]]==null?'':String(row[idx[key]]).trim();
const num=(row,key)=>Number(row[idx[key]])||0;
function image(url){
  let value=String(url||'');
  if(value.includes('woodculture.ae')) value=value.replace(/_(?:\d+x\d+)_crop_center(?=\.)/,'_600x600_crop_center');
  if(value.includes('unitedfurnitureco.com')) value=value.replace(/-200x200(?=\.(?:webp|jpg|png))/i,'');
  return value;
}
const products=values.slice(1).map(row=>({
  id:text(row,'product_variant_id'),store:text(row,'retailer_name'),name:text(row,'product_name'),variant:text(row,'variant_name'),
  category:text(row,'category_l1'),room:text(row,'room'),type:text(row,'product_type'),material:text(row,'primary_material'),
  dimensions:text(row,'dimensions_raw'),price:num(row,'current_price_aed'),original:num(row,'original_price_aed'),discount:num(row,'discount_pct'),
  image:image(text(row,'primary_image_url')),url:text(row,'product_url'),description:text(row,'description').replace(/\s+/g,' ').slice(0,650)
})).filter(p=>p.id&&p.name&&p.price);
await fs.writeFile(output,`window.CATALOGUE=${JSON.stringify(products)};\n`);
console.log(`Exported ${products.length} products`);
