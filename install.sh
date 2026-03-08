#!/bin/bash
# ══════════════════════════════════════════════════════════════════
#  Skitaru Panel – One-Liner Installer
#  Verwendung:
#    bash <(curl -fsSL https://raw.githubusercontent.com/DEIN_USER/skitaru-panel/main/install.sh)
#
#  Oder nach manuellem Download:
#    bash install.sh
# ══════════════════════════════════════════════════════════════════
set -e

# ── Farben ────────────────────────────────────────────────────
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'
C='\033[0;36m'; B='\033[1m'; N='\033[0m'

info()    { echo -e "${C}[➤]${N} $1"; }
success() { echo -e "${G}[✔]${N} $1"; }
warn()    { echo -e "${Y}[⚠]${N} $1"; }
error()   { echo -e "${R}[✖]${N} $1"; exit 1; }

# ── GitHub Quelle (anpassen nach Fork/Upload) ─────────────────
GITHUB_RAW="https://raw.githubusercontent.com/DEIN_USER/skitaru-panel/main"

# ── Root Check ────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Bitte als root ausführen: sudo bash install.sh"

PANEL_DIR="/root/mc-panel"
PORT="${MC_PANEL_PORT:-8080}"

clear
echo -e "${C}${B}"
cat << 'EOF'
  ███████╗██╗  ██╗██╗████████╗ █████╗ ██████╗ ██╗   ██╗
  ██╔════╝██║ ██╔╝██║╚══██╔══╝██╔══██╗██╔══██╗██║   ██║
  ███████╗█████╔╝ ██║   ██║   ███████║██████╔╝██║   ██║
  ╚════██║██╔═██╗ ██║   ██║   ██╔══██║██╔══██╗██║   ██║
  ███████║██║  ██╗██║   ██║   ██║  ██║██║  ██║╚██████╔╝
  ╚══════╝╚═╝  ╚═╝╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝
EOF
echo -e "${N}"
echo -e "  ${B}Minecraft Docker Panel – Installer${N}"
echo "  ══════════════════════════════════"
echo ""

# ── Basis-Pakete installieren ─────────────────────────────────
info "Installiere Basis-Pakete..."
apt-get update -y -qq 2>/dev/null
apt-get install -y -qq curl wget ca-certificates gnupg2 jq lsb-release apt-transport-https 2>/dev/null
success "Basis-Pakete bereit."

# ── Docker installieren ───────────────────────────────────────
if command -v docker &>/dev/null; then
  success "Docker bereits vorhanden ($(docker --version | awk '{print $3}' | tr -d ','))."
else
  info "Installiere Docker..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/debian $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y -qq 2>/dev/null
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  success "Docker installiert."
fi

# ── Node.js 20 installieren ───────────────────────────────────
NODE_VER=$(node -v 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1 || echo "0")
if [[ "$NODE_VER" -ge 18 ]]; then
  success "Node.js $(node -v) bereits vorhanden."
else
  info "Installiere Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null
  apt-get install -y -qq nodejs
  success "Node.js $(node -v) installiert."
fi

# ── Panel-Dateien herunterladen ───────────────────────────────
info "Lade Panel-Dateien herunter..."
mkdir -p "${PANEL_DIR}/public"

# Prüfen ob lokale Dateien vorhanden (manueller Download)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-/tmp}")" 2>/dev/null && pwd || echo '/tmp')"
LOCAL_SRC="${SCRIPT_DIR}/mc-panel"

if [[ -f "${LOCAL_SRC}/server.js" && "$(realpath "${LOCAL_SRC}" 2>/dev/null)" != "$(realpath "${PANEL_DIR}" 2>/dev/null)" ]]; then
  info "Verwende lokale Dateien aus ${LOCAL_SRC}..."
  cp "${LOCAL_SRC}/server.js"          "${PANEL_DIR}/server.js"
  cp "${LOCAL_SRC}/package.json"       "${PANEL_DIR}/package.json"
  cp "${LOCAL_SRC}/public/index.html"  "${PANEL_DIR}/public/index.html"
  success "Lokale Dateien kopiert."
elif [[ "$GITHUB_RAW" != *"DEIN_USER"* ]]; then
  info "Lade von GitHub: ${GITHUB_RAW}..."
  curl -fsSL "${GITHUB_RAW}/mc-panel/server.js"         -o "${PANEL_DIR}/server.js"
  curl -fsSL "${GITHUB_RAW}/mc-panel/package.json"      -o "${PANEL_DIR}/package.json"
  curl -fsSL "${GITHUB_RAW}/mc-panel/public/index.html" -o "${PANEL_DIR}/public/index.html"
  success "Dateien von GitHub heruntergeladen."
elif [[ -f "${PANEL_DIR}/server.js" ]]; then
  info "Verwende vorhandene Dateien in ${PANEL_DIR}."
