<div align="center">
**Self-hosted Minecraft server panel. Docker-powered. No bloat.**

[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-20+-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/docker-required-blue?style=flat-square&logo=docker)](https://docker.com)
[![Platform](https://img.shields.io/badge/platform-Debian_11%2F12%2F13-red?style=flat-square&logo=debian)](https://debian.org)

</div>

---

## ⚡ One-Line Install

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Skitaru/skitaru-panel/main/install.sh 2>/dev/null || wget -qO- https://raw.githubusercontent.com/Skitaru/skitaru-panel/main/install.sh)
```

> Requires **Debian 11/12/13** · Root access · Ports 3000 + game ports open

---

## ✦ What is this?

Skitaru Panel is a **lightweight, self-hosted web panel** for managing Minecraft servers via Docker — built for people who want full control without the overhead of Pterodactyl or similar tools.

Every server runs in its own **isolated Docker container**. The panel handles building, starting, stopping, file management, backups, and live console — all from a clean browser UI.

---

## 🖥️ Features

| Category | Details |
|---|---|
| **Server Types** | Paper · Fabric · Velocity · Custom JAR |
| **Java Auto-Select** | Correct Java version per MC version (8 / 11 / 17 / 21) |
| **Live Console** | Real-time log stream via WebSocket, auto-reconnect |
| **File Manager** | Browse, edit, upload (drag & drop), download, create folders |
| **Backups** | Create · Download · Restore · Delete — one click |
| **Resource Monitor** | Live CPU + RAM sparkline charts |
| **JVM Flags** | Aikar's flags pre-configured, customizable per server |
| **Multi-Server** | Manage unlimited servers from one sidebar |
| **Language** | 🇩🇪 Deutsch / 🇬🇧 English — switchable in the UI |
| **Auth** | Token-based sessions, HMAC-SHA256 password hashing |
| **Mobile** | Responsive layout with slide-in drawer sidebar |

---

## 🚀 Supported Server Types

### 📄 Paper
Vanilla-compatible high-performance server. Versions from 1.8 through latest — correct Java version selected automatically.

### 🧵 Fabric
Lightweight modding platform. Fetches latest loader + installer from the official Fabric meta API.

### 🚀 Velocity
Modern reverse proxy for multi-server networks. Auto-generates `velocity.toml` with forwarding secret. Configure backend servers directly in the create form.

### 📦 Custom JAR
Upload any server JAR — modpacks, custom builds, whatever. Choose Java version (8 / 11 / 17 / 21) and optional extra JVM args.

> **Note:** Forge installer JARs are blocked. Use a pre-built server JAR or run the installer manually and upload the result.

---

## 📋 Requirements

- **OS:** Debian 11 (Bullseye) · Debian 12 (Bookworm) · Debian 13 (Trixie)
- **RAM:** 1 GB minimum (+ RAM for each server)
- **Disk:** 5 GB minimum
- **Ports:** `3000` for the panel, plus one port per server (auto-assigned)
- **Root access** for installation

The installer handles everything else: Docker, Node.js 20, systemd service setup.

---

## 🛠️ Manual Setup

If you prefer to install manually:

```bash
# 1. Clone the repo
git clone https://github.com/Skitaru/skitaru-panel.git /root/mc-panel
cd /root/mc-panel

# 2. Install dependencies
npm install

# 3. Create config (replace YOUR_PASSWORD)
HASH=$(echo -n "YOUR_PASSWORD" | openssl dgst -sha256 -hmac "skitaru-panel-secret" | awk '{print $2}')
echo "{\"username\":\"admin\",\"passwordHash\":\"$HASH\"}" > config.json

# 4. Start the panel
node server.js

# Or as a systemd service
systemctl enable --now skitaru-panel
```

---

## 🔧 Service Management

```bash
# Restart panel
systemctl restart skitaru-panel

# View live logs
journalctl -u skitaru-panel -f

# Stop panel
systemctl stop skitaru-panel
```

---

## 📁 File Structure

```
/root/mc-panel/
├── server.js          ← Express + WebSocket backend
├── package.json
├── config.json        ← Admin credentials (auto-generated)
└── public/
    └── index.html     ← Full SPA frontend

/opt/<server-name>/
├── Dockerfile
├── docker-compose.yml
├── panel.json         ← Server metadata
└── data/              ← Mounted as /server in container
    ├── server.jar / velocity.jar
    ├── server.properties / velocity.toml
    ├── world/
    ├── plugins/
    └── ...
```

---

## 🔒 Security Notes

- The panel runs on **port 3000** with no HTTPS by default. Put it behind a reverse proxy (nginx/caddy) with SSL for public access.
- All API routes require a session token. Tokens expire after **12 hours**.
- File uploads are limited to **500 MB** per file.
- Passwords are hashed with HMAC-SHA256 — never stored in plaintext.

---

## 🌐 Velocity Setup Guide

1. Create a Velocity server in the panel with your backend servers configured
2. After startup, find the forwarding secret in `/opt/<name>/data/forwarding.secret` via the file manager
3. In each backend Paper server, edit `config/paper-global.yml`:
   ```yaml
   proxies:
     velocity:
       enabled: true
       online-mode: true
       secret: 'your-forwarding-secret-here'
   ```
4. Set backend servers to offline mode (`online-mode=false` in `server.properties`)
5. Players connect to the Velocity port only

---

## ⚙️ Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js · Express · ws |
| Frontend | Vanilla JS SPA (no framework) |
| Containers | Docker · Docker Compose |
| Auth | HMAC-SHA256 · In-memory sessions |
| File Upload | Multer |
| Serving | Static + WebSocket on same port |

---

<div align="center">

**Built for server admins who want control, not complexity.**

*MIT License — use it, fork it, make it yours.*

</div>
