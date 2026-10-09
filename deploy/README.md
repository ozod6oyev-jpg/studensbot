# Daftar Bot'ni serverga joylash 🚀

Bu papkadagi fayllar botni **doimiy ishlaydigan** xizmat sifatida o'z Linux
serveringizda (Ubuntu/Debian, systemd) ishga tushirish uchun.

| Fayl | Vazifasi |
| --- | --- |
| `deploy.sh` | Serverni tayyorlaydi va to'liq yangilashni bajaradi: Bun, kerakli paketlar, `daftar` foydalanuvchisi, loyiha fayllari, sayt (`dist/`), systemd xizmati, avtomatik yangilash taymeri |
| `daftar-bot.service` | systemd unit fayli (`deploy.sh` uni `/etc/systemd/system/` ga nusxalaydi) |
| `autodeploy.sh` | Git'dagi yangi commit'ni sezib, to'liq yangilashni bajaradigan skript (uni taymer chaqiradi) |
| `daftar-autodeploy.service` | O'sha skriptni ishga tushiradigan systemd birligi (`deploy.sh` o'rnatadi) |
| `daftar-autodeploy.timer` | Uni har 2 daqiqada ishga tushiradigan taymer |
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
> `/opt/daftar-bot` ga **o'rnatadi**, va `rsync` bilan o'rnatilgan nusxada `.git`
> bo'lmaydi. Shuning uchun serverdagi
> `/opt/daftar-bot` ichida `git pull` yozish xato beradi — kodni doim shu
> manba papkada yangilang (quyidagi "Yangilash" bo'limi).
>
> ℹ️ **Avtomatik yangilash** uchun `/opt/daftar-bot` da `.git` bo'lishi kerak, ya'ni kod
> `git clone` bilan o'rnatilgan bo'lsin (quyidagi "Avtomatik yangilash" bo'limi).

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
6. saytni yig'adi (`bun run build` → `dist/`), shunda nginx yangi sahifani ko'rsatadi;
7. `.env` fayli bo'lmasa namuna yaratadi (`chmod 600`); mavjudini **hech qachon** o'zgartirmaydi;
8. systemd xizmatini o'rnatadi, yoqadi va ishga tushiradi;
9. nginx faol bo'lsa uni qayta o'qitadi;
10. **avtomatik yangilash taymerini** o'rnatadi va yoqadi (quyidagi "Avtomatik yangilash" bo'limi).

Skriptni bir necha marta ishga tushirish xavfsiz: har bir ishga tushirish to'liq yangilashni
bajaradi — `git pull` → `bun install` → saytni yig'ish → xizmatni qayta ishga tushirish →
`nginx`. Taymer kerak bo'lmasa, `sudo bash deploy/deploy.sh --no-autodeploy` bilan uni
umuman o'rnatmasa ham bo'ladi.

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
ℹ️ Yordam          🆔 Chat ID
```

`ℹ️ Yordam` qisqa qo'llanmani ochadi (buyruqlar ro'yxatini ko'rsatmaydi — hammasi tugmalarda),
`🆔 Chat ID` esa chat raqamini aytadi; noma'lum buyruq yozilsa bot faqat qisqa maslahat qaytaradi.

`MINI_APP_URL` sozlangan bo'lsa, shu menyuga yana `🖥 Studio (Mini App)` tugmasi
qo'shiladi (quyidagi "Telegram Mini App" bo'limiga qarang).

- `➕ Yangi daftar` → varaq soni tanlanadi: 12 / 36 / 48 / 96 (har varaqning ikki tomoni bor —
  jami 24/72/96/192 bet), keyin qog'oz turi: `📏 Yo'l-yo'l daftar` / `🔲 Katak daftar` /
  `📄 Oq qog'oz` — tanlov daftarda saqlanadi, shuning uchun shu daftarning betlari va PDF kitobi
  o'sha qog'ozda chiziladi (bir chatda turli qog'ozli daftarlar bo'lishi mumkin); so'ng bot daftar
  nomini so'raydi — matn yuborsangiz shu nom, `⏭ Nomsiz qoldirish` bosilsa standart nom
  (`1-daftar`, keyingisi `2-daftar`) qo'yiladi;
- `✍️ Matn kiritish` → daftarlar ro'yxati chiqadi; daftar hali bo'lmasa, avval yangi daftar
  yaratish kerakligi aytiladi;
- `📚 Daftarlar` ichida `📖 <nom> • 5/24` tugmasi bosilsa daftar kartasi ochiladi:
  `✍️ Shu daftarga yozish`, `⬇️ PDF yuklab olish`, `🛠 Tahrirlash`, `✏️ Nomini o'zgartirish`,
  `⬅️ Daftarlar`;
- `✍️ Shu daftarga yozish` avval qayerga yozilganini (oxirgi bet va qator) hamda betdagi bo'sh
  qatorlarni aytadi; `▶️ Davom etish`, `➕ Yangi betdan` yoki `🔢 Qatorni tanlash` bilan joy
  tanlanadi, keyin nechta qator tashlab ketish so'raladi (`⬇️ Yozuvning tagidan` — 0 qator,
  `⏭ 1`, `⏭ 2`, …) va matn aynan shu qatordan boshlab yoziladi;
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

