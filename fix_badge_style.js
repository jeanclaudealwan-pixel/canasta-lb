const fs = require('fs');
let js = fs.readFileSync('public/js/jeu-client-pro.js', 'utf8');
js = js.replace("badge.className = 'badge-nouvelle';", "badge.className = 'badge-nouvelle';\n              badge.style.cssText = 'position:absolute; top:-8px; right:-8px; background:red; color:white; font-size:10px; font-weight:bold; padding:2px 6px; border-radius:10px; border:2px solid white; box-shadow:0 2px 4px rgba(0,0,0,0.5); z-index:10;';");
fs.writeFileSync('public/js/jeu-client-pro.js', js);
console.log("Inline CSS applied to badge");
