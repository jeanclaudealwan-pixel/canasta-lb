import numpy as np

# Ordre des valeurs pour l'encodage
VALEURS = ['A', '2', '3R', '3N', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R', 'Joker']
VALEURS_MELD = ['A', '2', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'] # On ne pose pas de 3

# Points faciaux des cartes (pour vérifier le seuil d'ouverture)
POINTS_FACIAUX = {
    'Joker': 50, '2': 25, 'A': 20,
    '8': 10, '9': 10, '10': 10, 'V': 10, 'D': 10, 'R': 10,
    '4': 5, '5': 5, '6': 5, '7': 5,
    '3R': 100, '3N': 0
}

def normaliser_valeur(carte):
    """Normalise la valeur d'une carte : transforme '3' en '3R' ou '3N' selon la couleur."""
    val = carte.get('valeur', '') if isinstance(carte, dict) else carte
    if val == '3':
        couleur = carte.get('couleur', '') if isinstance(carte, dict) else ''
        val = '3R' if couleur in ['Coeur', 'Carreau'] else '3N'
    return val

def compter_canastas(equipe_data):
    """
    Compte les canastas pures et impures d'une équipe.
    Retourne (nb_pures, nb_impures).
    """
    table = equipe_data.get('table', {})
    pures = 0
    impures = 0
    for key, meld in table.items():
        if meld.get('estCanasta', False):
            # Compter les wildcards dans la combinaison
            val_base = meld.get('valeur', '')
            wildcards_dans_meld = sum(
                1 for c in meld.get('cartes', [])
                if c.get('estJoker', False) or (c.get('valeur') == '2' and val_base != '2')
            )
            if wildcards_dans_meld == 0:
                pures += 1
            else:
                impures += 1
    return pures, impures

def encode_state(etat_jeu, num_joueur):
    """
    Transforme l'état JSON brut renvoyé par le jeu en un vecteur Numpy (94 dimensions)
    que le réseau de neurones de l'IA peut comprendre.
    
    Dimensions :
      [0-14]   Main du bot (15 valeurs)
      [15-38]  Table de l'équipe du bot (12 valeurs × 2 = 24)
      [39-62]  Table de l'équipe adverse (12 valeurs × 2 = 24)
      [63]     Taille défausse
      [64]     Terre gelée (0 ou 1)
      [65-79]  Carte du dessus de la défausse (one-hot, 15 valeurs)
      [80]     Score de mon équipe
      [81]     Mon équipe a ouvert (0 ou 1)
      [82]     Score adversaire
      [83]     Adversaire a ouvert (0 ou 1)
      [84]     Taille de la pioche
      [85-87]  Tailles des mains des 3 autres joueurs
      [88]     Canastas pures de mon équipe
      [89]     Canastas impures de mon équipe
      [90]     Canastas pures de l'adversaire
      [91]     Canastas impures de l'adversaire
      [92]     Seuil d'ouverture de mon équipe
      [93]     A joué ce tour (0 ou 1) — PHASE DU TOUR [NOUVEAU V3]
    """
    vecteur = []
    
    mon_equipe = etat_jeu['monEquipe']
    equipe_adverse = 2 if mon_equipe == 1 else 1

    # ── 1. MAIN DU BOT (15 valeurs) ──
    main_counts = {v: 0 for v in VALEURS}
    for carte in etat_jeu['maMain']:
        val = normaliser_valeur(carte)
        main_counts[val] += 1
    
    for v in VALEURS:
        vecteur.append(main_counts[v])

    # ── 2. TABLE DES COMBINAISONS (24 × 2 = 48 valeurs) ──
    def encoder_table_equipe(equipe_id):
        table = etat_jeu['equipes'][str(equipe_id)]['table']
        table_counts = {v: {'naturelles': 0, 'wildcards': 0} for v in VALEURS_MELD}
        
        for key, meld in table.items():
            base_val = meld['valeur']
            if base_val not in table_counts:
                continue
            for carte in meld['cartes']:
                carte_val = carte['valeur']
                est_wildcard = carte.get('estJoker', False) or (carte_val == '2' and base_val != '2')
                if est_wildcard:
                    table_counts[base_val]['wildcards'] += 1
                else:
                    table_counts[base_val]['naturelles'] += 1
                    
        for v in VALEURS_MELD:
            vecteur.append(table_counts[v]['naturelles'])
            vecteur.append(table_counts[v]['wildcards'])
            
    encoder_table_equipe(mon_equipe)
    encoder_table_equipe(equipe_adverse)

    # ── 3. DÉFAUSSE (17 valeurs) ──
    vecteur.append(etat_jeu['tailleDefausse'])
    vecteur.append(1.0 if etat_jeu['terreGelee'] else 0.0)
    
    top_carte_vecteur = [0] * len(VALEURS)
    carte_dessus = etat_jeu['carteDessusDefausse']
    if carte_dessus:
        val = normaliser_valeur(carte_dessus)
        if val in VALEURS:
            top_carte_vecteur[VALEURS.index(val)] = 1
    vecteur.extend(top_carte_vecteur)

    # ── 4. ÉTAT GLOBAL (5 valeurs) ──
    vecteur.append(etat_jeu['equipes'][str(mon_equipe)]['score'])
    vecteur.append(1.0 if etat_jeu['equipes'][str(mon_equipe)]['aOuvert'] else 0.0)
    vecteur.append(etat_jeu['equipes'][str(equipe_adverse)]['score'])
    vecteur.append(1.0 if etat_jeu['equipes'][str(equipe_adverse)]['aOuvert'] else 0.0)
    vecteur.append(etat_jeu['taillePioche'])

    # ── 5. TAILLES DES MAINS ADVERSES ET ALLIÉE (3 valeurs) ──
    for i in range(1, 5):
        if i != num_joueur:
            vecteur.append(etat_jeu['tailleMains'][str(i)])

    # ── 6. CANASTAS ET SEUIL D'OUVERTURE (5 valeurs) ──
    pures_mon, impures_mon = compter_canastas(etat_jeu['equipes'][str(mon_equipe)])
    pures_adv, impures_adv = compter_canastas(etat_jeu['equipes'][str(equipe_adverse)])
    
    vecteur.append(pures_mon)
    vecteur.append(impures_mon)
    vecteur.append(pures_adv)
    vecteur.append(impures_adv)
    
    # Seuil d'ouverture (disponible dans l'état du serveur)
    seuil = etat_jeu['equipes'][str(mon_equipe)].get('seuilOuverture', 60)
    vecteur.append(seuil)

    # ── 7. PHASE DU TOUR (1 valeur) [NOUVEAU V3] ──
    vecteur.append(1.0 if etat_jeu.get('aJoueCeTour', False) else 0.0)

    return np.array(vecteur, dtype=np.float32)

if __name__ == "__main__":
    # 15 + 24 + 24 + 2 + 15 + 5 + 3 + 5 + 1 = 94
    print("Encodeur v3 compilé avec succès. Taille du vecteur :", 
          15 + (12*2)*2 + 2 + 15 + 5 + 3 + 5 + 1)
