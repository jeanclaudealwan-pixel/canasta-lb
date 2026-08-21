const fs = require('fs');
let js = fs.readFileSync('public/js/jeu-client-pro.js', 'utf8');

const targetLoop = `animerCarte(source, dest, cls, innerHTML);`;
const replacementLoop = `
if (innerHTML) {
    cls += ' animated-face';
}
animerCarte(source, dest, cls, innerHTML);
`;

js = js.replace(targetLoop, replacementLoop);

// Inject CSS for animated-face
let css = fs.readFileSync('public/css/style-pro.css', 'utf8');
if (!css.includes('.animated-face')) {
    css += `
.animated-face {
    background: #fff !important;
    border: 1px solid #ccc !important;
    color: #151515;
    display: flex;
    justify-content: center;
    align-items: center;
}
.animated-face.red { color: var(--red); }
.animated-face .idx { font-size: 8px; }
.animated-face .idx.tl { top: 2px; left: 2px; }
.animated-face .idx.br { bottom: 2px; right: 2px; }
.animated-face .pip { font-size: 16px; opacity: 0.2; }
`;
    fs.writeFileSync('public/css/style-pro.css', css);
}

fs.writeFileSync('public/js/jeu-client-pro.js', js);
console.log("Fixed face anim styles");
