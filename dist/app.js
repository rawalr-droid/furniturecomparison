const PRODUCTS = window.CATALOGUE || [];
const PAGE_SIZE = 24;
const initialParams = new URLSearchParams(window.location.search);
const state = { query: initialParams.get('q') || '', category: '', room: '', store: '', min: '', max: '', sale: initialParams.get('deals') === '1', sort: 'featured', shown: PAGE_SIZE, compare: [] };

const $ = (id) => document.getElementById(id);
const els = {
  grid: $('productGrid'), count: $('resultCount'), label: $('resultLabel'), search: $('searchInput'),
  category: $('categoryFilter'), room: $('roomFilter'), store: $('storeFilter'), min: $('minPrice'), max: $('maxPrice'),
  sale: $('saleOnly'), sort: $('sortSelect'), load: $('loadMore'), empty: $('emptyState'), active: $('activeFilters'),
  compareCount: $('compareCount'), compareTrigger: $('compareTrigger'), productDialog: $('productDialog'), compareDialog: $('compareDialog')
};
els.search.value = state.query;
els.sale.checked = state.sale;

function money(value) { return new Intl.NumberFormat('en-AE', {style:'currency', currency:'AED', maximumFractionDigits:0}).format(value || 0); }
function escapeHTML(value='') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c])); }
function options(id, values) { values.filter(Boolean).sort().forEach(v => $(id).insertAdjacentHTML('beforeend', `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`)); }
options('categoryFilter', [...new Set(PRODUCTS.map(p => p.category))]);
options('roomFilter', [...new Set(PRODUCTS.map(p => p.room).filter(r => r !== 'Unspecified'))]);
options('storeFilter', [...new Set(PRODUCTS.map(p => p.store))]);

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
  const variant = String(product.variant || '').trim();
  if (variant && !/^default title$/i.test(variant) && !/^\d{7,}$/.test(variant)) return variant;
  const name = String(product.name || '');
  const suffix = parentName && name.toLowerCase().startsWith(parentName.toLowerCase()) ? name.slice(parentName.length).replace(/^[\s\-–—/|,:]+/, '') : '';
  return suffix || product.type || 'Standard option';
}

function bestVariant(variants) {
  return [...variants].sort((a,b) => (b.discount - a.discount) || Number(Boolean(b.image)) - Number(Boolean(a.image)) || a.price - b.price)[0];
}

function groupedRows(rows) {
  const matchingGroups = new Map();
  for (const product of rows) {
    const key = productKey(product);
    if (!matchingGroups.has(key)) matchingGroups.set(key, []);
    matchingGroups.get(key).push(product);
  }
  return [...matchingGroups.entries()].map(([key, matches]) => {
    let representative = bestVariant(matches);
    if (state.sort === 'price-low') representative = [...matches].sort((a,b) => a.price-b.price)[0];
    if (state.sort === 'price-high') representative = [...matches].sort((a,b) => b.price-a.price)[0];
    if (state.sort === 'discount') representative = [...matches].sort((a,b) => b.discount-a.discount)[0];
    const allVariants = PRODUCT_GROUPS.get(key) || matches;
    const prices = matches.map(p => p.price).filter(price => price > 0);
    return {
      ...representative,
      _groupKey: key,
      _variants: allVariants,
      _displayName: groupName(allVariants),
      _minPrice: Math.min(...prices),
      _maxPrice: Math.max(...prices),
      _maxDiscount: Math.max(...matches.map(p => p.discount || 0))
    };
  });
}

