const fs = require('fs');

// PATCH SERVEUR.JS
let srv = fs.readFileSync('serveur.js', 'utf8');

// 1. Add choisirSiege
const choisirSiegeCode = `
    socket.on('choisirSiege', (nouveauSiege) => {
        const salonId = joueursDansSalons[socket.id];
        if (!salonId) return;
        const salon = salons[salonId];
        if (salon.enCours || !salon.placesDisponibles.includes(nouveauSiege)) return;

        // Liberer ancien
        const ancienSiege = salon.joueurs[socket.id];
        if (ancienSiege) salon.placesDisponibles.push(ancienSiege);
        
        salon.joueurs[socket.id] = nouveauSiege;
        salon.placesDisponibles = salon.placesDisponibles.filter(p => p !== nouveauSiege);
        
        socket.emit('attributionSiege', nouveauSiege);
        diffuserMiseAJourSalon(salon);
    });

    socket.on('ajouterBot',`;

if (!srv.includes("socket.on('choisirSiege'")) {
    srv = srv.replace("socket.on('ajouterBot',", choisirSiegeCode);
}


// 2. Fix quitterLeSalon to insert bots immediately
const oldQuitter = `
        if (salon.enCours) {
            deconnexionsPendantPartie[socketId] = {
                roomId: salon.id,
                numero: numeroLibere,
                timeout: setTimeout(() => {
                    salon.placesDisponibles.push(numeroLibere);
                    salon.placesDisponibles.sort((a, b) => a - b);
                    delete deconnexionsPendantPartie[socketId];
                    delete salon.joueurs[socketId];
                    diffuserMessageGlobal(salon, \`Le Joueur \${numeroLibere} a définitivement quitté la table.\`);
                    envoyerMiseAJourSalon(salon);
                }, 900000)
            };
        } else {`;

const newQuitter = `
        if (salon.enCours) {
            // Remplacer par un Bot immédiatement
            delete salon.joueurs[socketId];
            const sIdBot = 'bot-' + Date.now() + Math.floor(Math.random()*1000);
            salon.joueurs[sIdBot] = numeroLibere;
            salon.bots = salon.bots || {};
            salon.bots[numeroLibere] = new BotJoueur(numeroLibere, salon, io);
            diffuserMessageGlobal(salon, \`Le Joueur \${numeroLibere} a quitté et a été remplacé par un Bot.\`);
            envoyerMiseAJourSalon(salon);
            diffuserEtatGlobal(salon);
            if (salon.partie.tourActuel === numeroLibere && !salon.partie.aJoueCeTour) {
                salon.bots[numeroLibere].jouerTour();
            }
        } else {`;

if (srv.includes("deconnexionsPendantPartie[socketId] = {")) {
    srv = srv.replace(oldQuitter, newQuitter);
}

// 3. Improve Bot logic
const oldBot = `
class BotJoueur {
    constructor(numero, salon, serverIo) {
        this.numero = numero;
        this.salon = salon;
        this.partie = salon.partie;
        this.io = serverIo;
    }
    jouerTour() {
        setTimeout(() => {
            if (!this.partie || !this.partie.enJeu) return;
            const resPiocher = this.partie.actionPiocher(this.numero);
            if (resPiocher.ok) {
                if (resPiocher.piocheEpuisee) {
                    gererFinManche(this.salon, { recapManche: resPiocher.recapManche });
                    return;
                }
                diffuserEtatGlobal(this.salon);
            }
            
            const main = this.partie.joueurs[this.numero].main;
            const valMap = {};
            for (let c of main) {
                if (!c.estJoker && c.valeur !== '2' && c.valeur !== '3') {
                    valMap[c.valeur] = (valMap[c.valeur] || 0) + 1;
                }
            }
            const valeursMultiples = Object.keys(valMap).filter(v => valMap[v] >= 3);
            if (valeursMultiples.length > 0) {
                const groupes = valeursMultiples.map(v => ({
                    cartesId: main.filter(c => c.valeur === v).map(c => c.id)
                }));
                const resDescendre = this.partie.actionDescendreCombinaisons(this.numero, groupes);
                if (resDescendre.ok) { diffuserAnimation(this.salon, "animationDescendre", this.numero); diffuserEtatGlobal(this.salon); }
            }
            
            let jeterId = main[0].id;
            const normales = main.filter(c => !c.estJoker && c.valeur !== '2');
            if (normales.length > 0) {
                normales.sort((a,b) => a.points - b.points);
                jeterId = normales[0].id;
            } else {
                const deux = main.filter(c => c.valeur === '2');
                if (deux.length > 0) jeterId = deux[0].id;
            }
            
            const resJeter = this.partie.actionJeter(this.numero, jeterId);
            if (resJeter.ok) {
                diffuserAnimation(this.salon, 'animationJeter', this.numero);
                if (resJeter.mancheTerminee) {
                    gererFinManche(this.salon, resJeter);
                } else {
                    diffuserEtatGlobal(this.salon);
                }
            }
        }, 1500 + Math.random() * 1000);
    }
}
`;

