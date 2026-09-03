// =============================================================================
// CANASTA LIBANAISE — CLIENT JS (PURE CSS CARDS - PREMIUM LAYOUT)
// =============================================================================

class GestionnaireSons {
    constructor() {
        this.ctx = null;
        this.sons = {};
        this.verrouInit = false;
        
        const frequences = {
            'carte': [400, 0.05, 'sine'],
            'piocher': [500, 0.1, 'sine'],
            'jeter': [300, 0.1, 'triangle'],
            'select': [800, 0.05, 'sine'],
            'erreur': [150, 0.3, 'sawtooth'],
            'succes': [600, 0.2, 'sine'],
            'victoire': [440, 0.5, 'square']
        };
        this.frequences = frequences;

        const declencherInit = () => {
            this.init();
            document.removeEventListener('click', declencherInit);
            document.removeEventListener('touchstart', declencherInit);
        };
        document.addEventListener('click', declencherInit);
        document.addEventListener('touchstart', declencherInit);
    }

    init() {
        if (this.ctx || this.verrouInit) return;
        this.verrouInit = true;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn("AudioContext non supporté.");
        }
    }

    jouer(nom) {
        if (!this.ctx || this.ctx.state !== 'running') return;
        const config = this.frequences[nom] || this.frequences['carte'];
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = config[2];
        osc.frequency.setValueAtTime(config[0], this.ctx.currentTime);
        if (nom === 'victoire') {
            osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.3);
            osc.frequency.exponentialRampToValueAtTime(1100, this.ctx.currentTime + 0.5);
        } else if (nom === 'succes') {
            osc.frequency.setValueAtTime(600, this.ctx.currentTime);
            osc.frequency.setValueAtTime(800, this.ctx.currentTime + 0.1);
        } else if (nom === 'erreur') {
            osc.frequency.linearRampToValueAtTime(100, this.ctx.currentTime + config[1]);
        }
        
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + config[1]);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + config[1]);
    }
}

const sons = new GestionnaireSons();
const socket = io();
window.socket = socket;

// =============================================================================
// ÉTAT GLOBAL
// =============================================================================
let ecranActuel = 'lobby'; // lobby | salon | jeu
let monNumero = 1; // 1, 2, 3 ou 4
let estSpectateur = false;
let cartesRecemmentPiochees = new Set();
let cartesSelectionnees = new Set();
let terreSelectionnee = false;
let groupesPrepares = []; // Tableau d'objets { cartesId: [], cartes: [] }
let groupesVerrouillesLocaux = []; // Tableau d'objets { cartesId: [] }
let etatGlobal = null;
let localHandOrder = []; // Stores card IDs in user-sorted order

// Mécanique de double tap
let dernierTap = {};
const DOUBLE_TAP_MS = 300;
let verrouAction = false;

// =============================================================================
// UTILITAIRES UI
// =============================================================================
function afficherEcran(idEcran) {
    const screens = ['login', 'menu-principal', 'lobby', 'salon', 'jeu'];
    screens.forEach(s => {
        const el = document.getElementById(`ecran-${s}`);
        if (el) el.style.display = 'none';
    });
    const target = document.getElementById(`ecran-${idEcran}`);
    if (target) target.style.display = 'flex';
    ecranActuel = idEcran;
    
    if (idEcran === 'jeu' && screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(e => console.log('Orientation lock not supported', e));
    }
    
    // Vérifier si le joueur a une partie en cours qu'il peut reprendre
    if (idEcran === 'menu-principal' || idEcran === 'lobby') {
        if (typeof socket !== 'undefined' && socket) {
            socket.emit('verifierReconnexion');
        }
    }
}

function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

// =============================================================================
// RÉSEAU : ÉCRANS LOBBY & SALON
// =============================================================================
document.getElementById('btn-creer-salon').addEventListener('click', () => {
    const nom = document.getElementById('input-nom-salon').value.trim();
    socket.emit('creerSalon', nom);
});

socket.on('listeSalons', (salons) => {
    const liste = document.getElementById('liste-salons');
    liste.innerHTML = '';
    if (salons.length === 0) {
        liste.innerHTML = '<p class="texte-vide">Aucun salon disponible. Créez-en un !</p>';
        return;
    }
    salons.forEach(s => {
        const div = document.createElement('div');
        div.className = 'salon-item';
        div.innerHTML = `
            <div><strong>${s.nom}</strong> (${s.nbJoueurs}/4)</div>
            <button class="btn btn-blue" ${s.nbJoueurs >= 4 || s.enCours ? 'disabled' : ''}>Rejoindre</button>
        `;
        div.querySelector('button').addEventListener('click', () => socket.emit('rejoindreSalon', s.id));
        liste.appendChild(div);
    });
});

socket.on('salonCree', (donnees) => rejoindreInterfaceSalon(donnees));
socket.on('salonRejoins', (donnees) => rejoindreInterfaceSalon(donnees));

function rejoindreInterfaceSalon(donnees) {
    afficherEcran('salon');
    document.getElementById('titre-salon').textContent = donnees.nom;
    estSpectateur = donnees.monNumero === null;
    mettreAJourSieges(donnees.joueurs, donnees.hote);
}

socket.on('miseAJourSalon', (donnees) => {
    if (ecranActuel === 'salon') {
        mettreAJourSieges(donnees.joueurs, donnees.hote);
    }
});

function mettreAJourSieges(joueurs, hote) {
    const grille = document.getElementById('grille-sieges');
    grille.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:10px; height: 100%;">
            <div style="flex:1; background:rgba(255,255,255,0.05); padding:8px; border-radius:10px; text-align:center; display:flex; flex-direction:column;">
                <h4 style="margin-bottom:6px; font-size:13px; font-weight:800; color:var(--blue);">ÉQUIPE NOUS</h4>
                <div id="col-nous" style="display:flex; flex-direction:column; gap:6px; flex:1; justify-content:center;"></div>
            </div>
            <div style="flex:1; background:rgba(255,255,255,0.05); padding:8px; border-radius:10px; text-align:center; display:flex; flex-direction:column;">
                <h4 style="margin-bottom:6px; font-size:13px; font-weight:800; color:var(--red);">ÉQUIPE EUX</h4>
                <div id="col-eux" style="display:flex; flex-direction:column; gap:6px; flex:1; justify-content:center;"></div>
            </div>
        </div>
    `;
    const colNous = grille.querySelector('#col-nous');
    const colEux = grille.querySelector('#col-eux');
    
    const mapJoueurs = {};
    joueurs.forEach(j => mapJoueurs[j.numero] = j);

    for (let i = 1; i <= 4; i++) {
        const div = document.createElement('div');
        div.className = 'siege';
        const isNous = (i === 1 || i === 3);
        if (mapJoueurs[i]) {
            const j = mapJoueurs[i];
            div.classList.add('occupe');
            div.innerHTML = `<strong>Siège ${i}</strong>
                <span style="font-size:20px; line-height:1; margin:2px 0;">${j.avatar || (j.estBot ? '🤖' : '👤')}</span>
                <span style="font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:100%; display:block;">${j.nom}</span>
            `;
        } else {
            div.style.cursor = 'pointer';
            div.innerHTML = `<strong>Siège ${i}</strong><span style="color:#777; font-size:10px; margin-top:2px;">S'asseoir</span>`;
            div.addEventListener('click', () => socket.emit('choisirSiege', i));
        }
        
        if (isNous) colNous.appendChild(div);
        else colEux.appendChild(div);
    }

    const estHote = socket.id === hote;
    window.idHoteActuel = hote;
    document.getElementById('btn-demarrer').style.display = estHote ? 'block' : 'none';
    document.getElementById('btn-ajouter-bot').style.display = estHote ? 'block' : 'none';
}

document.getElementById('btn-ajouter-bot').addEventListener('click', () => socket.emit('ajouterBot'));
document.getElementById('btn-demarrer').addEventListener('click', () => socket.emit('demarrerPartie'));
document.getElementById('btn-quitter-salon').addEventListener('click', () => {
    socket.emit('quitterSalon');
    afficherEcran('lobby');
    socket.emit('listerSalons');
});

socket.on('salonErreur', (msg) => toast(msg, 'error'));
socket.on('alerteJeu', (msg) => { 
    toast(msg, msg.includes('Erreur') || msg.includes('Impossible') || msg.includes('invalide') ? 'error' : 'info'); 
    sons.jouer('erreur'); 
    
    // Check if this is a failed opening
    if (msg.includes("droit d'ouvrir")) {
        modeErreurPreparation = true;
        mettreAJourBoutons();
    }
});

socket.on('messageGlobal', (msg) => toast(msg, 'info'));

// Chat events
document.getElementById('btn-envoyer-chat').addEventListener('click', () => {
    const input = document.getElementById('input-chat');
    if (input.value.trim()) {
        socket.emit('chatMessage', input.value.trim());
        input.value = '';
    }
});
document.getElementById('input-chat').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-envoyer-chat').click();
});
socket.on('nouveauMessage', (data) => {
    const container = document.getElementById('chat-messages');
    const el = document.createElement('div');
    el.className = 'chat-message';
    el.innerHTML = `<span class="sender">${data.expediteur}</span>: ${data.message} <span class="time">${data.time}</span>`;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
});

// Emoji events
const btnEmoji = document.getElementById('btn-emoji'); if(btnEmoji) btnEmoji.addEventListener('click', () => {
    const panel = document.getElementById('panneau-emojis');
    panel.style.display = panel.style.display === 'none' ? 'grid' : 'none';
});
document.querySelectorAll('.emoji-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
        socket.emit('envoyerEmoji', e.target.textContent);
        document.getElementById('panneau-emojis').style.display = 'none';
    });
});
socket.on('recevoirEmoji', (data) => {
    // Show floating emoji from the player's seat position
    const positions = {
        'adv-haut': { top: '10%', left: '50%' },
        'adv-gauche': { top: '32%', left: '10%' },
        'adv-droite': { top: '32%', right: '10%' },
        'zone-main': { bottom: '20%', left: '50%' }
    };
    
    let positionStr = positions['adv-haut']; // default
    if (etatGlobal) {
        if (data.numeroJoueur === monNumero) positionStr = positions['zone-main'];
        else {
            const gauche = (monNumero % 4) + 1;
            const droite = ((monNumero + 2) % 4) + 1;
            if (data.numeroJoueur === gauche) positionStr = positions['adv-gauche'];
            if (data.numeroJoueur === droite) positionStr = positions['adv-droite'];
        }
    }
    
    const floatEl = document.createElement('div');
    floatEl.className = 'emoji-flottant';
    floatEl.textContent = data.emoji;
    Object.assign(floatEl.style, positionStr);
    
    document.getElementById('ecran-jeu').appendChild(floatEl);
    setTimeout(() => floatEl.remove(), 2000);
});



// =============================================================================
// JEU : ACTIONS DE BOUTONS
// =============================================================================

// Force text onto buttons in case index.html is cached with old emojis
window.addEventListener('DOMContentLoaded', () => {
    const btnSortir = document.getElementById('btn-sortir');
    const btnPoser = document.getElementById('btn-poser');
    if (btnSortir) btnSortir.textContent = 'DEMANDER';
    if (btnPoser) btnPoser.textContent = 'POSER';
    window.addEventListener('resize', applyDynamicOverlap);
});

document.getElementById('btn-sortir').addEventListener('click', () => {
    socket.emit('demandeSortir');
});

