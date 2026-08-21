const fs = require('fs');

let srv = fs.readFileSync('serveur.js', 'utf8');

const target = `            if (resultat.piocheEpuisee) {
                gererFinManche(salon, { recapManche: resultat.recapManche });
            } else {
                diffuserEtatGlobal(salon);
            }`;

const replacement = `            if (resultat.piocheEpuisee) {
                gererFinManche(salon, { recapManche: resultat.recapManche });
            } else {
                io.to(salon.id).emit('animationPiocher', { joueur: numeroJoueur, nbCartes: resultat.cartesRecues.length });
                diffuserEtatGlobal(salon);
            }`;

if (srv.includes(target)) {
    srv = srv.replace(target, replacement);
    fs.writeFileSync('serveur.js', srv);
    console.log("Successfully patched serveur.js");
} else {
    console.log("Could not find target in serveur.js");
}
