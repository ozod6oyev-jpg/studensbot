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
git clone https://github.com/ozod6oyev-jpg/studensbot.git daftar-bot
cd daftar-bot
```

> Repozitoriy **ochiq (public)** — serverda GitHub logini yoki token so'ralmaydi.

**B) Kompyuteringizdan `rsync` bilan:**

```bash
# o'z kompyuteringizda, loyiha papkasida
rsync -av --exclude node_modules --exclude .env ./ sizning_foydalanuvchi@SERVER_IP:~/daftar-bot/
```

> ⚠️ `.env` faylini serverga ko'chirmang — token serverni o'zida alohida
> saqlanadi (4-bosqichga qarang).

> ℹ️ Bu papka — **manba**, ya'ni kod nusxasi. `deploy.sh` esa loyihani
> `/opt/daftar-bot` ga **o'rnatadi**, va u yerda `.git` bo'lmaydi (nusxa
> `rsync` bilan ko'chiriladi). Shuning uchun serverdagi
> `/opt/daftar-bot` ichida `git pull` yozish xato beradi — kodni doim shu
> manba papkada yangilang (quyidagi "Yangilash" bo'limi).

## 3. O'rnatish

Loyiha papkasida (ichida `deploy/` bor joyda):

```bash
sudo bash deploy/deploy.sh
```

Git orqali yuklamoqchi bo'lsangiz, manzilni ham bering — skript o'zi klonlaydi:

```bash
sudo bash deploy/deploy.sh https://github.com/ozod6oyev-jpg/studensbot.git
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
  jami 24/72/96/192 bet), keyin bot daftar nomini so'raydi — matn yuborsangiz shu nom, `⏭ Nomsiz
  qoldirish` bosilsa standart nom (`1-daftar`, keyingisi `2-daftar`) qo'yiladi;
- `✍️ Matn kiritish` → daftarlar ro'yxati chiqadi; daftar hali bo'lmasa, avval yangi daftar
  yaratish kerakligi aytiladi;
- `📚 Daftarlar` ichida `📖 <nom> • 5/24` tugmasi bosilsa daftar kartasi ochiladi:
  `✍️ Shu daftarga yozish`, `⬇️ PDF yuklab olish`, `🛠 Tahrirlash`, `✏️ Nomini o'zgartirish`,
  `⬅️ Daftarlar`;
- `✍️ Shu daftarga yozish` avval qayerga yozilganini (oxirgi bet va qator) hamda betdagi bo'sh
  qatorlarni aytadi; `▶️ Davom etish`, `➕ Yangi betdan` yoki `🔢 Qatorni tanlash` bilan joy
  tanlanadi, keyin nechta qator tashlab ketish so'raladi (`⏭ 0`, `⏭ 1`, `⏭ 2`, …) va matn aynan
  shu qatordan boshlab yoziladi;
- `🛠 Tahrirlash` → `✂️ Yozuvni o'chirish`: yozilgan betlar slayd qilinadi, bet → qator → so'z
  tanlanadi (boshlanish va tugash joyi), tasdiqlangach o'sha oraliqdagi so'zlar o'chiriladi va
  tahrirlangan betlar qayta yuboriladi;
- har bir yozuv va o'chirish `↩️ Yozuvni orqaga qaytarish` / `↩️ Oxirgi amalni qaytarish` bilan
  bekor qilinadi;
- `⬇️ PDF yuklab olish` daftarning yozilgan betlarini A4 ko'p betli PDF kitob qilib yuboradi
  (fayl nomi `<daftar nomi>.pdf`); juda katta daftarda PDF bir necha qismga bo'linadi
  (`-1-qism`, `-2-qism`, …). Natija har doim **hujjat** sifatida keladi;
- yuborilgan matn ochiq daftarga varaqma-varaq yoziladi va har bir tomon rasm bo'lib qaytadi:
  old tomonida chegara chapda, orqa tomonida o'ngda (xuddi haqiqiy daftar kabi);
