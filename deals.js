const PRODUCTS = window.CATALOGUE || [];
const AED = new Intl.NumberFormat('en-AE', { style:'currency', currency:'AED', maximumFractionDigits:0 });
const escapeHTML = (value='') => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[char]));
const savings = product => Math.max(0, product.original - product.price);

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

function uniqueProducts(products) {
  const groups = new Map();
  for (const product of products) {
    const key = productKey(product);
    const current = groups.get(key);
    if (!current || product.discount > current.discount || (product.discount === current.discount && savings(product) > savings(current))) groups.set(key, product);
  }
  return [...groups.values()];
}

const unique = uniqueProducts(PRODUCTS);
const selected = unique
  .filter(product => product.discount >= .55 && product.original >= 700 && product.price > 0 && product.image && product.url)
  .sort((a,b) => b.discount - a.discount || savings(b) - savings(a))
  .slice(0,10);

function card(product) {
  const percent = Math.round(product.discount * 100);
  return `<article class="deal-card">
    <a class="deal-image" href="product.html?id=${encodeURIComponent(product.id)}" target="_blank" rel="noopener">
      <img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}" loading="lazy">
      <span class="discount">${percent}% <small>off</small></span>
    </a>
    <div class="deal-body">
      <div class="deal-meta"><span>${escapeHTML(product.category)}</span><span>${escapeHTML(product.store)}</span></div>
      <h3><a href="product.html?id=${encodeURIComponent(product.id)}" target="_blank" rel="noopener">${escapeHTML(product.name)}</a></h3>
      <p class="prices"><strong>${AED.format(product.price)}</strong><span>${AED.format(product.original)}</span></p>
      <div class="saving"><span>You save</span><b>${AED.format(savings(product))}</b></div>
      <a class="view-deal" href="product.html?id=${encodeURIComponent(product.id)}" target="_blank" rel="noopener">View product <span>→</span></a>
    </div>
  </article>`;
}

const categoryDefinitions = [
  ['Sofas','sofa'],['Dining','dining table'],['Beds','bed'],['Chairs','chair'],
  ['Tables','coffee table'],['Storage','cabinet'],['Outdoor','outdoor']
];

function representative(query) {
  const terms = query.toLowerCase().split(' ');
  return unique.find(product => product.image && terms.every(term =>
    `${product.name} ${product.type} ${product.category} ${product.room}`.toLowerCase().includes(term)
  )) || unique.find(product => product.image);
}

document.getElementById('categoryStrip').innerHTML = categoryDefinitions.map(([label,query]) => {
  const product = representative(query);
  return `<a class="category-card" href="browse.html?q=${encodeURIComponent(query)}">
    <span class="category-image">${product ? `<img src="${escapeHTML(product.image)}" alt="" loading="lazy">` : ''}</span>
    <strong>${label}</strong>
  </a>`;
}).join('');

const hero = selected[0] || unique.find(product => product.image);
if (hero) {
  document.getElementById('heroProduct').innerHTML = `<img src="${escapeHTML(hero.image)}" alt="${escapeHTML(hero.name)}"><span class="hero-badge">${Math.round(hero.discount*100)}%<small>OFF</small></span>`;
}

document.getElementById('dealCount').textContent = selected.length;
document.getElementById('dealGrid').innerHTML = selected.map(card).join('');
document.getElementById('empty').hidden = selected.length > 0;
