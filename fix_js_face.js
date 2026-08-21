const fs = require('fs');
let js = fs.readFileSync('public/js/jeu-client-pro.js', 'utf8');

// Update animerCarte signature and innerHTML
const animFnOld = "function animerCarte(sourceEl, destEl, classNameSupp) {\n    if (!sourceEl || !destEl) return;\n    const tempCard = document.createElement('div');\n    tempCard.className = 'animated-card-throw ' + (classNameSupp || '');\n    document.body.appendChild(tempCard);";
const animFnNew = "function animerCarte(sourceEl, destEl, classNameSupp, innerHTML) {\n    if (!sourceEl || !destEl) return;\n    const tempCard = document.createElement('div');\n    tempCard.className = 'animated-card-throw ' + (classNameSupp || '');\n    if (innerHTML) tempCard.innerHTML = innerHTML;\n    document.body.appendChild(tempCard);";

if (js.includes(animFnOld)) {
    js = js.replace(animFnOld, animFnNew);
} else {
    // try looser regex
    js = js.replace(/function animerCarte\(sourceEl, destEl, classNameSupp\) \{[\s\S]*?document\.body\.appendChild\(tempCard\);/,
        "function animerCarte(sourceEl, destEl, classNameSupp, innerHTML) {\n    if (!sourceEl || !destEl) return;\n    const tempCard = document.createElement('div');\n    tempCard.className = 'animated-card-throw ' + (classNameSupp || '');\n    if (innerHTML) tempCard.innerHTML = innerHTML;\n    document.body.appendChild(tempCard);"
    );
}

// Update animationPiocher call
const loopOld = "animerCarte(source, dest, 'mini-back');";
const loopNew = `
let innerHTML = null;
let cls = 'mini-back';
if (data.cartesRecues && data.cartesRecues[i]) {
    const c = data.cartesRecues[i];
    const isRed = (c.couleur === '♥' || c.couleur === '♦');
    cls = 'card' + (isRed ? ' red' : '');
    innerHTML = \`<div class="idx tl"><span>\${c.valeur}</span><span>\${c.couleur}</span></div><div class="pip">\${c.couleur}</div><div class="idx br"><span>\${c.valeur}</span><span>\${c.couleur}</span></div>\`;
}
animerCarte(source, dest, cls, innerHTML);
`;

js = js.replace(loopOld, loopNew);

fs.writeFileSync('public/js/jeu-client-pro.js', js);
console.log("Updated JS for face cards animation");