> Oddiy holatda bu bo'lim kerak emas: serverda **avtomatik yangilash** o'rnatilgan va u yangi
> commit'ni o'zi oladi (keyingi bo'lim). Qo'lda yangilash birinchi marta o'rnatishda, taymer
> o'chirilgan bo'lsa yoki jurnalda xato ko'ringanda ishlatiladi.

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

## Avtomatik yangilash (git → deploy → build → restart)

**Serverda qo'lda hech narsa ishga tushirish shart emas.** `deploy.sh` bilan birga
`daftar-autodeploy.timer` o'rnatiladi: u har **2 daqiqada** `origin` da yangi commit bor-yo'qligini
tekshiradi va bor bo'lsa **to'liq yangilashni** o'zi bajaradi:

```text
git pull  →  bun install  →  bun run build (dist/)  →  systemctl restart daftar-bot  →  nginx reload
```

Ya'ni repozitoriyga push qilingan har bir o'zgarish ~2 daqiqa ichida serverga o'rnatiladi.
O'zgarish bo'lmasa skript hech narsa qilmaydi — na build, na restart.

> **Bir marta bajariladigan qadam (eski serverlar uchun):** taymer paydo bo'lishi uchun
> o'zgarishni **bir marta qo'lda** olish kerak:
>
> ```bash
> cd ~/daftar-bot && git pull && sudo bash deploy/deploy.sh
> ```
>
> Shundan keyin bu buyruq kerak emas — keyingi yangilanishlar o'zi o'rnatiladi.

| Buyruq | Nima qiladi |
| --- | --- |
| `systemctl list-timers daftar-autodeploy.timer` | taymer qachon ishga tushishini ko'rsatadi |
| `journalctl -u daftar-autodeploy -n 50` | yangilashlar jurnali (nima o'rnatildi, xato bo'ldimi) |
| `sudo bash /opt/daftar-bot/deploy/autodeploy.sh --check` | hozir yangilanish bor-yo'qligini aytadi (hech narsa o'rnatmaydi) |
| `sudo bash /opt/daftar-bot/deploy/autodeploy.sh` | bo'lsa hoziroq o'rnatadi (taymerni kutmasdan) |
| `sudo systemctl start daftar-autodeploy` | xuddi shu narsa: yangilashni darhol boshlaydi |
| `sudo systemctl disable --now daftar-autodeploy.timer` | avtomatik yangilashni o'chiradi |

Skriptning ehtiyot choralari:

- **bir vaqtda ikki nusxa ishlamaydi** (`flock`) — taymer va qo'lda urinish to'qnashmaydi;
- `git fetch` yiqilsa (internet yoki token) faqat ogohlantirish yoziladi va skript 0 bilan
  chiqadi: keyingi tekshiruvda yana urinib ko'riladi;
- serverdagi nusxa upstream'dan **oldinda** bo'lsa (kimdir serverda commit qilgan) hech narsa
  qilinmaydi — sabab jurnalga yoziladi;
- deploy haqiqatan yiqilsa skript xato kodi bilan tugaydi: `systemctl --failed` da ko'rinadi,
  batafsil sabab `journalctl -u daftar-autodeploy -n 80` da;
