const fs = require('fs');
let js = fs.readFileSync('public/js/jeu-client-pro.js', 'utf8');
js = js.replace("el.classList.add('nouvelle-carte-piochee');", "el.classList.add('nouvelle-carte-piochee'); el.style.overflow = 'visible';");
fs.writeFileSync('public/js/jeu-client-pro.js', js);
console.log("Overflow visible added.");
