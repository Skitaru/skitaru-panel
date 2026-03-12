#!/bin/bash
# ╔══════════════════════════════════════════════════════════════╗
# ║              Skitaru Panel — Installer v2                   ║
# ╚══════════════════════════════════════════════════════════════╝
set -euo pipefail

# ── Detect language ───────────────────────────────────────────────
LANG_CODE="${SKITARU_LANG:-}"
if [ -z "$LANG_CODE" ]; then
  SYS_LANG="${LANG:-${LANGUAGE:-en}}"
  case "$SYS_LANG" in de*) LANG_CODE="de" ;; *) LANG_CODE="en" ;; esac
fi

# ── Translations ──────────────────────────────────────────────────
if [ "$LANG_CODE" = "de" ]; then
  T_TITLE="Skitaru Panel Installer"
  T_ROOT="Dieses Skript muss als root ausgeführt werden."
  T_OS="Nicht unterstütztes Betriebssystem. Debian 11/12/13 erforderlich."
  T_PICK_LANG="Sprache / Language:"
  T_LANG_DE="  [1] Deutsch"
  T_LANG_EN="  [2] English"
  T_LANG_PROMPT="Auswahl [1-2]: "
  T_DETECT="System erkannt"
  T_STEP_DEPS="Abhängigkeiten installieren"
  T_STEP_DOCKER="Docker installieren"
  T_STEP_NODE="Node.js installieren"
  T_STEP_DIR="Verzeichnis anlegen"
  T_STEP_FILES="Panel-Dateien herunterladen"
  T_STEP_NPM="NPM-Pakete installieren"
  T_STEP_SERVICE="Systemd-Dienst konfigurieren"
  T_STEP_PW="Admin-Passwort setzen"
  T_STEP_FW="Firewall konfigurieren"
  T_DONE="Installation abgeschlossen"
  T_PW_PROMPT="Admin-Passwort"
  T_PW_CONFIRM="Passwort bestätigen"
  T_PW_MISMATCH="Passwörter stimmen nicht überein. Erneut versuchen."
  T_PW_SHORT="Passwort muss mindestens 8 Zeichen lang sein."
  T_URL="Panel erreichbar unter"
  T_SERVICE="Dienst verwalten"
  T_ALREADY="Panel ist bereits installiert."
  T_REINSTALL="Neu installieren? Alle Daten bleiben erhalten. [j/N]: "
  T_SKIP="Installation abgebrochen."
  T_UPDATING="Aktualisiere vorhandene Installation..."
  T_OK="OK"
  T_FAIL="FEHLER"
  T_WARN="Skipping — bereits installiert"
else
  T_TITLE="Skitaru Panel Installer"
  T_ROOT="This script must be run as root."
  T_OS="Unsupported OS. Debian 11/12/13 required."
  T_PICK_LANG="Sprache / Language:"
  T_LANG_DE="  [1] Deutsch"
  T_LANG_EN="  [2] English"
  T_LANG_PROMPT="Choose [1-2]: "
  T_DETECT="System detected"
  T_STEP_DEPS="Install dependencies"
  T_STEP_DOCKER="Install Docker"
  T_STEP_NODE="Install Node.js"
  T_STEP_DIR="Create directory"
  T_STEP_FILES="Download panel files"
  T_STEP_NPM="Install NPM packages"
  T_STEP_SERVICE="Configure systemd service"
  T_STEP_PW="Set admin password"
  T_STEP_FW="Configure firewall"
  T_DONE="Installation complete"
  T_PW_PROMPT="Admin password"
  T_PW_CONFIRM="Confirm password"
  T_PW_MISMATCH="Passwords do not match. Try again."
  T_PW_SHORT="Password must be at least 8 characters."
  T_URL="Panel available at"
  T_SERVICE="Manage service"
  T_ALREADY="Panel is already installed."
  T_REINSTALL="Reinstall? All data will be kept. [y/N]: "
  T_SKIP="Installation cancelled."
  T_UPDATING="Updating existing installation..."
  T_OK="OK"
  T_FAIL="ERROR"
  T_WARN="Skipping — already installed"
fi

