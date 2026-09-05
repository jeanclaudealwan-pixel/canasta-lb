import sys
import numpy.core
sys.modules['numpy._core'] = sys.modules['numpy.core']
import socketio
import time
import numpy as np
import uuid
import sys
import os

from sb3_contrib import MaskablePPO
from encoder import encode_state, normaliser_valeur, compter_canastas, VALEURS, VALEURS_MELD, POINTS_FACIAUX

# ═══════════════════════════════════════════════════════════════════════
# ESPACE D'ACTIONS (59 actions) — doit correspondre à canasta_gym.py
# ═══════════════════════════════════════════════════════════════════════
# 0       : Piocher
# 1       : Ramasser la Terre
# 2-16    : Jeter une carte (par valeur VALEURS[0..14])
# 17-31   : Descendre une NOUVELLE combinaison PURE
# 32-46   : Descendre une NOUVELLE combinaison IMPURE
# 47-58   : COMPLÉTER une combinaison existante (VALEURS_MELD[0..11])
# ═══════════════════════════════════════════════════════════════════════

NB_ACTIONS = 59

# Connexion au serveur
sio = socketio.Client()
serveur_url = 'http://141.144.233.104'

print('Chargement du modèle d\'IA V3 (bot_canasta_v3.zip)...')
try:
    model = MaskablePPO.load('bot_canasta_v3.zip')
    print('Modèle V3 chargé avec succès !')
except Exception as e:
    print(f'Erreur : {e}')
    sys.exit(1)

etat_actuel = None
mon_numero = None
en_attente_action = False