function filteredProducts() {
  const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
  const intents = {bed:['Bed','Bunk & Loft Bed'],beds:['Bed','Bunk & Loft Bed'],towel:['Towel'],towels:['Towel'],sofa:['Sofa','Sofa Set','Corner & Modular Sofa','Sofa Bed'],sofas:['Sofa','Sofa Set','Corner & Modular Sofa','Sofa Bed'],'dining chair':['Dining Chair'],'dining chairs':['Dining Chair'],'dining table':['Dining Table'],'dining tables':['Dining Table'],rug:['Rug'],rugs:['Rug'],mirror:['Mirror'],mirrors:['Mirror']};
  const intent=intents[state.query.toLowerCase().trim()];
  const matches = PRODUCTS.filter(p => {
    const haystack = `${p.name} ${p.variant} ${p.category} ${p.type} ${p.material} ${p.store}`.toLowerCase();
    return (intent ? intent.includes(p.type) : terms.every(t => haystack.includes(t))) &&
      (!state.category || p.category === state.category) && (!state.room || p.room === state.room) &&
      (!state.store || p.store === state.store) && (!state.min || p.price >= Number(state.min)) &&
      (!state.max || p.price <= Number(state.max)) && (!state.sale || p.discount > 0);
  });
  const rows = groupedRows(matches);
  rows.sort((a,b) => {
    if (state.sort === 'price-low') return a._minPrice - b._minPrice;
    if (state.sort === 'price-high') return b._maxPrice - a._maxPrice;
    if (state.sort === 'discount') return b._maxDiscount - a._maxDiscount;
    if (state.sort === 'name') return a._displayName.localeCompare(b._displayName);
    return (b._maxDiscount * 2 + (b.image ? 1 : 0)) - (a._maxDiscount * 2 + (a.image ? 1 : 0));
  });
  return rows;
}

function imageMarkup(p, cls='product-image') {
  return p.image ? `<img class="${cls}" src="${escapeHTML(p.image)}" alt="${escapeHTML(p.name)}" loading="lazy" onerror="this.outerHTML='<div class=&quot;image-fallback&quot;>Image unavailable</div>'">` : '<div class="image-fallback">Image unavailable</div>';
}

function card(p) {
  const selected = state.compare.includes(p.id);
  const count = p._variants.length;
  const price = p._minPrice < p._maxPrice ? `From ${money(p._minPrice)}` : money(p._minPrice);
  return `<article class="product-card">
    <a class="product-media" href="product.html?id=${encodeURIComponent(p.id)}" target="_blank" rel="noopener">${imageMarkup(p)}${count > 1 ? `<span class="variant-count">${count} options</span>` : ''}</a>
    <div class="product-body">
      <div class="product-kicker"><span>${escapeHTML(p.store)}</span>${p._maxDiscount ? `<span class="sale-badge">Up to ${Math.round(p._maxDiscount*100)}% off</span>` : ''}</div>
      <h3><a href="product.html?id=${encodeURIComponent(p.id)}" target="_blank" rel="noopener">${escapeHTML(p._displayName)}</a></h3>
      <div class="price">${price}${p.original > p.price && p._minPrice === p._maxPrice ? `<span class="was-price">${money(p.original)}</span>` : ''}</div>
      <div class="card-actions"><a class="view-button" href="product.html?id=${encodeURIComponent(p.id)}" target="_blank" rel="noopener">View details ↗</a><button class="${selected?'selected':''}" data-compare="${escapeHTML(p.id)}">${selected?'Added':'Compare'}</button></div>
    </div>
  </article>`;
}

function render() {
  const rows = filteredProducts(); const visible = rows.slice(0, state.shown);
  els.grid.innerHTML = visible.map(card).join('');
  els.count.textContent = `${rows.length.toLocaleString()} products`;
  els.label.textContent = state.query ? `Results for “${state.query}”` : 'Browse the catalogue';
  els.load.hidden = visible.length >= rows.length || !rows.length;
  els.empty.hidden = !!rows.length; els.grid.hidden = !rows.length;
  renderPills();
}

function renderPills() {
  const pills = [['query',state.query],['category',state.category],['room',state.room],['store',state.store],['sale',state.sale?'On sale':null]].filter(([,v])=>v);
  els.active.innerHTML = pills.map(([k,v]) => `<button class="filter-pill" data-clear="${k}">${escapeHTML(v)} ×</button>`).join('');
}

function syncFilters() {
  state.category=els.category.value; state.room=els.room.value; state.store=els.store.value;
  state.min=els.min.value; state.max=els.max.value; state.sale=els.sale.checked; state.sort=els.sort.value; state.shown=PAGE_SIZE; render();
}
function reset() {
  Object.assign(state,{query:'',category:'',room:'',store:'',min:'',max:'',sale:false,sort:'featured',shown:PAGE_SIZE});
  els.search.value=''; els.category.value=''; els.room.value=''; els.store.value=''; els.min.value=''; els.max.value=''; els.sale.checked=false; els.sort.value='featured'; render();
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
    .filter(x=>x.s>=0 && x.p.type===product.type && (product.room==='Outdoor')===(x.p.room==='Outdoor')).sort((a,b)=>b.s-a.s).slice(0,4).map(x=>x.p);
}
function fact(label,value){ return value ? `<div class="fact"><span>${label}</span>${escapeHTML(value)}</div>`:''; }