- `.env` (token) va `/var/lib/daftar-bot` (sozlamalar, daftarlar) hech qachon o'chirilmaydi;
- `/opt/daftar-bot` da `.git` bo'lmasa (nusxa `rsync` bilan ko'chirilgan bo'lsa) taymer ishga
  tushmaydi (`ConditionPathIsDirectory`) — bunday holda kod `git clone` bilan o'rnatilishi kerak;
- tekshirish oralig'ini o'zgartirish: `daftar-autodeploy.timer` dagi `OnUnitActiveSec` (standart
  `2min`), so'ng `sudo systemctl daemon-reload && sudo systemctl restart daftar-autodeploy.timer`.

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

> Yangi versiyadan keyin `dist/` ni qo'lda qayta yig'ish shart emas: `deploy.sh` hamda avtomatik
yangilash taymeri uni har yangilashda o'zi qayta yig'adi. Qo'lda kerak bo'lsa:
`cd /opt/daftar-bot && sudo -u daftar /usr/local/bin/bun run build`.

## Telegram Mini App (Studio'ni chat ichida ochish)

Studio sahifasini Telegram ichida **Mini App** sifatida ochish mumkin: bot menyusidagi
tugma bosilsa sahifa Telegram oynasida ochiladi, matn va sozlamalar `initData` bilan
botga yuboriladi, bot esa natijani o'sha chatga rasm qilib qaytaradi.

Talablar:

- **domen va HTTPS** — Telegram faqat `https://` manzilni qabul qiladi, ya'ni sertifikat
  (certbot) shart. Faqat IP manzilli serverda Mini App umuman ochilmaydi; polling rejimi
  va brauzerdagi Studio esa avvalgidek ishlayveradi;
- bot jarayoni (`daftar-bot` xizmati) **ishlab turishi** kerak — Mini App endpointini
  o'sha ochadi.

Mini App sozlanganda bot `setChatMenuButton` bilan Telegram'ning **menyu tugmasini**
(matn yoziladigan qator yonidagi tugma) Studio'ga bog'laydi va pastdagi menyuga
`🖥 Studio (Mini App)` tugmasini qo'shadi; `/studio` buyrug'i ham shu sahifani ochadigan
tugma yuboradi. Webhook rejimi bunga shart emas: Mini App endpointi long polling
rejimida ham `PORT` (standart `8080`) portida ko'tariladi.

### 1. Domen, sayt va HTTPS (bitta domen yetadi)

Domenni serverga yo'naltiring, so'ng saytni yig'ing:

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
cd /opt/daftar-bot
sudo -u daftar /usr/local/bin/bun run build     # dist/ papkasi hosil bo'ladi
```

Nginx bir vaqtning o'zida ham saytni, ham botning Mini App endpointini ko'rsatadi
(`/etc/nginx/sites-available/daftar`):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name domen.uz;

    root /opt/daftar-bot/dist;
    index index.html;

    # Studio sahifasi (Mini App ham shu yerdan ochiladi)
    location / { try_files $uri $uri/ /index.html; }

    # Mini App: natijani chatga qaytaradigan bot endpointi
    location /mini-app/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Faqat webhook rejimida ishlatilsa kerak bo'ladi
    location /telegram/webhook {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location ~* \.(ttf|woff2?|js|css|png|svg)$ {
        expires 30d;
        access_log off;
    }
}
```

`domen.uz` o'rniga o'z domeningizni yozing, keyin:

```bash
sudo ln -sf /etc/nginx/sites-available/daftar /etc/nginx/sites-enabled/daftar
sudo rm -f /etc/nginx/sites-enabled/default   # 80-portda ikkita default_server bo'lmasin
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d domen.uz              # HTTPS sertifikati (Mini App uchun shart)
```

### 2. Botga Mini App manzilini berish

```bash
sudo nano /opt/daftar-bot/.env
```

Qatorni qo'shing (manzil `https://` bo'lishi shart):

```ini
MINI_APP_URL=https://domen.uz/studio
```

```bash
sudo systemctl restart daftar-bot
```

Shundan keyin bot:

