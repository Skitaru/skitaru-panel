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

## GitHub einrichten

1. Dieses Repo auf GitHub als **öffentliches Repo** hochladen
2. In `install.sh` Zeile anpassen:
   ```bash
   GITHUB_RAW="https://raw.githubusercontent.com/DEIN_USER/skitaru-panel/main"
   ```
   → `DEIN_USER` durch deinen GitHub-Benutzernamen ersetzen

## One-Liner Installation

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