function openProduct(id) { window.open("product.html?id="+encodeURIComponent(id), "_blank", "noopener"); }

function toggleCompare(id) {
  if(state.compare.includes(id)) state.compare=state.compare.filter(x=>x!==id);
  else if(state.compare.length<3) state.compare.push(id);
  else return toast('You can compare up to 3 items');
  els.compareCount.textContent=state.compare.length; els.compareTrigger.disabled=state.compare.length<2; render();
}
function openCompare() {
  const items=state.compare.map(id=>PRODUCTS.find(p=>p.id===id)).filter(Boolean); if(items.length<2)return;
  const row=(label,fn)=>`<tr><td>${label}</td>${items.map(p=>`<td>${fn(p)||'—'}</td>`).join('')}</tr>`;
  $('compareContent').innerHTML=`<table class="compare-table"><tbody>
    ${row('',p=>imageMarkup(p))}${row('Product',p=>`<strong>${escapeHTML(groupName(PRODUCT_GROUPS.get(productKey(p))||[p]))}</strong><br><small>${escapeHTML(p.store)}</small>`)}
    ${row('Selected option',p=>escapeHTML(variantLabel(p,groupName(PRODUCT_GROUPS.get(productKey(p))||[p]))))}
    ${row('Price',p=>`<strong>${money(p.price)}</strong>${p.original>p.price?`<br><small>${Math.round(p.discount*100)}% off</small>`:''}`)}
    ${row('Type',p=>escapeHTML(p.type))}${row('Material',p=>escapeHTML(p.material))}${row('Dimensions',p=>escapeHTML(p.dimensions))}
    ${row('',p=>`<a href="product.html?id=${encodeURIComponent(p.id)}" target="_blank" rel="noopener">View details</a>`)}</tbody></table>`;
  els.compareDialog.showModal();
}
function toast(message){ const t=$('toast');t.textContent=message;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1800); }

$('searchForm').addEventListener('submit',e=>{e.preventDefault();state.query=els.search.value.trim();state.shown=PAGE_SIZE;render();$('browse').scrollIntoView({behavior:'smooth'});});
document.querySelectorAll('[data-query]').forEach(b=>b.addEventListener('click',()=>{els.search.value=b.dataset.query;state.query=b.dataset.query;render();$('browse').scrollIntoView({behavior:'smooth'});}));
[els.category,els.room,els.store,els.sale,els.sort].forEach(x=>x.addEventListener('change',syncFilters));
[els.min,els.max].forEach(x=>x.addEventListener('input',()=>{clearTimeout(x.timer);x.timer=setTimeout(syncFilters,250);}));
$('clearFilters').addEventListener('click',reset); $('emptyReset').addEventListener('click',reset);
$('filterToggle').addEventListener('click',()=>[$('filters').classList.toggle('open')]);
els.load.addEventListener('click',()=>{state.shown+=PAGE_SIZE;render();}); els.compareTrigger.addEventListener('click',openCompare);
document.addEventListener('click',e=>{
  const variant=e.target.closest('[data-variant]'); const view=e.target.closest('[data-view]'); const comp=e.target.closest('[data-compare]'); const clear=e.target.closest('[data-clear]');
  if(variant) openProduct(variant.dataset.variant); else if(view) openProduct(view.dataset.view);
  if(comp) toggleCompare(comp.dataset.compare);
  if(clear){const k=clear.dataset.clear;if(k==='query'){state.query='';els.search.value='';}else if(k==='sale'){state.sale=false;els.sale.checked=false;}else{state[k]='';els[k].value='';}state.shown=PAGE_SIZE;render();}
  const closer=e.target.closest('[data-close]');if(closer)$(closer.dataset.close+'Dialog').close();
});
[els.productDialog,els.compareDialog].forEach(d=>d.addEventListener('click',e=>{if(e.target===d)d.close();}));
render();