function autoGroupCartes(ids, extraCard = null) {
    let selected = ids.map(id => etatGlobal.maMain.find(c => c.id === id)).filter(Boolean);
    if (extraCard) selected.push(extraCard);
    
    // NOUVEAU : on trie toujours les cartes par valeur pour que les cartes identiques 
    // (ex: les 10 de la main et le 10 de la terre) soient toujours côte à côte, 
    // peu importe l'ordre dans lequel le joueur a cliqué.
    const ordreVal = { '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, '10': 8, 'V': 9, 'D': 10, 'R': 11, 'A': 12, '2': 13, 'Joker': 14 };
    selected.sort((a, b) => (ordreVal[a.valeur] || 0) - (ordreVal[b.valeur] || 0));
    
    let groups = [];
    let activeGroup = null;
    let orphanWildcards = []; // Cartes en attente de groupe (Joker ou 2)

    for (let c of selected) {
        // Règle de clôture : Si le groupe actif a déjà >= 3 cartes et qu'on sélectionne
        // une carte naturelle d'une AUTRE valeur, on ferme ce groupe pour que la nouvelle carte
        // commence un nouveau groupe. On NE FERME PAS si la nouvelle carte est un Joker ou un 2.
        const estWild = (c.valeur === 'Joker' || c.valeur === '2');
        if (activeGroup && activeGroup.cartesId.length >= 3 && c.valeur !== activeGroup.valeur && !estWild) {
            activeGroup = null;
        }

        if (c.valeur === 'Joker') {
            // Un Joker est toujours un wildcard
            if (activeGroup) {
                activeGroup.cartesId.push(c.id);
            } else {
                orphanWildcards.push(c);
            }
        } else if (c.valeur === '2') {
            // Un 2 peut être un wildcard ou former un groupe naturel de 2
            if (activeGroup) {
                // Si le groupe actif est déjà un groupe de 2, c'est naturel
                if (activeGroup.valeur === '2') {
                    activeGroup.cartesId.push(c.id);
                } else {
                    // Sinon, c'est un wildcard pour ce groupe actif
                    activeGroup.cartesId.push(c.id);
                }
            } else {
                // Pas de groupe actif. Regardons s'il y a déjà un '2' dans les orphelins.
                let indexOrphan2 = orphanWildcards.findIndex(w => w.valeur === '2');
                if (indexOrphan2 !== -1) {
                    // On a trouvé un '2' orphelin ! Ils forment un groupe naturel de 2.
                    let prev2 = orphanWildcards.splice(indexOrphan2, 1)[0];
                    let newGroup = { valeur: '2', cartesId: [prev2.id, c.id] };
                    groups.push(newGroup);
                    activeGroup = newGroup;
                    
                    // Si d'autres orphelins (Jokers) attendaient, ils rejoignent ce groupe
                    if (orphanWildcards.length > 0) {
                        orphanWildcards.forEach(w => activeGroup.cartesId.push(w.id));
                        orphanWildcards = [];
                    }
                } else {
                    // C'est le premier '2', il devient orphelin en attente
                    orphanWildcards.push(c);
                }
            }
        } else {
            // Carte naturelle (3 à As)
            if (activeGroup && activeGroup.valeur === c.valeur) {
                // On continue le groupe actif
                activeGroup.cartesId.push(c.id);
            } else {
                // On démarre un NOUVEAU groupe naturel
                // IMPORTANT: le fait de changer de valeur crée une distinction visuelle (nouveau groupe)
                let newGroup = { valeur: c.valeur, cartesId: [c.id] };
                groups.push(newGroup);
                activeGroup = newGroup;
                
                // Absorber les orphelins (cliqués juste avant cette nouvelle carte)
                if (orphanWildcards.length > 0) {
                    orphanWildcards.forEach(w => activeGroup.cartesId.push(w.id));
                    orphanWildcards = [];
                }
            }
        }
    }
    
    // S'il reste des orphelins à la fin, on les place dans leur propre groupe (ou le dernier actif)
    if (orphanWildcards.length > 0) {
        if (activeGroup) {
            orphanWildcards.forEach(w => activeGroup.cartesId.push(w.id));
        } else {
            // S'il n'y a eu que des jokers ou des 2 isolés
            let fallbackVal = orphanWildcards.some(w => w.valeur === '2') ? '2' : 'Joker';
            groups.push({ valeur: fallbackVal, cartesId: orphanWildcards.map(w => w.id) });
        }
    }
    
    return groups;
}

// =============================================================================
// TRI INTELLIGENT DE LA MAIN (style Jawaker)
// Groupes du plus petit au plus grand, wildcards ensemble à la fin
// =============================================================================
function trierMainIntelligent(main) {
    const troisRouges = [];
    const troisNoirs = [];
    const parValeur = {};
    const wildcards = [];

    const ordreVal = { '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, '10': 8, 'V': 9, 'D': 10, 'R': 11, 'A': 12 };

    main.forEach(c => {
        if (c.valeur === '3' && (c.couleur === 'Coeur' || c.couleur === 'Carreau')) {
            troisRouges.push(c);
        } else if (c.valeur === '3' && (c.couleur === 'Trefle' || c.couleur === 'Pique')) {
            troisNoirs.push(c);
        } else if (c.valeur === 'Joker' || c.valeur === '2') {
            wildcards.push(c);
        } else {
            if (!parValeur[c.valeur]) parValeur[c.valeur] = [];
            parValeur[c.valeur].push(c);
        }
    });

    // Jokers d'abord parmi les wildcards
    wildcards.sort((a, b) => {
        if (a.valeur === 'Joker' && b.valeur !== 'Joker') return -1;
        if (a.valeur !== 'Joker' && b.valeur === 'Joker') return 1;
        return 0;
    });

    // Groupes triés par taille CROISSANTE, puis par valeur croissante
    let groupes = Object.entries(parValeur).map(([val, cartes]) => ({
        valeur: val,
        cartes: cartes.slice(),
        ordre: ordreVal[val] || 0
    }));

    groupes.sort((a, b) => {
        if (a.cartes.length !== b.cartes.length) return a.cartes.length - b.cartes.length;
        return a.ordre - b.ordre;
    });

    // Séparer les cartes isolées (singles) des vrais groupes (2+)
    const singles = [];
    const vraisGroupes = [];
    groupes.forEach(g => {
        if (g.cartes.length === 1) singles.push(g.cartes[0]);
        else vraisGroupes.push(g);
    });

    // Résultat : groupes naturels, puis wildcards ensemble, puis singles, puis 3 noirs
    let result = [];
    if (troisRouges.length > 0) result.push({ cartes: troisRouges, type: 'troisRouges' });
    vraisGroupes.forEach(g => result.push({ cartes: g.cartes, type: 'groupe' }));
    if (wildcards.length > 0) result.push({ cartes: wildcards, type: 'wildcards' });
    if (singles.length > 0) result.push({ cartes: singles, type: 'singles' });
    if (troisNoirs.length > 0) result.push({ cartes: troisNoirs, type: 'troisNoirs' });

    return result;
}

function evaluerSelection() {
    const totalSelected = cartesSelectionnees.size + groupesVerrouillesLocaux.reduce((acc, arr) => acc + arr.length, 0) + (terreSelectionnee ? 1 : 0);
    if (totalSelected === 0) return { valide: false };
    
    // Si la terre est sélectionnée OU qu'on n'a pas encore joué, on ne peut pas "ajouter" 
    // directement à une combinaison existante sur la table. Il faut FORCÉMENT préparer.
    if (terreSelectionnee || (etatGlobal && !etatGlobal.aJoueCeTour)) {
        return { valide: true, type: 'nouveau' };
    }
    
    // Si on a des groupes verrouillés, ce n'est pas un simple "ajout" direct, c'est forcément 'nouveau' (pose de groupes)
    if (groupesVerrouillesLocaux.length > 0) {
        return { valide: true, type: 'nouveau' };
    }
    
    let selectedCartes = [];
    cartesSelectionnees.forEach(id => {
        const c = etatGlobal.maMain.find(carte => carte.id === id);
        if (c) selectedCartes.push(c);
    });
    
    const naturelles = selectedCartes.filter(c => c.valeur !== 'Joker' && c.valeur !== '2');
    const deuxNonJoker = selectedCartes.filter(c => c.valeur === '2' && c.valeur !== 'Joker');
    
    let valeurCible = null;
    if (naturelles.length > 0) {
        valeurCible = naturelles[0].valeur;
    } else if (deuxNonJoker.length > 0) {
        valeurCible = '2';
    }
    
    const monEq = etatGlobal.monEquipe || 1;
    const maTable = etatGlobal.equipes[monEq].table || {};
    
    // Check if it matches an existing meld on our table
    let cleTrouvee = null;
    let combiTrouvee = null;
    
    // Chercher d'abord une combinaison incomplète
    for (const [cle, combi] of Object.entries(maTable)) {
        if (combi.valeur === valeurCible && !combi.estCanasta) {
            cleTrouvee = cle;
            combiTrouvee = combi;
            break;
        }
    }
    // Sinon chercher une canasta
    if (!cleTrouvee) {
        for (const [cle, combi] of Object.entries(maTable)) {
            if (combi.valeur === valeurCible) {
                cleTrouvee = cle;
                combiTrouvee = combi;
                break;
            }
        }
    }
    
    if (valeurCible && combiTrouvee) {
        if (combiTrouvee.estCanasta && cartesSelectionnees.size >= 3) {
            return { valide: true, type: 'nouveau' };
        }
        return { valide: true, type: 'ajout', valeur: valeurCible, cleUnique: cleTrouvee };
    }
    
    if (cartesSelectionnees.size >= 3) {
        return { valide: true, type: 'nouveau' };
    }
    
    return { valide: false };
}

// groupesPrepares est déjà déclaré au début du fichier
let modeErreurPreparation = false;

const btnJeterElem = document.getElementById('btn-jeter');
if (btnJeterElem) {
    btnJeterElem.addEventListener('click', () => {
        if (verrouAction || !etatGlobal || etatGlobal.tourActuel !== monNumero || !etatGlobal.aJoueCeTour) return;
        if (cartesSelectionnees.size === 1) {
            verrouAction = true;
            const cardId = Array.from(cartesSelectionnees)[0];
            socket.emit('demandeJouerCarte', cardId);
            cartesSelectionnees.clear();
            setTimeout(() => verrouAction = false, 1000);
        }
    });
}

document.getElementById('btn-lock').addEventListener('click', () => {
    if (cartesSelectionnees.size >= 3) {
        const arrayIds = Array.from(cartesSelectionnees);
        const grouped = autoGroupCartes(arrayIds);
        
        grouped.forEach(g => {
            if (g.cartesId.length > 0) {
                groupesVerrouillesLocaux.push(g.cartesId);
            }
        });
        
        cartesSelectionnees.clear();
        sons.jouer('select');
        mettreAJourBoutons();
    }
});

document.getElementById('btn-poser').addEventListener('click', () => {
    const eval = evaluerSelection();
    if (!eval.valide) return;
    
    if (eval.type === 'ajout') {
        // Ajout direct sans préparation
        const arrayIds = Array.from(cartesSelectionnees);
        socket.emit('demandeDescendreCombinaison', [{ valeur: eval.valeur, cleUnique: eval.cleUnique, cartesId: arrayIds }]);
        cartesSelectionnees.clear();
        sons.jouer('succes');
        return;
    }

    let grouped = [];
    
    // 1. Process locked groups directly
    groupesVerrouillesLocaux.forEach(arr => {
        let res = autoGroupCartes(arr);
        grouped = grouped.concat(res);
    });
    
    // 2. Process remaining active selection
    if (cartesSelectionnees.size > 0 || terreSelectionnee) {
        const arrayIds = Array.from(cartesSelectionnees);
        let extraCard = null;
        if (terreSelectionnee && etatGlobal.carteDessusDefausse) {
            extraCard = etatGlobal.carteDessusDefausse;
        }
        let res = autoGroupCartes(arrayIds, extraCard);
        grouped = grouped.concat(res);
    }
    
    grouped = grouped.filter(g => g.cartesId.length >= 3);
    if (grouped.length === 0) {
        toast("Sélection invalide. 3 cartes minimum par groupe.", "error");
        sons.jouer('erreur');
        return;
    }
    
    // Si l'équipe a déjà ouvert et qu'on ne ramasse pas la terre, on pose directement
    const monEq = etatGlobal.equipes[etatGlobal.monEquipe];
    if (monEq && monEq.aOuvert && !terreSelectionnee) {
        socket.emit('demandeDescendreCombinaison', grouped.map(g => ({ cartesId: g.cartesId })));
        cartesSelectionnees.clear();
        groupesVerrouillesLocaux = [];
        sons.jouer('succes');
        return;
    }
    
    // Récolter uniquement les IDs des groupes valides
    let validIds = new Set();
    grouped.forEach(g => g.cartesId.forEach(id => {
        if (!etatGlobal.carteDessusDefausse || id !== etatGlobal.carteDessusDefausse.id) {
            validIds.add(id);
        }
    }));

    // Déplacer les cartes vers la zone de préparation localement
    const cartesDeplacees = [];
    validIds.forEach(id => {
        const idx = etatGlobal.maMain.findIndex(c => c.id === id);
        if (idx !== -1) {
            cartesDeplacees.push(etatGlobal.maMain[idx]);
            etatGlobal.maMain.splice(idx, 1);
        }
    });
    
    grouped.forEach(g => {
        let cartesDuGroupe = g.cartesId.map(id => {
            if (etatGlobal.carteDessusDefausse && id === etatGlobal.carteDessusDefausse.id) return etatGlobal.carteDessusDefausse;
            return cartesDeplacees.find(c => c.id === id);
        }).filter(Boolean);
        
        groupesPrepares.push({
            cartesId: g.cartesId,
            cartes: cartesDuGroupe
        });
    });
    
    if (terreSelectionnee) {
        terreSelectionnee = false;
        const terreEl = document.getElementById('terre');
        if (terreEl) {
            terreEl.style.boxShadow = 'none';
            terreEl.style.transform = 'none';
        }
    }
    
    cartesSelectionnees.clear();
    groupesVerrouillesLocaux = [];
    sons.jouer('select');
    rendreMelds(etatGlobal.equipes[etatGlobal.monEquipe], 'melds-equipe');
    rendreMain(etatGlobal.maMain); // Update hand visually
    mettreAJourBoutons();
});

document.getElementById('btn-valider-pose').addEventListener('click', () => {
    if (groupesPrepares.length === 0) return;
    const dataToSend = groupesPrepares.map(g => ({ cartesId: g.cartesId }));
    
    // Si le joueur n'a pas encore joué (ni pioché ni ramassé), c'est qu'il tente une ouverture sur la terre
    if (!etatGlobal.aJoueCeTour && etatGlobal.carteDessusDefausse) {
        socket.emit('demandeRamasserTerre', dataToSend);
    } else {
        socket.emit('demandeDescendreCombinaison', dataToSend);
    }
    
    verrouAction = true;
    setTimeout(() => verrouAction = false, 1000);
});

document.getElementById('btn-annuler-pose').addEventListener('click', () => {
    // Retourner les cartes dans la main
    groupesPrepares.forEach(g => {
        g.cartes.forEach(c => {
            // Ne pas remettre la carte de la terre dans la main
            if (etatGlobal.carteDessusDefausse && c.id === etatGlobal.carteDessusDefausse.id) return;
            
            if (!etatGlobal.maMain.find(existing => existing.id === c.id)) {
                etatGlobal.maMain.push(c);
            }
        });
    });
    groupesPrepares = [];
    modeErreurPreparation = false;
    
    terreSelectionnee = false;
    const terreEl = document.getElementById('terre');
    if (terreEl) {
        terreEl.style.boxShadow = 'none';
        terreEl.style.transform = 'none';
    }
    
    rendreMelds(etatGlobal.equipes[etatGlobal.monEquipe], 'melds-equipe');
    rendreMain(etatGlobal.maMain);
    mettreAJourBoutons();
});

const btnRef = document.getElementById('btn-refresh'); if(btnRef) btnRef.addEventListener('click', () => {
    window.location.reload();
});
const btnSet = document.getElementById('btn-settings'); if(btnSet) btnSet.addEventListener('click', () => {
    toast("Paramètres à venir !", "info");
});

// Piocher en cliquant sur la pile
document.getElementById('pioche').addEventListener('click', () => {
    if (verrouAction || !etatGlobal || etatGlobal.tourActuel !== monNumero) return;
    verrouAction = true;
    socket.emit('demandePiocher');
    setTimeout(() => verrouAction = false, 1000);
});

// Ramasser terre en cliquant sur la terre
document.getElementById('terre').addEventListener('click', () => {
    if (verrouAction || !etatGlobal || etatGlobal.tourActuel !== monNumero) return;
    
    // NEW LOGIC: Discard selected card if player has drawn (phase 2)
    if (etatGlobal.aJoueCeTour && cartesSelectionnees.size === 1) {
        verrouAction = true;
        const cardId = Array.from(cartesSelectionnees)[0];
        socket.emit('demandeJouerCarte', cardId);
        cartesSelectionnees.clear();
        setTimeout(() => verrouAction = false, 1000);
        return;
    }
    
    if (etatGlobal.aJoueCeTour) {
        toast("Vous avez déjà pioché. Sélectionnez une seule carte pour la jeter.", "info");
        return;
    }

    if (!etatGlobal.carteDessusDefausse) return;
    
    // NOUVELLE LOGIQUE : on sélectionne juste la terre visuellement !
    terreSelectionnee = !terreSelectionnee;
    const terreEl = document.getElementById('terre');
    if (terreSelectionnee) {
        terreEl.style.boxShadow = '0 0 10px 4px var(--green)';
        terreEl.style.transform = 'translateY(-10px)';
        sons.jouer('select');
    } else {
        terreEl.style.boxShadow = 'none';
        terreEl.style.transform = 'none';
        sons.jouer('select');
    }
    mettreAJourBoutons();
});

// =============================================================================
// RENDU DU JEU (PURE CSS)
// =============================================================================
function getCardClass(carte) {
    if (!carte) return 'back';
    if (carte.valeur === 'Joker') return 'joker';
    return (carte.couleur === 'Coeur' || carte.couleur === 'Carreau') ? 'red' : 'black';
}

function generateCardHTML(carte) {
    if (!carte) return '';
    if (carte.valeur === 'Joker') {
        return `
            <div class="idx tl"><span style="font-size:7px">JOK</span></div>
            <div class="pip">★</div>
            <div class="idx br"><span style="font-size:7px">JOK</span></div>
        `;
    }
    const suitSymbol = { 'Coeur': '♥', 'Carreau': '♦', 'Trefle': '♣', 'Pique': '♠' }[carte.couleur] || '';
    return `
        <div class="idx tl"><span>${carte.valeur}</span><span>${suitSymbol}</span></div>
        <div class="pip">${suitSymbol}</div>
        <div class="idx br"><span>${carte.valeur}</span><span>${suitSymbol}</span></div>
    `;
}

function colorSelectedGroups() {
    // Reset all selection colors
    document.querySelectorAll('.card').forEach(el => {
        el.classList.remove('sel-group-1', 'sel-group-2', 'sel-group-3', 'sel-group-4', 'sel-group-5');
    });

    let globalGroupIndex = 0;
    
    // 1. Color locked groups
    groupesVerrouillesLocaux.forEach(lockedArr => {
        const colorClass = `sel-group-${(globalGroupIndex % 5) + 1}`;
        lockedArr.forEach(id => {
            const el = document.querySelector(`.card[data-id="${id}"]`);
            if (el) el.classList.add(colorClass);
        });
        globalGroupIndex++;
    });

    // 2. Color active selection using autoGroupCartes
    if (cartesSelectionnees.size > 0) {
        const arrayIds = Array.from(cartesSelectionnees);
        const groups = autoGroupCartes(arrayIds);
        
        groups.forEach((g) => {
            const colorClass = `sel-group-${(globalGroupIndex % 5) + 1}`;
            g.cartesId.forEach(id => {
                const el = document.querySelector(`.card[data-id="${id}"]`);
                if (el) el.classList.add(colorClass);
            });
            globalGroupIndex++;
        });
    }
}

function highlightCompatibleMelds() {
    document.querySelectorAll('.canasta').forEach(el => el.classList.remove('compatible'));
    const ghost = document.querySelector('#melds-equipe .meld-ghost');
    if (ghost) ghost.classList.remove('compatible');

    if (cartesSelectionnees.size > 0 && typeof evaluerSelection === 'function') {
        const evaluation = evaluerSelection();
        if (evaluation.valide) {
            if (evaluation.type === 'ajout' && evaluation.cleUnique) {
                const targetMeld = document.querySelector(`#melds-equipe .canasta[data-cle="${evaluation.cleUnique}"]`);
                if (targetMeld) targetMeld.classList.add('compatible');
            } else if (evaluation.type === 'nouveau' && ghost) {
                ghost.classList.add('compatible');
            }
        }
    }
}

function mettreAJourBoutons() {
    highlightCompatibleMelds();
    colorSelectedGroups();
    const estMonTour = etatGlobal && etatGlobal.tourActuel === monNumero;
    const btnPoser = document.getElementById('btn-poser');
    const btnSortir = document.getElementById('btn-sortir');
    const btnValider = document.getElementById('btn-valider-pose');
    const btnAnnuler = document.getElementById('btn-annuler-pose');
    
    // Sortir Logic (only if eligible)
    const monEq = etatGlobal ? etatGlobal.equipes[etatGlobal.monEquipe] : null;
    let eligibleSortie = false;
    if (monEq && monEq.aOuvert) {
        let hasPure = false, hasImpure = false;
        Object.values(monEq.table).forEach(m => {
            if (m.estCanasta) {
                const estPure = m.cartes.every(c => !c.estJoker && (m.valeur === '2' || c.valeur !== '2'));
                if (estPure) hasPure = true;
                else hasImpure = true;
            }
        });
        eligibleSortie = hasPure && hasImpure;
    }
    
    if (btnSortir) {
        if (estMonTour && eligibleSortie) {
            btnSortir.style.display = 'block';
            btnSortir.disabled = false;
        } else {
            btnSortir.style.display = 'none';
        }
    }

    const btnJeter = document.getElementById('btn-jeter');

    if (groupesPrepares.length > 0) {
        const btnLock = document.getElementById('btn-lock');
        if (btnLock) btnLock.style.display = 'none';
        if (btnPoser) btnPoser.style.display = 'none';
        if (btnJeter) btnJeter.style.display = 'none';
        if (btnValider) btnValider.style.display = modeErreurPreparation ? 'none' : 'flex';
        if (btnAnnuler) btnAnnuler.style.display = 'flex';
        mettreAJourIndicateurTour();
    } else {
        mettreAJourIndicateurTour();
        
        let isSelectionValid = false;
        if (typeof evaluerSelection === 'function') {
            isSelectionValid = evaluerSelection().valide;
        }

        if (cartesSelectionnees.size === 1 && estMonTour && etatGlobal.aJoueCeTour) {
            if (btnJeter) btnJeter.style.display = 'flex';
        } else {
            if (btnJeter) btnJeter.style.display = 'none';
        }

        if (btnPoser) {
            btnPoser.style.display = 'flex';
            if (estMonTour && isSelectionValid) {
                btnPoser.disabled = false;
                btnPoser.style.transform = 'scale(1.1)';
                btnPoser.style.opacity = '1';
            } else {
                btnPoser.disabled = true;
                btnPoser.style.transform = 'scale(1)';
                btnPoser.style.opacity = '0.5';
            }
        }
        const btnLock = document.getElementById('btn-lock');
        if (btnLock) {
            if (cartesSelectionnees.size >= 3) {
                btnLock.style.display = 'block';
            } else {
                btnLock.style.display = 'none';
            }
        }
        
        if (btnValider) btnValider.style.display = 'none';
        if (btnAnnuler) btnAnnuler.style.display = 'none';
    }
}



function onCarteTap(carte, element) {
    if (verrouAction) return;
    const now = Date.now();
    const last = dernierTap[carte.id] || 0;
    dernierTap[carte.id] = now;
    const estMonTour = etatGlobal && etatGlobal.tourActuel === monNumero;

    // Check if it's in a locked group
    let lockedGroupIndex = groupesVerrouillesLocaux.findIndex(arr => arr.includes(carte.id));
    if (lockedGroupIndex !== -1) {
        // Unlock it
        groupesVerrouillesLocaux[lockedGroupIndex] = groupesVerrouillesLocaux[lockedGroupIndex].filter(id => id !== carte.id);
        // Remove group if empty
        if (groupesVerrouillesLocaux[lockedGroupIndex].length === 0) {
            groupesVerrouillesLocaux.splice(lockedGroupIndex, 1);
        }
        element.classList.remove('selectionnee');
    } else if (cartesSelectionnees.has(carte.id)) {
        cartesSelectionnees.delete(carte.id);
        element.classList.remove('selectionnee');
    } else {
        cartesSelectionnees.add(carte.id);
        element.classList.add('selectionnee');
    }
    sons.jouer('select');
    mettreAJourBoutons();
}

// =============================================================================
// OVERLAP DYNAMIQUE — gère rangées multiples + gaps entre groupes
// =============================================================================
function applyDynamicOverlap() {
    const conteneur = document.getElementById('conteneur-main');
    if (conteneur.classList.contains('multi-row')) {
        const rows = conteneur.querySelectorAll('.main-row');
        rows.forEach(row => applyOverlapForRow(row));
    } else {
        applyOverlapForRow(conteneur);
    }
}

function applyOverlapForRow(row) {
    const cartes = row.querySelectorAll('.card');
    if (cartes.length === 0) return;
    if (cartes.length === 1) {
        cartes[0].style.marginLeft = '0';
        return;
    }

    const maxW = window.innerWidth - 160; const containerWidth = Math.min(row.clientWidth || maxW, maxW);
    const cardW = 68;
    const groupGap = 10;
    const groupStarts = row.querySelectorAll('.group-start').length;
    const totalGroupGap = groupStarts * groupGap;

    // Calculer l'overlap pour que tout rentre
    const availableWidth = containerWidth - totalGroupGap;
    let spacing = (availableWidth - cardW) / (cartes.length - 1);
    let overlap = spacing - cardW;

    if (overlap > -18) overlap = -18; // Pas trop écarté
    if (overlap < -50) overlap = -50; // Minimum lisible

    cartes.forEach((c, i) => {
        if (i === 0) {
            c.style.marginLeft = '0';
        } else if (c.classList.contains('group-start')) {
            c.style.marginLeft = `${overlap + groupGap}px`;
        } else {
            c.style.marginLeft = `${overlap}px`;
        }
    });
}

// =============================================================================
// RENDU DE LA MAIN — tri intelligent + multi-rangées + wildcards déplaçables
// =============================================================================
let sortableHand = null;

function rendreMain(mainCartes) {
    const conteneur = document.getElementById('conteneur-main');
    conteneur.innerHTML = '';
    if (sortableHand) { try { sortableHand.destroy(); } catch(e) {} sortableHand = null; }

    if (!mainCartes || mainCartes.length === 0) return;

    const groupes = trierMainIntelligent(mainCartes);
    const totalCartes = mainCartes.length;
    const useMultiRow = false;

    // Carte data lookup pour les wildcards déplacés
    const carteParId = new Map();
    mainCartes.forEach(c => carteParId.set(c.id, c));

    function creerElementCarte(c, isWildcard) {
        const el = document.createElement('div');
        el.className = `card ${getCardClass(c)}`;
        el.dataset.id = c.id;
        if (isWildcard) el.classList.add('wildcard-draggable');
        const isSelected = cartesSelectionnees.has(c.id) || groupesVerrouillesLocaux.some(arr => arr.includes(c.id));
        if (isSelected) el.classList.add('selectionnee');
        el.innerHTML = generateCardHTML(c);
        if (cartesRecemmentPiochees.has(c.id)) {
            el.classList.add('nouvelle-carte-piochee');
            el.style.overflow = 'visible';
            const dot = document.createElement('div');
            dot.className = 'badge-nouvelle';
            dot.textContent = '✨';
            el.appendChild(dot);
        }
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            onCarteTap(c, el);
        });
        return el;
    }

    if (useMultiRow) {
        conteneur.classList.add('multi-row');
        const row1 = document.createElement('div');
        row1.className = 'main-row';
        const row2 = document.createElement('div');
        row2.className = 'main-row';

        // Répartir les groupes entre les 2 rangées de façon équilibrée
        let count1 = 0, count2 = 0;
        groupes.forEach(groupe => {
            const isWild = groupe.type === 'wildcards';
            const targetRow = count1 <= count2 ? row1 : row2;
            const isNewGroupInRow = targetRow.children.length > 0;

            groupe.cartes.forEach((c, i) => {
                const el = creerElementCarte(c, isWild);
                if (i === 0 && isNewGroupInRow) el.classList.add('group-start');
                targetRow.appendChild(el);
            });

            if (count1 <= count2) count1 += groupe.cartes.length;
            else count2 += groupe.cartes.length;
        });

        conteneur.appendChild(row1);
        conteneur.appendChild(row2);

        // SortableJS sur chaque rangée — seuls les wildcards sont déplaçables
        [row1, row2].forEach(row => {
            new Sortable(row, {
                animation: 200,
                delay: 200,
                delayOnTouchOnly: true,
                direction: 'horizontal',
                draggable: '.wildcard-draggable',
                group: 'hand',
                ghostClass: 'sortable-ghost',
                onEnd: () => {
                    requestAnimationFrame(() => {
                        applyDynamicOverlap();
                    });
                }
            });
        });
    } else {
        conteneur.classList.remove('multi-row');
        let isFirstGroup = true;

        groupes.forEach(groupe => {
            const isWild = groupe.type === 'wildcards';
            groupe.cartes.forEach((c, i) => {
                const el = creerElementCarte(c, isWild);
                if (i === 0 && !isFirstGroup) el.classList.add('group-start');
                conteneur.appendChild(el);
            });
            isFirstGroup = false;
        });

        // SortableJS — seuls les wildcards sont déplaçables
        sortableHand = new Sortable(conteneur, {
            animation: 200,
            delay: 200,
            delayOnTouchOnly: true,
            direction: 'horizontal',
            draggable: '.wildcard-draggable',
            ghostClass: 'sortable-ghost',
            onEnd: () => {
                requestAnimationFrame(() => {
                    applyDynamicOverlap();
                });
            }
        });
    }

    // Appliquer l'overlap après un petit délai pour que le DOM soit prêt
    requestAnimationFrame(() => applyDynamicOverlap());
}

