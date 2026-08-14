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
START="$(date +%s%3N 2>/dev/null || date +%s)"
OUT="$(curl -fsS -m 900 -H "x-cron-secret: ${SECRET}" "${BASE_URL}${ROUTE}" 2>&1)"
RC=$?
END="$(date +%s%3N 2>/dev/null || date +%s)"
MS=$(( END - START ))

# Journalise l'exécution DANS L'APP (écran « État des tâches planifiées ») —
# succès comme échec. On ne journalise PAS l'appel de journalisation lui-même
# (/api/cron/record) pour éviter la récursion. Best-effort, ne bloque jamais.
record_run() {
  case "$ROUTE" in
    /api/cron/record*) return 0 ;;
  esac
  local ok="$1" detail="$2"
  curl -fsS -m 30 -G "${BASE_URL}/api/cron/record" \
    -H "x-cron-secret: ${SECRET}" \
    --data-urlencode "route=${ROUTE}" \
    --data-urlencode "ok=${ok}" \
    --data-urlencode "ms=${MS}" \
    --data-urlencode "detail=${detail}" >/dev/null 2>&1 || true
}

if [ "$RC" -ne 0 ]; then
  record_run 0 "curl rc=${RC} : $(printf '%s' "$OUT" | tail -c 200)"
  fail "ECHEC (curl rc=${RC}) sur ${BASE_URL}${ROUTE} : $(printf '%s' "$OUT" | tail -c 400)"
fi

record_run 1 "$(printf '%s' "$OUT" | head -c 200)"
logger -t "$TAG" "$(printf '%s' "$OUT" | head -c 2000)"
