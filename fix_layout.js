const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

html = html.replace(
    '<div id="grille-sieges" class="grille-sieges">',
    '<div class="salon-layout-grid">\n                <div id="grille-sieges" class="grille-sieges">'
);
html = html.replace(
    '<div class="salon-actions">',
    '</div>\n            <div class="salon-actions">'
);

fs.writeFileSync('public/index.html', html);
console.log("HTML restructured");
