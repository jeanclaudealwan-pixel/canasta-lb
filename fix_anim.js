const fs = require('fs');
let srv = fs.readFileSync('serveur.js', 'utf8');

const target = "io.to(salon.id).emit('animationPiocher', { joueur: numeroJoueur, nbCartes: resultat.cartesRecues.length });";
const replacement = `Object.keys(salon.joueurs).forEach(sId => {
                    if (!sId.startsWith('bot-')) io.to(sId).emit('animationPiocher', { joueur: numeroJoueur, nbCartes: resultat.cartesRecues.length });
                });
                if (salon.spectateurs) {
                    salon.spectateurs.forEach(sId => {
                        io.to(sId).emit('animationPiocher', { joueur: numeroJoueur, nbCartes: resultat.cartesRecues.length });
                    });
                }`;

srv = srv.replace(target, replacement);
fs.writeFileSync('serveur.js', srv);
console.log("Fixed serveur.js animation emitting!");