// Fonction utilitaire pour calculer le total des points d'un meld
function totalPointsMeld(cartes) {
    return cartes.reduce((total, c) => total + c.points, 0);
}

function rendreMelds(equipeData, conteneurId) {
    const conteneur = document.getElementById(conteneurId);
    if (!conteneur) return;
    
    // Réinitialiser le titre
    const name = conteneurId === 'melds-equipe' ? 'NOUS' : 'EUX';
    const color = conteneurId === 'melds-equipe' ? '#60b3ff' : '#ff6b6b';
    
    let labelHTML = `<div class="label-left" style="display:flex; align-items:center;">Descente ${name}</div>`;
    
    if (equipeData) {
        let rightSide = `<div style="display:flex; align-items:center; gap:6px;">`;
        if (!equipeData.aOuvert) {
            rightSide += `<span style="font-size:9px; color:#f2c516; font-weight:800; background:rgba(242,197,22,0.15); padding:2px 4px; border-radius:5px; box-shadow:0 0 5px rgba(242,197,22,0.2);" title="Objectif d'ouverture">🎯${equipeData.seuilOuverture}</span>`;
        }
        rightSide += `</div>`;
        labelHTML += rightSide;
    }
    
    conteneur.innerHTML = `<div class="meld-label">${labelHTML}</div>`;
    
    // Wrap in canasta-list
    const canastaListDiv = document.createElement('div');
    canastaListDiv.className = 'canasta-list';
    
    if (equipeData) {
        if (equipeData.troisRouges && equipeData.troisRouges.length > 0) {
            const bonus = document.createElement('span');
            bonus.className = 'bonus-chip';
            bonus.style.display = 'inline-block';
            bonus.style.marginLeft = '8px';
            bonus.style.padding = '2px 5px';
            bonus.style.fontSize = '8px';
            bonus.textContent = `♦ 3 rouge × ${equipeData.troisRouges.length}`;
            const labelLeft = conteneur.querySelector('.label-left');
            if (labelLeft) labelLeft.appendChild(bonus);
        }

        const ordreValTable = { '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, '10': 8, 'V': 9, 'D': 10, 'R': 11, 'A': 12, '2': 13 };
        const valeursTriees = Object.keys(equipeData.table).sort((a,b) => (ordreValTable[a] || 0) - (ordreValTable[b] || 0));
        valeursTriees.forEach(val => {
            const combi = equipeData.table[val];
            const canastaDiv = document.createElement('div');
            
            // Déterminer la classe de la canasta
            let typeCanasta = 'open';
            let isPure = false;
            if (combi.cartes.length >= 7) {
                isPure = !combi.cartes.some(c => c.valeur === 'Joker' || (c.valeur === '2' && combi.valeur !== '2'));
                typeCanasta = 'closed ' + (isPure ? 'pure' : 'mixed');
            }
            let isHighlight = false;
            canastaDiv.className = `canasta ${typeCanasta}`;
            canastaDiv.dataset.cle = val; // Store the unique key for highlighting
            
            const slotsDiv = document.createElement('div');
            slotsDiv.className = 'slots';
            
            if (combi.cartes.length >= 7) {
                const slot = document.createElement('div');
                let c;
                if (isPure) {
                    c = combi.cartes.find(x => x.valeur !== 'Joker' && x.valeur !== '2' && (x.couleur === 'Coeur' || x.couleur === 'Carreau'));
                } else {
                    c = combi.cartes.find(x => x.valeur !== 'Joker' && x.valeur !== '2' && (x.couleur === 'Pique' || x.couleur === 'Trefle'));
                }
                if (!c) c = combi.cartes.find(x => x.valeur !== 'Joker' && x.valeur !== '2') || combi.cartes[0];
                const color = (c.couleur === 'Coeur' || c.couleur === 'Carreau') ? ' red' : '';
                const valDisplay = (c.valeur === 'Joker' || c.valeur === '2') ? '★' : (c.valeur === '10' ? '10' : c.valeur[0]);
                let isCardHighlight = window.cartesSurlignees && combi.cartes.some(cc => window.cartesSurlignees.includes(cc.id));
                slot.className = `slot filled${color}` + (isCardHighlight ? ' highlight-card-glow' : '');
                
                if (isCardHighlight) {
                    const hCard = combi.cartes.find(cc => window.cartesSurlignees.includes(cc.id));
                    if (hCard && hCard.posePar && etatGlobal && etatGlobal.couleursJoueurs) {
                        const pColor = etatGlobal.couleursJoueurs[hCard.posePar] || '#f2c516';
                        slot.style.setProperty('--glow-color', pColor);
                        slot.style.backgroundColor = pColor + '40';
                    }
                }
                
                slot.textContent = valDisplay;
                slot.style.width = '30px';
                slot.style.boxShadow = '2px 2px 5px rgba(0,0,0,0.5)';
                slotsDiv.appendChild(slot);
            } else {
                for (let i = 0; i < 7; i++) {
                    const slot = document.createElement('div');
                    if (i < combi.cartes.length) {
                        const c = combi.cartes[i];
                        const color = (c.couleur === 'Coeur' || c.couleur === 'Carreau') ? ' red' : '';
                        const valDisplay = (c.valeur === 'Joker' || c.valeur === '2') ? '★' : (c.valeur === '10' ? '10' : c.valeur[0]);
                        let isCardHighlight = window.cartesSurlignees && window.cartesSurlignees.includes(c.id);
                        slot.className = `slot filled${color}` + (isCardHighlight ? ' highlight-card-glow' : '');
                        
                        if (isCardHighlight && c.posePar && etatGlobal && etatGlobal.couleursJoueurs) {
                            const pColor = etatGlobal.couleursJoueurs[c.posePar] || '#f2c516';
                            slot.style.setProperty('--glow-color', pColor);
                            slot.style.backgroundColor = pColor + '40';
                        }
                        
                        slot.textContent = valDisplay;
                        if (c.posePar && etatGlobal && etatGlobal.couleursJoueurs) {
                            const dot = document.createElement('span');
                            dot.className = 'player-dot';
                            dot.style.backgroundColor = etatGlobal.couleursJoueurs[c.posePar] || '#fff';
                            slot.style.position = 'relative';
                            slot.textContent = '';
                            slot.appendChild(document.createTextNode(valDisplay));
                            slot.appendChild(dot);
                        }
                    } else {
                        slot.className = 'slot';
                    }
                    slotsDiv.appendChild(slot);
                }
            }
        canastaDiv.appendChild(slotsDiv);
        
        // Afficher le tag
        const tag = document.createElement('span');
        tag.className = `canasta-tag ${combi.cartes.length >= 7 ? (isPure ? 'pure' : 'mixed') : 'open'}`;
        
        if (combi.cartes.length >= 7) {
            tag.innerHTML = isPure ? `<svg class="icon"><use href="#i-star"/></svg>7/7 pure` : `<svg class="icon"><use href="#i-star"/></svg>7/7 mixte`;
        } else {
            tag.textContent = `${combi.cartes.length}/7`;
        }
        canastaDiv.appendChild(tag);
        
        canastaDiv.addEventListener('click', () => {
            const estMonTour = etatGlobal && etatGlobal.tourActuel === monNumero;
            const isMonEquipe = conteneurId === 'melds-equipe';
            if (estMonTour && isMonEquipe && cartesSelectionnees.size > 0) {
                socket.emit('demandeDescendreCombinaison', [{
                    valeur: combi.valeur,
                    cleUnique: val,
                    cartesId: Array.from(cartesSelectionnees)
                }]);
                cartesSelectionnees.clear();
                sons.jouer('succes');
            }
        });
        
        canastaListDiv.appendChild(canastaDiv);
    });

    // Ajouter la zone de préparation à la suite
    if (conteneurId === 'melds-equipe' && typeof groupesPrepares !== 'undefined' && groupesPrepares.length > 0) {
        groupesPrepares.forEach(g => {
            const canastaDiv = document.createElement('div');
            canastaDiv.className = 'canasta open staged';
            
            const slotsDiv = document.createElement('div');
            slotsDiv.className = 'slots';
            
            g.cartes.forEach(c => {
                const slot = document.createElement('div');
                const color = (c.couleur === 'Coeur' || c.couleur === 'Carreau') ? ' red' : '';
                const valDisplay = (c.valeur === 'Joker' || c.valeur === '2') ? '★' : (c.valeur === '10' ? '10' : c.valeur[0]);
                slot.className = `slot filled${color}`;
                slot.textContent = valDisplay;
                slotsDiv.appendChild(slot);
            });
            // fill remaining up to 7
            for(let i=g.cartes.length; i<7; i++) {
                const slot = document.createElement('div');
                slot.className = 'slot empty';
                slotsDiv.appendChild(slot);
            }
            canastaDiv.appendChild(slotsDiv);
            
            const tag = document.createElement('span');
            tag.className = 'canasta-tag open';
            tag.textContent = 'Poser';
            canastaDiv.appendChild(tag);
            
            canastaListDiv.appendChild(canastaDiv);
        });
    }
    } // End if (equipeData)

    // Plus ghost (nouveau meld)
    const ghost = document.createElement('div');
    ghost.className = 'meld-ghost';
    ghost.textContent = '+';
    ghost.addEventListener('click', () => {
        if (conteneurId === 'melds-equipe') {
            const btnPoser = document.getElementById('btn-poser');
            if (btnPoser && btnPoser.style.display !== 'none' && !btnPoser.disabled) {
                btnPoser.click();
            }
        }
    });
    canastaListDiv.appendChild(ghost);
    
    conteneur.appendChild(canastaListDiv);
}

function rendreAdversaires(etat) {
    if (!etat.monNumero || estSpectateur) return;
    const moi = etat.monNumero;
    const partenaire = ((moi + 2 - 1) % 4) + 1;
    const gauche = (moi % 4) + 1;
    const droite = ((moi + 2) % 4) + 1;

    function dessinerPaquet(id, numJoueur) {
        const el = document.getElementById(id);
        if (!el) return;
        
        const nbCartes = etat.tailleMains[numJoueur] || 0;
        let name = "Joueur " + numJoueur;
        let avatarHTML = `<svg class="icon"><use href="#i-person"/></svg>`;
        
        if (etat.nomsJoueurs && etat.nomsJoueurs[numJoueur]) {
            name = etat.nomsJoueurs[numJoueur].pseudo;
            avatarHTML = `<span style="font-size:24px;">${etat.nomsJoueurs[numJoueur].avatar}</span>`;
        }

        
        let handFanHTML = '';
        const limit = Math.min(nbCartes, 7);
        for(let i=0; i<limit; i++) {
            if (id === 'adv-haut') {
                const angle = -10 + (i * 20/limit);
                handFanHTML += `<div class="mini-back" style="left:${i*8}px; transform:rotate(${angle}deg);"></div>`;
            } else {
                handFanHTML += `<div class="mini-back" style="top:${i*6}px;"></div>`;
            }
        }

        let couleurJoueur = '#fff';
        if (etat.couleursJoueurs && etat.couleursJoueurs[numJoueur]) {
            couleurJoueur = etat.couleursJoueurs[numJoueur];
        }

        el.innerHTML = `
          <div class="hand-fan" ${id === 'adv-haut' ? `style="width:${(limit-1)*8 + 13}px;"` : `style="height:${(limit-1)*6 + 18}px;"`}>
            ${handFanHTML}
          </div>
          <div class="avatar-wrap">
            <div class="avatar" style="display:flex; justify-content:center; align-items:center; border: 2px solid ${couleurJoueur}; box-shadow: 0 0 8px ${couleurJoueur}80;">${avatarHTML}</div>
            <span class="card-count">${nbCartes}</span>
          </div>
          <div class="avatar-name" style="display:flex; align-items:center; gap:4px; justify-content:center;">
            <span style="width:8px; height:8px; border-radius:50%; background-color:${couleurJoueur}; display:inline-block; border:1px solid rgba(0,0,0,0.5);"></span>
            ${name}
          </div>
        `;
    }

    dessinerPaquet('adv-haut', partenaire);
    dessinerPaquet('adv-gauche', gauche);
    dessinerPaquet('adv-droite', droite);
}

function rendreScoresEtTour(etat) {
    const monEq = etat.monEquipe || 1;
    const autreEq = monEq === 1 ? 2 : 1;

    const dataMonEq = etat.equipes[monEq] || { score: 0 };
    const dataAutreEq = etat.equipes[autreEq] || { score: 0 };

    // Update Progress Bars (max 15000)
    const pctEquipe = Math.max(0, Math.min(100, (dataMonEq.score / 15000) * 100));
    const pctAdversaire = Math.max(0, Math.min(100, (dataAutreEq.score / 15000) * 100));

    const pEq = document.getElementById('progression-eq'); if(pEq) pEq.style.width = pctEquipe + '%';
    const pAdv = document.getElementById('progression-adv'); if(pAdv) pAdv.style.width = pctAdversaire + '%';
    
    // Update external score panels
    const scoreNous = document.getElementById('score-nous');
    const scoreEux = document.getElementById('score-eux');
    if (scoreNous) scoreNous.textContent = dataMonEq.score || 0;
    if (scoreEux) scoreEux.textContent = dataAutreEq.score || 0;
    
    mettreAJourIndicateurTour();
}

function mettreAJourIndicateurTour() {
    if (!etatGlobal) return;
    const indic = document.getElementById('indicateur-tour');
    if (indic) {
        let maCouleur = '#fff';
        if (etatGlobal.couleursJoueurs && etatGlobal.monNumero && etatGlobal.couleursJoueurs[etatGlobal.monNumero]) {
            maCouleur = etatGlobal.couleursJoueurs[etatGlobal.monNumero];
        }
        indic.innerHTML = `<span class="turn-dot" style="background-color:${maCouleur};"></span>Tour : Vous`;
    }

    // --- MISE A JOUR DES STYLES DE TOUR ACTIF ---
    // Nettoyer les classes actives partout
    document.querySelectorAll('.opponent').forEach(el => el.classList.remove('tour-actif'));
    const mainEl = document.getElementById('conteneur-main');
    if (mainEl) mainEl.classList.remove('tour-actif');
    
    // Ajouter la classe au joueur actif
    if (etatGlobal.tourActuel === monNumero) {
        // Pas d'effet visuel sur la propre main selon la demande
    } else {
        const mapPos = {
            [(monNumero % 4) + 1]: 'gauche',
            [((monNumero + 1) % 4) + 1]: 'haut',
            [((monNumero + 2) % 4) + 1]: 'droite'
        };
        const posActif = mapPos[etatGlobal.tourActuel];
        if (posActif) {
            const advEl = document.getElementById('adv-' + posActif);
            if (advEl) advEl.classList.add('tour-actif');
        }
    }
    // --------------------------------------------

    const indicScore = document.getElementById('indicateur-score-pose');
    if (groupesPrepares && groupesPrepares.length > 0) {
        let scorePose = 0;
        groupesPrepares.forEach(g => {
            g.cartes.forEach(c => scorePose += c.points);
        });
        let targetScore = 60;
        const eq = etatGlobal.equipes[etatGlobal.monEquipe];
        if (eq && !eq.aOuvert) targetScore = eq.seuilOuverture || 60;
        else targetScore = 0;

        indicScore.style.display = 'flex';
        if (targetScore > 0) {
            indicScore.textContent = `Score : ${scorePose} / ${targetScore}`;
            indicScore.style.color = scorePose >= targetScore ? '#4ade80' : '#f87171';
            indicScore.style.borderColor = scorePose >= targetScore ? '#4ade80' : '#f87171';
        } else {
            indicScore.textContent = `Score : ${scorePose}`;
            indicScore.style.color = '#fff';
            indicScore.style.borderColor = "rgba(255,255,255,0.2)";
        }
    } else {
        indicScore.style.display = 'none';
    }

    if (etatGlobal.tourActuel === monNumero) {
        indic.innerHTML = '<span class="turn-dot"></span>Tour : Vous';
        indic.style.color = "var(--gold)";
        indic.style.borderColor = "var(--gold)";
    } else {
        const mapNoms = {};
        const partenaire = ((monNumero + 2 - 1) % 4) + 1;
        const gauche = (monNumero % 4) + 1;
        const droite = ((monNumero + 2) % 4) + 1;
        if (etatGlobal.nomsJoueurs) {
            mapNoms[partenaire] = etatGlobal.nomsJoueurs[partenaire]?.pseudo || "Partenaire";
            mapNoms[gauche] = etatGlobal.nomsJoueurs[gauche]?.pseudo || "Adv. Gauche";
            mapNoms[droite] = etatGlobal.nomsJoueurs[droite]?.pseudo || "Adv. Droite";
        } else {
            mapNoms[partenaire] = "Partenaire";
            mapNoms[gauche] = "Adv. Gauche";
            mapNoms[droite] = "Adv. Droite";
        }

        indic.innerHTML = `<span class="turn-dot" style="background:rgba(255,255,255,0.4);box-shadow:none;"></span>Tour : ${mapNoms[etatGlobal.tourActuel] || 'Joueur ' + etatGlobal.tourActuel}`;
        indic.style.color = "#fff";
        indic.style.borderColor = "rgba(255,255,255,0.2)";
    }
}

function rendrePioche(taille) {
    const pioche = document.getElementById('pioche');
    if (!pioche) return;
    
    pioche.innerHTML = `
        <div class="draw-layer" style="opacity:${taille > 2 ? 0.55 : 0}"></div>
        <div class="draw-layer" style="opacity:${taille > 1 ? 0.8 : 0}"></div>
        <div class="draw-layer" style="opacity:${taille > 0 ? 1 : 0.2}"></div>
        ${taille > 0 ? `<span class="pile-count">${taille} rest.</span>` : ''}
    `;
}

function rendreDefausse(carteDessus, taille) {
    const terre = document.getElementById('terre');
    if (!terre) return;
    terre.innerHTML = '';
    
    if (carteDessus) {
        let suitSymbol = { 'Coeur': '♥', 'Carreau': '♦', 'Trefle': '♣', 'Pique': '♠' }[carteDessus.couleur] || '';
        let val = carteDessus.valeur === 'Joker' ? '★' : carteDessus.valeur;
        let isGel = etatGlobal && etatGlobal.terreGelee;
        let colorClass = (carteDessus.couleur === 'Coeur' || carteDessus.couleur === 'Carreau') ? 'color:var(--red);' : 'color:#151515;';
        
        terre.style.background = '#fdfdfd';
        terre.style.border = '2px solid #fff';
        terre.innerHTML = `
            <span style="${colorClass}">${val}</span>
            <span style="${colorClass}">${suitSymbol}</span>
            ${isGel ? `<span class="frozen-badge"><svg class="icon"><use href="#i-lock"/></svg>Gelée</span>` : ''}
        `;
    } else {
        terre.innerHTML = '';
        terre.style.background = 'transparent';
        terre.style.border = '1px dashed rgba(255,255,255,0.3)';
    }

    if (taille > 0) {
        terre.innerHTML += `<div class="badge-terre">${taille}</div>`;
    }
}

// =============================================================================
// BOUCLE PRINCIPALE SOCKET.IO
// =============================================================================
socket.on('miseAJourEtat', (etat) => {
    etatGlobal = etat;
    if (etat.enJeu && ecranActuel !== 'jeu') {
        afficherEcran('jeu');
        cartesSelectionnees.clear();
        window.statsMisesAJour = false;
    }
    if (etat.monNumero) monNumero = etat.monNumero;

    // Toujours réinitialiser les groupes préparés sauf en cas d'erreur active
    if (!modeErreurPreparation) {
        groupesPrepares = [];
    }
    modeErreurPreparation = false;

    if (etat.maMain) rendreMain(etat.maMain);

    const monEq = etat.monEquipe || 1;
    const autreEq = monEq === 1 ? 2 : 1;

    if (etat.equipes) {
        // Render melds matching the Canasta layout
        rendreMelds(etat.equipes[monEq], 'melds-equipe');
        rendreMelds(etat.equipes[autreEq], 'melds-adversaire');
        rendreScoresEtTour(etat);
    }

    rendrePioche(etat.taillePioche);
    rendreDefausse(etat.carteDessusDefausse, etat.tailleDefausse);
    if (etat.tailleMains) rendreAdversaires(etat);
    mettreAJourBoutons();

    if (etat.dernierRecapManche && !etat.enJeu) {
        afficherRecap(etat.dernierRecapManche);
    } else if (etat.enJeu) {
        document.getElementById('modal-scores').style.display = 'none';
        // Only hide overlay if no other modal is showing
        if (document.getElementById('modal-sortie').style.display === 'none' && 
            document.getElementById('modal-victoire').style.display === 'none' &&
            document.getElementById('modal-vote').style.display === 'none' &&
            document.getElementById('modal-reconnexion').style.display === 'none') {
            document.getElementById('modal-overlay').style.display = 'none';
        }
    }
    
    // On ne lance afficherVictoire ici QUE si on n'a pas de recap à afficher, 
    // sinon c'est le bouton "Continuer" du recap qui lancera la victoire.
    if (etat.partieTerminee && !etat.dernierRecapManche) {
        afficherVictoire(etat.vainqueur, etat.equipes);
    }
    // Trigger tutorial tooltip positioning
    if (typeof showTutoStep === 'function') showTutoStep();
});

// Modals
function afficherRecap(recap) {
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById('modal-scores').style.display = 'block';
    
    let html = '<div style="display:flex; flex-wrap:wrap; gap:20px; text-align:left;">';
    for (let eq of [1, 2]) {
        let d = recap.equipes[eq];
        if (!d) continue;
        html += `<div style="flex:1; min-width:250px; background:rgba(0,0,0,0.2); padding:15px; border-radius:10px;">`;
        html += `<h3 style="color:${eq===etatGlobal.monEquipe?'#3498db':'#e74c3c'}; margin-top:0; text-align:center;">${eq===etatGlobal.monEquipe?'Notre Équipe':'Adversaires'}</h3>`;
        html += `<div class="ligne-score"><span>3 Rouges :</span><span>${d.detail.troisRouges}</span></div>`;
        let signPose = d.detail.pointsEnArriere ? '-' : '';
        html += `<div class="ligne-score"><span>Posé :</span><span style="color:${d.detail.pointsEnArriere?'indianred':'inherit'}">${signPose}${d.detail.valeurCombinaisons}</span></div>`;
        
        let pures = d.detail.canastas.filter(c=>c.pure).reduce((s,c)=>s+c.points,0);
        let impures = d.detail.canastas.filter(c=>!c.pure).reduce((s,c)=>s+c.points,0);
        html += `<div class="ligne-score"><span>Canastas Pures :</span><span>${pures}</span></div>`;
        html += `<div class="ligne-score"><span>Canastas Impures :</span><span>${impures}</span></div>`;
        
        if (d.detail.bonusSortie) {
            html += `<div class="ligne-score" style="color:var(--gold)"><span>Sortie :</span><span>${d.detail.bonusSortie}</span></div>`;
        }
        html += `<div class="ligne-score" style="color:var(--red)"><span>Main restante :</span><span>-${d.detail.valeurMainRestante}</span></div>`;
        html += `<div class="ligne-score" style="margin-top:10px;"><span>TOTAL MANCHE :</span><span>${d.pointsManche}</span></div>`;
        html += `<div class="ligne-score" style="color:var(--gold); font-size:1.2em;"><span>SCORE GLOBAL :</span><span>${d.scoreTotal}</span></div>`;
        html += `</div>`;
    }
    html += '</div>';
    const btn = document.getElementById('btn-fermer-scores');
    
    // Si la partie est terminée, tout le monde peut cliquer pour voir la victoire
    if (etatGlobal && etatGlobal.partieTerminee) {
        btn.textContent = 'Voir le Vainqueur !';
        btn.style.background = 'var(--gold)';
        btn.disabled = false;
    } else {
        const hoteActuel = window.idHoteActuel || (etatGlobal && etatGlobal.hote);
        if (hoteActuel === socket.id) {
            btn.textContent = 'Continuer ▶';
            btn.style.background = 'var(--green)';
            btn.disabled = false;
        } else {
            btn.textContent = "Attente de l'hôte...";
            btn.style.background = '#666';
            btn.disabled = true;
        }
    }

    document.getElementById('contenu-scores').innerHTML = html;
}

document.getElementById('btn-fermer-scores').addEventListener('click', () => {
    if (etatGlobal && etatGlobal.partieTerminee) {
        document.getElementById('modal-scores').style.display = 'none';
        afficherVictoire(etatGlobal.vainqueur, etatGlobal.equipes);
        return;
    }

    const hoteActuel = window.idHoteActuel || (etatGlobal && etatGlobal.hote);
    if (hoteActuel === socket.id) {
        socket.emit('demandeNouvelleManche');
        const btn = document.getElementById('btn-fermer-scores');
        btn.textContent = "Démarrage...";
        btn.disabled = true;
    }
});

function afficherVictoire(vainqueur, equipes) {
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById('modal-victoire').style.display = 'block';
    sons.jouer('victoire');
    if (vainqueur === etatGlobal.monEquipe && typeof confetti === 'function') {
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
    }
    
    const txt = document.getElementById('texte-victoire');
    if (vainqueur === etatGlobal.monEquipe) {
        txt.innerHTML = `Félicitations ! Votre équipe a gagné avec ${equipes[vainqueur].score} points !`;
        txt.style.color = "var(--green)";
    } else {
        txt.innerHTML = `Dommage... L'équipe adverse gagne avec ${equipes[vainqueur].score} points.`;
        txt.style.color = "var(--red)";
    }
    
    // Update stats in localStorage
    if (!window.statsMisesAJour) {
        window.statsMisesAJour = true; // Prevent double trigger
        let stats = JSON.parse(localStorage.getItem('canastaStats') || '{"jouees":0, "gagnees":0, "meilleurScore":0}');
        stats.jouees++;
        if (vainqueur === etatGlobal.monEquipe) stats.gagnees++;
        if (equipes[etatGlobal.monEquipe].score > stats.meilleurScore) {
            stats.meilleurScore = equipes[etatGlobal.monEquipe].score;
        }
        localStorage.setItem('canastaStats', JSON.stringify(stats));
        mettreAJourStatsUI();
    }
}

document.getElementById('btn-retour-lobby').addEventListener('click', () => {
    localStorage.removeItem('canastaTutoEtape');
    document.getElementById('modal-victoire').style.display = 'none';
    document.getElementById('modal-overlay').style.display = 'none';
    socket.emit('quitterSalon');
    afficherEcran('menu-principal');
});

socket.on('questionSortie', () => {
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById('modal-sortie').style.display = 'block';
    sons.jouer('carte');
});

document.getElementById('btn-accepter-sortie').addEventListener('click', () => {
    socket.emit('reponseSortie', true);
    document.getElementById('modal-sortie').style.display = 'none';
    document.getElementById('modal-overlay').style.display = 'none';
});

document.getElementById('btn-refuser-sortie').addEventListener('click', () => {
    socket.emit('reponseSortie', false);
    document.getElementById('modal-sortie').style.display = 'none';
    document.getElementById('modal-overlay').style.display = 'none';
});

socket.on('resultatSortie', (data) => {
    if (data.accepte || data === true) {
        toast("Votre allié accepte ! Vous pouvez sortir.", "success");
    } else {
        toast("Votre allié a refusé que vous sortiez.", "error");
    }
});
// =============================================================================
// RECONNEXION ET ANTI-FREEZE MOBILE
// =============================================================================
socket.on('connect', () => {
    let token = localStorage.getItem('canastaToken');
    if (!token) {
        token = 'tk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('canastaToken', token);
    }
    
    let pseudo = localStorage.getItem('canastaPseudo');
    if (!pseudo) {
        pseudo = document.getElementById('input-pseudo') ? document.getElementById('input-pseudo').value : 'Joueur';
        if (!pseudo.trim()) pseudo = 'Joueur';
    }
    
    localStorage.setItem('canastaPseudo', pseudo);
    
    socket.emit('setProfil', { pseudo, avatar: currentAvatar, token, dbId: localStorage.getItem('canastaAuthToken') });
    socket.emit('verifierReconnexion');
    
    const oldId = localStorage.getItem('canastaSessionId');
    if (token) {
        socket.emit('tentativeReconnexion', token);
    }
    localStorage.setItem('canastaSessionId', socket.id);
    
    // Après reconnexion, toujours rafraîchir l'état si on est en jeu
    if (ecranActuel === 'jeu') {
        setTimeout(() => socket.emit('demandeRafraichissement'), 1000);
    }
});

// Send updated profile when creating a room
document.getElementById('btn-creer-salon').addEventListener('click', () => {
    const pseudo = localStorage.getItem('canastaPseudo') || 'Joueur';
    const token = localStorage.getItem('canastaToken');
    socket.emit('setProfil', { pseudo, avatar: currentAvatar, token, dbId: localStorage.getItem('canastaAuthToken') });
});

// UI DYNAMIQUE POUR LE VOTE DE DÉCONNEXION
socket.on('demandeVoteDeconnexion', (data) => {
    document.getElementById('titre-vote').textContent = `Déconnexion de ${data.pseudo}`;
    document.getElementById('texte-vote').textContent = `Le joueur ${data.pseudo} a été déconnecté (appel, perte de réseau...). Que voulez-vous faire ?`;
    
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById('modal-vote').style.display = 'block';
    
    document.getElementById('btn-vote-attendre').onclick = () => {
        socket.emit('soumettreVoteDeconnexion', { numeroJoueur: data.numeroJoueur, choix: 'attendre' });
        document.getElementById('modal-vote').style.display = 'none';
        document.getElementById('modal-overlay').style.display = 'none';
        toast("Vote 'Attendre' envoyé.");
    };
    
    document.getElementById('btn-vote-bot').onclick = () => {
        socket.emit('soumettreVoteDeconnexion', { numeroJoueur: data.numeroJoueur, choix: 'bot' });
        document.getElementById('modal-vote').style.display = 'none';
        document.getElementById('modal-overlay').style.display = 'none';
        toast("Vote 'Remplacer par un bot' envoyé.");
    };
});

// UI DYNAMIQUE POUR LA RECONNEXION
socket.on('reconnexionDisponible', (data) => {
    // Si on est déjà dans le jeu, ignorer
    if (document.getElementById('ecran-jeu').style.display === 'block') return;
    
    document.getElementById('texte-reconnexion').textContent = `Vous avez été déconnecté du salon "${data.nomSalon}". Voulez-vous reprendre votre place ?`;
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById('modal-reconnexion').style.display = 'block';
    
    document.getElementById('btn-accepter-reconnexion').onclick = () => {
        socket.emit('rejoindrePartieDeconnectee');
        document.getElementById('modal-reconnexion').style.display = 'none';
        document.getElementById('modal-overlay').style.display = 'none';
    };
    
    document.getElementById('btn-refuser-reconnexion').onclick = () => {
        socket.emit('ignorerReconnexion', { nomSalon: data.nomSalon, idSalon: data.idSalon });
        document.getElementById('modal-reconnexion').style.display = 'none';
        document.getElementById('modal-overlay').style.display = 'none';
    };
});

// LOGIN & MENU ACTIONS
// NEW AUTH UI ACTIONS
document.getElementById('btn-show-login').addEventListener('click', () => {
    document.getElementById('auth-main-options').style.display = 'none';
    document.getElementById('auth-login-form').style.display = 'flex';
});
document.getElementById('btn-show-register').addEventListener('click', () => {
    document.getElementById('auth-main-options').style.display = 'none';
    document.getElementById('auth-register-form').style.display = 'flex';
});
document.querySelectorAll('.btn-retour-auth').forEach(btn => {
    btn.addEventListener('click', () => {
        document.getElementById('auth-login-form').style.display = 'none';
        document.getElementById('auth-register-form').style.display = 'none';
        document.getElementById('auth-main-options').style.display = 'flex';
    });
});

document.getElementById('btn-do-login').addEventListener('click', () => {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    if (!username || !password) return toast("Remplissez tous les champs", "error");
    socket.emit('auth:login', { username, password });
});

document.getElementById('btn-do-register').addEventListener('click', () => {
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value;
    if (!username || !password) return toast("Remplissez tous les champs", "error");
    socket.emit('auth:register', { username, password, avatar: currentAvatar });
});

document.getElementById('btn-auth-guest').addEventListener('click', () => {
    socket.emit('auth:guest');
});

document.getElementById('btn-menu-solo').addEventListener('click', () => {
    localStorage.removeItem('canastaTutoEtape');
    socket.emit('demandePartieSolo');
    toast("Création de la partie...", "info");
});

document.getElementById('btn-menu-multi').addEventListener('click', () => {
    localStorage.removeItem('canastaTutoEtape');
    afficherEcran('lobby');
});

document.getElementById('btn-menu-tuto').addEventListener('click', () => {
    toast("Bientôt disponible ! Le tutoriel est en cours d'amélioration.", "info");
    // socket.emit('demandePartieTuto');
    // localStorage.setItem('canastaTutoEtape', '1');
    // toast("Lancement du tutoriel...", "info");
});

document.getElementById('btn-lobby-retour').addEventListener('click', () => {
    afficherEcran('menu-principal');
});

// Update the disconnected events visually
socket.on('joueurDeconnecte', (numero) => {
    toast(`Joueur ${numero} est déconnecté (En attente...)`, 'warning');
    // We could grey out the avatar here
    const mapPos = {
        [(monNumero % 4) + 1]: 'gauche',
        [((monNumero + 1) % 4) + 1]: 'haut',
        [((monNumero + 2) % 4) + 1]: 'droite'
    };
    const pos = mapPos[numero];
    if (pos) {
        const adv = document.getElementById('adv-' + pos);
        if (adv) adv.style.opacity = '0.4';
    }
});

socket.on('joueurReconnecte', (numero) => {
    toast(`Joueur ${numero} s'est reconnecté !`, 'success');
    const mapPos = {
        [(monNumero % 4) + 1]: 'gauche',
        [((monNumero + 1) % 4) + 1]: 'haut',
        [((monNumero + 2) % 4) + 1]: 'droite'
    };
    const pos = mapPos[numero];
    if (pos) {
        const adv = document.getElementById('adv-' + pos);
        if (adv) adv.style.opacity = '1';
    }
});


document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (!socket.connected) {
            socket.connect();
        }
        // Toujours tenter un rafraîchissement quand on revient sur le jeu
        // La connexion peut être stale même si socket.connected est true
        if (ecranActuel === 'jeu') {
            setTimeout(() => {
                if (socket.connected) {
                    socket.emit('demandeRafraichissement');
                }
            }, 500);
        }
    }
});