# ── Colors ────────────────────────────────────────────────────────
G='\033[0;32m'; B='\033[1;34m'; Y='\033[0;33m'
R='\033[0;31m'; W='\033[1;37m'; D='\033[0;90m'; N='\033[0m'
BOLD='\033[1m'; DIM='\033[2m'

# ── UI helpers ────────────────────────────────────────────────────
header() {
  clear
  echo
  echo -e "  ${G}╔══════════════════════════════════════════════════════════╗${N}"
  echo -e "  ${G}║${N}  ${BOLD}${W}⬡  SKITARU PANEL${N}  ${DIM}v2.0  —  Installer${N}              ${G}║${N}"
  echo -e "  ${G}╚══════════════════════════════════════════════════════════╝${N}"
  echo
}

step() {
  local n="$1" total="$2" label="$3"
  local pct=$(( n * 100 / total ))
  local filled=$(( n * 28 / total ))
  local bar=""
  for i in $(seq 1 $filled);  do bar="${bar}█"; done
  for i in $(seq $((filled+1)) 28); do bar="${bar}░"; done
  clear
  echo
  echo -e "  ${G}╔══════════════════════════════════════════════════════════╗${N}"
  echo -e "  ${G}║${N}  ${BOLD}${W}⬡  SKITARU PANEL${N}  ${DIM}v2.0  —  Installer${N}              ${G}║${N}"
  echo -e "  ${G}╚══════════════════════════════════════════════════════════╝${N}"
  echo
  echo -e "  ${G}[${bar}]${N} ${DIM}${pct}%${N}  ${W}${n}/${total}${N}  ${BOLD}${label}${N}"
  echo
  sep
  echo
}

ok()   { echo -e "  ${G}✔${N}  $1"; }
fail() { echo -e "  ${R}✖  $1${N}"; exit 1; }
warn() { echo -e "  ${Y}⚠${N}  $1"; }
info() { echo -e "  ${D}→${N}  ${DIM}$1${N}"; }
sep()  { echo -e "  ${D}────────────────────────────────────────────────${N}"; }
br()   { echo; }

run() {
  local label="$1"; shift
  info "$label"
  if "$@" >> /tmp/skitaru-install.log 2>&1; then
    ok "$label"
  else
    fail "$T_FAIL: $label"
  fi
}

# ── Language picker (interactive) ─────────────────────────────────
pick_language() {
  header
  echo -e "  ${W}${T_PICK_LANG}${N}"
  br
  echo -e "${G}${T_LANG_DE}${N}"
  echo -e "${G}${T_LANG_EN}${N}"
  br
  printf "  %s" "$T_LANG_PROMPT"
  read -r choice
  case "$choice" in
    1) LANG_CODE="de" ;;
    2) LANG_CODE="en" ;;
    *) LANG_CODE="en" ;;
  esac
  # Re-source translations
  if [ "$LANG_CODE" = "de" ]; then
    T_DETECT="System erkannt"; T_STEP_DEPS="Abhängigkeiten installieren"
    T_STEP_DOCKER="Docker installieren"; T_STEP_NODE="Node.js installieren"
    T_STEP_DIR="Verzeichnis anlegen"; T_STEP_FILES="Panel-Dateien herunterladen"
    T_STEP_NPM="NPM-Pakete installieren"; T_STEP_SERVICE="Systemd-Dienst konfigurieren"
    T_STEP_PW="Admin-Passwort setzen"; T_STEP_FW="Firewall konfigurieren"
    T_DONE="Installation abgeschlossen"; T_PW_PROMPT="Admin-Passwort"
    T_PW_CONFIRM="Passwort bestätigen"; T_PW_MISMATCH="Passwörter stimmen nicht überein. Erneut versuchen."
    T_PW_SHORT="Passwort muss mindestens 8 Zeichen lang sein."
    T_URL="Panel erreichbar unter"; T_SERVICE="Dienst verwalten"
    T_ALREADY="Panel ist bereits installiert."; T_REINSTALL="Neu installieren? Alle Daten bleiben erhalten. [j/N]: "
    T_SKIP="Installation abgebrochen."; T_UPDATING="Aktualisiere vorhandene Installation..."
    T_WARN="Skipping — bereits installiert"; T_ROOT="Dieses Skript muss als root ausgeführt werden."
    T_OS="Nicht unterstütztes Betriebssystem. Debian 11/12/13 erforderlich."
  else
    T_DETECT="System detected"; T_STEP_DEPS="Install dependencies"
    T_STEP_DOCKER="Install Docker"; T_STEP_NODE="Install Node.js"
    T_STEP_DIR="Create directory"; T_STEP_FILES="Download panel files"
    T_STEP_NPM="Install NPM packages"; T_STEP_SERVICE="Configure systemd service"
    T_STEP_PW="Set admin password"; T_STEP_FW="Configure firewall"
    T_DONE="Installation complete"; T_PW_PROMPT="Admin password"
    T_PW_CONFIRM="Confirm password"; T_PW_MISMATCH="Passwords do not match. Try again."
    T_PW_SHORT="Password must be at least 8 characters."
    T_URL="Panel available at"; T_SERVICE="Manage service"
    T_ALREADY="Panel is already installed."; T_REINSTALL="Reinstall? All data will be kept. [y/N]: "
    T_SKIP="Installation cancelled."; T_UPDATING="Updating existing installation..."
    T_WARN="Skipping — already installed"; T_ROOT="This script must be run as root."
    T_OS="Unsupported OS. Debian 11/12/13 required."
  fi
}