- `PORT` (standart `8080`) portida Mini App serverini ochadi — `POST /mini-app/send`,
  `POST /mini-app/state` va `POST /mini-app/notebook` so'rovlarini qabul qiladi
  (`GET /healthz` → `ok`);
- Telegram'ning menyu tugmasini Studio'ga bog'laydi va pastdagi menyuga
  `🖥 Studio (Mini App)` tugmasini qo'shadi.

Mini App ichida matn yozishdan oldin **qaysi daftarga** yozilishini tanlaysiz, **qaysi qatordan**
boshlanishini esa daftar varaqasining o'zida (qatorni bosib) belgilaysiz: `POST /mini-app/state`
daftarlar ro'yxatini va tanlangan daftarning joriy beti (nechta qator band, qayerdan davom etadi)
holatini qaytaradi, `POST /mini-app/send` esa `notebookId` va `startLine` ni qabul qiladi.
Daftarni boshqarish (yangi daftar yaratish, nomlash, o'chirish, oxirgi yozuvni orqaga
qaytarish, PDF kitob) `POST /mini-app/notebook` orqali bajariladi — u ham `initData` imzosi
bilan tekshiriladi. Nginx sozlamasi o'zgarmaydi — uchala yo'l ham o'sha `/mini-app/`
proxy'sidan o'tadi.

Tekshirish:

```bash
curl -s http://127.0.0.1:8080/healthz        # ok
journalctl -u daftar-bot -n 30               # Mini App haqidagi xabarlar
sudo -u daftar /usr/local/bin/bun run /opt/daftar-bot/bot/index.ts info
```

Telegram'da botni ochib, menyu tugmasini bosing: Studio oynasi ochiladi, matn yozib
natijani chatga yuborish mumkin. Sahifa `initData` ni (Telegram imzosini) botga
yuboradi, bot uni `TELEGRAM_BOT_TOKEN` bilan tekshiradi — imzo noto'g'ri yoki ma'lumot
24 soatdan eski bo'lsa, so'rov rad etiladi.

> Mini App ochilmayapti yoki natija chatga kelmayapti? Avval `curl -s
> http://127.0.0.1:8080/healthz` ni sinab ko'ring: javob `ok` bo'lmasa xizmat ishlamayapti
> yoki `PORT` boshqa, `ok` bo'lsa — domen/HTTPS yoki nginx sozlamasida muammo bor
> (quyidagi "Muammolar" jadvali).

### 3. Domeningiz bo'lmasa — bepul HTTPS manzil

Mini App uchun domen shart emas, faqat **HTTPS** shart. Ikki ishlaydigan yo'l bor.

**a) `sslip.io` / `nip.io` + certbot (bepul va doimiy).** Bu xizmatlar `<IP>.sslip.io`
ko'rinishidagi nomni o'sha IP manzilga yo'naltiradi, shuning uchun Let's Encrypt sertifikatini
haqiqiy nom uchun olish mumkin. Serveringiz IP'si `95.123.45.67` bo'lsa,
`/etc/nginx/sites-available/daftar` fayli to'liq shunday bo'ladi (yagona farq —
`server_name` qatorida o'z IP'ingiz):

```nginx
# /etc/nginx/sites-available/daftar
server {
    listen 80;
    listen [::]:80;
    server_name 95.123.45.67.sslip.io;

    root /opt/daftar-bot/dist;
    index index.html;

    # Sayt va Studio sahifasi (Mini App ham shu yerdan ochiladi)
    location / { try_files $uri $uri/ /index.html; }

    # Mini App: natijani chatga qaytaradigan bot endpointi (bot `PORT`, standart 8080)
    location /mini-app/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Faqat webhook rejimida kerak bo'ladi
    location /telegram/webhook {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location ~* \.(ttf|woff2?|js|css|png|svg)$ {
        expires 30d;
        access_log off;
    }
}
```

Yoqish va sertifikat olish:

```bash
sudo ln -sf /etc/nginx/sites-available/daftar /etc/nginx/sites-enabled/daftar
sudo rm -f /etc/nginx/sites-enabled/default     # 80-portda ikkita default_server bo'lmasin
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d 95.123.45.67.sslip.io   # bepul HTTPS sertifikati; 443 bloki o'zi qo'shiladi
```