let currentAvatar = '👤';
document.addEventListener('DOMContentLoaded', () => {
    // Restore profile
    const savedPseudo = localStorage.getItem('canastaPseudo');
    if (savedPseudo) {
        const loginEl = document.getElementById('login-username');
        const regEl = document.getElementById('register-username');
        if (loginEl) loginEl.value = savedPseudo;
        if (regEl) regEl.value = savedPseudo;
    }
    
    const savedAvatar = localStorage.getItem('canastaAvatar');
    if (savedAvatar) currentAvatar = savedAvatar;
    
    const options = document.querySelectorAll('.avatar-option');
    options.forEach(opt => {
        if (opt.dataset.avatar === currentAvatar) {
            options.forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
        }
        opt.addEventListener('click', () => {
            options.forEach(o => {
                o.classList.remove('selected');
                o.style.borderColor = 'transparent';
                o.style.background = 'transparent';
            });
            opt.classList.add('selected');
            opt.style.borderColor = 'var(--gold)';
            opt.style.background = 'rgba(255,255,255,0.2)';
            currentAvatar = opt.dataset.avatar;
            localStorage.setItem('canastaAvatar', currentAvatar);
        });
    });
});

// ANIMATIONS
function animerCarte(sourceEl, destEl, classNameSupp, innerHTML) {
    if (!sourceEl || !destEl) return;
    
    // Si source ou dest est un adversaire, cibler sa main (hand-fan) plutôt que tout le bloc
    const realSource = sourceEl.querySelector('.hand-fan') || sourceEl;
    const realDest = destEl.querySelector('.hand-fan') || destEl;

    const tempCard = document.createElement('div');
    tempCard.className = 'animated-card-throw ' + (classNameSupp || '');
    if (innerHTML) tempCard.innerHTML = innerHTML;
    document.body.appendChild(tempCard);

    const rectSource = realSource.getBoundingClientRect();
    const rectDest = realDest.getBoundingClientRect();
    
    // Attendre que la carte soit rendue pour avoir ses dimensions réelles
    requestAnimationFrame(() => {
        const cardRect = tempCard.getBoundingClientRect();
        const cardW = cardRect.width || 26;
        const cardH = cardRect.height || 36;
        
        const startX = rectSource.left + rectSource.width / 2 - cardW / 2;
        const startY = rectSource.top + rectSource.height / 2 - cardH / 2;
        
        tempCard.style.left = startX + 'px';
        tempCard.style.top = startY + 'px';
        
        // Setup transition pour avoir une belle courbe
        tempCard.style.transition = 'all 0.5s cubic-bezier(0.25, 1, 0.5, 1)';
        
        requestAnimationFrame(() => {
            const endX = rectDest.left + rectDest.width / 2 - cardW / 2;
            const endY = rectDest.top + rectDest.height / 2 - cardH / 2;
            
            // Calculer un léger décalage pour l'arc de cercle
            const midX = (startX + endX) / 2;
            const midY = (startY + endY) / 2;
            const curveOffset = 50; // pixels
            
            tempCard.style.left = endX + 'px';
            tempCard.style.top = endY + 'px';
            tempCard.style.transform = 'scale(1.2) rotate(360deg)';
            tempCard.style.opacity = '0';
        });
    });
    
    setTimeout(() => {
        if (tempCard.parentNode) tempCard.parentNode.removeChild(tempCard);
    }, 500);
}