# ── Constants ─────────────────────────────────────────────────────
PANEL_DIR="/root/mc-panel"
SERVICE_NAME="skitaru-panel"
REPO="https://raw.githubusercontent.com/Skitaru/skitaru-panel/main"
PORT=3000
TOTAL_STEPS=8

# ── Pre-flight ────────────────────────────────────────────────────
[ "$EUID" -ne 0 ] && { echo -e "${R}$T_ROOT${N}"; exit 1; }
. /etc/os-release 2>/dev/null || true
[[ "${ID:-}" != "debian" ]] && { echo -e "${R}$T_OS${N}"; exit 1; }

# ── Language selection ────────────────────────────────────────────
pick_language

# ── Already installed? ────────────────────────────────────────────
REINSTALL=false
if [ -d "$PANEL_DIR" ] && [ -f "$PANEL_DIR/server.js" ]; then
  header
  warn "$T_ALREADY"
  br
  printf "  %s" "$T_REINSTALL"
  read -r ans
  case "$ans" in [jJyY]) REINSTALL=true ;; *) echo -e "  ${D}$T_SKIP${N}"; exit 0 ;; esac
fi

# ── Start ─────────────────────────────────────────────────────────
header
PRETTY_NAME="${PRETTY_NAME:-Debian}"
_DETECT_MSG="$T_DETECT: ${PRETTY_NAME}"

# ── Step 1: Dependencies ──────────────────────────────────────────
step 1 $TOTAL_STEPS "$T_STEP_DEPS"
info "$_DETECT_MSG"
run "apt-get update" apt-get update -qq
run "curl, wget, gnupg, ca-certificates" apt-get install -y -qq curl wget gnupg ca-certificates lsb-release apt-transport-https

# ── Step 2: Docker ────────────────────────────────────────────────
step 2 $TOTAL_STEPS "$T_STEP_DOCKER"
if command -v docker &>/dev/null; then
  warn "$T_WARN"
else
  run "Docker GPG key" bash -c 'install -m 0755 -d /etc/apt/keyrings && \
    (curl -fsSL https://download.docker.com/linux/debian/gpg 2>/dev/null || wget -qO- https://download.docker.com/linux/debian/gpg) | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg'
  run "Docker repository" bash -c 'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/debian $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list'
  run "apt-get update" apt-get update -qq
  run "docker-ce docker-compose-plugin" apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  run "Enable Docker" systemctl enable --now docker
fi

# ── Step 3: Node.js ───────────────────────────────────────────────
step 3 $TOTAL_STEPS "$T_STEP_NODE"
if command -v node &>/dev/null && node -e 'process.exit(parseInt(process.version.slice(1))<18?1:0)' 2>/dev/null; then
  warn "$T_WARN ($(node --version))"
else
  run "NodeSource GPG + repo" bash -c '(curl -fsSL https://deb.nodesource.com/setup_20.x 2>/dev/null || wget -qO- https://deb.nodesource.com/setup_20.x) | bash - >> /tmp/skitaru-install.log 2>&1'
  run "nodejs" apt-get install -y -qq nodejs
