const fs = require('fs');
let srv = fs.readFileSync('serveur.js', 'utf8');

const botJeterOld = `                if (resJeter.ok) {
                    diffuserAnimation(this.salon, 'animationJeter', this.numero);
                    if (resJeter.mancheTerminee) {
                        gererFinManche(this.salon, resJeter);
                    } else {
                        diffuserEtatGlobal(this.salon);
                    }
                }`;

const botJeterNew = `                if (resJeter.ok) {
                    diffuserAnimation(this.salon, 'animationJeter', this.numero);
                    if (resJeter.mancheTerminee) {
                        gererFinManche(this.salon, resJeter);
                    } else {
                        diffuserChangementTour(this.salon, resJeter.prochainTour);
                        diffuserEtatGlobal(this.salon);
                        verifierTourBot(this.salon, resJeter.prochainTour);
                    }
                }`;

if (srv.includes(botJeterOld)) {
    srv = srv.replace(botJeterOld, botJeterNew);
    fs.writeFileSync('serveur.js', srv);
    console.log("Turn pass added to BotJoueur!");
} else {
    console.log("Could not find the block to replace.");
}
