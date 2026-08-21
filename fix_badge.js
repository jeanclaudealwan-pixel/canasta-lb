const fs = require('fs');
let js = fs.readFileSync('public/js/jeu-client-pro.js', 'utf8');

const target = "if (cartesRecemmentPiochees.has(c.id)) el.classList.add('nouvelle-carte-piochee');";
const replacement = `if (cartesRecemmentPiochees.has(c.id)) {
              el.classList.add('nouvelle-carte-piochee');
              const badge = document.createElement('div');
              badge.className = 'badge-nouvelle';
              badge.innerHTML = 'Nouveau';
              el.appendChild(badge);
          }`;

if (js.includes(target)) {
    js = js.replace(target, replacement);
    fs.writeFileSync('public/js/jeu-client-pro.js', js);
    console.log("JS patched to add badge");
} else {
    console.log("Target not found");
}
