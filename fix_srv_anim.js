const fs = require('fs');
let srv = fs.readFileSync('serveur.js', 'utf8');

const target = "if (!sId.startsWith('bot-')) io.to(sId).emit('animationPiocher', { joueur: numeroJoueur, nbCartes: resultat.cartesRecues.length });";
const replacement = "if (!sId.startsWith('bot-')) io.to(sId).emit('animationPiocher', { joueur: numeroJoueur, nbCartes: resultat.cartesRecues.length, cartesRecues: (salon.joueurs[sId] === numeroJoueur) ? resultat.cartesRecues : null });";

if (srv.includes(target)) {
    srv = srv.replace(target, replacement);
    fs.writeFileSync('serveur.js', srv);
    console.log("serveur.js patched with cartesRecues");
} else {
    console.log("target not found");
}
