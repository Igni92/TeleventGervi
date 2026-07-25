#!/usr/bin/env bash
# TeleVent — DÉPLOIEMENT (code + cron) sur le VPS OVH. Idempotent.
#
# Ce dossier EST le serveur de prod : on construit le checkout COURANT
# (aucun `git pull` — le remote GitHub n'a pas de token). Workflow :
#   1) tu modifies le code et/ou deploy/cron/televent.cron
#   2) tu lances CE script → build + réinstallation du cron + redémarrage
#
# Lance-le depuis un terminal vierge :
#   bash /srv/televent/app/deploy/scripts/deploy.sh
# (fonctionne aussi en `sudo bash …` : npm tourne toujours en tant que televent,
#  jamais en root, pour ne pas créer d'artefacts root-owned.)
set -euo pipefail

APP_DIR=/srv/televent/app
APP_USER=televent
cd "$APP_DIR"

# Tâches système via sudo (ou direct si déjà root) ; build en tant que televent.
if [ "$(id -u)" = "0" ]; then
  SUDO=""
  run_app() { sudo -u "$APP_USER" -H "$@"; }
else
  SUDO="sudo"
  run_app() { "$@"; }
fi

echo "── 1/4 · Dépendances (npm ci) ──"
run_app npm ci

echo "── 2/4 · Build de production (prisma generate && next build) ──"
run_app npm run build

echo "── 3/4 · Cron (helper + crontab versionné → /etc/cron.d) ──"
$SUDO install -m 755 "$APP_DIR/deploy/scripts/cron-call.sh" /usr/local/bin/televent-cron-call
$SUDO install -m 644 "$APP_DIR/deploy/cron/televent.cron"   /etc/cron.d/televent
if ! grep -q '^CRON_SECRET=' "$APP_DIR/.env" 2>/dev/null; then
  echo "⚠️  CRON_SECRET absent de $APP_DIR/.env → AUCUN cron OVH ne s'authentifiera."
  echo "    Définis-en un (une seule fois) :"
  echo "      echo \"CRON_SECRET=\$(openssl rand -hex 24)\" | sudo tee -a $APP_DIR/.env"
fi

echo "── 4/4 · Redémarrage du service ──"
$SUDO systemctl restart televent
sleep 3
$SUDO systemctl --no-pager --lines=5 status televent || true

echo "✅ Déployé : $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"