# ═══════════════════════════════════════════════════════════════════════
# MASQUE D'ACTIONS — Vérifie les vraies règles du jeu (V3 : avec seuil)
# ═══════════════════════════════════════════════════════════════════════
def get_action_mask(etat):
    mask = np.zeros(NB_ACTIONS, dtype=bool)
    if not etat: return mask

    main = etat.get('maMain', [])
    a_joue = etat.get('aJoueCeTour', False)
    
    # Comptage des cartes
    counts = {val: 0 for val in VALEURS}
    wildcards = 0
    nb_2 = 0
    
    for c in main:
        val = normaliser_valeur(c)
        if c.get('estJoker', False):
            wildcards += 1
            counts['Joker'] += 1
        elif val == '2':
            wildcards += 1
            nb_2 += 1
            counts['2'] += 1
        elif val in counts:
            counts[val] += 1

    # Données de l'équipe
    mon_equipe_id = str(etat.get('monEquipe', 1))
    equipe_data = etat.get('equipes', {}).get(mon_equipe_id, {})
    a_ouvert = equipe_data.get('aOuvert', False)
    seuil = equipe_data.get('seuilOuverture', 60)

    if not a_joue:
        # PIOCHER — toujours autorisé
        mask[0] = True
        
        # RAMASSER TERRE — vérifications strictes
        carte_dessus = etat.get('carteDessusDefausse')
        taille_defausse = etat.get('tailleDefausse', 0)
        terre_gelee = etat.get('terreGelee', False)
        
        if taille_defausse > 0 and carte_dessus:
            val_dessus = carte_dessus.get('valeur', '')
            est_joker = carte_dessus.get('estJoker', False)
            couleur_dessus = carte_dessus.get('couleur', '')
            est_3_noir = (val_dessus == '3' and couleur_dessus in ['Pique', 'Trèfle'])
            est_2 = (val_dessus == '2')
            
            if not est_joker and not est_2 and not est_3_noir:
                nb_naturelles = sum(
                    1 for c in main 
                    if c.get('valeur') == val_dessus 
                    and not c.get('estJoker', False)
                    and c.get('valeur') != '2'
                )
                nb_requis = 3 if terre_gelee else 2
                if nb_naturelles >= nb_requis:
                    mask[1] = True
    # --- REPRODUCTION EXACTE DU MASQUE D'ENTRAÎNEMENT (Ninja Rules + Seuil) ---
    terre_gelee = etat.get('terreGelee', False)
    taille_defausse = etat.get('tailleDefausse', 0)
    
    # 1. Calcul des cartes dangereuses
    valeurs_dangereuses = set()
    joueur_suivant = (mon_numero % 4) + 1
    equipe_suivante = 1 if joueur_suivant in [1, 3] else 2
    equipes = etat.get('equipes', {})
    table_suiv = equipes.get(str(equipe_suivante), {}).get('table', {})
    
    for meld in table_suiv.values():
        val_meld = meld.get('valeur')
        nb_poses = sum(1 for c in meld.get('cartes', []) if c.get('posePar') == joueur_suivant)
        if nb_poses < 2:
            valeurs_dangereuses.add(val_meld)

    if a_joue:
        # V3.7: Vérifier si l'équipe peut mathématiquement ouvrir
        peut_ouvrir = True
        if not a_ouvert:
            # Calcul rapide (sans l'algo complexe de gym, on autorise l'action et le serveur bloquera 
            # SI on n'a pas les points. Mais pour être propre, on devrait avoir le calculateur.
            # Pour l'instant, vu que le serveur rejette, on laisse True, MAIS l'IA a été entraînée
            # à ne pas essayer si elle ne peut pas. On garde simple pour le client.)
            pass
            
        for i, val in enumerate(VALEURS):
            # ── JETER (2-16) ──
            if counts[val] > 0:
                if val in ['Joker', '2']:
                    # RÈGLE NINJA 1
                    if len(main) == 1:
                        mask[2 + i] = True
                    elif taille_defausse >= 6 and not terre_gelee:
                        mask[2 + i] = True
                    else:
                        mask[2 + i] = False
                elif val in valeurs_dangereuses and not terre_gelee and len(main) > 1:
                    mask[2 + i] = False
                else:
                    mask[2 + i] = True
            
            # ── DESCENDRE PUR (17-31) ──
            if val not in ['Joker', '2', '3R', '3N'] and counts[val] >= 3:
                mask[17 + i] = True
                
            # ── DESCENDRE IMPUR (32-46) ──
            if val not in ['Joker', '2', '3R', '3N'] and counts[val] >= 2 and wildcards >= 1:
                mask[32 + i] = True
        
        # SÉCURITÉ ANTI-FREEZE
        if not any(mask[2:17]):
            for i, val in enumerate(VALEURS):
                if counts[val] > 0: mask[2 + i] = True
        
        # COMPLÉTER (47-58)
        table = equipe_data.get('table', {})
        
        if a_ouvert:
            for i, val_meld in enumerate(VALEURS_MELD):
                has_combo = any(meld.get('valeur') == val_meld for meld in table.values())
                if not has_combo:
                    continue
                if val_meld == '2':
                    if nb_2 > 0:
                        mask[47 + i] = True
                else:
                    if counts.get(val_meld, 0) > 0:
                        mask[47 + i] = True
                    
    return mask