fi

# ── Step 4: Directory ─────────────────────────────────────────────
step 4 $TOTAL_STEPS "$T_STEP_DIR"
mkdir -p "$PANEL_DIR/public"
ok "$PANEL_DIR"

# ── Step 5: Download files ────────────────────────────────────────
step 5 $TOTAL_STEPS "$T_STEP_FILES"
run "server.js"      bash -c "curl -fsSL \"$REPO/server.js\" -o \"$PANEL_DIR/server.js\" 2>/dev/null || wget -q \"$REPO/server.js\" -O \"$PANEL_DIR/server.js\""
run "index.html"     bash -c "curl -fsSL \"$REPO/public/index.html\" -o \"$PANEL_DIR/public/index.html\" 2>/dev/null || wget -q \"$REPO/public/index.html\" -O \"$PANEL_DIR/public/index.html\""
run "package.json"   bash -c "curl -fsSL \"$REPO/package.json\" -o \"$PANEL_DIR/package.json\" 2>/dev/null || wget -q \"$REPO/package.json\" -O \"$PANEL_DIR/package.json\""

# ── Step 6: NPM ──────────────────────────────────────────────────
step 6 $TOTAL_STEPS "$T_STEP_NPM"
run "npm install" bash -c "cd $PANEL_DIR && npm install --silent"

# ── Step 7: Service ───────────────────────────────────────────────
step 7 $TOTAL_STEPS "$T_STEP_SERVICE"
cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=Skitaru MC Panel
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=${PANEL_DIR}
ExecStart=/usr/bin/node ${PANEL_DIR}/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
run "systemctl daemon-reload" systemctl daemon-reload
run "Enable & start service" bash -c "systemctl enable $SERVICE_NAME && systemctl restart $SERVICE_NAME"

# ── Step 8: Password ─────────────────────────────────────────────
step 8 $TOTAL_STEPS "$T_STEP_PW"
if [ "$REINSTALL" = false ] || [ ! -f "$PANEL_DIR/config.json" ]; then
  while true; do
    br
    printf "  ${W}%s: ${N}" "$T_PW_PROMPT"
    read -rs PW; echo
    if [ ${#PW} -lt 8 ]; then warn "$T_PW_SHORT"; continue; fi
    printf "  ${W}%s: ${N}" "$T_PW_CONFIRM"
    read -rs PW2; echo
    [ "$PW" = "$PW2" ] && break
    warn "$T_PW_MISMATCH"
  done
  HASH=$(echo -n "$PW" | openssl dgst -sha256 -hmac "skitaru-panel-secret" | awk '{print $2}')
  echo "{\"username\":\"admin\",\"passwordHash\":\"$HASH\"}" > "$PANEL_DIR/config.json"
  ok "config.json"
else
  warn "$T_WARN"
fi

# ── Done ──────────────────────────────────────────────────────────
IP=$(hostname -I | awk '{print $1}')
br
echo -e "  ${G}╔══════════════════════════════════════════════════════════╗${N}"
echo -e "  ${G}║${N}  ${G}✔${N}  ${BOLD}${W}${T_DONE}${N}                               ${G}║${N}"
echo -e "  ${G}╠══════════════════════════════════════════════════════════╣${N}"
echo -e "  ${G}║${N}  ${D}${T_URL}:${N}                                   ${G}║${N}"
echo -e "  ${G}║${N}  ${B}http://${IP}:${PORT}${N}                                ${G}║${N}"
echo -e "  ${G}║${N}                                                          ${G}║${N}"
echo -e "  ${G}║${N}  ${D}${T_SERVICE}:${N}                               ${G}║${N}"
echo -e "  ${G}║${N}  ${DIM}systemctl restart ${SERVICE_NAME}${N}                  ${G}║${N}"
echo -e "  ${G}║${N}  ${DIM}journalctl -u ${SERVICE_NAME} -f${N}                  ${G}║${N}"
echo -e "  ${G}╚══════════════════════════════════════════════════════════╝${N}"
br
info "/tmp/skitaru-install.log"
br