> `dist/` papkasi bo'lmasa sayt ochilmaydi: `cd /opt/daftar-bot && sudo -u daftar
> /usr/local/bin/bun run build`. Studio'ning standart endpointi nisbiy yo'l
> (`/mini-app/send`; holat va daftar amallari ham shu yo'l ostida) — shu nginx bloki bilan
> hech narsa qo'shimcha sozlash kerak emas.

So'ng `.env` faylida manzilni yangilang va xizmatni qayta ishga tushiring:

```ini
MINI_APP_URL=https://95.123.45.67.sslip.io/studio
```

```bash
sudo systemctl restart daftar-bot
```

80 va 443 portlari ochiq, IP esa doimiy (statik) bo'lishi kerak (qanday tekshirish va
xavfsiz ochish — "Portlar va xavfsizlik devori" bo'limi). IP o'zgarsa manzil ham
o'zgaradi — yangisini `MINI_APP_URL` ga yozib, xizmatni qayta ishga tushirish kifoya
(@BotFather'da hech narsa o'zgartirilmaydi).

> Agar `sslip.io` o'rniga `nip.io` ishlatsangiz, nom `95.123.45.67.nip.io` ko'rinishida
> bo'ladi — `server_name` va `certbot -d` da ham o'sha nom yoziladi.

**b) Cloudflare Tunnel (tez, vaqtinchalik manzil).** Serverda `cloudflared` ni o'rnatib, saytni
ochiq nginx orqali tunnelga ulasak, `https://<tasodifiy>.trycloudflare.com` manzili hosil
bo'ladi:

```bash
cloudflared tunnel --url http://127.0.0.1:80   # sayt (nginx) + /mini-app/ proxy
```

```ini
MINI_APP_URL=https://<tasodifiy>.trycloudflare.com/studio
```

Vaqtinchalik manzil har ishga tushirishda o'zgaradi, shuning uchun `MINI_APP_URL` ni ham
yangilab, `daftar-bot` ni qayta ishga tushirish kerak bo'ladi. Doimiy ishlatish uchun
`cloudflared tunnel create` bilan **nomlangan** tunnel va o'z domeningiz kerak.

> **Muhim:** manzil majburiy `https://` bo'lishi kerak. `http://<IP>/studio` yoki
> `http://localhost:5173` bilan Telegram `web_app` tugmasini umuman ochmaydi. Bunday holatda
> Studio'ni faqat oddiy brauzerda ishlatish mumkin (chatga yuborish tugmasi ko'rinmaydi), bot esa
> ishga tushganda `⚠️  MINI_APP_URL HTTPS bo'lishi kerak …` deb ogohlantiradi.

### 4. API boshqa domenda bo'lsa (ixtiyoriy)

Sayt va bot turli domenda tursa, API manzilini yig'ishdan oldin bering:

```bash
cd /opt/daftar-bot
sudo -u daftar env VITE_MINI_APP_ENDPOINT=https://bot.domen.uz/mini-app/send /usr/local/bin/bun run build
```

Bunday holatda botning CORS tekshiruvi `MINI_APP_URL` domeniga ruxsat beradi — ya'ni
`MINI_APP_URL` sayt turgan domen bo'lishi kerak.

## Muammolar

