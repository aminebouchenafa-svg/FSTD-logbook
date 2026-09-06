# FSTD Logbook

Registre des séances simulateur : date, créneau, horaires, équipage (TRI / CDB / FO),
type de training (QT ou REC) et type de séance (FFS ou FBS).

## Champs enregistrés par séance

- Date de la séance
- Créneau (Matin / Après-midi / Soir / Nuit)
- Heure de début
- Heure de fin
- Nom du TRI (instructeur)
- Nom du CDB (commandant de bord)
- Nom du FO (officier pilote)
- Type de training : `QT` ou `REC` (récurrent)
- Type de séance : `FFS` (Full Flight Simulator) ou `FBS` (Fixed Base Simulator)

## Démarrer l'application

```bash
npm install
npm start
```

Puis ouvrir http://localhost:3000

## Notes techniques

- Backend Node/Express, données persistées dans `server/data/sessions.json`
  (partagé entre tous les utilisateurs qui accèdent au serveur).
- Frontend en HTML/CSS/JS natif, aucune étape de build nécessaire.
- Prochaines évolutions possibles : authentification par utilisateur,
  export du registre (CSV/PDF), filtres avancés par période ou par équipage.
