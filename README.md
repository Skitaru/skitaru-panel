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

## One-Liner Installation (Eigentlich Two-Liner)

1.

```bash
apt-get update -y && apt-get install -y curl
```

2.

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Skitaru/skitaru-panel/main/install.sh)
```

## Features

- Login-System mit Admin-Account
- PaperMC Server erstellen (Version wählbar)
- Live-Konsole per WebSocket
- Befehle via Konsole senden
- Start / Stop / Restart / Löschen
- Datei-Manager (Upload, Download, Löschen, Ordner erstellen)
- CPU & RAM Live-Statistiken
- Clean Design

## Manuell aktualisieren

```bash
cd /root/mc-panel
# Dateien ersetzen, dann:
systemctl restart skitaru-panel
```
