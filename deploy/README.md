# Daftar Bot'ni serverga joylash 🚀

Bu papkadagi fayllar botni **doimiy ishlaydigan** xizmat sifatida o'z Linux
serveringizda (Ubuntu/Debian, systemd) ishga tushirish uchun.

| Fayl | Vazifasi |
| --- | --- |
| `deploy.sh` | Serverni tayyorlaydi: Bun, kerakli paketlar, `daftar` foydalanuvchisi, loyiha fayllari, systemd xizmati |
| `daftar-bot.service` | systemd unit fayli (`deploy.sh` uni `/etc/systemd/system/` ga nusxalaydi) |
| `README.md` | Shu qo'llanma |

Kerak bo'ladi: Ubuntu 22.04+ (yoki Debian 12+), root (yoki `sudo`) huquqi va
Telegram bot tokeni (`@BotFather` → `/newbot`).

---

## 1. Serverga kirish

```bash
ssh sizning_foydalanuvchi@SERVER_IP
```

## 2. Loyihani serverga olib kelish

**A) Git orqali (tavsiya etiladi):**

```bash
git clone https://github.com/sizning_login/daftar-bot.git
cd daftar-bot
```

**B) Kompyuteringizdan `rsync` bilan:**

```bash
# o'z kompyuteringizda, loyiha papkasida
rsync -av --exclude node_modules --exclude .env ./ sizning_foydalanuvchi@SERVER_IP:~/daftar-bot/
```

> ⚠️ `.env` faylini serverga ko'chirmang — token serverni o'zida alohida
> saqlanadi (11-bosqichga qarang).

## 3. O'rnatish

Loyiha papkasida (ichida `deploy/` bor joyda):

```bash
sudo bash deploy/deploy.sh
```

Git orqali yuklamoqchi bo'lsangiz, manzilni ham bering — skript o'zi klonlaydi:

```bash
sudo bash deploy/deploy.sh https://github.com/sizning_login/daftar-bot.git
```

Skript nima qiladi:

1. `curl`, `git`, `ca-certificates`, `rsync` yo'q bo'lsa o'rnatadi;
2. Bun bo'lmasa rasmiy skript bilan o'rnatadi va `/usr/local/bin/bun` ga bog'laydi;
3. `daftar` nomli tizim foydalanuvchisini va `/var/lib/daftar-bot` papkasini yaratadi;
4. loyihani `/opt/daftar-bot` ga joylaydi (qayta ishga tushirilsa — `git pull` qiladi);
5. `bun install` bajaradi;
6. `.env` fayli bo'lmasa namuna yaratadi (`chmod 600`); mavjudini **hech qachon** o'zgartirmaydi;
7. systemd xizmatini o'rnatadi, yoqadi va ishga tushiradi.

Skriptni bir necha marta ishga tushirish xavfsiz.

## 4. Tokenni kiritish

```bash
sudo nano /opt/daftar-bot/.env
```

`TELEGRAM_BOT_TOKEN=` qatoriga `@BotFather` bergan tokenni yozing, saqlang
(`Ctrl+O`, `Enter`, `Ctrl+X`) va xizmatni qayta ishga tushiring:

```bash
sudo systemctl restart daftar-bot
```

Faylni qo'lda tahrirlashni istamasangiz, tokenni fayldan o'qib o'rnatish ham mumkin
(skript qiymatni logga ham, jarayon argumentlariga ham chiqarmaydi):

```bash
sudo bash deploy/deploy.sh --token-file=/root/token.txt
rm /root/token.txt    # ishlatib bo'lgach o'chiring
```

## 5. Holatni tekshirish

```bash
systemctl status daftar-bot          # xizmat ishlayaptimi
journalctl -u daftar-bot -f          # loglarni jonli kuzatish
sudo -u daftar /usr/local/bin/bun run /opt/daftar-bot/bot/index.ts info
```

`info` buyrug'i bot nomini, username'ini va webhook holatini ko'rsatadi.

## 6. Botdan foydalanish (qisqacha)

Bot pastdagi **doimiy menyu** bilan ishlaydi (tugmalar chat ichida emas):

```text
✍️ Matn kiritish   ⚙️ Sozlamalar
```

- `➕ Yangi daftar` → varaq soni tanlanadi: 12 / 36 / 48 / 96 (har varaqning ikki tomoni bor —
  jami 24/72/96/192 bet);
- `✍️ Matn kiritish` → daftarlar ro'yxati chiqadi; daftar hali bo'lmasa, avval yangi daftar
  yaratish kerakligi aytiladi;
- yuborilgan matn ochiq daftarga varaqma-varaq yoziladi va har bir tomon rasm bo'lib qaytadi:
  old tomonida chegara chapda, orqa tomonida o'ngda (xuddi haqiqiy daftar kabi);
