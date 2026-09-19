const PRODUCTS=window.CATALOGUE||[];
const $=id=>document.getElementById(id);
function money(value) { return new Intl.NumberFormat('en-AE', {style:'currency', currency:'AED', maximumFractionDigits:0}).format(value || 0); }
function escapeHTML(value='') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c])); }
function productKey(product) {
  const raw = String(product.url || '').trim();
  try {
    const url = new URL(raw, window.location.href);
    const shopify = url.pathname.match(/\/products\/([^/]+)/i);
    const path = shopify ? `/products/${shopify[1]}` : url.pathname.replace(/\/$/, '');
    return `${product.store}|${url.hostname.toLowerCase()}${path.toLowerCase()}`;
  } catch (_) {
    return `${product.store}|${raw.split(/[?#]/)[0].replace(/\/$/, '').toLowerCase() || product.id}`;
  }
}

function retailerURL(product) {
  const raw = String(product.url || '');
  const variantId = String(product.id || '').match(/(\d{8,})$/)?.[1];
  if (!variantId || !/\/products\//i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    url.searchParams.set('variant', variantId);
    return url.toString();
  } catch (_) { return raw; }
}

const PRODUCT_GROUPS = new Map();
for (const product of PRODUCTS) {
  const key = productKey(product);
  if (!PRODUCT_GROUPS.has(key)) PRODUCT_GROUPS.set(key, []);
  PRODUCT_GROUPS.get(key).push(product);
}

function groupName(variants) {
  if (variants.length < 2) return variants[0]?.name || '';
  let prefix = variants[0].name || '';
  for (const variant of variants.slice(1)) {
    while (prefix && !String(variant.name || '').toLowerCase().startsWith(prefix.toLowerCase())) prefix = prefix.slice(0, -1);
  }
  const cleanPrefix = prefix.replace(/[\s\-–—/|,:]+$/, '').trim();
  if (cleanPrefix.length >= 8) return cleanPrefix;
  const first = variants[0].name || '';
  const lastDivider = Math.max(first.lastIndexOf(' - '), first.lastIndexOf(' – '), first.lastIndexOf(' / '));
  return lastDivider > 7 ? first.slice(0, lastDivider).trim() : first;
}

function variantLabel(product, parentName='') {
  const titleSuffix=parentName && product.name.startsWith(parentName) ? product.name.slice(parentName.length).replace(/^[\s–—/|,:-]+/,'').trim() : '';
  const variant = [titleSuffix, String(product.variant || '').trim()].filter((v,i,a)=>v&&!/^\d{7,}$/.test(v)&&v!=='Default Title'&&a.indexOf(v)===i).join(' · ');
  if (variant && !/^default title$/i.test(variant) && !/^\d{7,}$/.test(variant)) return variant;
  const name = String(product.name || '');
  const suffix = parentName && name.toLowerCase().startsWith(parentName.toLowerCase()) ? name.slice(parentName.length).replace(/^[\s\-–—/|,:]+/, '') : '';
  return suffix || product.type || 'Standard option';
}

function bestVariant(variants) {
  return [...variants].sort((a,b) => (b.discount - a.discount) || Number(Boolean(b.image)) - Number(Boolean(a.image)) || a.price - b.price)[0];
}

function imageMarkup(p, cls='product-image') {
  return p.image ? `<img class="${cls}" src="${escapeHTML(p.image)}" alt="${escapeHTML(p.name)}" loading="lazy" onerror="this.outerHTML='<div class=&quot;image-fallback&quot;>Image unavailable</div>'">` : '<div class="image-fallback">Image unavailable</div>';
}

function productImages(product) {
  return [...new Set([product.image, ...(Array.isArray(product.images) ? product.images : [])].filter(Boolean))];
}

