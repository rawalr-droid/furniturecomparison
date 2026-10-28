// Homepage 'Shop by room' row (owner, 2026-10-08; it replaced 'Shop by category'): a fixed list, not nightly.
// n = room, c = link, i = photo (a smaller version of the store's photo where its image server offers one).
window.FF_HOME_ROOMS = [
 {
  "n": "Living Room",
  "c": "browse.html?room=Living%20Room",
  "i": "https://media.homecentre.com/i/homecentre/166924839-166469820-HC07062024_04-2100.jpg?w=900"
 },
 {
  "n": "Bedroom",
  "c": "browse.html?room=Bedroom",
  "i": "https://media.homecentre.com/i/homecentre/165872248-165872246-HC24102023_05-2100.jpg?w=900"
 },
 {
  "n": "Dining Room",
  "c": "browse.html?room=Dining%20Room",
  "i": "https://media.homeboxstores.com/i/homebox/169822475-169822475-HMBX16072026N_05-2100.jpg?v=7&w=900"
 },
 {
  "n": "Kitchen",
  "c": "browse.html?room=Kitchen",
  "i": "https://cdn.shopify.com/s/files/1/0740/8595/7668/files/Image_4_d11f0862-4040-4de4-b0da-e4a9f5306cd5.png?v=1780487655&width=900&format=pjpg"
 },
 {
  "n": "Bathroom",
  "c": "browse.html?room=Bathroom",
  "i": "https://media.homecentre.com/i/homecentre/165097460-165097460-HC14112022_04-2100.jpg?w=900"
 },
 {
  "n": "Home Office",
  "c": "browse.html?room=Home%20Office",
  "i": "https://hocfurniture.ae/wp-content/uploads/2026/04/Oren-Work-Desk-4.webp"
 },
 {
  "n": "Kids Room",
  "c": "browse.html?room=Kids%20Room",
  "i": "https://cdn.media.amplience.net/i/lmg/169780084-169780084-HC20042066_03-2100.jpg?w=900"
 },
 {
  "n": "Outdoor",
  "c": "browse.html?room=Outdoor",
  "i": "https://cdn.shopify.com/s/files/1/0632/0580/2143/files/ChatGPTImageFeb26_2026_03_14_58AM.png?v=1772729158&width=900&format=pjpg"
 },
 {
  "n": "Entryway",
  "c": "browse.html?room=Entryway",
  "i": "https://media.homecentre.com/i/homecentre/161324875-161324875-HC050119_04-2100.jpg?v=1&w=900"
 }
];

// Homepage "Collections" (owner approved the layout, 28 Oct): three fixed collections; each opens a filtered category page.
// n = title, c = link, i = photo (a store photo, like the room photos above; the tile still works if it fails to load).
window.FF_HOME_COLLECTIONS = [
 { "n": "Beds under AED 1,500", "c": "browse.html?c=furniture%2Fbedroom%2Fbeds&price=0-1500", "i": "https://cdn.shopify.com/s/files/1/0255/1857/1617/files/2_2e18908b-320b-4c6d-bf25-ab4ead30ed04.jpg?v=1771941620" },
 { "n": "Dining tables under AED 2,000", "c": "browse.html?c=furniture%2Fdining-room%2Fdining-tables&price=0-2000", "i": "https://media.homecentre.com/i/homecentre/168405741-168405741-HC24092025_01-2100.jpg?w=900" },
 { "n": "Sofas, 50% off or more", "c": "browse.html?c=furniture%2Fsofas-seating%2Fsofas&disc=50", "i": "https://assets.danubehome.com/media/dh-seller/p/sellers/BESPOKE-FURNITURE/product-image/179900159990/1783676282108/1.webp" }
];
// Homepage "Popular searches": the most searched terms on the site (Google Analytics, 28 days to 27 Oct). Update by hand now and then.
window.FF_HOME_TERMS = ['Dining table', 'Sofa', 'Coffee table', 'Bunk bed', 'Queen bed', 'Sofa bed', 'Outdoor dining', 'Rug', 'Armchair', 'Sideboard'];