- `⚙️ Sozlamalar` ichida alohida ochiladi: `🖋 Siyoh rangi` (10 ta rang), `📄 Qog'oz turi`
  (Yo'l-yo'l / Katak / Toza (A4)), `✍️ Yozuv uslubi` (39 shrift — ro'yxat rasm ko'rinishida,
  chunki Telegram shriftlarni ko'rsata olmaydi), `📐 Yozuv sozlamalari`, `📚 Daftarlar`.

Ma'lumotlar `BOT_DATA_DIR` papkasida (xizmatda `/var/lib/daftar-bot`) saqlanadi:
`settings.json` — chat sozlamalari, `notebooks.json` — daftarlar. 🎉

---

## Xizmatni boshqarish

```bash
sudo systemctl restart daftar-bot    # qayta ishga tushirish
sudo systemctl stop daftar-bot       # to'xtatish
sudo systemctl start daftar-bot      # ishga tushirish
sudo systemctl disable daftar-bot    # avtomatik ishga tushishni o'chirish
```

## Yangilash (yangi versiya)

```bash
cd ~/daftar-bot && git pull          # yoki: sudo bash deploy/deploy.sh https://github.com/...
sudo bash deploy/deploy.sh           # git manzili bilan chaqirilgan bo'lsa: shu buyruq ham yetadi
```

`deploy.sh` loyihani yangilab, bog'liqliklarni o'rnatadi va xizmatni qayta
ishga tushiradi. `.env` va `/var/lib/daftar-bot` (chat sozlamalari va daftarlar:
`settings.json`, `notebooks.json`) saqlanib qoladi.

## Webhook rejimiga o'tish (ixtiyoriy)

Polling rejimi hosting talab qilmaydi va ko'p hollarda yetarli. Webhook
javobni tezroq beradi, lekin **ochiq HTTPS domen** kerak.

1. Domenni serverga yo'naltiring, keyin Nginx:

```nginx
# /etc/nginx/sites-available/daftar-bot
server {
    listen 80;
    server_name bot.sizning-domen.uz;

    location /telegram/webhook {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

2. Sertifikat oling:

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo ln -s /etc/nginx/sites-available/daftar-bot /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d bot.sizning-domen.uz
```

3. Xizmatni webhook rejimida ishga tushiring:

```bash
sudo systemctl edit daftar-bot
```

Ochilgan faylga quyidagini yozing (bo'sh qatorlarni saqlang):

```ini
[Service]
ExecStart=
ExecStart=/usr/local/bin/bun run /opt/daftar-bot/bot/index.ts webhook https://bot.sizning-domen.uz
```

```bash
sudo systemctl restart daftar-bot
```

4. Tekshirish va pollingga qaytish:

```bash
sudo -u daftar /usr/local/bin/bun run /opt/daftar-bot/bot/index.ts info
sudo -u daftar /usr/local/bin/bun run /opt/daftar-bot/bot/index.ts delete-webhook
```

> Polling va webhook bir vaqtda ishlamaydi — bittasini tanlang, aks holda
> Telegram `409 Conflict` qaytaradi.

## Studioni (veb sahifani) joylash (ixtiyoriy)

Studio — oddiy statik sayt, backend kerak emas:

```bash
sudo apt-get install -y nginx
cd /opt/daftar-bot
sudo -u daftar /usr/local/bin/bun run build     # dist/ papkasi hosil bo'ladi
```

Nginx orqali ko'rsatish (`/etc/nginx/sites-available/daftar-studio`):

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root /opt/daftar-bot/dist;
    index index.html;

    location / { try_files $uri $uri/ /index.html; }

    location ~* \.(ttf|woff2?|js|css|png|svg)$ {
        expires 30d;
        access_log off;
    }
}
```

Yoqish:

```bash
sudo ln -sf /etc/nginx/sites-available/daftar-studio /etc/nginx/sites-enabled/daftar-studio
sudo rm -f /etc/nginx/sites-enabled/default     # 80-portda ikkita default_server bo'lmasin
sudo nginx -t && sudo systemctl enable --now nginx && sudo systemctl reload nginx
```

Endi sahifa `http://SERVER_IP/` da ochiladi. Domen va HTTPS (certbot) uchun `server_name`
qatorini domeningizga o'zgartiring.

> Yangi versiyadan keyin `dist/` ni qayta yig'ishni unutmang: `sudo -u daftar /usr/local/bin/bun run build`.

## Muammolar

| Alomat | Yechim |
| --- | --- |
| `401 Unauthorized` | Token xato yoki bekor qilingan — `@BotFather` dan yangisini olib `.env` ga yozing va xizmatni qayta ishga tushiring |
| `409 Conflict` | Polling va webhook birga ishlayapti — bittasini to'xtating (`delete-webhook`) |
| Xizmat ishga tushmayapti | `journalctl -u daftar-bot -n 50` — ko'pincha `.env` da token yo'q yoki Bun yo'li xato |
| `can't cd to /opt/daftar-bot` | `chown -R daftar:daftar /opt/daftar-bot` |
| Sozlamalar yoki daftarlar saqlanmayapti | `/var/lib/daftar-bot` papkasi `daftar` foydalanuvchisiga tegishli bo'lishi kerak (`settings.json`, `notebooks.json`) |
| Rasm chiqmayapti | Matn yuborilganini va ochiq daftar borligini tekshiring: matn faqat tanlangan daftarga yoziladi, daftar bo'lmasa bot yangisini yaratishni aytadi |
| Webhook ishlamayapti | Domen HTTPS bo'lishi va `/telegram/webhook` yo'li proxy qilingan bo'lishi shart |

## Xavfsizlik

- Token va boshqa kalitlar faqat `/opt/daftar-bot/.env` faylida (huquq `600`) saqlanadi — repozitoriyga hech qachon qo'shilmaydi.
- `.env` o'zgargandan keyin xizmatni qayta ishga tushirish shart: `sudo systemctl restart daftar-bot`.
- Token oshkor bo'lsa, `@BotFather` da `/revoke` qilib yangisini oling.
- Xizmat `sudo` huquqisiz, alohida `daftar` foydalanuvchisi nomidan ishlaydi.