window.cartesSurlignees = [];
socket.on('animationDescendre', (data) => {
    let numeroJoueur = data;
    let cartesAjoutees = [];
    if (typeof data === 'object') {
        numeroJoueur = data.numeroJoueur;
        cartesAjoutees = data.cartesAjoutees || [];
    }

    if (numeroJoueur === monNumero) return; // on ne s'anime pas soi-même (déjà vu)
    
    const mapPos = {
        [(monNumero % 4) + 1]: 'gauche',
        [((monNumero + 1) % 4) + 1]: 'haut',
        [((monNumero + 2) % 4) + 1]: 'droite'
    };
    const pos = mapPos[numeroJoueur];
    if (!pos) return;
    
    const adv = document.getElementById('adv-' + pos);
    const estEux = (numeroJoueur % 2 !== monNumero % 2);
    const dest = document.getElementById(estEux ? 'melds-adversaire' : 'melds-equipe');
    
    animerCarte(adv, dest, '');

    // Set global highlight variable to be picked up by rendreMelds
    if (cartesAjoutees.length > 0) {
        window.cartesSurlignees = cartesAjoutees;
        setTimeout(() => {
            window.cartesSurlignees = [];
            // Remove highlight classes manually after 2 seconds
            document.querySelectorAll('.highlight-card-glow').forEach(el => {
                el.classList.remove('highlight-card-glow');
                el.style.backgroundColor = '';
                el.style.removeProperty('--glow-color');
            });
        }, 2000);
    }
});

