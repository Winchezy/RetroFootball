# RetroFootball – import dans Babylon.js Editor (5.x)

## Contenu

| Fichier | Rôle |
|---|---|
| `assets/RetroFootball_Stade.glb` | Stade, joueurs, ballon pixel-art, caméra, lumières, repères `FX_*` et l'animation complète « Cinematique » (13 s) |
| `assets/audio/*.wav` | Sons (foule, frappe, filet, clameur, jingle 8-bit, sifflet, glissade, feux d'artifice) |
| `scripts/retroFootballCinematique.ts` | Script qui lance la cinématique : particules, effets de lumière, sons synchronisés, zoom caméra |

## Étapes

1. **Modèle** : glisser `RetroFootball_Stade.glb` dans le panneau *Assets* de l'éditeur, puis dans la scène.
2. **Sons** : copier le dossier `assets/audio` dans le dossier `public/` du projet Babylon
   (ils seront servis à l'adresse `/audio/...`). Sinon, changer « Dossier des sons (URL) » dans l'inspecteur du script.
3. **Script** : copier `retroFootballCinematique.ts` dans le dossier `src/` du projet (par ex. `src/scripts/`),
   sélectionner un nœud de la scène (par ex. `Ballon`) et y ajouter le script depuis l'inspecteur.
4. **Lancer** (Play) puis cliquer dans la vue : le clic est nécessaire pour que le navigateur autorise le son.

## Réglages (inspecteur du script)

- Volume général, boucle on/off, démarrage au clic
- Quantité de particules (baisser si ça rame)
- Intensité des projecteurs et des faisceaux colorés
- Bloom + glow on/off

## Ce qui vient du GLB et ce qui vient du script

- **GLB** : géométrie, matériaux (texture du ballon en filtrage « nearest »), couleurs de la foule, toutes les
  animations d'objets (joueurs, ballon, foule qui saute, caméra qui tourne autour du buteur, rotation des faisceaux).
- **Script** : particules, stroboscope des projecteurs, panneaux LED, intensité des faisceaux et leurs cônes
  lumineux, zoom (FOV) de la caméra, sons, bloom/glow. Ces éléments ne passent pas par le format glTF.

Les repères `FX_*` sont des nœuds vides : on peut les déplacer dans l'éditeur pour changer
l'endroit où apparaissent les confettis, feux d'artifice, etc. Leurs paramètres (image de début, couleur…)
sont dans les « extras » glTF, éditables depuis Blender.
