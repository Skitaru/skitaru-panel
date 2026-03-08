# Skitaru Panel

Minecraft Docker Web-Panel für Debian 12/13.

## Repo-Struktur

```
skitaru-panel/
├── install.sh              ← Haupt-Installer
├── mc-panel/
│   ├── server.js
│   ├── package.json
│   └── public/
│       └── index.html
└── README.md
```

## One-Liner Installation

```bash
apt-get update -y && apt-get install -y curl
```

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/DEIN_USER/skitaru-panel/main/install.sh)
```

## Features

- Login-System mit Admin-Account
- PaperMC Server erstellen (Version wählbar)
- Live-Konsole per WebSocket
- Befehle via RCON senden
- Start / Stop / Restart / Löschen
- Datei-Manager (Upload, Download, Löschen, Ordner erstellen)
- CPU & RAM Live-Statistiken

## Manuell aktualisieren

```bash
cd /root/mc-panel
# Dateien ersetzen, dann:
systemctl restart skitaru-panel
```