socket.on('animationJeter', (numeroJoueur) => {
    if (numeroJoueur === monNumero) return;
    
    const mapPos = {
        [(monNumero % 4) + 1]: 'gauche',
        [((monNumero + 1) % 4) + 1]: 'haut',
        [((monNumero + 2) % 4) + 1]: 'droite'
    };
    const pos = mapPos[numeroJoueur];
    if (!pos) return;
    
    const adv = document.getElementById('adv-' + pos);
    const terre = document.getElementById('terre');
    
    animerCarte(adv, terre, '');
});

// Settings & Quit
const btnMenu = document.querySelector('.menu-btn');
if(btnMenu) {
    btnMenu.addEventListener('click', () => {
        document.getElementById('modal-overlay').style.display = 'flex';
        document.getElementById('modal-parametres').style.display = 'block';
    });
}
const btnFermerParam = document.getElementById('btn-fermer-parametres');
if(btnFermerParam) {
    btnFermerParam.addEventListener('click', () => {
        document.getElementById('modal-overlay').style.display = 'none';
        document.getElementById('modal-parametres').style.display = 'none';
    });
}
const btnQuitterJeu = document.getElementById('btn-quitter-jeu');
if(btnQuitterJeu) {
    btnQuitterJeu.addEventListener('click', () => {
        localStorage.removeItem('canastaTutoEtape');
        socket.emit('quitterVolontaire');
        window.location.reload();
    });
}


