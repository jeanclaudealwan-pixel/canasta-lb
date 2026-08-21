const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const { PartieCanasta } = require('./serveur-logique/jeu'); 

const app = express();
const serveur = http.createServer(app);
const io = new Server(serveur);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/favicon.ico', (req, res) => res.status(204).end());

let salons = {}; // Map of roomId -> room object
let prochainSalonId = 1;
let joueursDansSalons = {}; // { socketId: roomId }
let deconnexionsPendantPartie = {};
const profilsJoueurs = {}; // { token: { roomId, numero, timeout } }

function getSalonPourSocket(socketId) {
    const salonId = joueursDansSalons[socketId];
    return salonId ? salons[salonId] : null;
}


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
            
            const teamHasPure = Object.values(equipe.table).some(c => c.estCanasta && c.verrouilleePure);
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
                        diffuserChangementTour(this.salon, resJeter.prochainTour);
                        diffuserEtatGlobal(this.salon);
                        verifierTourBot(this.salon, resJeter.prochainTour);
                    }
                }
            }
        }, 1500 + Math.random() * 1000);
    }
}

function verifierTourBot(salon, numTour) { if (salon.bots && salon.bots[numTour]) { salon.bots[numTour].jouerTour(); } }

function diffuserAlerte(salon, message) {
    for (let sId in salon.joueurs) {
        if (!sId.startsWith('bot-')) io.to(sId).emit('alerteJeu', message);
    }
    for (let sId of salon.spectateurs) {
        io.to(sId).emit('alerteJeu', message);
    }
}

function gererFinManche(salon, resultat) {
    diffuserAlerte(salon, `Manche terminée ! Raison : ${resultat.recapManche.raison}`);
    diffuserEtatGlobal(salon); // Envoie l'état avec dernierRecapManche et enJeu=false
    
    if (!salon.partie.partieTerminee) {
        // Redémarrer automatiquement dans 10 secondes
        setTimeout(() => {
            if (salon && salon.partie && !salon.partie.enJeu) {
                salon.partie.demarrerNouvelleManche(salon.partie.prochainPremierJoueur);
                diffuserChangementTour(salon, salon.partie.tourActuel);
                verifierTourBot(salon, salon.partie.tourActuel);
                diffuserEtatGlobal(salon);
            }
        }, 12000); // 12 seconds de recap
    }
}

function diffuserChangementTour(salon, numTour) {
    for (let sId in salon.joueurs) {
        if (!sId.startsWith('bot-')) io.to(sId).emit('changementDeTour', numTour);
    }
    for (let sId of salon.spectateurs) {
        io.to(sId).emit('changementDeTour', numTour);
    }
}

function diffuserMessageGlobal(salon, message) {
    for (let sId in salon.joueurs) {
        if (!sId.startsWith('bot-')) io.to(sId).emit('messageGlobal', message);
    }
    for (let sId of salon.spectateurs) {
        io.to(sId).emit('messageGlobal', message);
    }
}

function diffuserEtatGlobal(salon) {
    if (!salon || !salon.partie) return;
    
    const nomsJoueurs = {};
    for (let sId in salon.joueurs) {
        let num = salon.joueurs[sId];
        let nom = sId.startsWith('bot-') ? 'Bot' : 'Joueur';
        let avatar = sId.startsWith('bot-') ? '🤖' : '👤';
        if (profilsJoueurs[sId]) {
            nom = profilsJoueurs[sId].pseudo || nom;
            avatar = profilsJoueurs[sId].avatar || avatar;
        }
        nomsJoueurs[num] = { pseudo: nom, avatar: avatar };
    }

    for (let idConnexion in salon.joueurs) {
        if (idConnexion.startsWith('bot-')) continue;
        let num = salon.joueurs[idConnexion];
        let etatJoueur = salon.partie.getEtatPourJoueur(num);
        etatJoueur.nomsJoueurs = nomsJoueurs;
        io.to(idConnexion).emit('miseAJourEtat', etatJoueur);
    }
    if (salon.spectateurs.size > 0) {
        let etatSpectateur = salon.partie.getEtatPourJoueur(1);
        etatSpectateur.maMain = [];
        etatSpectateur.monNumero = null;
        etatSpectateur.monEquipe = null;
        etatSpectateur.nomsJoueurs = nomsJoueurs;
        for (let spec of salon.spectateurs) {
            io.to(spec).emit('miseAJourEtat', etatSpectateur);
        }
    }
}

