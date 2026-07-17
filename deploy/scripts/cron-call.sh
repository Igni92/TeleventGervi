#!/usr/bin/env bash
# TeleVent — déclencheur machine des routes de synchro (appelé par cron).
# Usage : televent-cron-call /api/cron/sap-sync
# Lit CRON_SECRET dans le .env de l'app et appelle Next.js en local (port 3000),
# sans passer par nginx. Installer : sudo cp deploy/scripts/cron-call.sh \
#   /usr/local/bin/televent-cron-call && sudo chmod 755 /usr/local/bin/televent-cron-call
set -euo pipefail

ROUTE="${1:?usage: televent-cron-call /api/...}"
ENV_FILE="${ENV_FILE:-/srv/televent/app/.env}"
BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"

SECRET="$(grep -E '^CRON_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
if [ -z "$SECRET" ]; then
  echo "televent-cron-call: CRON_SECRET absent de $ENV_FILE — synchro refusée" >&2
  exit 1
fi

# -m 900 : la synchro miroir peut être longue ; -f : code retour ≠ 0 si HTTP ≥ 400
# (cron/journal verront l'échec). La sortie JSON est envoyée au journal syslog.
curl -fsS -m 900 -H "x-cron-secret: ${SECRET}" "${BASE_URL}${ROUTE}" \
  | logger -t "televent-cron${ROUTE//\//-}" || {
    logger -t "televent-cron${ROUTE//\//-}" "ECHEC (HTTP ou timeout)"
    exit 1
  }