let activeGallery = [];
let activeGalleryIndex = 0;
function selectGalleryImage(index) {
  if (!activeGallery.length) return;
  activeGalleryIndex = (index + activeGallery.length) % activeGallery.length;
  const main = $('detailMainImage');
  if (main) main.src = activeGallery[activeGalleryIndex];
  document.querySelectorAll('[data-image-index]').forEach(button => {
    const selected = Number(button.dataset.imageIndex) === activeGalleryIndex;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function similarity(base, p) {
  if (productKey(base)===productKey(p)) return -1;
  let score=0; if(base.type===p.type) score+=8; if(base.category===p.category) score+=5; if(base.room===p.room) score+=2;
  if(base.material && p.material && base.material.toLowerCase().includes(p.material.toLowerCase().split(',')[0])) score+=2;
  if(base.store!==p.store) score+=10; const ratio=Math.min(base.price,p.price)/Math.max(base.price,p.price); score+=ratio*3;
  const words=new Set(base.name.toLowerCase().split(/\W+/)); p.name.toLowerCase().split(/\W+/).forEach(w=>{if(w.length>3&&words.has(w))score+=1}); return score;
}
function similarTo(product) {
  return [...PRODUCT_GROUPS.entries()]
    .filter(([key]) => key !== productKey(product))
    .map(([,variants]) => { const p=bestVariant(variants); return {p:{...p,_displayName:groupName(variants)},s:similarity(product,p)}; })
    .filter(x=>x.s>=0 && x.p.type===product.type && (product.room==='Outdoor')===(x.p.room==='Outdoor')).sort((a,b)=>b.s-a.s).slice(0,20).map(x=>x.p);
}
function fact(label,value){ return value ? `<div class="fact"><span>${label}</span>${escapeHTML(value)}</div>`:''; }

function openProduct(id) {
  const p=PRODUCTS.find(x=>x.id===id); if(!p)return;
  const variants=PRODUCT_GROUPS.get(productKey(p)) || [p];
  const parentName=groupName(variants);
  const currentIndex=Math.max(0,variants.findIndex(v=>v.id===p.id));
  const similar=similarTo(p);
  activeGallery=productImages(p);
  activeGalleryIndex=0;
  const imageThumbnails=activeGallery.map((image,index)=>`<button class="variant-thumb image-thumb ${index===0?'active':''}" data-image-index="${index}" aria-pressed="${index===0}" type="button" aria-label="View image ${index+1} of ${activeGallery.length}">
    <img src="${escapeHTML(image)}" alt="" loading="lazy"><span>${index+1}</span>
  </button>`).join('');
  const variantThumbnails=variants.map(v=>`<button class="variant-thumb ${v.id===p.id?'active':''}" data-variant="${escapeHTML(v.id)}" aria-pressed="${v.id===p.id}" type="button" aria-label="Select ${escapeHTML(variantLabel(v,parentName))}" title="${escapeHTML(variantLabel(v,parentName))}">
    <img src="${escapeHTML(v.image)}" alt="" loading="lazy"><span>${escapeHTML(variantLabel(v,parentName))}</span>
  </button>`).join('');
  const features=Array.isArray(p.features)?p.features.filter(Boolean):[];
  const specs=Array.isArray(p.specs)?p.specs.filter(item=>item&&item.label&&item.value):[];
  $('productDialogContent').innerHTML=`<div class="product-detail">
    <div class="detail-gallery">
      ${activeGallery.length?`<img id="detailMainImage" class="detail-image" src="${escapeHTML(activeGallery[0])}" alt="${escapeHTML(parentName)}">`:'<div class="image-fallback">Image unavailable</div>'}
      ${activeGallery.length>1?`<button class="gallery-arrow gallery-prev" data-image-step="-1" aria-label="Previous image">‹</button><button class="gallery-arrow gallery-next" data-image-step="1" aria-label="Next image">›</button><div class="detail-thumbnails">${imageThumbnails}</div>`:''}
    </div>
    <div class="detail-copy"><div class="store">${escapeHTML(p.store)}</div><h2>${escapeHTML(parentName)}</h2>
      ${variants.length>1?`<p class="selected-variant"><span>Colour / option</span>${escapeHTML(variantLabel(p,parentName))} <small>${currentIndex+1} of ${variants.length}</small></p>`:`<p class="variant">${escapeHTML(variantLabel(p,parentName))}</p>`}
      ${variants.length>1?`<div class="option-thumbnails">${variantThumbnails}</div>`:''}
      <p class="detail-price">${money(p.price)}${p.original>p.price?` <span class="was-price">${money(p.original)}</span>`:''}</p>
      <div class="facts">${fact('Category',p.type)}${fact('Room',p.room)}${fact('Material',p.material)}${fact('Colour',p.color)}${fact('Dimensions',p.dimensions)}${fact('Style',p.style)}${fact('Assembly',p.assembly)}${fact('Warranty',p.warranty)}${fact('Made in',p.country)}</div>
      <p class="description">${escapeHTML(p.description||'See the retailer website for full product information.')}</p>
      ${features.length?`<section class="product-features"><h3>Features</h3><ul>${features.map(item=>`<li>${escapeHTML(item)}</li>`).join('')}</ul></section>`:''}
      ${p.care?`<section class="product-care"><h3>Care instructions</h3><p>${escapeHTML(p.care)}</p></section>`:''}
      ${specs.length?`<section class="product-specs"><h3>Product details</h3><dl>${specs.map(item=>`<div><dt>${escapeHTML(item.label)}</dt><dd>${escapeHTML(item.value)}</dd></div>`).join('')}</dl></section>`:''}
      <a class="retailer-link" href="${escapeHTML(retailerURL(p))}" target="_blank" rel="noopener sponsored">View this option at ${escapeHTML(p.store)}</a>
    </div>
    <div class="similar-wrap"><h3>Similar pieces across stores</h3><p>${similar.length} matching products. Alternatives from other retailers are prioritised.</p><div class="similar-grid">${similar.map(s=>`<a class="similar-item" href="product.html?id=${encodeURIComponent(s.id)}" target="_blank" rel="noopener">${imageMarkup(s)}<div><strong>${escapeHTML(s._displayName)}</strong><span>${money(s.price)} · ${escapeHTML(s.store)}</span></div></a>`).join('')}</div></div>
  </div>`;
  document.title=parentName+' | Furnish Finder UAE'; history.replaceState(null,'','product.html?id='+encodeURIComponent(p.id));
}


document.addEventListener('click',e=>{
  const image=e.target.closest('[data-image-index]');
  const step=e.target.closest('[data-image-step]');
  const variant=e.target.closest('[data-variant]');
  if(image) selectGalleryImage(Number(image.dataset.imageIndex));
  else if(step) selectGalleryImage(activeGalleryIndex+Number(step.dataset.imageStep));
  else if(variant){openProduct(variant.dataset.variant);document.querySelector('[data-variant].active')?.focus({preventScroll:true});}
});
const selectedId=new URLSearchParams(location.search).get('id');
if(PRODUCTS.some(p=>p.id===selectedId))openProduct(selectedId);else $('productDialogContent').innerHTML='<section class=detail-copy><h1>Product not found</h1><p>This product may no longer be in the catalogue.</p><a href=browse.html>Browse furniture</a></section>';