function getListeSalonsData() {
    return Object.values(salons).map(s => ({
        id: s.id,
        nom: s.nom,
        nbJoueurs: Object.keys(s.joueurs).length,
        enCours: s.enCours
    }));
}

function envoyerMiseAJourSalon(salon) {
    const joueursArray = [];
    for (let sId in salon.joueurs) {
        let nom = sId.startsWith('bot-') ? 'Bot' : 'Joueur';
        let avatar = sId.startsWith('bot-') ? '🤖' : '👤';
        if (profilsJoueurs[sId]) {
            nom = profilsJoueurs[sId].pseudo || nom;
            avatar = profilsJoueurs[sId].avatar || avatar;
        }
        joueursArray.push({
            numero: salon.joueurs[sId],
            nom: nom,
            avatar: avatar,
            estBot: sId.startsWith('bot-')
        });
    }
    const data = {
        id: salon.id,
        nom: salon.nom,
        joueurs: joueursArray,
        hote: salon.hote
    };
    for (let sId in salon.joueurs) {
        if (!sId.startsWith('bot-')) io.to(sId).emit('miseAJourSalon', data);
    }
    for (let sId of salon.spectateurs) {
        io.to(sId).emit('miseAJourSalon', data);
    }
}

function quitterLeSalon(socketId) {
    const salon = getSalonPourSocket(socketId);
    if (!salon) return;
    
    if (salon.spectateurs.has(socketId)) {
        salon.spectateurs.delete(socketId);
    } else if (salon.joueurs[socketId]) {
        let numeroLibere = salon.joueurs[socketId];
        
        if (salon.enCours) {
            // Remplacer par un Bot immédiatement
            delete salon.joueurs[socketId];
            const sIdBot = 'bot-' + Date.now() + Math.floor(Math.random()*1000);
            salon.joueurs[sIdBot] = numeroLibere;
            salon.bots = salon.bots || {};
            salon.bots[numeroLibere] = new BotJoueur(numeroLibere, salon, io);
            diffuserMessageGlobal(salon, `Le Joueur ${numeroLibere} a quitté et a été remplacé par un Bot.`);
            envoyerMiseAJourSalon(salon);
            diffuserEtatGlobal(salon);
            if (salon.partie.tourActuel === numeroLibere && !salon.partie.aJoueCeTour) {
                salon.bots[numeroLibere].jouerTour();
            }
        } else {
            salon.placesDisponibles.push(numeroLibere);
            salon.placesDisponibles.sort((a, b) => a - b);
            delete salon.joueurs[socketId];
            
            if (salon.hote === socketId) {
                let autresJoueurs = Object.keys(salon.joueurs).filter(id => !id.startsWith('bot-'));
                if (autresJoueurs.length > 0) {
                    salon.hote = autresJoueurs[0];
                } else {
                    delete salons[salon.id];
                    io.emit('listeSalons', getListeSalonsData());
                    delete joueursDansSalons[socketId];
                    return;
                }
            }
        }
    }
    
    delete joueursDansSalons[socketId];
    if (salons[salon.id]) envoyerMiseAJourSalon(salon);
    io.emit('listeSalons', getListeSalonsData());
}

