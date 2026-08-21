const fs = require('fs');

let html = fs.readFileSync('public/index.html', 'utf8');

html = html.replace(/<div id="panneau-emojis"[^>]*>/, '<div id="panneau-emojis" class="panneau-emojis">');

const settings_modal = `
        <div id="modal-parametres" class="modal-panel" style="display:none; text-align: center;">
            <h2 style="color: var(--gold); margin-bottom: 20px;">⚙️ Réglages</h2>
            <div style="margin:20px 0;">
                <p>Paramètres de la partie</p>
            </div>
            <button id="btn-quitter-jeu" class="btn btn-large" style="background: var(--red); color: white; border: 2px solid white; margin-bottom: 10px; font-weight: bold; border-radius: 12px;">🚪 Quitter la partie</button>
            <button id="btn-fermer-parametres" class="btn btn-large" style="background: #333; color: white; border-radius: 12px; font-weight: bold;">Fermer</button>
        </div>
`;
html = html.replace('<div id="modal-sortie"', settings_modal + '        <div id="modal-sortie"');

// Wait, some divs don't use 'salon-conteneur' but I want to apply modern-salon to 'salon-conteneur' and 'lobby-conteneur'
html = html.replace('<div class="salon-conteneur">', '<div class="salon-conteneur modern-salon">');
html = html.replace('<div class="lobby-conteneur">', '<div class="lobby-conteneur modern-salon">');

fs.writeFileSync('public/index.html', html);
console.log("HTML patched");
