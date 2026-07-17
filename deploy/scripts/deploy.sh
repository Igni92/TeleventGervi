#!/usr/bin/env bash
# TeleVent — mise à jour de l'app sur le VPS (pull + build + restart).
# À lancer en tant qu'utilisateur `televent` (ou root) :
#   bash /srv/televent/app/deploy/scripts/deploy.sh [branche]
# Le service redémarre en quelques secondes après le build (brève coupure,
# acceptable pour un outil interne ; faire un snapshot OVH avant une grosse màj).
set -euo pipefail

APP_DIR=/srv/televent/app
BRANCH="${1:-main}"

cd "$APP_DIR"

echo "── git pull origin ${BRANCH} ──"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "── npm ci (dépendances exactes du lockfile) ──"
npm ci

echo "── build de production (prisma generate && next build) ──"
npm run build

echo "── redémarrage du service ──"
sudo systemctl restart televent
sleep 3
sudo systemctl --no-pager --lines=5 status televent

echo "✅ Déployé : $(git rev-parse --short HEAD) ($(git log -1 --pretty=%s))"
