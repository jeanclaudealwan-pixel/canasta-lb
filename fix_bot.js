const fs = require('fs');
let srv = fs.readFileSync('serveur.js', 'utf8');

const botMeldOld = `            if (groupesDescendre.length > 0) {
                // If they need to open, we just pass the groups, if it fails, it fails (naive bot)
                const resDescendre = this.partie.actionDescendreCombinaisons(this.numero, groupesDescendre);
                if (resDescendre.ok) { 
                    diffuserAnimation(this.salon, "animationDescendre", this.numero); 
                    diffuserEtatGlobal(this.salon); 
                }
            }`;

const botMeldNew = `            const teamHasPure = Object.values(equipe.table).some(c => c.estCanasta && c.verrouilleePure);
            const teamHasImpure = Object.values(equipe.table).some(c => c.estCanasta && !c.verrouilleePure);
            const canGoOut = teamHasPure && teamHasImpure;
            let cardsUsed = groupesDescendre.reduce((sum, g) => sum + g.cartesId.length, 0);

            if (!canGoOut && (main.length - cardsUsed) < 2) {
                groupesDescendre = [];
            }

            if (groupesDescendre.length > 0) {
                const resDescendre = this.partie.actionDescendreCombinaisons(this.numero, groupesDescendre);
                if (resDescendre.ok) { 
                    diffuserAnimation(this.salon, "animationDescendre", this.numero); 
                    diffuserEtatGlobal(this.salon); 
                }
            }`;

if (srv.includes(botMeldOld)) {
    srv = srv.replace(botMeldOld, botMeldNew);
}

const botJeterOld = `            if (jeterId) {
                const resJeter = this.partie.actionJeter(this.numero, jeterId);
                if (resJeter.ok) {
                    diffuserAnimation(this.salon, 'animationJeter', this.numero);
                    if (resJeter.mancheTerminee) {
                        gererFinManche(this.salon, resJeter);
                    } else {
                        diffuserEtatGlobal(this.salon);
                    }
                }
            }`;

const botJeterNew = `            if (jeterId) {
                let resJeter = this.partie.actionJeter(this.numero, jeterId);
                if (!resJeter.ok) {
                    // Fallback
                    const currentMain = this.partie.joueurs[this.numero].main;
                    for (let c of currentMain) {
                        resJeter = this.partie.actionJeter(this.numero, c.id);
                        if (resJeter.ok) { jeterId = c.id; break; }
                    }
                }

                if (resJeter.ok) {
                    diffuserAnimation(this.salon, 'animationJeter', this.numero);
                    if (resJeter.mancheTerminee) {
                        gererFinManche(this.salon, resJeter);
                    } else {
                        diffuserEtatGlobal(this.salon);
                    }
                }
            }`;

if (srv.includes(botJeterOld)) {
    srv = srv.replace(botJeterOld, botJeterNew);
}

fs.writeFileSync('serveur.js', srv);
console.log("Bot logic patched");