socket.on('animationPiocher', (data) => {
    if (data.joueur === monNumero && data.cartesRecues) {
        cartesRecemmentPiochees.clear();
        data.cartesRecues.forEach(c => cartesRecemmentPiochees.add(c.id));
        setTimeout(() => {
            cartesRecemmentPiochees.clear();
            rendreMain(etatGlobal ? etatGlobal.maMain : []);
        }, 3000);
    }

    let dest = null;
    if (data.joueur === monNumero) {
        dest = document.getElementById('conteneur-main');
    } else {
        const mapPos = {
            [(monNumero % 4) + 1]: 'gauche',
            [((monNumero + 1) % 4) + 1]: 'haut',
            [((monNumero + 2) % 4) + 1]: 'droite'
        };
        const pos = mapPos[data.joueur];
        if (pos) dest = document.getElementById('adv-' + pos);
    }
    
    const source = document.getElementById('pioche');
    if (source && dest) {
        for(let i=0; i<data.nbCartes; i++) {
            setTimeout(() => {
                
let innerHTML = null;
let cls = 'mini-back';
if (data.cartesRecues && data.cartesRecues[i]) {
    const c = data.cartesRecues[i];
    const suitMap = { 'Coeur': '♥', 'Carreau': '♦', 'Trefle': '♣', 'Pique': '♠' };
    const suitSymbol = suitMap[c.couleur] || c.couleur;
    const isRed = (c.couleur === 'Coeur' || c.couleur === 'Carreau');
    cls = 'animated-card-throw animated-face' + (isRed ? ' red' : '');
    innerHTML = `<div class="idx tl"><span>${c.valeur}</span><span>${suitSymbol}</span></div><div class="pip">${suitSymbol}</div><div class="idx br"><span>${c.valeur}</span><span>${suitSymbol}</span></div>`;
}
animerCarte(source, dest, cls, innerHTML);


            }, i * 200);
        }
    }
});

