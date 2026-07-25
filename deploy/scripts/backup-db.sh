#!/usr/bin/env bash
# TeleVent — sauvegarde quotidienne de la base PostgreSQL LOCALE (option B).
# Planifié par /etc/cron.d/televent. Si DATABASE_URL ne pointe pas sur une base
# locale (option A : Supabase), le script sort sans rien faire — Supabase gère
# ses propres backups.
# Dumps compressés dans /var/backups/televent/, rétention 14 jours.
# Recommandé : répliquer ce dossier hors du VPS (rclone → OVH Object Storage).
set -euo pipefail

ENV_FILE="${ENV_FILE:-/srv/televent/app/.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/televent}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL absent de $ENV_FILE" >&2; exit 1; }

case "$DATABASE_URL" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "Base non locale (Supabase ?) — backup géré côté hébergeur, rien à faire."; exit 0 ;;
esac

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/televent-$STAMP.dump"

pg_dump "$DATABASE_URL" -Fc -f "$OUT"
find "$BACKUP_DIR" -name 'televent-*.dump' -mtime +"$RETENTION_DAYS" -delete

echo "✅ Backup : $OUT ($(du -h "$OUT" | cut -f1)) — rétention ${RETENTION_DAYS} j"