else
  error "Keine Panel-Dateien gefunden! Bitte GITHUB_RAW in install.sh anpassen oder Dateien lokal ablegen."
fi

# ── npm install ───────────────────────────────────────────────
info "Installiere npm-Pakete..."
cd "${PANEL_DIR}"
npm install --silent --no-fund --no-audit
success "npm-Pakete installiert."

# ── Admin-Account einrichten ──────────────────────────────────
echo ""
echo -e "${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"
echo -e "${B}  Admin-Account erstellen${N}"
echo -e "${B}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${N}"

# Bestehenden Account ggf. überschreiben
if [[ -f "${PANEL_DIR}/config.json" ]]; then
  warn "Bestehende Konfiguration gefunden."
  read -rp "$(echo -e "${Y}?${N}  Admin-Account neu erstellen? [j/N]: ")" OVERWRITE
  if [[ "${OVERWRITE,,}" != "j" ]]; then
    info "Bestehender Account wird beibehalten."
    SKIP_ACCOUNT=true
  fi
fi

if [[ "${SKIP_ACCOUNT}" != "true" ]]; then
  while true; do
    read -rp "$(echo -e "${Y}?${N}  Benutzername: ")" ADMIN_USER
    ADMIN_USER="${ADMIN_USER// /}"
    [[ -n "$ADMIN_USER" ]] && break
    warn "Benutzername darf nicht leer sein."
  done

  while true; do
    read -rsp "$(echo -e "${Y}?${N}  Passwort: ")" ADMIN_PASS
    echo ""
    [[ ${#ADMIN_PASS} -ge 6 ]] && break
    warn "Passwort muss mindestens 6 Zeichen haben."
  done

  read -rsp "$(echo -e "${Y}?${N}  Passwort bestätigen: ")" ADMIN_PASS2
  echo ""
  if [[ "$ADMIN_PASS" != "$ADMIN_PASS2" ]]; then
    error "Passwörter stimmen nicht überein!"
  fi

  # Passwort hashen mit Node.js crypto
  SALT=$(node -e "process.stdout.write(require('crypto').randomBytes(16).toString('hex'))")
  HASH=$(node -e "
    const c=require('crypto');
    const h=c.createHmac('sha256','${SALT}').update('${ADMIN_PASS}').digest('hex');
    process.stdout.write(h);
  ")

  cat > "${PANEL_DIR}/config.json" <<JSON
{
  "username": "${ADMIN_USER}",
  "passwordHash": "${HASH}",
  "salt": "${SALT}"
}
JSON

  success "Admin-Account '${ADMIN_USER}' erstellt."
fi

# ── Port konfigurieren ────────────────────────────────────────
read -rp "$(echo -e "${Y}?${N}  Panel-Port [Standard: 8080]: ")" PANEL_PORT
PANEL_PORT="${PANEL_PORT:-8080}"

# ── Systemd Service ───────────────────────────────────────────
info "Erstelle Systemd Service..."
cat > /etc/systemd/system/skitaru-panel.service << EOF
[Unit]
Description=Skitaru MC Panel
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=${PANEL_DIR}
Environment=PORT=${PANEL_PORT}
ExecStart=/usr/bin/node ${PANEL_DIR}/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Alten Service entfernen falls vorhanden
systemctl stop mc-panel 2>/dev/null || true
systemctl disable mc-panel 2>/dev/null || true
rm -f /etc/systemd/system/mc-panel.service 2>/dev/null || true

systemctl daemon-reload
systemctl enable skitaru-panel
systemctl restart skitaru-panel
success "Systemd Service gestartet."

# ── Firewall ──────────────────────────────────────────────────
if command -v ufw &>/dev/null && ufw status | grep -q "active"; then
  warn "UFW aktiv – öffne Port ${PANEL_PORT}/tcp..."
  ufw allow "${PANEL_PORT}/tcp" &>/dev/null || true
fi

# ── Fertig ────────────────────────────────────────────────────
SERVER_IP=$(hostname -I | awk '{print $1}')
echo ""
echo -e "${G}${B}╔══════════════════════════════════════════╗${N}"
echo -e "${G}${B}║   ✔  Skitaru Panel erfolgreich!          ║${N}"
echo -e "${G}${B}╚══════════════════════════════════════════╝${N}"
echo ""
echo -e "  ${B}Panel-URL:${N}"
echo -e "  ${C}http://${SERVER_IP}:${PANEL_PORT}${N}"
echo ""
echo -e "  ${B}Nützliche Befehle:${N}"
echo -e "  systemctl status  skitaru-panel   – Status"
echo -e "  systemctl restart skitaru-panel   – Neustart"
echo -e "  journalctl -u     skitaru-panel -f – Logs"
echo ""
echo -e "  ${Y}One-Liner (nach GitHub Upload):${N}"
echo -e "  ${C}bash <(curl -fsSL ${GITHUB_RAW}/install.sh)${N}"
echo ""