io.on('connection', (socket) => {
    console.log(`Nouvelle connexion détectée : ${socket.id}`);
    
    socket.emit('listeSalons', getListeSalonsData());

    
    socket.on('setProfil', (data) => {
        profilsJoueurs[socket.id] = { pseudo: data.pseudo, avatar: data.avatar };
        const salon = getSalonPourSocket(socket.id);
        if (salon) {
            envoyerMiseAJourSalon(salon);
            diffuserEtatGlobal(salon);
        }
    });
    
    socket.on('listerSalons', () => {
        socket.emit('listeSalons', getListeSalonsData());
    });

    socket.on('creerSalon', (nomSalon) => {
        if (Object.keys(salons).length >= 20) {
            return socket.emit('salonErreur', 'Nombre maximum de salons atteint.');
        }
        if (joueursDansSalons[socket.id]) {
            quitterLeSalon(socket.id);
        }
        
        const salonId = 'salon_' + prochainSalonId++;
        const nom = nomSalon || `Salon #${prochainSalonId - 1}`;
        
        const nouveauSalon = {
            id: salonId,
            nom: nom,
            hote: socket.id,
            joueurs: {},
            spectateurs: new Set(),
            partie: null,
            bots: {},
            placesDisponibles: [1, 2, 3, 4],
            enCours: false
        };
        salons[salonId] = nouveauSalon;
        
        let numeroJoueur = nouveauSalon.placesDisponibles.shift();
        nouveauSalon.joueurs[socket.id] = numeroJoueur;
        joueursDansSalons[socket.id] = salonId;
        
        socket.emit('salonCree', {
            id: salonId,
            nom: nom,
            joueurs: [{ numero: numeroJoueur, nom: 'Joueur', estBot: false }],
            hote: socket.id
        });
        socket.emit('attributionSiege', numeroJoueur);
        
        io.emit('listeSalons', getListeSalonsData());
    });

    socket.on('rejoindreSalon', (salonId) => {
        const salon = salons[salonId];
        if (!salon) {
            return socket.emit('salonErreur', "Ce salon n'existe plus.");
        }
        if (joueursDansSalons[socket.id]) {
            quitterLeSalon(socket.id);
        }

        joueursDansSalons[socket.id] = salonId;

        if (salon.placesDisponibles.length > 0) {
            let numeroJoueur = salon.placesDisponibles.shift();
            salon.joueurs[socket.id] = numeroJoueur;
            
            socket.emit('attributionSiege', numeroJoueur);
            socket.emit('salonRejoins', {
                id: salon.id,
                nom: salon.nom,
                joueurs: Object.keys(salon.joueurs).map(sId => ({
                    numero: salon.joueurs[sId], nom: sId.startsWith('bot-') ? 'Bot' : 'Joueur', estBot: sId.startsWith('bot-')
                })),
                hote: salon.hote,
                monNumero: numeroJoueur
            });
            
            envoyerMiseAJourSalon(salon);
            io.emit('listeSalons', getListeSalonsData());
        } else {
            salon.spectateurs.add(socket.id);
            socket.emit('modeSpectateur');
            socket.emit('salonRejoins', {
                id: salon.id,
                nom: salon.nom,
                joueurs: Object.keys(salon.joueurs).map(sId => ({
                    numero: salon.joueurs[sId], nom: sId.startsWith('bot-') ? 'Bot' : 'Joueur', estBot: sId.startsWith('bot-')
                })),
                hote: salon.hote,
                monNumero: null
            });
            envoyerMiseAJourSalon(salon);
        }
    });

    socket.on('quitterSalon', () => {
        quitterLeSalon(socket.id);
        socket.emit('listeSalons', getListeSalonsData());
    });

    
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
        envoyerMiseAJourSalon(salon);
    });

    socket.on('ajouterBot', () => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon || salon.hote !== socket.id || salon.enCours) return;
        
        if (salon.placesDisponibles.length > 0) {
            let num = salon.placesDisponibles.shift();
            let botId = `bot-${num}-${Date.now()}`;
            salon.joueurs[botId] = num;
            
            envoyerMiseAJourSalon(salon);
            io.emit('listeSalons', getListeSalonsData());
        }
    });

    socket.on('demarrerPartie', () => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon || salon.hote !== socket.id || salon.enCours) return;

        while (salon.placesDisponibles.length > 0) {
            let num = salon.placesDisponibles.shift();
            let botId = `bot-${num}-${Date.now()}`;
            salon.joueurs[botId] = num;
        }

        salon.enCours = true;
        salon.partie = new PartieCanasta();
        
        for (let sId in salon.joueurs) {
            if (sId.startsWith('bot-')) {
                let num = salon.joueurs[sId];
                salon.bots[num] = new BotJoueur(num, salon, io);
            }
        }

        diffuserAlerte(salon, "La table est complète ! Distribution des cartes...");
        salon.partie.demarrerNouvellePartie();
        diffuserEtatGlobal(salon);
        diffuserChangementTour(salon, salon.partie.tourActuel);
        verifierTourBot(salon, salon.partie.tourActuel);
        
        envoyerMiseAJourSalon(salon);
        io.emit('listeSalons', getListeSalonsData());
    });

    // Game Events
    socket.on('demandeJouerCarte', (carteId) => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon || !salon.partie) return;
        let numeroJoueur = salon.joueurs[socket.id];
        if (!numeroJoueur) return;

        let resultat = salon.partie.actionJeter(numeroJoueur, carteId);
        
        if (resultat.ok) {
            diffuserAnimation(salon, 'animationJeter', numeroJoueur);
            if (resultat.mancheTerminee) {
                gererFinManche(salon, resultat);
            } else {
                diffuserChangementTour(salon, resultat.prochainTour);
                verifierTourBot(salon, resultat.prochainTour);
                diffuserEtatGlobal(salon);
            }
        } else {
            socket.emit('alerteJeu', resultat.erreur);
            socket.emit('miseAJourEtat', salon.partie.getEtatPourJoueur(numeroJoueur));
        }
    });

    socket.on('demandePiocher', () => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon || !salon.partie) return;
        let numeroJoueur = salon.joueurs[socket.id];
        if (!numeroJoueur) return;

        let resultat = salon.partie.actionPiocher(numeroJoueur);

        if (resultat.ok) {
            if (resultat.piocheEpuisee) {
                gererFinManche(salon, { recapManche: resultat.recapManche });
            } else {
                Object.keys(salon.joueurs).forEach(sId => {
                    if (!sId.startsWith('bot-')) io.to(sId).emit('animationPiocher', { joueur: numeroJoueur, nbCartes: resultat.cartesRecues.length, cartesRecues: (salon.joueurs[sId] === numeroJoueur) ? resultat.cartesRecues : null });
                });
                if (salon.spectateurs) {
                    salon.spectateurs.forEach(sId => {
                        io.to(sId).emit('animationPiocher', { joueur: numeroJoueur, nbCartes: resultat.cartesRecues.length });
                    });
                }
                diffuserEtatGlobal(salon);
            }
        } else {
            socket.emit('alerteJeu', resultat.erreur);
        }
    });

    socket.on('demandeRamasserTerre', (groupesOuverture) => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon || !salon.partie) return;
        let numeroJoueur = salon.joueurs[socket.id];
        if (!numeroJoueur) return;

        let resultat = salon.partie.actionRamasserTerre(numeroJoueur, groupesOuverture);

        if (resultat.ok) {
            diffuserAlerte(salon, `Le Joueur ${numeroJoueur} a ramassé la terre (+1 carte piochée) !`);
            diffuserEtatGlobal(salon);
        } else {
            socket.emit('alerteJeu', resultat.erreur);
        }
    });

    socket.on('demandeDescendreCombinaison', (groupesProposees) => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon || !salon.partie) return;
        let numeroJoueur = salon.joueurs[socket.id];
        if (!numeroJoueur) return;

        let resultat = salon.partie.actionDescendreCombinaisons(numeroJoueur, groupesProposees);
        if (resultat.ok) {
            diffuserAnimation(salon, 'animationDescendre', numeroJoueur);
            socket.emit('alerteJeu', "Combinaisons validées !");
            if (resultat.mancheTerminee) {
                envoyerMiseAJourSalon(salon);
                gererFinManche(salon, resultat);
            } else {
                diffuserEtatGlobal(salon);
            }
        } else {
            socket.emit('alerteJeu', resultat.erreur);
        }
    });

    socket.on('chatMessage', (msg) => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon) return;
        let nomExpediteur = "Spectateur";
        if (salon.joueurs[socket.id]) {
            nomExpediteur = `Joueur ${salon.joueurs[socket.id]}`;
        }
        
        const messageData = {
            expediteur: nomExpediteur,
            message: msg,
            time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
        };
        
        for (let sId in salon.joueurs) {
            if (!sId.startsWith('bot-')) io.to(sId).emit('nouveauMessage', messageData);
        }
        for (let sId of salon.spectateurs) {
            io.to(sId).emit('nouveauMessage', messageData);
        }
    });

    socket.on('envoyerEmoji', (emoji) => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon || !salon.enCours) return;
        let numeroJoueur = salon.joueurs[socket.id];
        if (!numeroJoueur) return;
        
        const data = { numeroJoueur, emoji };
        for (let sId in salon.joueurs) {
            if (!sId.startsWith('bot-')) io.to(sId).emit('recevoirEmoji', data);
        }
        for (let sId of salon.spectateurs) {
            io.to(sId).emit('recevoirEmoji', data);
        }
    });

    socket.on('demandeSortir', () => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon || !salon.partie) return;
        let numeroJoueur = salon.joueurs[socket.id];
        if (!numeroJoueur) return;

        let allie = salon.partie.demanderSortie(numeroJoueur);
        let idAllie = Object.keys(salon.joueurs).find(id => salon.joueurs[id] === allie);
        if (idAllie && !idAllie.startsWith('bot-')) {
            io.to(idAllie).emit('questionSortie', numeroJoueur);
        } else if (idAllie && idAllie.startsWith('bot-')) {
            socket.emit('resultatSortie', true); 
        }
    });

    socket.on('reponseSortie', (data) => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon || !salon.partie) return;
        let numeroJoueur = salon.joueurs[socket.id];
        if (!numeroJoueur) return;

        let demandeur = salon.partie.demanderSortie(numeroJoueur);
        let accepte = typeof data === 'object' ? data.accepte : !!data;
        if (!accepte) {
            salon.partie.sortieRefusee[demandeur] = true;
        }
        let idDemandeur = Object.keys(salon.joueurs).find(id => salon.joueurs[id] === demandeur);
        if (idDemandeur && !idDemandeur.startsWith('bot-')) {
            io.to(idDemandeur).emit('resultatSortie', { accepte });
        }
    });

    socket.on('demandeRafraichissement', () => {
        const salon = getSalonPourSocket(socket.id);
        if (salon && salon.partie) {
            let num = salon.joueurs[socket.id];
            if (num) {
                socket.emit('miseAJourEtat', salon.partie.getEtatPourJoueur(num));
            } else if (salon.spectateurs.has(socket.id)) {
                let etatSpectateur = salon.partie.getEtatPourJoueur(1);
                etatSpectateur.maMain = [];
                etatSpectateur.monNumero = null;
                etatSpectateur.monEquipe = null;
                socket.emit('miseAJourEtat', etatSpectateur);
            }
        }
    });

    socket.on('tentativeReconnexion', (token) => {
        if (deconnexionsPendantPartie[token]) {
            let data = deconnexionsPendantPartie[token];
            clearTimeout(data.timeout);
            
            const salon = salons[data.roomId];
            if (salon) {
                salon.joueurs[socket.id] = data.numero;
                joueursDansSalons[socket.id] = data.roomId;
                
                socket.emit('attributionSiege', data.numero);
                diffuserEtatGlobal(salon);
                socket.emit('alerteJeu', 'Reconnexion réussie !');
                envoyerMiseAJourSalon(salon);
            } else {
                socket.emit('alerteJeu', 'Le salon n\'existe plus.');
            }
            delete deconnexionsPendantPartie[token];
        } else if (joueursDansSalons[token]) {
            const roomId = joueursDansSalons[token];
            const salon = salons[roomId];
            if (salon && salon.joueurs[token]) {
                const numero = salon.joueurs[token];
                
                const oldSocket = io.sockets.sockets.get(token);
                if (oldSocket) oldSocket.disconnect(true);
                
                delete salon.joueurs[token];
                delete joueursDansSalons[token];
                
                salon.joueurs[socket.id] = numero;
                joueursDansSalons[socket.id] = roomId;
                
                socket.emit('attributionSiege', numero);
                diffuserEtatGlobal(salon);
                socket.emit('alerteJeu', 'Reconnexion réussie !');
                envoyerMiseAJourSalon(salon);
            } else {
                socket.emit('alerteJeu', 'Impossible de se reconnecter.');
            }
        } else {
            socket.emit('alerteJeu', 'Impossible de se reconnecter.');
        }
    });

    socket.on('disconnect', () => {
        console.log(`Déconnexion : ${socket.id}`);
        quitterLeSalon(socket.id);
    });
});

const PORT = process.env.PORT || 3000;
serveur.listen(PORT, () => {
    console.log(`Serveur Canasta démarré sur http://localhost:${PORT}`);
});
function diffuserAnimation(salon, nomAnimation, numJoueur) {
    if (!salon) return;
    for (let sId in salon.joueurs) {
        if (!sId.startsWith('bot-')) io.to(sId).emit(nomAnimation, numJoueur);
    }
    for (let sId of salon.spectateurs) {
        io.to(sId).emit(nomAnimation, numJoueur);
    }
}
