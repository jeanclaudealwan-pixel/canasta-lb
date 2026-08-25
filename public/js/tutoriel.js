// =============================================================
// CANASTA LIBANAISE - TUTORIEL COMPLET PRO v4
// Progression 100% manuelle, scenario double groupe
// =============================================================
(function() {
    'use strict';

    var TOTAL_STEPS = 21;

    var STEPS = {
        1: {
            title: 'Bienvenue dans la Canasta Libanaise !',
            desc: 'Jeu de cartes en equipe (2 contre 2). Objectif : etre la premiere equipe a atteindre 15 000 points en plusieurs manches.',
            highlight: null, action: 'manual'
        },
        2: {
            title: 'Les cartes et leurs valeurs',
            desc: 'Joker = 50 pts | 2 = 25 pts | As = 20 pts | 8 a Roi = 10 pts | 4 a 7 = 5 pts. On joue avec 3 paquets + 6 Jokers (162 cartes).',
            highlight: '#conteneur-main', action: 'manual'
        },
        3: {
            title: 'Cartes speciales : les Jokers et les 2',
            desc: 'Les Jokers et les 2 sont des "wildcards" : ils remplacent n\'importe quelle carte dans un groupe. Mais il faut toujours PLUS de cartes naturelles que de wildcards.',
            highlight: null, action: 'manual'
        },
        4: {
            title: 'Cartes speciales : les 3 Rouges',
            desc: '3 de Coeur/Carreau = +100 pts bonus chacun (si vous avez ouvert et avez une Canasta). Sinon, -100 pts de penalite ! Ils sont poses automatiquement.',
            highlight: null, action: 'manual'
        },
        5: {
            title: 'Cartes speciales : les 3 Noirs',
            desc: '3 de Trefle/Pique = cartes de blocage. Impossible de les combiner. Jetez-en un pour bloquer la terre au joueur suivant !',
            highlight: null, action: 'manual'
        },
        6: {
            title: 'Debut de tour : Piochez !',
            desc: 'Chaque tour commence par piocher 2 cartes. Cliquez sur la pioche (le tas au centre) pour commencer votre tour.',
            highlight: '#pioche', action: 'pioche'
        },
        7: {
            title: 'Le Score d\'Ouverture',
            desc: 'Pour poser la 1ere fois, il faut un minimum de points : < 3000 = 60 pts | 3000-4999 = 90 pts | 5000-6999 = 120 pts | 7000+ = 160 pts.',
            highlight: '#score-nous', action: 'manual'
        },
        8: {
            title: 'Preparez le 1er groupe',
            desc: 'Vous avez besoin de 60 points pour ouvrir. Touchez vos 3 Rois (R) un par un pour les selectionner. Un groupe valide = 3+ cartes.',
            highlight: '#conteneur-main', action: 'select3_1'
        },
        9: {
            title: 'Verrouillez le 1er groupe',
            desc: 'Le cadenas est apparu. Cliquez dessus pour preparer votre groupe de Rois (30 points).',
            highlight: '#btn-lock', action: 'lock1'
        },
        10: {
            title: 'Preparez un 2eme groupe',
            desc: 'Les 3 Rois valent 30 pts. C\'est insuffisant (il faut 60). Touchez vos 3 As (A) un par un pour les selectionner et creer un 2eme groupe.',
            highlight: '#conteneur-main', action: 'select3_2'
        },
        11: {
            title: 'Verrouillez les As',
            desc: 'Cliquez sur le cadenas pour preparer ce 2eme groupe. Les As valent 20 pts chacun, donc ce groupe vaut 60 points !',
            highlight: '#btn-lock', action: 'lock2'
        },
        12: {
            title: 'Posez vos groupes',
            desc: 'Avec 90 points (30 + 60), vous depassez le minimum ! Cliquez sur le bouton POSER.',
            highlight: '#btn-poser', action: 'poser'
        },
        13: {
            title: 'Confirmez l\'ouverture',
            desc: 'Vos groupes sont en attente. Cliquez sur le GROS BOUTON VERT (Valider) en bas a droite pour confirmer la pose !',
            highlight: '#btn-valider-pose', action: 'valider'
        },
                14: {
            title: 'Terminez votre tour : Jetez !',
            desc: 'Selectionnez 1 carte de votre main puis cliquez JETER. Elle va sur la defausse au centre. C\'est au joueur suivant !',
            highlight: '#btn-jeter', action: 'jeter'
        },
        14.5: {
            title: 'Tour des adversaires',
            desc: 'Les bots vont jouer leur tour rapidement. Patientez quelques secondes le temps que la main vous revienne !',
            highlight: '', action: 'wait'
        },
        15: {
            title: 'La Defausse (Terre)',
            desc: 'C\'est a vous ! Nous avons glisse 2 cartes identiques a la defausse dans votre main. Selectionnez-les (2 cartes), puis touchez la defausse au centre pour la ramasser !',
            highlight: '#terre', action: 'ramasser'
        },
        16: {
            title: 'Terre Gelee',
            desc: 'Si un Joker ou un 2 est dans la defausse, elle est "gelee" : il faut 3 cartes naturelles pour la prendre (au lieu de 2). Impossible si un Joker/2/3 Noir est dessus.',
            highlight: '#terre', action: 'manual'
        },
        17: {
            title: 'La Canasta (7+ cartes)',
            desc: 'Un groupe de 7 cartes ou plus = une Canasta ! C\'est obligatoire pour pouvoir sortir et terminer la manche.',
            highlight: '#melds-equipe', action: 'manual'
        },
        18: {
            title: 'Canasta Pure vs Impure',
            desc: 'Pure (sans wildcards) : +500 pts bonus. Impure (avec Joker/2) : +350 pts. Pour les As : Pure +1500 / Impure +750. Pour les 2 : Pure +3000 / Impure +1500 !',
            highlight: '#melds-equipe', action: 'manual'
        },
        19: {
            title: 'Condition de Sortie',
            desc: 'Pour vider votre main et finir la manche, votre equipe doit avoir AU MINIMUM 1 Canasta Pure ET 1 Canasta Impure. Sinon, vous ne pouvez pas jeter votre derniere carte !',
            highlight: null, action: 'manual'
        },
        20: {
            title: 'Calcul du Score',
            desc: 'Score = Bonus de sortie (+350) + Bonus Canastas + Valeur des cartes posees + 3 Rouges - Cartes restantes en main. Attention : 0 Canasta = vos cartes comptent en negatif !',
            highlight: null, action: 'manual'
        },
        21: {
            title: 'Vous etes pret !',
            desc: 'La partie continue. Formez des Canastas, prenez la terre quand c\'est avantageux, et visez les 15 000 pts. Bonne chance !',
            highlight: null, action: 'fin'
        }
    };

    function getBanner() { return document.getElementById('tuto-banner'); }

    function endTuto() {
        localStorage.removeItem('canastaTutoEtape');
        var b = getBanner();
        if (b) b.style.display = 'none';
        document.querySelectorAll('.tuto-highlight').forEach(function(el) {
            el.classList.remove('tuto-highlight');
        });
    }

    function showTutoStep() {
        var etape = parseFloat(localStorage.getItem('canastaTutoEtape'));
        var banner = getBanner();
        if (!banner) return;

        if (!etape || etape < 1 || etape > TOTAL_STEPS) {
            banner.style.display = 'none';
            document.querySelectorAll('.tuto-highlight').forEach(function(el) {
                el.classList.remove('tuto-highlight');
            });
            return;
        }

        var step = STEPS[etape];
        if (!step) return;

        banner.style.display = 'block';
        

        var badge = document.getElementById('tuto-badge');
        var title = document.getElementById('tuto-title');
        var desc = document.getElementById('tuto-desc');
        var progress = document.getElementById('tuto-progress');
        var skipBtn = document.getElementById('tuto-skip');

        if (badge) badge.textContent = etape;
        if (title) title.textContent = step.title;
        if (desc) desc.textContent = step.desc;
        if (progress) progress.style.width = Math.round((etape / TOTAL_STEPS) * 100) + '%';
        
        if (skipBtn) {
            if (etape === TOTAL_STEPS) {
                skipBtn.textContent = 'Terminer';
                skipBtn.style.display = 'block';
            } else if (step.action === 'manual') {
                skipBtn.textContent = 'Suivant';
                skipBtn.style.display = 'block';
                skipBtn.style.background = 'linear-gradient(135deg, #1c9e5c, #0d6238)';
                skipBtn.style.color = '#fff';
                skipBtn.style.border = 'none';
            } else {
                skipBtn.style.display = 'none'; // Hide skip button on interactive steps! They MUST do the action.
            }
        }

        // Remove old highlights
        document.querySelectorAll('.tuto-highlight').forEach(function(el) {
            el.classList.remove('tuto-highlight');
        });

        // Add highlight
        if (step.highlight) {
            var el = document.querySelector(step.highlight);
            if (el) el.classList.add('tuto-highlight');
        }
    }

    function advanceTuto(fromStep) {
        var current = parseFloat(localStorage.getItem('canastaTutoEtape'));
        if (current === fromStep) {
            if (fromStep >= TOTAL_STEPS) {
                endTuto();
            } else {
                var next = (fromStep === 14) ? 14.5 : ((fromStep === 14.5) ? 15 : fromStep + 1);
                localStorage.setItem('canastaTutoEtape', String(next));
                if (next === 15 && window.socket) { window.socket.emit('demandeTricheTutoRamasser'); }
                showTutoStep();
            }
        }
    }

    window.showTutoStep = showTutoStep;
    window.advanceTuto = advanceTuto;
    window.endTuto = endTuto;

    document.addEventListener('DOMContentLoaded', function() {

    // Tuto Click Interceptor
    document.addEventListener('click', function(e) {
        var stepNum = parseFloat(localStorage.getItem('canastaTutoEtape'));
        if (!stepNum) return;
        var step = STEPS[stepNum];
        if (!step) return;

        var actionsMap = {
            '#pioche': 'pioche',
            '#terre': 'ramasser',
            '#btn-lock': 'lock',
            '#btn-poser': 'poser',
            '#btn-valider-pose': 'valider',
            '#btn-annuler-pose': 'annuler',
            '#btn-jeter': 'jeter',
            '#btn-sortir': 'sortir'
        };

        var clickedAction = null;
        for (var selector in actionsMap) {
            if (e.target.closest(selector)) {
                clickedAction = actionsMap[selector];
                break;
            }
        }

        if (clickedAction) {
            var allowedAction = step.action;
            if (allowedAction === 'lock1' || allowedAction === 'lock2') allowedAction = 'lock';

            var isAllowed = (clickedAction === allowedAction);
            // Allow confirming or canceling the pickup during the 'ramasser' step
            if (allowedAction === 'ramasser' && (clickedAction === 'valider' || clickedAction === 'annuler')) isAllowed = true;
            
            if (!isAllowed) {
                e.stopPropagation();
                e.preventDefault();
                if (typeof toast !== 'undefined') {
                    toast('Action non permise. Suivez les instructions du tutoriel.', 'warning');
                }
                return false;
            }
        }
    }, true);


        // Skip/Next button
        var skipBtn = document.getElementById('tuto-skip');
        if (skipBtn) {
            skipBtn.addEventListener('click', function() {
                var current = parseFloat(localStorage.getItem('canastaTutoEtape'));
                if (current) {
                    advanceTuto(current);
                }
            });
        }

        // Action observers
        
        // Pioche
        var pioche = document.getElementById('pioche');
        if (pioche) {
            pioche.addEventListener('click', function() { 
                var step = parseFloat(localStorage.getItem('canastaTutoEtape'));
                if (step === 6) advanceTuto(6); 
            });
        }

        // Selection (Rois and As) - Polling mechanism for 100% reliability
                setInterval(function() {
            var step = parseFloat(localStorage.getItem('canastaTutoEtape'));
            if ((step === 8 || step === 10) && document.querySelectorAll('.card.selectionnee').length >= 3) {
                advanceTuto(step);
            }
            if (step === 14 && typeof etatGlobal !== 'undefined' && etatGlobal && etatGlobal.tourActuel !== monNumero) {
                advanceTuto(14);
            }
            if (step === 14.5 && typeof etatGlobal !== 'undefined' && etatGlobal && etatGlobal.tourActuel === monNumero) {
                advanceTuto(14.5);
            }
            if (step === 15 && typeof etatGlobal !== "undefined" && etatGlobal && etatGlobal.aJoueCeTour) {
                advanceTuto(15);
            }
        }, 500);

        // Lock
        var btnLock = document.getElementById('btn-lock');
        if (btnLock) {
            btnLock.addEventListener('click', function() { 
                var step = parseFloat(localStorage.getItem('canastaTutoEtape'));
                if (step === 9 || step === 11) advanceTuto(step); 
            });
        }

        // Poser
        var btnPoser = document.getElementById('btn-poser');
        if (btnPoser) {
            btnPoser.addEventListener('click', function() { 
                var step = parseFloat(localStorage.getItem('canastaTutoEtape'));
                if (step === 12) advanceTuto(12); 
            });
        }
        
        // Valider
        var btnValider = document.getElementById('btn-valider-pose');
        if (btnValider) {
            btnValider.addEventListener('click', function() {
                var step = parseFloat(localStorage.getItem('canastaTutoEtape'));
                if (step === 13) advanceTuto(13);
            });
        }

        // Jeter
        var btnJeter = document.getElementById('btn-jeter');
        if (btnJeter) {
            btnJeter.addEventListener('click', function() { 
                var step = parseFloat(localStorage.getItem('canastaTutoEtape'));
                if (step === 14) advanceTuto(14); 
            });
        }
    });
})();
