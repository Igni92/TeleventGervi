#!/usr/bin/env bash
# TeleVent — DÉPLOIEMENT (code + cron) sur le VPS OVH. Idempotent.
#
# Ce dossier EST le serveur de prod : on construit le checkout COURANT
# (aucun `git pull` — le remote GitHub n'a pas de token). Workflow :
#   1) tu modifies le code et/ou deploy/cron/televent.cron
#   2) tu lances CE script → build + réinstallation du cron + redémarrage
#
# À lancer depuis un terminal vierge (connecté en `ubuntu`, qui a sudo) :
#   bash /srv/televent/app/deploy/scripts/deploy.sh
#
# Peu importe qui le lance (ubuntu / root / televent) : le BUILD tourne TOUJOURS
# en tant que `televent` (propriétaire de node_modules/.next) et les tâches
# SYSTÈME (cron, service) passent par sudo.
set -euo pipefail

APP_DIR=/srv/televent/app
APP_USER=televent
CURRENT_USER="$(id -un)"

# npm/build TOUJOURS en tant que televent (sinon EACCES sur node_modules).
app_npm() {
  if [ "$CURRENT_USER" = "$APP_USER" ]; then
    ( cd "$APP_DIR" && npm "$@" )
  else
    sudo -u "$APP_USER" -H bash -lc "cd '$APP_DIR' && npm $*"
  fi
}
# Tâches système : direct si root, sinon sudo.
if [ "$(id -u)" = "0" ]; then SUDO=""; else SUDO="sudo"; fi

echo "── 1/4 · Dépendances (npm ci, en tant que $APP_USER) ──"
app_npm ci

echo "── 2/4 · Build de production (prisma generate && next build) ──"
app_npm run build

echo "── 3/4 · Cron (helper + crontab versionné → /etc/cron.d) ──"
$SUDO install -m 755 "$APP_DIR/deploy/scripts/cron-call.sh" /usr/local/bin/televent-cron-call
$SUDO install -m 644 "$APP_DIR/deploy/cron/televent.cron"   /etc/cron.d/televent
if ! $SUDO grep -q '^CRON_SECRET=' "$APP_DIR/.env" 2>/dev/null; then
  echo "⚠️  CRON_SECRET absent de $APP_DIR/.env → AUCUN cron OVH ne s'authentifiera."
  echo "    Définis-en un (une seule fois) :"
  echo "      echo \"CRON_SECRET=\$(openssl rand -hex 24)\" | sudo tee -a $APP_DIR/.env"
fi

echo "── 4/4 · Redémarrage du service ──"
$SUDO systemctl restart televent
sleep 3
$SUDO systemctl --no-pager --lines=5 status televent || true

# -c safe.directory : le dépôt appartient à televent, on peut le lire depuis ubuntu.
GIT="git -C $APP_DIR -c safe.directory=$APP_DIR"
echo "✅ Déployé : $($GIT rev-parse --short HEAD) — $($GIT log -1 --pretty=%s)"
