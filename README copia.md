# Pokémon Team Builder · Gen VIII

Dashboard statica (HTML/CSS/JS, nessuna build) per creare una squadra e analizzare debolezze, resistenze e coperture.

## Pubblicazione su GitHub Pages
Settings → Pages → *Deploy from a branch* → `main` / `(root)`.

## Dati
Generati da PokéAPI (CSV ufficiali) con `scripts/build-data.mjs`:
`node scripts/build-data.mjs <cartella data/v2/csv> data`
Il workflow *Aggiorna dati Pokédex* (manuale) lo fa in automatico. Le icone sono in `assets/icons`.

## Test in locale
`python3 -m http.server` e apri http://localhost:8000