const newBot = `
class BotJoueur {
    constructor(numero, salon, serverIo) {
        this.numero = numero;
        this.salon = salon;
        this.partie = salon.partie;
        this.io = serverIo;
    }
    jouerTour() {
        setTimeout(() => {
            if (!this.partie || !this.partie.enJeu) return;
            
            let ramasserOk = false;
            const topTerre = this.partie.defausse.length > 0 ? this.partie.defausse[this.partie.defausse.length - 1] : null;
            const equipe = this.partie.equipes[this.partie.equipeDuJoueur(this.numero)];
            const main = this.partie.joueurs[this.numero].main;

            if (topTerre && !topTerre.estJoker && topTerre.valeur !== '2' && !topTerre.est3Noir && equipe.aOuvert) {
                const pileGelee = this.partie.defausse.some(c => c.estJoker || c.valeur === '2');
                const requiredMatches = pileGelee ? 3 : 2;
                const nbMatches = main.filter(c => c.valeur === topTerre.valeur).length;
                if (nbMatches >= requiredMatches) {
                    const resRamasser = this.partie.actionRamasserTerre(this.numero, null);
                    if (resRamasser.ok) {
                        ramasserOk = true;
                        diffuserEtatGlobal(this.salon);
                    }
                }
            }

            if (!ramasserOk) {
                const resPiocher = this.partie.actionPiocher(this.numero);
                if (resPiocher.ok) {
                    if (resPiocher.piocheEpuisee) {
                        gererFinManche(this.salon, { recapManche: resPiocher.recapManche });
                        return;
                    }
                    Object.keys(this.salon.joueurs).forEach(sId => {
                        if (!sId.startsWith('bot-')) this.io.to(sId).emit('animationPiocher', { joueur: this.numero, nbCartes: resPiocher.cartesRecues.length, cartesRecues: null });
                    });
                    diffuserEtatGlobal(this.salon);
                }
            }
            
            // Smart melds logic
            const valMap = {};
            const wildcards = main.filter(c => c.estJoker || c.valeur === '2');
            for (let c of main) {
                if (!c.estJoker && c.valeur !== '2' && c.valeur !== '3' && c.valeur !== '3 Rouge') {
                    valMap[c.valeur] = (valMap[c.valeur] || []);
                    valMap[c.valeur].push(c);
                }
            }
            
            let groupesDescendre = [];
            let wIdx = 0;
            for (let v in valMap) {
                let cartesNormales = valMap[v];
                if (cartesNormales.length >= 3) {
                    groupesDescendre.push({ cartesId: cartesNormales.map(c => c.id) });
                } else if (cartesNormales.length === 2 && wildcards.length > wIdx) {
                    // Use a wildcard to make a meld of 3
                    const w = wildcards[wIdx++];
                    groupesDescendre.push({ cartesId: [cartesNormales[0].id, cartesNormales[1].id, w.id] });
                }
            }
            
            if (groupesDescendre.length > 0) {
                // If they need to open, we just pass the groups, if it fails, it fails (naive bot)
                const resDescendre = this.partie.actionDescendreCombinaisons(this.numero, groupesDescendre);
                if (resDescendre.ok) { 
                    diffuserAnimation(this.salon, "animationDescendre", this.numero); 
                    diffuserEtatGlobal(this.salon); 
                }
            }
            
            // Simple discard
            let jeterId = null;
            const updatedMain = this.partie.joueurs[this.numero].main;
            const normales = updatedMain.filter(c => !c.estJoker && c.valeur !== '2');
            if (normales.length > 0) {
                normales.sort((a,b) => a.points - b.points); // Jette les plus petits points
                jeterId = normales[0].id;
            } else if (updatedMain.length > 0) {
                jeterId = updatedMain[0].id;
            }
            
            if (jeterId) {
                const resJeter = this.partie.actionJeter(this.numero, jeterId);
                if (resJeter.ok) {
                    diffuserAnimation(this.salon, 'animationJeter', this.numero);
                    if (resJeter.mancheTerminee) {
                        gererFinManche(this.salon, resJeter);
                    } else {
                        diffuserEtatGlobal(this.salon);
                    }
                }
            }
        }, 1500 + Math.random() * 1000);
    }
}
`;

if (srv.includes("class BotJoueur {")) {
    // Regex replace from class BotJoueur { to the end of the class. 
    // Given the text, I'll just replace the whole old block
    // Wait, the safest is to split and replace
    const startIdx = srv.indexOf("class BotJoueur {");
    const nextFnIdx = srv.indexOf("function diffuserAlerte(salon, message)"); // Assuming there is a next function
    if (startIdx !== -1 && nextFnIdx !== -1) {
        const pre = srv.substring(0, startIdx);
        const post = srv.substring(nextFnIdx);
        srv = pre + newBot + "\n" + post;
    }
}

fs.writeFileSync('serveur.js', srv);
console.log("serveur.js logic patched (choisirSiege, quitter, bot)");
