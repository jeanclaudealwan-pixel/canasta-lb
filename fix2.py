import re

with open('C:\\Users\\Triton\\Documents\\canasta-lb\\ia\\client_ia.py', 'r', encoding='utf-8') as f:
    code = f.read()

def replace_safety(match):
    return '''        # SÉCURITÉ ANTI-CRASH : S'il n'y a AUCUNE carte qu'on a le droit de jeter
        # Niveau 1 : On sacrifie une carte normale risquée plutôt que de geler illégalement.
        if not any(mask[2:17]):
            for i, val in enumerate(VALEURS):
                if counts[val] > 0 and val not in ['Joker', '2', '3R', '3N']:
                    mask[2 + i] = True
                    
        # Niveau 2 : Si on n'avait VRAIMENT QUE des atouts en main
        if not any(mask[2:17]):
            for i, val in enumerate(VALEURS):
                if counts[val] > 0 and val in ['Joker', '2']:
                    mask[2 + i] = True if (counts['2'] == 0 or val == '2') else False
'''

pattern = re.compile(r'        # SÉCURITÉ ANTI-CRASH.*?mask\[2 \+ i\] = True\n', re.DOTALL)
code = pattern.sub(replace_safety, code)

with open('C:\\Users\\Triton\\Documents\\canasta-lb\\ia\\client_ia.py', 'w', encoding='utf-8') as f:
    f.write(code)
print('Done!')
