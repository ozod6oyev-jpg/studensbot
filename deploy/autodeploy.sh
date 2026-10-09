#!/usr/bin/env bash
#
# Daftar Bot'ni avtomatik yangilash.
#
# Serverga kirib qo'lda `git pull && sudo bash deploy.sh` qilish shart
# bo'lmasin: skript `origin` da yangi commit bor-yo'qligini o'zi tekshiradi va
# bor bo'lsa TO'LIQ deploy'ni bajaradi — pull, `bun install`, saytni yig'ish
# (dist/), nginx ni qayta o'qitish va botni qayta ishga tushirish.
#
# Uni systemd taymeri chaqiradi (har 2 daqiqada; deploy.sh taymerni o'zi
# o'rnatadi):
#
#   systemctl list-timers daftar-autodeploy.timer
#   journalctl -u daftar-autodeploy -n 50
#
# Qo'lda:
#
#   sudo bash deploy/autodeploy.sh --check     # yangilanish bormi, faqat aytadi
#   sudo bash deploy/autodeploy.sh             # bor bo'lsa hoziroq o'rnatadi
#   sudo bash deploy/autodeploy.sh --verbose   # o'zgarish bo'lmasa ham aytadi
#
# Xatti-harakat:
#   • o'zgarish bo'lmasa hech narsa qilmaydi (build ham, restart ham yo'q);
#   • bir vaqtda ikki nusxa ishlamaydi (flock) — taymer va qo'lda urinish
#     to'qnashmaydi;
#   • `git fetch` yiqilsa (internet yoki token) ogohlantirib, 0 bilan chiqadi:
#     taymer keyingi daqiqada yana urinadi;
#   • serverdagi nusxa upstream'dan oldinda bo'lsa (kimdir serverda commit
#     qilgan) hech narsa qilmaydi — qo'lda tekshirish kerak;
#   • deploy xatosi 0 bo'lmagan kod bilan tugaydi: `systemctl --failed` da
#     ko'rinadi, xato esa journalda qoladi.
#
# Standart qiymatlar deploy.sh bilan bir xil; boshqa joyga o'rnatilgan nusxa
# uchun AUTODEPLOY_APP_DIR (yoki AUTODEPLOY_DEPLOY_SCRIPT) beriladi.
set -euo pipefail

APP_DIR="${AUTODEPLOY_APP_DIR:-/opt/daftar-bot}"
SERVICE_USER="${AUTODEPLOY_USER:-daftar}"
DEPLOY_SCRIPT="${AUTODEPLOY_DEPLOY_SCRIPT:-${APP_DIR}/deploy/deploy.sh}"
BRANCH="${AUTODEPLOY_BRANCH:-}"

CHECK_ONLY=0
VERBOSE=0
for argument in "$@"; do
  case "$argument" in
    --check) CHECK_ONLY=1 ;;
    --verbose | -v) VERBOSE=1 ;;
    -*) printf "XATO: noma'lum parametr: %s\n" "$argument" >&2; exit 1 ;;
    *) printf "XATO: kutilmagan argument: %s\n" "$argument" >&2; exit 1 ;;
  esac
done

# systemd jurnaliga tushadi — rangli belgilar kerak emas.
log() { printf '[autodeploy] %s\n' "$1"; }
warn() { printf '[autodeploy] OGOHLANTIRISH: %s\n' "$1"; }

# Papka `daftar` foydalanuvchisiga tegishli: git buyruqlari ham shu nomdan
# bajariladi (root sifatida ishlaganda "dubious ownership" xatosi chiqadi).
git_as_user() {
  runuser -u "$SERVICE_USER" -- git -C "$APP_DIR" "$@"
}

# Yangi commitlar olinadigan shox: `@{u}` bo'lmasa — origin/HEAD, main, master.
upstream_ref() {
  if [ -n "$BRANCH" ]; then
    printf "origin/%s\n" "$BRANCH"
    return 0
  fi

  local tracked
  tracked="$(git_as_user rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  if [ -n "$tracked" ]; then
    printf "%s\n" "$tracked"
    return 0
  fi

  local candidate
  for candidate in origin/HEAD origin/main origin/master; do
    if git_as_user rev-parse --verify --quiet "$candidate" >/dev/null 2>&1; then
      printf "%s\n" "$candidate"
      return 0
    fi
  done
  return 0
}

# ------------------------------ qulf --------------------------------------

# Bir vaqtda ikki nusxa (taymer + qo'lda) ishlamasin.
LOCK_FILE="${AUTODEPLOY_LOCK:-/run/daftar-autodeploy.lock}"
if ! touch "$LOCK_FILE" 2>/dev/null; then
  LOCK_FILE="${TMPDIR:-/tmp}/daftar-autodeploy.lock"