- `⚙️ Sozlamalar` ichida alohida ochiladi: `🖋 Siyoh rangi` (10 ta rang), `📄 Qog'oz turi`
  (Yo'l-yo'l / Katak / Toza (A4)), `✍️ Yozuv uslubi` (39 shrift — ro'yxat rasm ko'rinishida,
  chunki Telegram shriftlarni ko'rsata olmaydi), `📐 Yozuv sozlamalari`, `📚 Daftarlar`,
  `🖋 Uslubimni nusxalash`;
- `🖋 Uslubimni nusxalash` (`/style`, `/uslub`) → 10 ta so'z va (ixtiyoriy) 10 ta raqam namunasi
  suratga olinadi, bot ularni o'lchab eng yaqin qo'lyozma shriftni tanlaydi va sizning
  qiyaligingiz, shtrix qalinligi, harflar kengligi bilan shaxsiy uslub yasaydi; uslub nomlanadi
  va faqat shu chat uchun saqlanadi (bir chatda ko'pi bilan 5 ta uslub).

Ma'lumotlar `BOT_DATA_DIR` papkasida (xizmatda `/var/lib/daftar-bot`) saqlanadi:
`settings.json` — chat sozlamalari, `notebooks.json` — daftarlar, `styles.json` — shaxsiy
uslublar. 🎉

---

## Xizmatni boshqarish

```bash
sudo systemctl restart daftar-bot    # qayta ishga tushirish
sudo systemctl stop daftar-bot       # to'xtatish
sudo systemctl start daftar-bot      # ishga tushirish
sudo systemctl disable daftar-bot    # avtomatik ishga tushishni o'chirish
```

## Yangilash (yangi versiya)

Kodni **manba papkada** yangilab, keyin o'rnatish skriptini ishga tushiring:

```bash
cd ~/daftar-bot                     # kodning manba nusxasi (klon)
git pull
sudo bash deploy/deploy.sh          # /opt/daftar-bot ni yangilaydi va xizmatni qayta ishga tushiradi
```

Manba nusxa yo'q bo'lsa (kod bir marta yuklab olingan bo'lsa), git manzilini
o'zingiz bering — skript `/opt/daftar-bot` ni klon qiladi va endi u yerda ham
`git pull` ishlaydi:

```bash
cd /root
git clone https://github.com/ozod6oyev-jpg/studensbot.git daftar-src
cd daftar-src
sudo bash deploy/deploy.sh https://github.com/ozod6oyev-jpg/studensbot.git
```

Manba nusxa umuman bo'lmasa (masalan faqat `/opt/daftar-bot` bor va uni siz
bir marta `rsync` bilan ko'chirgansiz), skriptni **o'sha papkaning o'zidan**
repozitoriy manzili bilan ishga tushirish kifoya — skript o'zini xavfsiz
nusxaga olib o'tadi, kodni klon qiladi va mavjud `.env` (ya'ni bot tokeni)
joyida qoldiriladi:

```bash
sudo bash /opt/daftar-bot/deploy/deploy.sh https://github.com/ozod6oyev-jpg/studensbot.git
```

> Manzil berilmasa skript to'xtaydi: `Manba va maqsad papka bir xil
> (/opt/daftar-bot)`. Bu xato emas — `deploy.sh` `/opt/daftar-bot` dan
> o'zini-o'zi yangilay olmaydi, shuning uchun manzil yoki boshqa manba papka
> kerak.

> `/opt/daftar-bot` — o'rnatilgan nusxa: `git pull` ni **o'sha papkada** yozish
> faqat yuqoridagi klon bajarilgan bo'lsa ishlaydi. Klon qilinmagan bo'lsa
> `fatal: not a git repository` xatosi chiqadi — bu normal holat, kod manba
> papkada yangilanadi.

`deploy.sh` loyihani yangilab, bog'liqliklarni o'rnatadi va xizmatni qayta
ishga tushiradi. `.env` va `/var/lib/daftar-bot` (chat sozlamalari va daftarlar:
`settings.json`, `notebooks.json`) **hech qachon** o'chirilmaydi — papka klon
bilan almashtirilganda ham token saqlab qolinadi.

> Agar `/opt/daftar-bot` ichida saqlanmagan o'zgarishlar bo'lsa (serverda
> qo'lda tahrirlangan yoki qo'lda yaratilgan fayllar), `git pull` to'xtaydi.
> Skript bunday paytda o'sha fayllarni `/var/lib/daftar-bot/deploy-backup-<sana>/`
> ga saqlab qo'yadi (`changes.patch` va `untracked/`) va yangilanishni baribir
> o'rnatadi — hech narsa jimgina yo'qolmaydi.

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
| `Manba va maqsad papka bir xil (/opt/daftar-bot)` | Skript `/opt/daftar-bot` ichidan **manzilsiz** ishga tushirilgan — repozitoriy manzilini qo'shib qayta ishga tushiring: `sudo bash /opt/daftar-bot/deploy/deploy.sh https://github.com/ozod6oyev-jpg/studensbot.git` |
| `git pull` to'xtaydi: `Your local changes would be overwritten` yoki `untracked working tree files would be overwritten` | O'rnatilgan nusxada saqlanmagan o'zgarish bor (masalan `bun install` `bun.lock` ni yangilagan) yoki kelayotgan versiya papkada allaqachon mavjud kuzatilmaydigan fayl qo'shmoqchi. `deploy.sh` hech narsani jimgina o'chirmaydi: `/var/lib/daftar-bot/deploy-backup-<sana>/` ichiga `changes.patch` (kuzatilgan fayllardagi o'zgarishlar) va `untracked/` (to'sqinlik qilgan fayllar) saqlanadi, so'ng yangilanish davom etadi. Patch'ni qaytarish: `sudo -u daftar git -C /opt/daftar-bot apply /var/lib/daftar-bot/deploy-backup-<sana>/changes.patch` |
| `fatal: not a git repository` (`/opt/daftar-bot` ichida `git pull`) | Bu o'rnatilgan nusxa, manba emas — kodni manba papkada yangilang (`cd ~/daftar-bot && git pull`), keyin `sudo bash deploy/deploy.sh` |
| `can't cd to /opt/daftar-bot` | `chown -R daftar:daftar /opt/daftar-bot` |
| Sozlamalar yoki daftarlar saqlanmayapti | `/var/lib/daftar-bot` papkasi `daftar` foydalanuvchisiga tegishli bo'lishi kerak (`settings.json`, `notebooks.json`, `styles.json`) |
| Rasm chiqmayapti | Matn yuborilganini va ochiq daftar borligini tekshiring: matn faqat tanlangan daftarga yoziladi, daftar bo'lmasa bot yangisini yaratishni aytadi |
| Webhook ishlamayapti | Domen HTTPS bo'lishi va `/telegram/webhook` yo'li proxy qilingan bo'lishi shart |

## Xavfsizlik

- Token va boshqa kalitlar faqat `/opt/daftar-bot/.env` faylida (huquq `600`) saqlanadi — repozitoriyga hech qachon qo'shilmaydi.
- `.env` o'zgargandan keyin xizmatni qayta ishga tushirish shart: `sudo systemctl restart daftar-bot`.
- Token oshkor bo'lsa, `@BotFather` da `/revoke` qilib yangisini oling.
- Xizmat `sudo` huquqisiz, alohida `daftar` foydalanuvchisi nomidan ishlaydi.
