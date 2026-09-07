import re

with open('C:\\Users\\Triton\\Documents\\canasta-lb\\ia\\client_ia.py', 'r', encoding='utf-8') as f:
    code = f.read()

def replace_ouverture_block(match):
    return '''                    # On calcule les points en ajoutant les groupes
                    pts_ouverture = sum(POINTS_FACIAUX.get(normaliser_valeur(c), 0) for c in etat_actuel['maMain'] if c['id'] in used_ids)
                    
                    # 1. Ajouter tous les purs
                    for val2 in VALEURS:
                        if val2 == valeur_cible or val2 in ['Joker', '2', '3R', '3N']:
                            continue
                        other_ids = [c['id'] for c in etat_actuel['maMain'] 
                                     if normaliser_valeur(c) == val2 and c['id'] not in used_ids]
                        if len(other_ids) >= 3:
                            groupes.append({'cartesId': other_ids})
                            used_ids.update(other_ids)
                            pts_ouverture += sum(POINTS_FACIAUX.get(normaliser_valeur(c), 0) for c in etat_actuel['maMain'] if c['id'] in other_ids)
                            
                    # 2. Ajouter les impurs possibles UNIQUEMENT si on n'a pas atteint le seuil
                    seuil = etat_actuel.get('equipes', {}).get(mon_equipe_id, {}).get('seuilOuverture', 120)
                    if pts_ouverture < seuil:
                        _raw_wc_dispo = [c for c in etat_actuel['maMain'] if (c.get('estJoker') or c.get('valeur') == '2') and c['id'] not in used_ids]
                        _raw_wc_dispo.sort(key=lambda c: 0 if c.get('valeur') == '2' else 1)
                        dispo_wc = [c['id'] for c in _raw_wc_dispo]
                        for val2 in VALEURS:
                            if pts_ouverture >= seuil: break
                            if val2 == valeur_cible or val2 in ['Joker', '2', '3R', '3N']:
                                continue
                            other_ids = [c['id'] for c in etat_actuel['maMain'] 
                                         if normaliser_valeur(c) == val2 and c['id'] not in used_ids]
                            if len(other_ids) == 2 and len(dispo_wc) >= 1:
                                impure_ids = other_ids + [dispo_wc.pop(0)]
                                groupes.append({'cartesId': impure_ids})
                                used_ids.update(impure_ids)
                                pts_ouverture += sum(POINTS_FACIAUX.get(normaliser_valeur(c), 0) for c in etat_actuel['maMain'] if c['id'] in impure_ids)
                                
'''

pattern1 = re.compile(r'                    # 1\. Ajouter tous les purs\n.*?used_ids\.update\(impure_ids\)\n', re.DOTALL)
code = pattern1.sub(replace_ouverture_block, code)

with open('C:\\Users\\Triton\\Documents\\canasta-lb\\ia\\client_ia.py', 'w', encoding='utf-8') as f:
    f.write(code)
print('Done!')
