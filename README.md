# Pokémon Team Builder · Gen VIII

Dashboard statica (HTML/CSS/JS, nessuna build) per creare una squadra e analizzare debolezze, resistenze e coperture.

## Funzioni
- Ricerca nel box Pokémon e nei selettori di mosse e oggetti
- Statistiche modificabili per ogni Pokémon (con ripristino)
- Pokémon salvati (abilità, mosse, oggetto, stat) da riusare dal box, voce «Salvati»
- Più squadre salvate in automatico nel browser, nome modificabile
- Pagina di confronto fino a 3 squadre (sintesi, medie, debolezze per tipo)

## Pubblicazione su GitHub Pages
Settings → Pages → *Deploy from a branch* → `main` / `(root)`.

## Dati
Generati da PokéAPI (CSV ufficiali) con `scripts/build-data.mjs`:
`node scripts/build-data.mjs <cartella data/v2/csv> data`
Il workflow *Aggiorna dati Pokédex* (manuale) lo fa in automatico. Le icone sono in `assets/icons`.

## Test in locale
`python3 -m http.server` e apri http://localhost:8000
