const fs = require('fs');
let js = fs.readFileSync('public/js/jeu-client-pro.js', 'utf8');

// 1. Add global Set for newly drawn cards
if (!js.includes('let cartesRecemmentPiochees')) {
    js = js.replace("let estSpectateur = false;", "let estSpectateur = false;\nlet cartesRecemmentPiochees = new Set();");
}

// 2. In animationPiocher, record the new cards
const oldAnim = "socket.on('animationPiocher', (data) => {";
const newAnim = `
socket.on('animationPiocher', (data) => {
    if (data.joueur === monNumero && data.cartesRecues) {
        cartesRecemmentPiochees.clear();
        data.cartesRecues.forEach(c => cartesRecemmentPiochees.add(c.id));
        setTimeout(() => {
            cartesRecemmentPiochees.clear();
            rendreMain(etatGlobal ? etatGlobal.mesCartes : []);
        }, 3000);
    }
`;
if (!js.includes('cartesRecemmentPiochees.clear();')) {
    js = js.replace(oldAnim, newAnim);
}

// 3. In creerElementCarte, add the class if it's new
const oldCreer = "if (cartesSelectionnees.has(c.id)) el.classList.add('selectionnee');";
const newCreer = `if (cartesSelectionnees.has(c.id)) el.classList.add('selectionnee');
          if (cartesRecemmentPiochees.has(c.id)) el.classList.add('nouvelle-carte-piochee');`;

if (!js.includes('nouvelle-carte-piochee')) {
    js = js.replace(oldCreer, newCreer);
}

fs.writeFileSync('public/js/jeu-client-pro.js', js);
console.log("Client JS updated for new cards");