# ═══════════════════════════════════════════════════════════════════════
# JOUER UN COUP
# ═══════════════════════════════════════════════════════════════════════
def jouer_coup():
    global etat_actuel, mon_numero, en_attente_action
    if not etat_actuel or not en_attente_action: return
    if etat_actuel.get('tourActuel') != mon_numero: return
        
    print('\nC\'est mon tour de jouer ! Je réfléchis...')
    try:
        obs = encode_state(etat_actuel, mon_numero)
        mask = get_action_mask(etat_actuel)
        if not mask.any():
            print("Aucun masque valide !")
            return

        action, _ = model.predict(obs, action_masks=mask, deterministic=True)
        action = int(action)
        print(f"-> Action ID : {action}")
        time.sleep(1.0)
        
        action_ok = False
        
        if action == 0:
            print("Action: Pioche")
            sio.emit('demandePiocher')
            action_ok = True
            
        elif action == 1:
            print("Action: Ramasse la Terre")
            sio.emit('demandeRamasserTerre')
            action_ok = True
            
        elif 2 <= action <= 16:
            valeur_cible = VALEURS[action - 2]
            carte_id = None
            for c in etat_actuel['maMain']:
                if normaliser_valeur(c) == valeur_cible:
                    carte_id = c['id']
                    break
            if carte_id:
                print(f"Action: Jete {valeur_cible}")
                sio.emit('demandeJouerCarte', carte_id)
                action_ok = True
            else:
                print(f"ERREUR: Carte {valeur_cible} introuvable en main !")
                
        elif 17 <= action <= 31:
            valeur_cible = VALEURS[action - 17]
            cartes_ids = [c['id'] for c in etat_actuel['maMain'] if normaliser_valeur(c) == valeur_cible]
            if len(cartes_ids) >= 3:
                groupes = [{'cartesId': cartes_ids}]
                
                # V3.1 : Auto-ouverture — regrouper tous les groupes purs pour atteindre le seuil
                mon_equipe_id = str(etat_actuel.get('monEquipe', 1))
                a_ouvert = etat_actuel.get('equipes', {}).get(mon_equipe_id, {}).get('aOuvert', False)
                if not a_ouvert:
                    used_ids = set(cartes_ids)
                    for val2 in VALEURS:
                        if val2 == valeur_cible or val2 in ['Joker', '2', '3R', '3N']:
                            continue
                        other_ids = [c['id'] for c in etat_actuel['maMain'] 
                                     if normaliser_valeur(c) == val2 and c['id'] not in used_ids]
                        if len(other_ids) >= 3:
                            groupes.append({'cartesId': other_ids})
                            used_ids.update(other_ids)
                    print(f"Action: OUVERTURE avec {len(groupes)} groupe(s) (déclenché par {valeur_cible})")
                else:
                    print(f"Action: Pose {valeur_cible} pur ({len(cartes_ids)} cartes)")
                
                sio.emit('demandeDescendreCombinaison', groupes)
                action_ok = True
            else:
                print(f"ERREUR: Pas assez de {valeur_cible} pour un pur ({len(cartes_ids)}) !")
                
        elif 32 <= action <= 46:
            valeur_cible = VALEURS[action - 32]
            cartes_ids = [c['id'] for c in etat_actuel['maMain'] if normaliser_valeur(c) == valeur_cible]
            dispo_wc = [c['id'] for c in etat_actuel['maMain'] if c.get('estJoker') or c.get('valeur') == '2']
            nb_wc = max(0, 3 - len(cartes_ids))
            if nb_wc == 0: nb_wc = 1
            wc_utilises = dispo_wc[:nb_wc]
            if len(cartes_ids) >= 2 and len(wc_utilises) >= 1:
                cartes_ids.extend(wc_utilises)
                groupes = [{'cartesId': cartes_ids}]
                
                # V3.1 : Auto-ouverture
                mon_equipe_id = str(etat_actuel.get('monEquipe', 1))
                a_ouvert = etat_actuel.get('equipes', {}).get(mon_equipe_id, {}).get('aOuvert', False)
                if not a_ouvert:
                    used_ids = set(cartes_ids)
                    for val2 in VALEURS:
                        if val2 == valeur_cible or val2 in ['Joker', '2', '3R', '3N']:
                            continue
                        other_ids = [c['id'] for c in etat_actuel['maMain'] 
                                     if normaliser_valeur(c) == val2 and c['id'] not in used_ids]
                        if len(other_ids) >= 3:
                            groupes.append({'cartesId': other_ids})
                            used_ids.update(other_ids)
                    print(f"Action: OUVERTURE IMPURE avec {len(groupes)} groupe(s) (déclenché par {valeur_cible})")
                else:
                    print(f"Action: Pose {valeur_cible} impur ({len(cartes_ids)} cartes)")
                
                sio.emit('demandeDescendreCombinaison', groupes)
                action_ok = True
            else:
                print(f"ERREUR: Impossible d'assembler un impur de {valeur_cible} !")

        elif 47 <= action <= 58:
            valeur_cible = VALEURS_MELD[action - 47]
            cartes_ids = [
                c['id'] for c in etat_actuel['maMain'] 
                if c.get('valeur') == valeur_cible and not c.get('estJoker', False)
            ]
            if len(cartes_ids) >= 1:
                print(f"Action: Complète {valeur_cible} (+{len(cartes_ids)} cartes)")
                sio.emit('demandeDescendreCombinaison', [{'cartesId': cartes_ids, 'valeur': valeur_cible}])
                action_ok = True
            else:
                print(f"ERREUR: Pas de {valeur_cible} en main pour compléter !")
        
        # Sécurité anti-blocage : si l'action locale a échoué, forcer une défausse
        if not action_ok:
            a_joue = etat_actuel.get('aJoueCeTour', False)
            if a_joue and etat_actuel.get('maMain'):
                carte = etat_actuel['maMain'][0]
                print(f"-> SECOURS : Jete {carte.get('valeur')} (ID: {carte['id']})")
                sio.emit('demandeJouerCarte', carte['id'])
            elif not a_joue:
                print("-> SECOURS : Pioche")
                sio.emit('demandePiocher')
            
        en_attente_action = False
    except Exception as e:
        print(f"Erreur IA : {e}")
        import traceback
        traceback.print_exc()

