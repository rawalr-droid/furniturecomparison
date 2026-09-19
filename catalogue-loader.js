(async()=>{
  const loader=document.currentScript;
  const entry=loader?.dataset.entry;
  const chunkCount=48;
  const version='pan-20260919';
  const loadScript=src=>new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=src;
    script.onload=resolve;
    script.onerror=()=>reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
  await Promise.all(Array.from({length:chunkCount},(_,index)=>loadScript(`catalogue-data/pan-home-${String(index).padStart(3,'0')}.js?v=${version}`)));
  const panHome=(window.PAN_HOME_CATALOGUE_CHUNKS||[]).flat();
  window.CATALOGUE=(window.CATALOGUE||[]).filter(product=>product.store!=='Pan Home').concat(panHome);
  delete window.PAN_HOME_CATALOGUE_CHUNKS;
  if(entry) await loadScript(entry);
})().catch(error=>{
  console.error(error);
  const target=document.getElementById('productGrid')||document.getElementById('productDialogContent')||document.body;
  target.insertAdjacentHTML('afterbegin','<p class="catalogue-error">The latest catalogue could not be loaded. Please refresh the page.</p>');
});
