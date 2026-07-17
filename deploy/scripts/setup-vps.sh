#!/usr/bin/env bash
# TeleVent — provisionnement initial d'un OVH VPS-3 (Ubuntu 24.04 LTS).
# À lancer en ROOT sur le VPS fraîchement livré, le dépôt étant déjà cloné
# dans /srv/televent/app (cf. docs/OVH-VPS3-DEPLOIEMENT.md §2) :
#   bash /srv/televent/app/deploy/scripts/setup-vps.sh
# PostgreSQL local (option B) : INSTALL_POSTGRES=1 bash setup-vps.sh
# Idempotent : relançable sans casse.
set -euo pipefail

APP_DIR=/srv/televent/app
APP_USER=televent
INSTALL_POSTGRES="${INSTALL_POSTGRES:-0}"

echo "── Mises à jour système ──"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get upgrade -y
apt-get install -y curl git ufw fail2ban unattended-upgrades nginx \
  certbot python3-certbot-nginx

echo "── Utilisateur applicatif ${APP_USER} ──"
id "$APP_USER" &>/dev/null || adduser --system --group --home /srv/televent --shell /bin/bash "$APP_USER"
chown -R "$APP_USER":"$APP_USER" /srv/televent

echo "── Pare-feu (ufw) : SSH + HTTP + HTTPS uniquement ──"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "── fail2ban (protège SSH) + mises à jour de sécurité auto ──"
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "── Swap 2 Go (filet pour next build) ──"
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "── Node.js 22 LTS (NodeSource) ──"
if ! command -v node &>/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v && npm -v

if [ "$INSTALL_POSTGRES" = "1" ]; then
  echo "── PostgreSQL 16 local + base televent ──"
  apt-get install -y postgresql postgresql-contrib
  systemctl enable --now postgresql
  sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='televent'" | grep -q 1 \
    || { PGPASS="$(openssl rand -base64 24)"; \
         sudo -u postgres psql -c "CREATE ROLE televent LOGIN PASSWORD '${PGPASS}'"; \
         echo "⚠️  Mot de passe PostgreSQL généré pour 'televent' : ${PGPASS}"; \
         echo "    → à reporter dans DATABASE_URL du .env"; }
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='televent'" | grep -q 1 \
    || sudo -u postgres createdb -O televent televent
  # Tuning mémoire pour 12 Go partagés avec Node (cf. guide §3.B).
  PGCONF=$(sudo -u postgres psql -tAc "SHOW config_file")
  for kv in "shared_buffers = 2GB" "effective_cache_size = 6GB" \
            "work_mem = 32MB" "maintenance_work_mem = 256MB" "max_connections = 60"; do
    key="${kv%% =*}"
    grep -qE "^${key}" "$PGCONF" || echo "$kv" >> "$PGCONF"
  done
  systemctl restart postgresql
  mkdir -p /var/backups/televent && chown "$APP_USER":"$APP_USER" /var/backups/televent
fi

echo "── Fichiers de conf TeleVent (nginx, systemd, cron) ──"
cp "$APP_DIR/deploy/nginx/televent.conf" /etc/nginx/sites-available/televent.conf
ln -sf /etc/nginx/sites-available/televent.conf /etc/nginx/sites-enabled/televent.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

cp "$APP_DIR/deploy/systemd/televent.service" /etc/systemd/system/televent.service
systemctl daemon-reload

cp "$APP_DIR/deploy/scripts/cron-call.sh" /usr/local/bin/televent-cron-call
chmod 755 /usr/local/bin/televent-cron-call
cp "$APP_DIR/deploy/cron/televent.cron" /etc/cron.d/televent
chmod 644 /etc/cron.d/televent

cat <<'EOF'

✅ Provisionnement terminé. Étapes suivantes (guide §4-§7) :
  1. sudo -u televent -i ; cd /srv/televent/app
  2. cp .env.example .env && chmod 600 .env   # remplir (dont CRON_SECRET)
  3. npm ci && npm run build
  4. sudo systemctl enable --now televent
  5. DNS → IP du VPS, puis : sudo certbot --nginx -d televent.gervifrais.com
EOF
