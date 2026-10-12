# Alpine Dirt

Jeu de motocross 3D avec contre-la-montre, entraînement et multijoueur sur réseau local.

## Windows

Installez [Node.js 22.12 ou plus récent](https://nodejs.org/), puis double-cliquez sur **Alpine Dirt.cmd**. Le lanceur installe les dépendances au premier démarrage, compile le jeu, démarre le serveur et ouvre la page locale. Laissez sa fenêtre ouverte pendant la partie.

## Commandes

```sh
npm ci
npm run build
npm start
```

`npm run dev` démarre aussi le serveur avec Vite pour le développement. Les tests unitaires se lancent avec `npm test`.

Les dépendances, compilations, records et captures locaux sont ignorés par Git. Le code source et les fichiers nécessaires au jeu restent dans le dépôt.
