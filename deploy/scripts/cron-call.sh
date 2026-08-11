#!/usr/bin/env bash
# TeleVent — déclencheur machine des routes cron (appelé par /etc/cron.d/televent).
# Usage : televent-cron-call /api/cron/sap-sync
# Lit CRON_SECRET dans le .env de l'app et appelle Next.js en local (port 3000),
# sans passer par nginx. Réinstallé automatiquement par deploy.sh.
#
# TOUT passe par le journal (`logger`), succès comme échec : cron tourne avec
# MAILTO="" — ce qui n'est pas journalisé n'existe pas. Diagnostic :
#   sudo journalctl --since '2 hours ago' | grep televent-cron
#
# Pas de `set -e` : une erreur doit produire une LIGNE DE JOURNAL, pas une mort
# silencieuse du script (c'est ce qui masquait un .env illisible : `grep` sortait
# en erreur et `set -e` tuait le script avant le message d'explication).
set -uo pipefail

ROUTE="${1:?usage: televent-cron-call /api/...}"
ENV_FILE="${ENV_FILE:-/srv/televent/app/.env}"
BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
TAG="televent-cron${ROUTE//\//-}"

fail() {
  echo "televent-cron-call: $1" >&2
  logger -t "$TAG" -p user.err "$1"
  exit 1
}

if [ ! -r "$ENV_FILE" ]; then
  fail "$ENV_FILE illisible par $(id -un) — les crons doivent tourner en tant que 'televent' (cf. /etc/cron.d/televent)."
fi

SECRET="$(grep -E '^CRON_SECRET=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
if [ -z "$SECRET" ]; then
  fail "CRON_SECRET absent de $ENV_FILE — appel annulé. Ajoute-le : echo \"CRON_SECRET=\$(openssl rand -hex 24)\" | sudo tee -a $ENV_FILE puis redémarre le service."
fi

# -m 900 : certaines routes (miroir SAP) sont longues ; -f : code retour ≠ 0 si
# HTTP >= 400. 2>&1 : le message d'erreur de curl (connexion refusée, timeout…)
# doit finir dans le journal, sinon un service à l'arrêt reste invisible.
OUT="$(curl -fsS -m 900 -H "x-cron-secret: ${SECRET}" "${BASE_URL}${ROUTE}" 2>&1)"
RC=$?
if [ "$RC" -ne 0 ]; then
  fail "ECHEC (curl rc=${RC}) sur ${BASE_URL}${ROUTE} : $(printf '%s' "$OUT" | tail -c 400)"
fi

logger -t "$TAG" "$(printf '%s' "$OUT" | head -c 2000)"