function mettreAJourStatsUI() {
    let stats = JSON.parse(localStorage.getItem('canastaStats') || '{"jouees":0, "gagnees":0, "meilleurScore":0, "xp":0}');
    const elG = document.getElementById('stat-gagnees');
    const elJ = document.getElementById('stat-jouees');
    const elR = document.getElementById('stat-record');
    if (elG) elG.textContent = stats.gagnees || 0;
    if (elJ) elJ.textContent = stats.jouees || 0;
    if (elR) elR.textContent = stats.meilleurScore || 0;
    
    if (stats.xp !== undefined && document.getElementById('barre-xp')) {
        const niveau = calculerNiveau(stats.xp);
        document.getElementById('texte-niveau').textContent = "Niveau " + niveau;
        document.getElementById('texte-xp').textContent = stats.xp + " XP";
        
        const xpPrecedent = niveau === 1 ? 0 : Math.pow((niveau-1)*10, 2);
        const xpSuivant = Math.pow(niveau*10, 2);
        const progress = ((stats.xp - xpPrecedent) / (xpSuivant - xpPrecedent)) * 100;
        
        document.getElementById('barre-xp').style.width = Math.max(0, Math.min(progress, 100)) + "%";
    }
}document.addEventListener('DOMContentLoaded', mettreAJourStatsUI);

socket.on('auth:success', (res) => {
    if (res.userId) {
        localStorage.setItem('canastaAuthToken', res.userId); // Simplified for this prototype
    } else {
        localStorage.removeItem('canastaAuthToken'); // Guest
    }
    
    const pseudo = res.username;
    localStorage.setItem('canastaPseudo', pseudo);
    currentAvatar = res.avatar;
    localStorage.setItem('canastaAvatar', currentAvatar);
    
    // Save DB ID in profilsJoueurs via setProfil
    socket.emit('setProfil', { pseudo, avatar: currentAvatar, token: localStorage.getItem('canastaToken'), dbId: res.userId });
    
    // Set stats in localStorage temporarily for UI
    if (res.stats) {
        localStorage.setItem('canastaStats', JSON.stringify(res.stats));
    } else {
        localStorage.setItem('canastaStats', '{"jouees":0, "gagnees":0, "meilleurScore":0}');
    }
    
    document.getElementById('menu-display-pseudo').textContent = pseudo;
    document.getElementById('menu-display-avatar').textContent = currentAvatar;
    
    mettreAJourStatsUI();
    afficherEcran('menu-principal');
    toast(`Bienvenue ${pseudo} !`, 'success');
});

socket.on('auth:error', (msg) => {
    toast(msg, 'error');
});

// LEADERBOARD & XP LOGIC
function calculerNiveau(xp) {
    return Math.floor(Math.sqrt(xp) / 10) + 1;
}

function getXpPourNiveauSuivant(niveau) {
    return Math.pow((niveau) * 10, 2); // To go from level N to N+1
}

document.getElementById('btn-menu-classement').addEventListener('click', () => {
    socket.emit('getLeaderboard');
    document.getElementById('modal-classement').style.display = 'flex';
});

document.getElementById('btn-fermer-classement').addEventListener('click', () => {
    document.getElementById('modal-classement').style.display = 'none';
});

socket.on('leaderboardData', (rows) => {
    const listEl = document.getElementById('liste-classement');
    listEl.innerHTML = '';
    if (!rows || rows.length === 0) {
        listEl.innerHTML = '<div style="color:white; text-align:center;">Aucun joueur classé pour le moment.</div>';
        return;
    }
    
    rows.forEach((row, index) => {
        let badgeColor = '#555';
        if (index === 0) badgeColor = '#ffd700'; // Gold
        else if (index === 1) badgeColor = '#c0c0c0'; // Silver
        else if (index === 2) badgeColor = '#cd7f32'; // Bronze
        
        const niveau = calculerNiveau(row.xp);
        
        listEl.innerHTML += `<div style="display:flex; align-items:center; background:rgba(0,0,0,0.3); padding:10px; border-radius:12px; gap:10px;">
            <div style="width:30px; height:30px; border-radius:50%; background:${badgeColor}; color:white; display:flex; justify-content:center; align-items:center; font-weight:bold;">${index + 1}</div>
            <div style="font-size:1.8rem;">${row.avatar || '🐤'}</div>
            <div style="flex-grow:1;">
                <div style="color:white; font-weight:bold;">${row.username}</div>
                <div style="color:var(--gold); font-size:0.8rem;">Niv ${niveau} • ${row.xp} XP</div>
            </div>
            <div style="text-align:right;">
                <div style="color:var(--green); font-size:0.9rem; font-weight:bold;">${row.best_score} pts</div>
                <div style="color:#aaa; font-size:0.8rem;">${row.games_won} V.</div>
            </div>
        </div>`;
    });
});


// REGLES LOGIC
const modalRegles = document.getElementById('modal-regles');
const btnMenuRegles = document.getElementById('btn-menu-regles');
const btnParamRegles = document.getElementById('btn-param-regles');
const btnFermerRegles = document.getElementById('btn-fermer-regles');

if (btnMenuRegles) {
    btnMenuRegles.addEventListener('click', () => {
        modalRegles.style.display = 'flex';
    });
}
if (btnParamRegles) {
    btnParamRegles.addEventListener('click', () => {
        modalRegles.style.display = 'flex';
    });
}
if (btnFermerRegles) {
    btnFermerRegles.addEventListener('click', () => {
        modalRegles.style.display = 'none';
    });
}