| Alomat | Yechim |
| --- | --- |
| `401 Unauthorized` | Token xato yoki bekor qilingan — `@BotFather` dan yangisini olib `.env` ga yozing va xizmatni qayta ishga tushiring |
| `409 Conflict` | Polling va webhook birga ishlayapti — bittasini to'xtating (`delete-webhook`) |
| Xizmat ishga tushmayapti | `journalctl -u daftar-bot -n 50` — ko'pincha `.env` da token yo'q yoki Bun yo'li xato |
| `Manba va maqsad papka bir xil (/opt/daftar-bot)` | Skript `/opt/daftar-bot` ichidan **manzilsiz** ishga tushirilgan — repozitoriy manzilini qo'shib qayta ishga tushiring: `sudo bash /opt/daftar-bot/deploy/deploy.sh https://github.com/ozod6oyev-jpg/studensbot.git` |
| `git pull` to'xtaydi: `Your local changes would be overwritten` yoki `untracked working tree files would be overwritten` | O'rnatilgan nusxada saqlanmagan o'zgarish bor (masalan `bun install` `bun.lock` ni yangilagan) yoki kelayotgan versiya papkada allaqachon mavjud kuzatilmaydigan fayl qo'shmoqchi. `deploy.sh` hech narsani jimgina o'chirmaydi: `/var/lib/daftar-bot/deploy-backup-<sana>/` ichiga `changes.patch` (kuzatilgan fayllardagi o'zgarishlar) va `untracked/` (to'sqinlik qilgan fayllar) saqlanadi, so'ng yangilanish davom etadi. Patch'ni qaytarish: `sudo -u daftar git -C /opt/daftar-bot apply /var/lib/daftar-bot/deploy-backup-<sana>/changes.patch` |
| `fatal: not a git repository` (`/opt/daftar-bot` ichida `git pull`) | Bu o'rnatilgan nusxa, manba emas — kodni manba papkada yangilang (`cd ~/daftar-bot && git pull`), keyin `sudo bash deploy/deploy.sh` |
| Yangilanish o'zi kelmayapti (push qildim, serverda o'zgarish yo'q) | `systemctl list-timers daftar-autodeploy.timer` (taymer yoqilganmi), `journalctl -u daftar-autodeploy -n 50`, `sudo bash /opt/daftar-bot/deploy/autodeploy.sh --check`. Ko'p uchraydigan sabablar: papkada `.git` yo'q (nusxa `rsync` bilan o'rnatilgan), `git fetch` uchun token/ruxsat yo'q yoki serverdagi nusxa upstream'dan oldinda |
| Push qildim, sayt yangilanmadi | Taymerni kuting (~2 daqiqa) yoki `sudo bash /opt/daftar-bot/deploy/autodeploy.sh`. Sayt `dist/` dan o'qiladi va u har yangilashda qayta yig'iladi; brauzer eski sahifani ko'rsatsa — qattiq yangilang (`Ctrl+Shift+R`) |
| `can't cd to /opt/daftar-bot` | `chown -R daftar:daftar /opt/daftar-bot` |
| Sozlamalar yoki daftarlar saqlanmayapti | `/var/lib/daftar-bot` papkasi `daftar` foydalanuvchisiga tegishli bo'lishi kerak (`settings.json`, `notebooks.json`, `styles.json`) |
| Rasm chiqmayapti | Matn yuborilganini va ochiq daftar borligini tekshiring: matn faqat tanlangan daftarga yoziladi, daftar bo'lmasa bot yangisini yaratishni aytadi |
| Webhook ishlamayapti | Domen HTTPS bo'lishi va `/telegram/webhook` yo'li proxy qilingan bo'lishi shart |
| Mini App tugmasi bosilsa sahifa ochilmayapti ("URL'ni ochib bo'lmadi") | Domen HTTPS emas, `MINI_APP_URL` xato yozilgan yoki nginx'da `/mini-app/` (va sayt `dist/`) proxy qilinmagan. HTTPS sertifikatini tekshiring: `sudo certbot certificates`, so'ng `nginx -t && sudo systemctl reload nginx` |
| Mini App'da "Telegram ma'lumotlari eskirgan" chiqadi | `initData` 24 soatdan eski — Mini App'ni yopib, bot menyusidagi tugma orqali qaytadan oching |
| Mini App'da "Bot serveriga ulanib bo'lmadi" yoki "Yuborilmadi (HTTP 500)" | Bot jarayoni ishlamayapti yoki `PORT`da tinglamayapti: `systemctl status daftar-bot`, `journalctl -u daftar-bot -n 50`, `curl -s http://127.0.0.1:8080/healthz` |
| Serverning o'zida `curl http://127.0.0.1/` ishlaydi, tashqaridan (telefon yoki boshqa kompyuterdan) esa ochilmayapti | Port yopiq: mahalliy firewall (`ufw`) yoki provayder firewall'i 80/443 ga ruxsat bermayapti — quyidagi "Portlar va xavfsizlik devori" bo'limi. Sertifikat olishdan oldin 80 ochiq bo'lishi shart |
| `certbot` "Connection refused" / "Timeout during connect" deb yiqiladi | Let's Encrypt serveringizning 80-portiga kira olmayapti: firewall/provayder qoidasi yoki noto'g'ri `server_name`. `sudo nginx -t`, `sudo ufw status verbose` va provayder panelidagi Inbound qoidalarini tekshiring |

