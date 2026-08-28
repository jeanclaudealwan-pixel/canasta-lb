const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const { PartieCanasta, calculerSeuilOuverture } = require('./serveur-logique/jeu');
const db = require('./serveur-logique/database'); 

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
    async jouerTour() { console.log("Bot jouerTour started for bot " + this.numero);
        try {
        // Délai initial avant toute action (réflexion du bot)
        await new Promise(r => setTimeout(r, 1200 + Math.random() * 800)); if (!this.partie || !this.partie.enJeu) return;
        
        const numero = this.numero;
        const partie = this.partie;
            let equipe = partie.equipes[partie.equipeDuJoueur(numero)];
            let main = partie.joueurs[numero].main;
            if (!equipe.aOuvert) {
                this.toursSansOuverture = (this.toursSansOuverture || 0) + 1;
            } else {
                this.toursSansOuverture = 0;
            }

            let ramasserOk = false;
            const topTerre = partie.defausse.length > 0 ? partie.defausse[partie.defausse.length - 1] : null;
            
            // 1. RAMASSER LA TERRE
            if (topTerre && !topTerre.estJoker && topTerre.valeur !== '2' && !topTerre.est3Noir) {
                const pileGelee = partie.defausse.some(c => c.estJoker || c.valeur === '2');
                const nbRequis = pileGelee ? 3 : 2;
                const naturals = main.filter(c => !c.estJoker && c.valeur === topTerre.valeur);
                
                if (naturals.length >= nbRequis) {
                    let wantsToPickUp = true;
                    if (equipe.aOuvert) {
                        // SCENARIO 3 : Ignorer les petites piles (<4) sauf si c'est très utile
                        if (partie.defausse.length <= 3) {
                            let meldLen = equipe.table[topTerre.valeur] ? equipe.table[topTerre.valeur].cartes.length : 0;
                            // S'il a beaucoup de cartes et que ça ne fait pas une canasta directe, il l'ignore
                            if (meldLen + naturals.length + 1 < 7 && main.length > 5) {
                                wantsToPickUp = false;
                            }
                        }
                        if (wantsToPickUp) {
                            const res = partie.actionRamasserTerre(numero, null);
                            if (res.ok) ramasserOk = true;
                        }
                    } else {
                        // Tenter d'ouvrir avec la terre (approche pure privilégiée)
                        let seuil = calculerSeuilOuverture(equipe.score);
                        let autoriserJoker = (this.toursSansOuverture >= 3 || seuil >= 90);
                        
                        let pointsTotal = 0;
                        const valMap = {};
                        for (const c of main) {
                            if (!c.estJoker && c.valeur !== '2' && !c.est3Noir && c.valeur !== '3 Rouge') {
                                valMap[c.valeur] = valMap[c.valeur] || [];
                                valMap[c.valeur].push(c);
                            }
                        }
                        valMap[topTerre.valeur] = valMap[topTerre.valeur] || [];
                        valMap[topTerre.valeur].push(topTerre);
                        
                        let wildcards = main.filter(c => c.estJoker || c.valeur === '2');
                        let wIdx = 0;
                        let groupesOuverture = [];
                        
                        for (let v in valMap) {
                            let cartesV = valMap[v];
                            if (cartesV.length >= 3) {
                                pointsTotal += cartesV.reduce((s, c) => s + c.points, 0);
                                groupesOuverture.push({ cartesId: cartesV.map(c => c.id) });
                            } else if (autoriserJoker && cartesV.length === 2 && wildcards.length > wIdx) {
                                const w = wildcards[wIdx++];
                                pointsTotal += cartesV[0].points + cartesV[1].points + w.points;
                                groupesOuverture.push({ cartesId: [cartesV[0].id, cartesV[1].id, w.id] });
                            }
                        }
                        
                        const topTerreUtilisee = groupesOuverture.some(g => g.cartesId.includes(topTerre.id));
                        if (topTerreUtilisee && pointsTotal >= seuil) {
                            const res = partie.actionRamasserTerre(numero, groupesOuverture);
                            if (res.ok) {
                                ramasserOk = true;
                                let cartesAjoutees = [];
                                groupesOuverture.forEach(g => {
                                    if (g.cartesId) cartesAjoutees.push(...g.cartesId);
                                });
                                if (cartesAjoutees.length > 0) {
                                    diffuserAnimation(this.salon, "animationDescendre", { numeroJoueur: numero, cartesAjoutees: cartesAjoutees });
                                }
                            }
                        }
                    }
                }
            }
            
            if (ramasserOk) {
                diffuserEtatGlobal(this.salon);
            } else {
                // 2. PIOCHER
                const resPiocher = partie.actionPiocher(numero);
                if (resPiocher.ok) {
                    if (resPiocher.piocheEpuisee) {
                        gererFinManche(this.salon, { recapManche: resPiocher.recapManche });
                        return;
                    }
                    Object.keys(this.salon.joueurs).forEach(sId => {
                        if (!sId.startsWith('bot-')) this.io.to(sId).emit('animationPiocher', { joueur: numero, nbCartes: resPiocher.cartesRecues.length, cartesRecues: null });
                    });
                    diffuserEtatGlobal(this.salon);
                }
            }
            
            // Recharger l'état de la main et de l'équipe après pioche/ramassage
            main = partie.joueurs[numero].main;
            equipe = partie.equipes[partie.equipeDuJoueur(numero)];
            
            const nextNum = (numero % 4) + 1;
            const nextEquipeNum = partie.equipeDuJoueur(nextNum);
            const nextEquipe = partie.equipes[nextEquipeNum];
            
            // 3. DESCENDRE COMBINAISONS
            let groupesDescendre = [];
            
            if (!equipe.aOuvert) {
                // Tenter d'ouvrir de sa main
                let seuil = calculerSeuilOuverture(equipe.score);
                let autoriserJoker = (this.toursSansOuverture >= 3 || seuil >= 90);
                
                let pointsTotal = 0;
                const valMap = {};
                for (const c of main) {
                    if (!c.estJoker && c.valeur !== '2' && !c.est3Noir && c.valeur !== '3 Rouge') {
                        valMap[c.valeur] = valMap[c.valeur] || [];
                        valMap[c.valeur].push(c);
                    }
                }
                let wildcards = main.filter(c => c.estJoker || c.valeur === '2');
                let wIdx = 0;
                let potentiels = [];
                for (let v in valMap) {
                    let cartesV = valMap[v];
                    if (cartesV.length >= 3) {
                        pointsTotal += cartesV.reduce((s, c) => s + c.points, 0);
                        potentiels.push({ cartesId: cartesV.map(c => c.id) });
                    } else if (autoriserJoker && cartesV.length === 2 && wildcards.length > wIdx) {
                        const w = wildcards[wIdx++];
                        pointsTotal += cartesV[0].points + cartesV[1].points + w.points;
                        potentiels.push({ cartesId: [cartesV[0].id, cartesV[1].id, w.id] });
                    }
                }
                if (pointsTotal >= seuil) {
                    groupesDescendre = potentiels;
                }
            } else {
                // Ajouter aux combinaisons existantes ou créer de nouvelles
                const valMap = {};
                let wildcards = main.filter(c => c.estJoker || c.valeur === '2');
                let wIdx = 0;
                
                for (const c of main) {
                    if (!c.estJoker && c.valeur !== '2' && !c.est3Noir && c.valeur !== '3 Rouge') {
                        valMap[c.valeur] = valMap[c.valeur] || [];
                        valMap[c.valeur].push(c);
                    }
                }
                
                for (let v in valMap) {
                    let cartesV = valMap[v];
                    let existingCombo = null;
                    let cleUnique = null;
                    
                    // Chercher une combinaison existante
                    for (const [key, combo] of Object.entries(equipe.table)) {
                        if (combo.valeur === v && !combo.estCanasta) {
                            existingCombo = combo; cleUnique = key; break;
                        }
                    }
                    if (!existingCombo) {
                        for (const [key, combo] of Object.entries(equipe.table)) {
                            if (combo.valeur === v) {
                                existingCombo = combo; cleUnique = key; break;
                            }
                        }
                    }
                    
                    if (existingCombo) {
                        // Ajout de cartes naturelles
                        if (cartesV.length > 0) {
                            groupesDescendre.push({ valeur: cleUnique, cartesId: cartesV.map(c => c.id) });
                        }
                    } else {
                        // Nouveau groupe : On ne crée que des groupes purs de 3+ cartes !
                        // On ne gaspille plus de Joker pour faire un groupe de 3 si on a déjà ouvert.
                        if (cartesV.length >= 3) {
                            groupesDescendre.push({ cartesId: cartesV.map(c => c.id) });
                        }
                    }
                }
                
                // SCENARIO 1 : Gestion stratégique des jokers (Canastas Noires)
                for (const [key, combo] of Object.entries(equipe.table)) {
                    if (combo.cartes.length >= 7) continue; 
                    
                    let cartesEquipe = combo.cartes.filter(c => !c.estJoker && c.valeur !== '2').length;
                    let cartesAdversaire = 0;
                    for (const oppCombo of Object.values(nextEquipe.table)) {
                        if (oppCombo.valeur === combo.valeur) {
                            cartesAdversaire = oppCombo.cartes.filter(c => !c.estJoker && c.valeur !== '2').length;
                            break;
                        }
                    }
                    
                    let cartesManquantes = 7 - combo.cartes.length;
                    let canMakeCanastaInstantly = (wildcards.length - wIdx) >= cartesManquantes;
                    // Si l'adversaire a déjà 5 cartes naturelles, il n'en reste que 7 dans le jeu (qui a 3 paquets de 4 = 12 cartes).
                    // Faire une canasta pure devient quasiment impossible.
                    let pureIsImpossible = (cartesAdversaire >= 5); 
                    
                    if (canMakeCanastaInstantly || pureIsImpossible) {
                        let nbWilds = combo.cartes.filter(c => c.estJoker || c.valeur === '2').length;
                        while (wIdx < wildcards.length && nbWilds < 3) {
                            const w = wildcards[wIdx++];
                            let gAjout = groupesDescendre.find(g => g.valeur === key);
                            if (!gAjout) {
                                gAjout = { valeur: key, cartesId: [] };
                                groupesDescendre.push(gAjout);
                            }
                            gAjout.cartesId.push(w.id);
                            nbWilds++;
                            
                            let totalNow = combo.cartes.length + gAjout.cartesId.length;
                            if (totalNow >= 7) break;
                        }
                    }
                }
            }
            
            // SCENARIO 4 : VÉRIFICATION SORTIE + TEMPORISATION
            let teamHasPure = false;
            let teamHasImpure = false;
            for (const combo of Object.values(equipe.table)) {
                if (combo.cartes.length >= 7) {
                    const estPure = combo.cartes.every(c => !c.estJoker && (combo.valeur === '2' || c.valeur !== '2'));
                    if (estPure) teamHasPure = true;
                    else teamHasImpure = true;
                }
            }
            let canGoOut = teamHasPure && teamHasImpure;
            
            const partenaireNum = equipe.membres.find(m => m !== numero);
            const partenaireCartes = partie.joueurs[partenaireNum].main.length;
            
            if (canGoOut && partenaireCartes >= 5) {
                canGoOut = false; // On temporise pour aider le partenaire
            }
            
            if (!canGoOut) {
                let currentUsed = 0;
                let finalGroupes = [];
                for (let g of groupesDescendre) {
                    const cLen = g.cartesId.length;
                    if (main.length - (currentUsed + cLen) >= 2) {
                        finalGroupes.push(g);
                        currentUsed += cLen;
                    } else {
                        if (g.valeur) {
                            const maxAllowed = main.length - currentUsed - 2;
                            if (maxAllowed > 0) {
                                finalGroupes.push({ valeur: g.valeur, cartesId: g.cartesId.slice(0, maxAllowed) });
                                currentUsed += maxAllowed;
                            }
                        }
                        break; 
                    }
                }
                groupesDescendre = finalGroupes;
            }

            if (groupesDescendre.length > 0) {
                let cartesAjoutees = [];
                groupesDescendre.forEach(g => {
                    if (g.cartesId) cartesAjoutees.push(...g.cartesId);
                });

                // Délai avant de descendre ses combinaisons pour que le joueur puisse suivre l'action
                await new Promise(r => setTimeout(r, 1000 + Math.random() * 500));
                
                const resDescendre = partie.actionDescendreCombinaisons(numero, groupesDescendre);
                if (resDescendre.ok) {
                    diffuserAnimation(this.salon, "animationDescendre", { numeroJoueur: numero, cartesAjoutees: cartesAjoutees }); 
                    diffuserEtatGlobal(this.salon); 
                    if (resDescendre.mancheTerminee) {
                        gererFinManche(this.salon, { recapManche: resDescendre.recapManche });
                        return;
                    }
                }
            }
            
            main = partie.joueurs[numero].main;
            
            console.log("Bot " + this.numero + " JETER"); // 4. JETER (Défensif, Geler la terre)
            const nextMelds = Object.values(nextEquipe.table).map(m => m.valeur);
            const lastDiscardedByNext = partie.dernieresCartesJetees ? partie.dernieresCartesJetees[nextNum] : null;
            
            let jeterId = null;
            const black3s = main.filter(c => c.est3Noir);
            
            // SCENARIO 2 : Analyse de la défausse pour voir si on doit geler
            let oppWantsPile = false;
            if (partie.defausse.length >= 4) { // Terre volumineuse
                for (let card of partie.defausse) {
                    if (!card.estJoker && card.valeur !== '2' && card.valeur !== '3') {
                        if (nextMelds.includes(card.valeur)) {
                            oppWantsPile = true; break;
                        }
                    }
                }
            }
            
            // Cartes spéciales (Jokers/2) non utilisées dans la descente
            const usedInDescend = new Set();
            groupesDescendre.forEach(g => g.cartesId.forEach(id => usedInDescend.add(id)));
            const freeWildcards = main.filter(c => (c.estJoker || c.valeur === '2') && !usedInDescend.has(c.id));

            if (oppWantsPile && freeWildcards.length > 0) {
                // SCENARIO 2 : On gèle la terre car elle est très dangereuse
                jeterId = freeWildcards[0].id;
            } else if (black3s.length > 0) {
                jeterId = black3s[0].id; // Toujours jeter les 3 noirs (très défensif classique)
            } else {
                const normales = main.filter(c => !c.estJoker && c.valeur !== '2' && c.valeur !== '3 Rouge');
                if (normales.length > 0) {
                    normales.sort((a,b) => a.points - b.points); 
                    
                    const safeDiscards = normales.filter(c => nextMelds.includes(c.valeur) || c.valeur === lastDiscardedByNext);
                    
                    if (safeDiscards.length > 0) {
                        jeterId = safeDiscards[0].id;
                    } else {
                        jeterId = normales[0].id; // Tant pis, on jette la plus petite
                    }
                } else if (main.length > 0) {
                    jeterId = main[0].id;
                }
             if (jeterId) {
                // Délai avant de jeter la carte (fin du tour)
                await new Promise(r => setTimeout(r, 1000 + Math.random() * 500));
                
                 let resJeter = partie.actionJeter(numero, jeterId); 
                if (!resJeter.ok) {
                    // Fallback absolu
                    for (let c of main) {
                        resJeter = partie.actionJeter(numero, c.id);
                        if (resJeter.ok) { jeterId = c.id; break; }
                    }
                }

                if (resJeter.ok) {
                    diffuserAnimation(this.salon, 'animationJeter', numero);
                    if (resJeter.mancheTerminee) {
                        gererFinManche(this.salon, resJeter);
                    } else {
                        diffuserChangementTour(this.salon, resJeter.prochainTour);
                        diffuserEtatGlobal(this.salon);
                        verifierTourBot(this.salon, resJeter.prochainTour);
                    }
                    return; // Succès, on quitte la fonction
                }
            }
            
            // ANTI-BLOCAGE : Si le bot arrive ici, c'est qu'il n'a pas pu jeter (ex: il lui reste 1 carte mais son équipe ne peut pas sortir)
            console.log("CRITICAL: Bot " + this.numero + " bloqué ! Impossible de jeter. Passage forcé au tour suivant.");
            partie.aJoueCeTour = false; // Réinitialise l'état du joueur pour le prochain tour
            const prochain = (numero % 4) + 1;
            partie.tourActuel = prochain;
            diffuserChangementTour(this.salon, prochain);
            diffuserEtatGlobal(this.salon);
            verifierTourBot(this.salon, prochain);

        } catch (err) { 
            console.error("BOT ERROR: ", err); 
            // ANTI-BLOCAGE EXTRÊME : Si une erreur JS inattendue se produit, on force le changement de tour
            if (this.partie) {
                this.partie.aJoueCeTour = false;
                const prochain = (this.numero % 4) + 1;
                this.partie.tourActuel = prochain;
                diffuserChangementTour(this.salon, prochain);
                diffuserEtatGlobal(this.salon);
                verifierTourBot(this.salon, prochain);
            }
        }
        // Fin du tour du bot      // Fin du tour du bot
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

    // Si la partie entière est terminée, mettre à jour la BDD
    if (salon.partie && salon.partie.partieTerminee) {
        let vainqueur = salon.partie.vainqueur;
        for (let sId in salon.joueurs) {
            if (!sId.startsWith('bot-') && profilsJoueurs[sId] && profilsJoueurs[sId].dbId) {
                let eq = salon.partie.joueurs[salon.joueurs[sId]].equipe;
                let isWin = (eq === vainqueur);
                let score = salon.partie.equipes[eq].score;
                db.updateUserStats(profilsJoueurs[sId].dbId, isWin, score);
            }
        }
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

    const couleursJoueurs = { 1: '#3fa0e0', 2: '#e6483f', 3: '#f2c516', 4: '#4ade80' };

    for (let idConnexion in salon.joueurs) {
        if (idConnexion.startsWith('bot-')) continue;
        let num = salon.joueurs[idConnexion];
        let etatJoueur = salon.partie.getEtatPourJoueur(num);
        etatJoueur.nomsJoueurs = nomsJoueurs;
        etatJoueur.couleursJoueurs = couleursJoueurs;
        etatJoueur.hote = salon.hote;
        io.to(idConnexion).emit('miseAJourEtat', etatJoueur);
    }
    if (salon.spectateurs.size > 0) {
        let etatSpectateur = salon.partie.getEtatPourJoueur(1);
        etatSpectateur.maMain = [];
        etatSpectateur.monNumero = null;
        etatSpectateur.monEquipe = null;
        etatSpectateur.nomsJoueurs = nomsJoueurs;
        etatSpectateur.couleursJoueurs = couleursJoueurs;
        etatSpectateur.hote = salon.hote;
        for (let spec of salon.spectateurs) {
            io.to(spec).emit('miseAJourEtat', etatSpectateur);
        }
    }
}

function getListeSalonsData() {
    return Object.values(salons)
        .filter(s => !s.id.startsWith('solo_'))
        .map(s => ({
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
        profilsJoueurs[socket.id] = { pseudo: data.pseudo, avatar: data.avatar, dbId: data.dbId || null };
        const salon = getSalonPourSocket(socket.id);
        if (salon) {
            envoyerMiseAJourSalon(salon);
            diffuserEtatGlobal(salon);
        }
    });

    socket.on('auth:register', (data) => {
        db.registerUser(data.username, data.password, data.avatar || '👤', (res) => {
            if (res.error) socket.emit('auth:error', res.error);
            else socket.emit('auth:success', res);
        });
    });

    socket.on('auth:login', (data) => {
        db.loginUser(data.username, data.password, (res) => {
            if (res.error) socket.emit('auth:error', res.error);
            else socket.emit('auth:success', res);
        });
    });

    socket.on('auth:guest', (data) => {
        const guestName = "Invité_" + Math.floor(Math.random() * 10000);
        socket.emit('auth:success', { success: true, userId: null, username: guestName, avatar: '👤', stats: { jouees: 0, gagnees: 0, meilleurScore: 0 } });
    });
    
    socket.on('listerSalons', () => {
        socket.emit('listeSalons', getListeSalonsData());
    });

    socket.on('getLeaderboard', () => {
        db.getLeaderboard((rows) => {
            socket.emit('leaderboardData', rows);
        });
    });

    socket.on('demandePartieTuto', () => {
        quitterLeSalon(socket.id);
        const nomSalon = "Tutoriel";
        const idSalon = 'tuto_' + socket.id;
        
        salons[idSalon] = {
            id: idSalon,
            nom: nomSalon,
            hote: socket.id,
            joueurs: {},
            placesDisponibles: [2, 3, 4],
            enCours: false,
            partie: null,
            bots: {},
            spectateurs: new Set(),
            messages: []
        };
        
        const salon = salons[idSalon];
        salon.joueurs[socket.id] = 1;
        joueursDansSalons[socket.id] = idSalon;
        
        salon.enCours = true;
        salon.partie = new PartieCanasta();

        while (salon.placesDisponibles.length > 0) {
            let num = salon.placesDisponibles.shift();
            let botId = 'bot-' + num + '-' + Date.now();
            salon.joueurs[botId] = num;
            salon.bots[num] = new BotJoueur(num, salon, io);
        }
        salon.partie.demarrerNouvellePartie();
        
        // Rig the hand for Player 1: Give them 3 Kings so they can lock a group
        let mainJ1 = salon.partie.joueurs[1].main;
        mainJ1.splice(0, 6); // Remove 6 random cards
        mainJ1.push({id: 'R_Coeur_Tuto', valeur: 'R', enseigne: 'Coeur', points: 10, type: 'naturelle'});
        mainJ1.push({id: 'R_Pique_Tuto', valeur: 'R', enseigne: 'Pique', points: 10, type: 'naturelle'});
        mainJ1.push({id: 'R_Carreau_Tuto', valeur: 'R', enseigne: 'Carreau', points: 10, type: 'naturelle'});
        mainJ1.push({id: 'A_Coeur_Tuto', valeur: 'A', enseigne: 'Coeur', points: 20, type: 'naturelle'});
        mainJ1.push({id: 'A_Pique_Tuto', valeur: 'A', enseigne: 'Pique', points: 20, type: 'naturelle'});
        mainJ1.push({id: 'A_Carreau_Tuto', valeur: 'A', enseigne: 'Carreau', points: 20, type: 'naturelle'});
        
        socket.emit('lancementJeu', salon.id);
        socket.join(salon.id);
        
        setTimeout(() => {
            diffuserEtatGlobal(salon);
            diffuserChangementTour(salon, salon.partie.tourActuel);
            verifierTourBot(salon, salon.partie.tourActuel);
        }, 500);
    });

    socket.on('demandePartieSolo', () => {
        quitterLeSalon(socket.id);
        const nomSalon = "Partie Solo";
        const idSalon = 'solo_' + socket.id;
        
        salons[idSalon] = {
            id: idSalon,
            nom: nomSalon,
            hote: socket.id,
            joueurs: {},
            placesDisponibles: [2, 3, 4],
            enCours: false,
            partie: null,
            bots: {},
            spectateurs: new Set(),
            messages: []
        };
        
        const salon = salons[idSalon];
        salon.joueurs[socket.id] = 1;
        joueursDansSalons[socket.id] = idSalon;
        
        // Ajouter les bots instantanément
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

        salon.partie.demarrerNouvellePartie();
        
        socket.emit('lancementJeu', salon.id);
        socket.join(salon.id);
        
        setTimeout(() => {
            diffuserEtatGlobal(salon);
            diffuserChangementTour(salon, salon.partie.tourActuel);
            verifierTourBot(salon, salon.partie.tourActuel);
        }, 500); // Petite pause pour s'assurer que le client a switché d'écran
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

    socket.on('demandeNouvelleManche', () => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon || salon.hote !== socket.id || !salon.partie || salon.partie.enJeu || salon.partie.partieTerminee) return;
        
        salon.partie.demarrerNouvelleManche(salon.partie.prochainPremierJoueur);
        diffuserChangementTour(salon, salon.partie.tourActuel);
        verifierTourBot(salon, salon.partie.tourActuel);
        diffuserEtatGlobal(salon);
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

    
    socket.on('demandeTricheTutoRamasser', () => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon || !salon.partie) return;
        let p = salon.partie;
        if (p.defausse.length > 0) {
            let topCard = p.defausse[p.defausse.length - 1];
            if (topCard.estJoker || topCard.est3Noir || topCard.est3Rouge || topCard.valeur === '2') {
                topCard.valeur = '9';
                topCard.couleur = 'Coeur';
                topCard.points = 10;
                topCard.estJoker = false;
                topCard.est3Noir = false;
                topCard.est3Rouge = false;
                topCard.estWildcardGenerique = false;
            }
            let main = p.joueurs[1].main;
            main.push({ id: 'triche_1_' + Date.now(), valeur: topCard.valeur, couleur: topCard.couleur, points: topCard.points });
            main.push({ id: 'triche_2_' + Date.now() + 'x', valeur: topCard.valeur, couleur: topCard.couleur, points: topCard.points });
            diffuserEtatGlobal(salon);
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

    socket.on('demandeRamasserTerre', (...args) => {
        try {
            let groupesOuverture = args.length > 0 && Array.isArray(args[0]) ? args[0] : args;
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
        } catch (err) {
            console.error("Erreur demandeRamasserTerre:", err);
            socket.emit('alerteJeu', "Erreur interne lors du ramassage de la terre.");
        }
    });

    socket.on('demandeDescendreCombinaison', (...args) => {
        try {
            let groupesProposees = args.length > 0 && Array.isArray(args[0]) ? args[0] : args;
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
        } catch (err) {
            console.error("Erreur demandeDescendreCombinaison:", err);
            socket.emit('alerteJeu', "Erreur interne lors de la descente des combinaisons.");
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
                if (salon.hote === token) {
                    salon.hote = socket.id;
                }
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
                
                if (salon.hote === token) {
                    salon.hote = socket.id;
                }

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
