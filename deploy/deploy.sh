#!/usr/bin/env bash
#
# Daftar Bot'ni Ubuntu/Debian serverga o'rnatadi.
#
#   bash deploy.sh                              # loyiha shu papkada turgan bo'lsa
#   bash deploy.sh https://github.com/siz/daftar-bot   # git'dan yuklab o'rnatish
#
# Skript idempotent: qayta ishga tushirilsa ham xavfsiz (mavjud .env va
# ma'lumotlar saqlanib qoladi, xizmat qayta ishga tushiriladi).
set -euo pipefail

REMOTE_URL="${1:-}"

# ------------------------------ yordamchilar ------------------------------

info() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
ok() { printf '    \033[1;32m%s\033[0m\n' "$1"; }
warn() { printf '    \033[1;33mOGOHLANTIRISH: %s\033[0m\n' "$1"; }
fail() {
  printf '\n\033[1;31mXATO: %s\033[0m\n' "$1" >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="/opt/daftar-bot"
DATA_DIR="/var/lib/daftar-bot"
SERVICE_NAME="daftar-bot"
UNIT_SOURCE="${SCRIPT_DIR}/daftar-bot.service"
UNIT_TARGET="/etc/systemd/system/${SERVICE_NAME}.service"

# --------------------------- oldindan tekshiruv ---------------------------

info "Daftar Bot o'rnatilmoqda"

[ "$EUID" -eq 0 ] || fail "Bu skript root huquqi bilan ishga tushirilishi kerak: sudo bash deploy.sh"
command -v apt-get >/dev/null 2>&1 || fail "Bu skript Ubuntu/Debian uchun (apt-get topilmadi)."
[ -f "$UNIT_SOURCE" ] || fail "deploy/daftar-bot.service topilmadi — deploy/ papkasi bilan birga ishga tushiring."

if [ -z "$REMOTE_URL" ]; then
  [ -f "${SOURCE_DIR}/bot/index.ts" ] || fail "Loyiha fayllari topilmadi. Git manzilini bering: bash deploy.sh https://github.com/siz/daftar-bot"
  ok "Manba: shu papkadagi loyiha (${SOURCE_DIR})"
else
  ok "Manba: git repozitoriy (${REMOTE_URL})"
fi

# ------------------------------ paketlar ---------------------------------

info "Tizim paketlari tekshirilmoqda"
MISSING_PACKAGES=()
for package in curl git ca-certificates rsync; do
  dpkg -s "$package" >/dev/null 2>&1 || MISSING_PACKAGES+=("$package")
done

if [ "${#MISSING_PACKAGES[@]}" -gt 0 ]; then
  ok "O'rnatiladi: ${MISSING_PACKAGES[*]}"
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${MISSING_PACKAGES[@]}"
else
  ok "Hammasi mavjud"
fi

# -------------------------------- Bun -------------------------------------

info "Bun tekshirilmoqda"
if [ ! -x /usr/local/bin/bun ]; then
  if command -v bun >/dev/null 2>&1; then
    ln -sf "$(command -v bun)" /usr/local/bin/bun
    ok "Mavjud bun /usr/local/bin/bun ga bog'landi"
  else
    ok "Bun o'rnatilmoqda (rasmiy skript)"
    curl -fsSL https://bun.sh/install | bash
    if [ -x "${HOME}/.bun/bin/bun" ]; then
      ln -sf "${HOME}/.bun/bin/bun" /usr/local/bin/bun
      ok "Bun o'rnatildi: $(/usr/local/bin/bun --version)"
    else
      fail "Bun o'rnatilmadi. Qo'lda o'rnatib (https://bun.sh) qayta urinib ko'ring."
    fi
  fi
else
  ok "Bun mavjud: $(/usr/local/bin/bun --version)"
fi

# ------------------------- foydalanuvchi va papkalar ----------------------

info "Xizmat foydalanuvchisi va ma'lumot papkasi"
if id -u daftar >/dev/null 2>&1; then
  ok "Foydalanuvchi 'daftar' allaqachon mavjud"
else
  useradd --system --create-home --shell /usr/sbin/nologin daftar
  ok "Foydalanuvchi 'daftar' yaratildi"
fi

mkdir -p "$DATA_DIR" "$APP_DIR"
chown daftar:daftar "$DATA_DIR"
ok "Ma'lumot papkasi: ${DATA_DIR}"

# ------------------------------ loyiha fayllari ---------------------------

info "Loyiha fayllari ${APP_DIR} ga joylashtirilmoqda"
if [ -n "$REMOTE_URL" ]; then
  if [ -d "${APP_DIR}/.git" ]; then
    git -C "$APP_DIR" pull --ff-only
    ok "Yangilandi (git pull)"
  else
    # git clone bo'sh papkani talab qiladi — mavjud narsalarni tozalaymiz.
    find "$APP_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    git clone --depth 1 "$REMOTE_URL" "$APP_DIR"
    ok "Yuklab olindi (git clone)"
  fi
else
  [ "$SOURCE_DIR" != "$APP_DIR" ] || fail "Manba va maqsad papka bir xil (${APP_DIR}). Git manzilini bering yoki loyihani boshqa joydan ishga tushiring."
  rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'bot/data' \
    --exclude '.env' \
    --exclude '.env.local' \
    --exclude 'dist' \
    "${SOURCE_DIR}/" "${APP_DIR}/"
  ok "Fayllar ko'chirildi (rsync)"
fi
chown -R daftar:daftar "$APP_DIR"

# ------------------------------ bog'liqliklar -----------------------------

info "Bog'liqliklar o'rnatilmoqda (bun install)"
(cd "$APP_DIR" && runuser -u daftar -- /usr/local/bin/bun install --production=false)
ok "Bog'liqliklar tayyor"

# --------------------------------- .env -----------------------------------

info "Maxfiy kalitlar fayli (.env)"
ENV_FILE="${APP_DIR}/.env"
if [ -f "$ENV_FILE" ]; then
  ok "Mavjud .env saqlanib qoldi (ustidan yozilmaydi)"
else
  cat > "$ENV_FILE" <<'ENV_TEMPLATE'
# Daftar Bot sozlamalari. Bu fayl hech qachon git'ga qo'shilmaydi.
# Tokenni @BotFather'dan oling: /newbot
TELEGRAM_BOT_TOKEN=

# Ixtiyoriy: webhook uchun maxfiy kalit
# BOT_SECRET=

# Ixtiyoriy: webhook server porti (standart 8080)
# PORT=8080

# Ixtiyoriy: boshqa Bot API serveri
# TELEGRAM_API_BASE=https://api.telegram.org
ENV_TEMPLATE
  chown daftar:daftar "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok "Namuna .env yaratildi (chmod 600)"
fi

# ------------------------------- xizmat -----------------------------------

info "systemd xizmati o'rnatilmoqda"
install -m 644 "$UNIT_SOURCE" "$UNIT_TARGET"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
systemctl restart "$SERVICE_NAME"
ok "Xizmat yoqildi va ishga tushirildi: ${SERVICE_NAME}"

# ------------------------------- yakun ------------------------------------

if grep -qE '^TELEGRAM_BOT_TOKEN=[^[:space:]]+' "$ENV_FILE"; then
  ok "Token o'rnatilgan — bot ishlayapti"
else
  warn "TELEGRAM_BOT_TOKEN hali bo'sh!"
  printf '\n    1) @BotFather dan tokenni oling.\n'
  printf '    2) Faylni tahrirlang:  nano %s\n' "$ENV_FILE"
  printf '       (TELEGRAM_BOT_TOKEN= qatoriga tokenni yozing)\n'
  printf '    3) Xizmatni qayta ishga tushiring:  systemctl restart %s\n\n' "$SERVICE_NAME"
fi

info "Xizmat holati"
systemctl status --no-pager "$SERVICE_NAME" | head -20 || true

printf '\nFoydali buyruqlar:\n'
printf '  Loglarni kuzatish : journalctl -u %s -f\n' "$SERVICE_NAME"
printf '  Qayta ishga tushirish : systemctl restart %s\n' "$SERVICE_NAME"
printf '  To'"'"'xtatish : systemctl stop %s\n' "$SERVICE_NAME"
printf '  Bot haqida ma'"'"'lumot : runuser -u daftar -- /usr/local/bin/bun run %s/bot/index.ts info\n\n' "$APP_DIR"