fi
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    log "boshqa nusxa allaqachon ishlayapti — kutmasdan chiqamiz"
    exit 0
  fi
fi

# --------------------------- oldindan tekshiruv ---------------------------

[ "$EUID" -eq 0 ] || {
  warn "bu skript root huquqi bilan ishga tushiriladi: sudo bash deploy/autodeploy.sh"
  exit 1
}

if [ ! -d "${APP_DIR}/.git" ]; then
  warn "${APP_DIR} git repozitoriy emas — avtomatik yangilash o'chirilgan
    (ishlatish uchun: sudo bash ${DEPLOY_SCRIPT} https://github.com/siz/daftar-bot)"
  exit 0
fi

[ -f "$DEPLOY_SCRIPT" ] || {
  warn "deploy skripti topilmadi: ${DEPLOY_SCRIPT} — yangilashni qo'lda bajaring"
  exit 0
}

command -v runuser >/dev/null 2>&1 || {
  warn "runuser topilmadi — git buyruqlarini bajarib bo'lmaydi"
  exit 0
}

REMOTE_URL_VALUE="$(git_as_user remote get-url origin 2>/dev/null || true)"
[ -n "$REMOTE_URL_VALUE" ] || {
  warn "origin manzili yo'q: sudo -u ${SERVICE_USER} git -C ${APP_DIR} remote -v"
  exit 0
}

# ------------------------- yangilanish bormi? -----------------------------

if ! git_as_user fetch --quiet --prune origin; then
  warn "git fetch bajarilmadi (internet yoki token?) — keyingi urinishda yana sinaladi"
  exit 0
fi

TARGET_REF="$(upstream_ref)"
[ -n "$TARGET_REF" ] || {
  warn "upstream shox topilmadi: sudo -u ${SERVICE_USER} git -C ${APP_DIR} branch -vv"
  exit 0
}

LOCAL_HEAD="$(git_as_user rev-parse HEAD)"
REMOTE_HEAD="$(git_as_user rev-parse --verify --quiet "${TARGET_REF}^{commit}" 2>/dev/null || true)"
[ -n "$REMOTE_HEAD" ] || {
  warn "${TARGET_REF} topilmadi — repo holatini qo'lda tekshiring"
  exit 0
}

if [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ]; then
  [ "$VERBOSE" = "1" ] && log "o'zgarish yo'q — $(printf '%.7s' "$LOCAL_HEAD") allaqachon o'rnatilgan"
  exit 0
fi

# `rev-list --count` shallow nusxalarda ham ishlaydi: `merge-base` dan farqli
# o'laroq u kesilgan tarixga tayanmaydi.
NEW_COUNT="$(git_as_user rev-list --count "HEAD..${TARGET_REF}" 2>/dev/null || true)"
if [ -n "$NEW_COUNT" ] && [ "$NEW_COUNT" = "0" ]; then
  # Upstream'da yangi commit yo'q, demak serverdagi nusxa undan oldinda
  # (kimdir serverda commit qilgan) — avtomatik deploy to'g'ri bo'lmaydi.
  warn "serverdagi nusxa upstream'dan oldinda — qo'lda tekshiring:
    sudo -u ${SERVICE_USER} git -C ${APP_DIR} log --oneline -3 ${TARGET_REF}..HEAD"
  exit 0
fi

log "${NEW_COUNT:-?} ta yangi commit topildi (${TARGET_REF}: $(printf '%.7s' "$LOCAL_HEAD") → $(printf '%.7s' "$REMOTE_HEAD")):"
git_as_user --no-pager log --oneline --no-decorate "HEAD..${TARGET_REF}" | head -20 || true

if [ "$CHECK_ONLY" = "1" ]; then
  log "--check: faqat tekshirildi, deploy qilinmadi"
  exit 0
fi

# ------------------------------- deploy -----------------------------------

log "to'liq deploy boshlandi (pull → bun install → build → nginx → restart)"
# Manzil argument bilan emas, muhit o'zgaruvchisi bilan beriladi: tokenli
# manzil (https://user:token@...) `ps` chiqishida ko'rinib qolmasin.
if ! REMOTE_URL="$REMOTE_URL_VALUE" bash "$DEPLOY_SCRIPT"; then
  warn "deploy bajarilmadi — bot eski versiyada qoldi
    xatoni ko'rish uchun: journalctl -u daftar-autodeploy -n 80"
  exit 1
fi

log "tayyor: $(git_as_user rev-parse --short HEAD)"