# ═══════════════════════════════════════════════════════════════════════
# ÉVÉNEMENTS SOCKET
# ═══════════════════════════════════════════════════════════════════════
cible_salon_id = sys.argv[1] if len(sys.argv) > 1 else None
a_rejoint = False

@sio.event
def connect():
    global a_rejoint
    print('Connexion au serveur réussie !')
    sio.emit('setProfil', {'pseudo': 'IA Expert V3', 'avatar': '🧠', 'token': f'ia_{uuid.uuid4()}', 'dbId': None})
    
    if cible_salon_id:
        print(f"Rejoindre le salon ciblé : {cible_salon_id}")
        sio.emit('rejoindreSalon', cible_salon_id)
        a_rejoint = True
    else:
        # Comportement par défaut (si on le lance sans argument)
        sio.emit('listerSalons')

@sio.on('listeSalons')
def on_liste_salons(data):
    global a_rejoint
    if a_rejoint:
        return
        
    if len(data) > 0:
        salon = data[0]
        if not salon['enCours'] and salon['nbJoueurs'] < 4:
            print(f"Rejoindre le salon : {salon['nom']}")
            sio.emit('rejoindreSalon', salon['id'])
            a_rejoint = True
        else:
            print("Le premier salon est plein ou en cours.")
    else:
        print("Aucun salon trouvé.")

@sio.on('miseAJourEtat')
def on_mise_a_jour(etat):
    global etat_actuel, mon_numero, en_attente_action
    etat_actuel = etat
    mon_numero = etat.get('monNumero')
    if etat.get('enJeu') and etat.get('tourActuel') == mon_numero:
        en_attente_action = True
        jouer_coup()

@sio.on('alerteJeu')
def on_alerte_jeu(msg):
    print(f"\n[!] ALERTE SERVEUR : {msg}")
    
    # Ignorer les messages de succès et les notifications de jeu
    mots_succes = [
        "Combinaisons valid", "Reconnexion", "C'est votre tour", "La table est compl",
        "a ramassé la terre", "a pioché", "Distribution des cartes",
        "nouvelle manche", "Partie terminée", "a gagné", "Manche terminée"
    ]
    if any(mot in msg for mot in mots_succes):
        return

    global etat_actuel, mon_numero, en_attente_action
    
    # Si c'est notre tour et notre action a été rejetée, fallback
    if etat_actuel and etat_actuel.get('tourActuel') == mon_numero and not en_attente_action:
        a_joue = etat_actuel.get('aJoueCeTour', False)
        print("-> Action rejetée par le serveur. Secours...")
        time.sleep(1.0)
        if not a_joue:
            print("Secours: Pioche")
            sio.emit('demandePiocher')
        else:
            ma_main = etat_actuel.get('maMain', [])
            if ma_main:
                print(f"Secours: Jete {ma_main[0].get('valeur')} (ID: {ma_main[0]['id']})")
                sio.emit('demandeJouerCarte', ma_main[0]['id'])
        
@sio.on('disconnect')
def disconnect():
    print('Déconnecté du serveur.')

if __name__ == '__main__':
    sio.connect(serveur_url)
    sio.wait()
