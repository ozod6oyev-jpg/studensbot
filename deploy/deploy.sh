#!/usr/bin/env bash
#
# Daftar Bot'ni Ubuntu/Debian serverga o'rnatadi.
#
#   bash deploy.sh                              # loyiha shu papkada turgan bo'lsa
#   bash deploy.sh https://github.com/siz/daftar-bot   # git'dan yuklab o'rnatish
#   bash deploy.sh --token-file=/root/token.txt  # tokenni fayldan o'qib o'rnatish
#
# Skript idempotent: qayta ishga tushirilsa ham xavfsiz (mavjud sozlamalar va
# ma'lumotlar saqlanib qoladi, xizmat qayta ishga tushiriladi).
set -euo pipefail

REMOTE_URL=""
# Tokenni qo'lda fayl tahrirlamasdan kiritish uchun: --token-file=/yo'l/fayl
TOKEN_FILE=""
for argument in "$@"; do
  case "$argument" in
    --token-file=*) TOKEN_FILE="${argument#--token-file=}" ;;
    --token-file) fail_param="--token-file=/yo'l/fayl ko'rinishida yoziladi" ;;
    -*) fail_param="Noma'lum parametr: ${argument}" ;;
    *) REMOTE_URL="$argument" ;;
  esac
done
if [ -n "${fail_param:-}" ]; then
  printf '\n\033[1;31mXATO: %s\033[0m\n' "$fail_param" >&2
  exit 1
fi

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