## Portlar va xavfsizlik devori

Mini App uchun tashqaridan faqat **80** (HTTP va sertifikat olish) va **443** (HTTPS) kerak.
Botning `8080` porti tashqariga ochilmaydi — unga faqat nginx `127.0.0.1` orqali murojaat
qiladi.

**1. Portda haqiqatan tinglanayaptimi (serverning o'zida):**

```bash
sudo ss -tlnp | grep -E ':(80|443)\b'   # nginx ko'rinishi kerak
systemctl is-active nginx               # active
curl -sI http://127.0.0.1/ | head -1    # 200/301
```

**2. Mahalliy firewall ruxsat berayaptimi:**

```bash
sudo ufw status verbose                 # 80/tcp va 443/tcp ALLOW bo'lsin
sudo iptables -S | grep -E 'dpt:(80|443)'      # ufw ishlatilmasa
sudo nft list ruleset | grep -E 'dport (80|443)'   # nftables ishlatilsa
```

**3. Tashqaridan haqiqatan ochiqmi:** buni serverning o'zidan aniqlab bo'lmaydi
(ichkaridan kirish har doim ishlaydi). Telefonni Wi-Fi'dan uzib (mobil internet) yoki
boshqa kompyuterdan sinab ko'ring:

```bash
nc -vz <SERVER_IP> 80 && nc -vz <SERVER_IP> 443
curl -sI http://<SERVER_IP>.sslip.io/ | head -1
```

**4. Yopiq bo'lsa — xavfsiz ochish (Debian/Ubuntu, `ufw`):**

```bash
sudo apt-get install -y ufw
sudo ufw allow OpenSSH        # AVVAL SSH — aks holda ulanishni o'zingiz uzib qo'yasiz
sudo ufw allow 'Nginx Full'   # 80 + 443 birga
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw enable               # "Command may disrupt existing ssh connections" — y
sudo ufw status verbose
```

SSH boshqa portda bo'lsa (`sshd_config` dagi `Port`), `OpenSSH` o'rniga o'sha portni
yozing: `sudo ufw allow 2222/tcp`.

**5. Xavfsizlik qoidalari:**

- 80/443 dan boshqasini ochish **shart emas**; `ufw enable` qilgandan keyin kerak
  bo'lmagan portlar avtomatik yopiq qoladi;
- **8080** ni tashqariga ochmang. Bot texnik jihatdan `0.0.0.0:8080` da tinglaydi
  (`ss -tlnp | grep 8080`), lekin unga faqat nginx murojaat qilishi kerak. Ishonch
  bo'lmasa: `sudo ufw deny 8080/tcp`;
- ijtimoiy tarmoq/VPS provayderining **panelidagi firewall** (Hetzner Cloud Firewall,
  DigitalOcean Cloud Firewall, AWS Security Group, Oracle VCN) mahalliy `ufw` dan
  ustun turadi — u yerda ham `Inbound: 22 (faqat o'z IP'ingiz), 80, 443 tcp` ruxsat
  berilgan bo'lishi shart. Ko'p hollarda "port yopiq" muammosining sababi shu;
- `certbot` olgandan keyin 80 ni yopmang: u sertifikatni yangilashda (HTTP-01)
  qayta kerak bo'ladi;
- ishlab bo'lgach tekshiring: `sudo ufw status verbose`, `sudo certbot certificates`,
  `curl -sI https://<SERVER_IP>.sslip.io/studio | head -1`.

## Xavfsizlik

- Token va boshqa kalitlar faqat `/opt/daftar-bot/.env` faylida (huquq `600`) saqlanadi — repozitoriyga hech qachon qo'shilmaydi.
- `.env` o'zgargandan keyin xizmatni qayta ishga tushirish shart: `sudo systemctl restart daftar-bot`.
- Token oshkor bo'lsa, `@BotFather` da `/revoke` qilib yangisini oling.
- Xizmat `sudo` huquqisiz, alohida `daftar` foydalanuvchisi nomidan ishlaydi.
