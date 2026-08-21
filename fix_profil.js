const fs = require('fs');
let srv = fs.readFileSync('serveur.js', 'utf8');

// 1. Add profilsJoueurs globally
if (!srv.includes('const profilsJoueurs = {};')) {
    srv = srv.replace('let deconnexionsPendantPartie = {};', "let deconnexionsPendantPartie = {};\nconst profilsJoueurs = {};");
}

// 2. Add setProfil listener
if (!srv.includes("socket.on('setProfil'")) {
    const listener = `
    socket.on('setProfil', (data) => {
        profilsJoueurs[socket.id] = { pseudo: data.pseudo, avatar: data.avatar };
        const salon = getSalonPourSocket(socket.id);
        if (salon) {
            envoyerMiseAJourSalon(salon);
            diffuserEtatGlobal(salon);
        }
    });
    `;
    srv = srv.replace("socket.on('listerSalons', () => {", listener + "\n    socket.on('listerSalons', () => {");
}

// 3. Update envoyerMiseAJourSalon to use profilsJoueurs
const oldEnvoyer = `function envoyerMiseAJourSalon(salon) {
    const joueursArray = [];
    for (let sId in salon.joueurs) {
        joueursArray.push({
            numero: salon.joueurs[sId],
            nom: sId.startsWith('bot-') ? 'Bot' : 'Joueur',
            estBot: sId.startsWith('bot-')
        });
    }`;
const newEnvoyer = `function envoyerMiseAJourSalon(salon) {
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
    }`;
if (srv.includes("nom: sId.startsWith('bot-') ? 'Bot' : 'Joueur',") && !srv.includes("avatar = profilsJoueurs")) {
    srv = srv.replace(oldEnvoyer, newEnvoyer);
}

// 4. Update diffuserEtatGlobal to inject nomsJoueurs
const oldDiffuser = `function diffuserEtatGlobal(salon) {
    if (!salon || !salon.partie) return;
    for (let idConnexion in salon.joueurs) {
        if (idConnexion.startsWith('bot-')) continue;
        let num = salon.joueurs[idConnexion];
        let etatJoueur = salon.partie.getEtatPourJoueur(num);
        io.to(idConnexion).emit('miseAJourEtat', etatJoueur);
    }`;

const newDiffuser = `function diffuserEtatGlobal(salon) {
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
    }`;

if (srv.includes(oldDiffuser)) {
    srv = srv.replace(oldDiffuser, newDiffuser);
}

fs.writeFileSync('serveur.js', srv);
console.log("serveur.js patched with profiles");