# Skript o'rnatilgan papkaning o'zidan ishga tushirilsa va git manzili berilgan
# bo'lsa, pastda shu papka tozalanadi — skript faylining o'zi ham o'chib qolib,
# keyingi qatorlari o'qilmay qoladi. Shuning uchun o'zimizni /tmp dagi xavfsiz
# nusxadan qayta ishga tushiramiz (nusxa kichik, o'zi o'chib ketmaydi).
if [ -n "$REMOTE_URL" ]; then
  case "$SCRIPT_DIR" in
    "$APP_DIR"|"$APP_DIR"/*)
      info "Skript ${APP_DIR} ichida turgani uchun xavfsiz nusxadan qayta ishga tushiriladi"
      SAFE_DEPLOY_DIR="$(mktemp -d)"
      cp -a "${SCRIPT_DIR}/." "${SAFE_DEPLOY_DIR}/"
      cd /
      exec bash "${SAFE_DEPLOY_DIR}/deploy.sh" "$@"
      ;;
  esac
fi

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

# Rasmiy skript Bun'ni foydalanuvchi uy papkasiga (~/.bun/bin) o'rnatadi.
# Uni /usr/local/bin/bun ga *symlink* qilib bo'lmaydi: /root kabi uy papkalari
# boshqa foydalanuvchilarga yopiq, shuning uchun `daftar` xizmati
# "runuser: failed to execute /usr/local/bin/bun: Permission denied" bilan
# yiqiladi. Shuning uchun haqiqiy nusxani qo'yamiz.
BUN_SOURCE=""
if [ -x "${HOME}/.bun/bin/bun" ]; then
  BUN_SOURCE="${HOME}/.bun/bin/bun"
elif command -v bun >/dev/null 2>&1 && [ -x "$(command -v bun)" ]; then
  BUN_SOURCE="$(command -v bun)"
else
  ok "Bun o'rnatilmoqda (rasmiy skript)"
  curl -fsSL https://bun.sh/install | bash
  [ -x "${HOME}/.bun/bin/bun" ] || fail "Bun o'rnatilmadi. Qo'lda o'rnatib (https://bun.sh) qayta urinib ko'ring."
  BUN_SOURCE="${HOME}/.bun/bin/bun"
fi

# Symlinkni har doim haqiqiy faylga almashtiramiz (manba yangiroq bo'lsa yangilaymiz).
BUN_BIN="$(readlink -f "$BUN_SOURCE")"
[ -x "$BUN_BIN" ] || fail "Bun fayli topilmadi: ${BUN_SOURCE}"

if [ "$BUN_BIN" = "/usr/local/bin/bun" ]; then
  chmod 755 /usr/local/bin/bun
elif [ -L /usr/local/bin/bun ] || [ ! -f /usr/local/bin/bun ] || [ "$BUN_SOURCE" -nt /usr/local/bin/bun ]; then
  rm -f /usr/local/bin/bun
  install -m 755 "$BUN_BIN" /usr/local/bin/bun
fi
chmod 755 /usr/local/bin/bun
/usr/local/bin/bun --version >/dev/null 2>&1 || fail "/usr/local/bin/bun ishga tushmadi."
ok "Bun tayyor: $(/usr/local/bin/bun --version)"

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

# Eng muhim tekshiruv: xizmat foydalanuvchisi Bun'ni haqiqatan ishga
# tushira olishi kerak (Bun boshqa foydalanuvchining yopiq papkasida bo'lsa
# shu yerda to'xtaymiz, keyin emas).
runuser -u daftar -- /usr/local/bin/bun --version >/dev/null 2>&1 || fail "'daftar' foydalanuvchisi /usr/local/bin/bun ni ishga tushira olmayapti."
ok "'daftar' foydalanuvchisi Bun'ni ishga tushira oladi"

# ------------------------------ loyiha fayllari ---------------------------

info "Loyiha fayllari ${APP_DIR} ga joylashtirilmoqda"
if [ -n "$REMOTE_URL" ]; then
  # Git buyruqlari `daftar` foydalanuvchisi nomidan bajariladi: papka unga
  # tegishli, aks holda root sifatida ishlaganda git "dubious ownership"
  # xatosi bilan to'xtaydi.
  if [ -d "${APP_DIR}/.git" ]; then
    runuser -u daftar -- git -C "$APP_DIR" remote set-url origin "$REMOTE_URL" 2>/dev/null || true
    if ! runuser -u daftar -- git -C "$APP_DIR" pull --ff-only; then
      # Ish paytida kuzatilgan fayllar o'zgarib qolgan bo'lishi mumkin
      # (masalan `bun install` bun.lock ni yangilaydi) — bunday holatda
      # `git pull` merjni rad etadi. Indexdagi o'zgarishlar bo'shatiladi va
      # kuzatilgan fayllar asl holatiga qaytariladi. Kuzatilmaydigan fayllar
      # (.env, bot/data, dist) tegilmaydi.
      warn "git pull to'sqinlikka uchradi — kuzatilgan fayllar tiklanib, qayta urinib ko'riladi"
      runuser -u daftar -- git -C "$APP_DIR" reset --quiet || true
      runuser -u daftar -- git -C "$APP_DIR" checkout -- . || fail "Kuzatilgan fayllarni tiklab bo'lmadi: sudo -u daftar git -C ${APP_DIR} status"
      runuser -u daftar -- git -C "$APP_DIR" pull --ff-only \
        || fail "git pull bajarilmadi (${REMOTE_URL}): sudo -u daftar git -C ${APP_DIR} status"
    fi
    ok "Yangilandi (git pull)"
  else
    # Muammoli holat: papka ilgari `rsync` bilan joylashtirilgan (unda .git
    # yo'q), ammo ichida .env — ya'ni bot tokeni — bor. Tozalashdan oldin uni
    # vaqtincha saqlab olamiz, aks holda token yo'qolib qoladi.
    ENV_BACKUP=""
    if [ -f "${APP_DIR}/.env" ]; then
      ENV_BACKUP="$(mktemp)"
      cp -p "${APP_DIR}/.env" "$ENV_BACKUP"
      ok "Mavjud .env vaqtincha saqlab olindi"
    fi
    CLONE_DIR="$(mktemp -d)"
    git clone --depth 1 "$REMOTE_URL" "${CLONE_DIR}/repo"
    # git clone bo'sh papkani talab qiladi — mavjud narsalarni tozalaymiz.
    find "$APP_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    cp -a "${CLONE_DIR}/repo/." "$APP_DIR/"
    rm -rf "$CLONE_DIR"
    if [ -n "$ENV_BACKUP" ]; then
      cp -p "$ENV_BACKUP" "${APP_DIR}/.env"
      rm -f "$ENV_BACKUP"
      ok ".env qaytarildi — bot tokeni saqlanib qoldi"
    fi
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
# `bun install` standart holatda hamma bog'liqlikni, shu jumladan
# devDependencies'ni o'rnatadi (bot va tekshiruv skriptlari shunga tayanadi).
# `--production=false` yozilmaydi: yangi Bun versiyalarida u qiymat qabul
# qilmaydigan bayroqqa aylangan va xato beradi.
(cd "$APP_DIR" && runuser -u daftar -- /usr/local/bin/bun install)
ok "Bog'liqliklar tayyor"

# --------------------------------- .env -----------------------------------

info "Maxfiy kalitlar fayli"
ENV_FILE="${APP_DIR}/.env"
if [ -f "$ENV_FILE" ]; then
  ok "Mavjud sozlamalar fayli saqlanib qoldi (ustidan yozilmaydi)"
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
  ok "Namuna sozlamalar fayli yaratildi (chmod 600)"
fi

# Tokenni fayldan o'rnatish (qiymat jarayon argumentlarida ham, logda ham
# ko'rinmaydi: uni awk ichida fayldan o'qiymiz).
if [ -n "$TOKEN_FILE" ]; then
  [ -f "$TOKEN_FILE" ] || fail "Token fayli topilmadi: ${TOKEN_FILE}"
  TOKEN_TMP="$(mktemp)"
  if grep -q '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE"; then
    awk -v tf="$TOKEN_FILE" '
      BEGIN { while ((getline line < tf) > 0) { gsub(/[[:space:]]/, "", line); if (line != "") tok = line } }
      /^TELEGRAM_BOT_TOKEN=/ { print "TELEGRAM_BOT_TOKEN=" tok; done = 1; next }
      { print }
      END { if (!done) print "TELEGRAM_BOT_TOKEN=" tok }
    ' "$ENV_FILE" > "$TOKEN_TMP"
  else
    cat "$ENV_FILE" > "$TOKEN_TMP"
    awk -v tf="$TOKEN_FILE" '
      BEGIN { while ((getline line < tf) > 0) { gsub(/[[:space:]]/, "", line); if (line != "") tok = line }
              print "TELEGRAM_BOT_TOKEN=" tok }
    ' >> "$TOKEN_TMP"
  fi
  mv "$TOKEN_TMP" "$ENV_FILE"
  chown daftar:daftar "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok "Token fayldan o'rnatildi (chmod 600): ${TOKEN_FILE}"
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
elif [ -z "${TOKEN_FILE:-}" ]; then
  warn "TELEGRAM_BOT_TOKEN hali bo'sh!"
  printf '\n    1) @BotFather dan tokenni oling.\n'
  printf '    2) Faylni tahrirlang:  nano %s\n' "$ENV_FILE"
  printf '       (TELEGRAM_BOT_TOKEN= qatoriga tokenni yozing)\n'
  printf '    3) Xizmatni qayta ishga tushiring:  systemctl restart %s\n' "$SERVICE_NAME"
  printf '    Yoki:  bash deploy.sh --token-file=/root/token.txt\n\n'
fi

info "Xizmat holati"
systemctl status --no-pager "$SERVICE_NAME" | head -20 || true

printf '\nFoydali buyruqlar:\n'
printf '  Loglarni kuzatish : journalctl -u %s -f\n' "$SERVICE_NAME"
printf '  Qayta ishga tushirish : systemctl restart %s\n' "$SERVICE_NAME"
printf '  To'"'"'xtatish : systemctl stop %s\n' "$SERVICE_NAME"
printf '  Bot haqida ma'"'"'lumot : runuser -u daftar -- /usr/local/bin/bun run %s/bot/index.ts info\n\n' "$APP_DIR"
