# Daftar Bot 📓

Matnni **qo'lda yozilgan daftar sahifasi** ko'rinishida rasmga aylantiruvchi Telegram bot + brauzerdagi
Studio. Foydalanuvchi matn yuboradi — bot uni yo'l-yo'l (chiziqli) yoki katak daftarga yozib, rasm qilib
qaytaradi: xuddi o'quvchi daftarga yozgandek. Dvigatel **adabiyot** matnlari uchun ham, **matematika**
formulalari uchun ham ishlaydi.

## Nima qiladi

- 📝 Matnni qatorlarga bo'lib, chegaraga yetganda so'zni keyingi qatorga ko'chiradi.
- 📄 Varaq to'lganda yangi varaq ochadi — har bir varaq alohida rasm bo'ladi.
- 📐 **Yo'l-yo'l** (chiziqli, chegarasi qizil chiziqli) va **katak** (5 mm) daftar varaqalari, shuningdek toza oq varaq.
- 🖋 **39 shriftdan iborat qo'lyozma kutubxonasi**, 6 kategoriyada: erkin qo'lyozma, ozoda yozuv, bosma (pechat) uslub, kitobiy kursiv, mo'yqalam-bo'r va bolalar yozuvi. Shulardan 13 tasi kirillcha matnni ham biladi.
- 🎨 Olti xil siyoh rangi: ko'k, qora, qalam, yashil, qizil, siyohrang.
- ➗ Matematika: daraja (`x^2`), indeks (`a_1`), kasr (`\frac{a}{b}`), ildiz (`\sqrt{x}`), √ ∫ ∑ ≤ ≥ ≠ ∞ π ∠ ⊥ ∥ va yunon harflari.
- 🤖 Telegram bot: `/settings` bilan inline sozlamalar, har bir rasmdan keyin tezkor tugmalar.
- 🌐 Studio: brauzerda jonli ko'rinish, PNG yuklab olish, hech qanday akkaunt kerak emas.

## Tez boshlash

```bash
bun install
```

**Studio (brauzerda jonli ko'rinish):**

```bash
bun run dev          # http://localhost:5173
```

**Telegram bot:**

```bash
bun run bot:poll     # long polling — hosting shart emas
```

Yoki xuddi shu narsa to'g'ridan-to'g'ri:

```bash
bun bot/index.ts poll
```

Webhook rejimida (doimiy server va HTTPS domen kerak):

```bash
bun bot/index.ts webhook https://mening-domenim.example
bun bot/index.ts info              # bot nomi va webhook holati
bun bot/index.ts delete-webhook    # pollingga qaytish uchun
```

## Loyiha tuzilishi

```
├── src/
│   ├── lib/handwriting/        # qo'lyozma render dvigateli (brauzer + Node uchun bir xil)
│   │   ├── types.ts            # umumiy tiplar va DEFAULT_STYLE
│   │   ├── options.ts          # UI uchun tanlovlar (qog'oz, siyoh, shrift, format)
│   │   ├── browser.ts          # brauzerda shrift yuklab, render qilish
│   │   ├── render.ts           # asosiy kirish nuqtasi: renderNotebook()
│   │   ├── layout.ts           # matnni qatorlarga bo'lish va joylash
│   │   ├── math.ts             # kasr, ildiz, daraja, indeks joylashuvi
│   │   ├── symbols.ts          # shriftda yo'q belgilar uchun qalam harakatlari
│   │   ├── paper.ts            # chiziqli/katak/toza varaqa foni
│   │   ├── font.ts             # TTF tahlili (opentype.js) va glif konturlari
│   │   ├── raster.ts           # konturlarni pikselga chizish (antialiasing)
│   │   ├── png.ts              # PNG kodlovchi (sof JavaScript)
│   │   ├── rng.ts              # takrorlanadigan tasodifiy sonlar (wobble uchun)
│   │   └── fonts.generated.ts  # 39 shriftning avtomatik ro'yxati (o'lchamlari bilan)
│   ├── pages/                  # Landing ( / ), Studio ( /studio ), Botni ulash ( /bot )
│   ├── components/             # site-chrome, notebook-preview, font-gallery, ui/* primitivlari
│   ├── hooks/                  # use-notebook-render — debounce bilan render
│   └── assets/fonts/           # 39 qo'lyozma shrifti + licenses/ (OFL matnlari)
├── bot/index.ts                # Telegram bot: polling, webhook, sozlamalar, buyruqlar
│   └── data/                   # ishlash paytida yaratiladi: chat sozlamalari (git'ga tushmaydi)
├── scripts/fetch-fonts.ts      # shriftlar kutubxonasini yangilash (google/fonts dan)
├── scripts/check-render.ts     # dvigatel tekshiruvi: PNG namunalar + matematika geometriyasi
├── scripts/check-bot.ts        # bot tekshiruvi: soxta Telegram server bilan to'liq oqim
├── deploy/                     # serverga o'rnatish: deploy.sh, systemd unit, qo'llanma
└── Readme.md
```

## Matematika sintaksisi

| Yozuv | Natija |
| --- | --- |
| `x^2`, `x^{10}` | yuqori indeks (daraja) |
| `a_1`, `a_{n+1}` | quyi indeks |
| `\frac{a}{b}` | kasr: surat, chiziq, maxraj |
| `$a/b$` | matematik rejimdagi qisqa kasr |
| `\sqrt{x}` | kvadrat ildiz |
| `\sqrt[3]{x}` | kub (yoki istalgan darajali) ildiz |
| `√ ∫ ∑ ± × ÷` | belgilar to'g'ridan-to'g'ri matnda |
| `≤ ≥ ≠ ≈ ∞ π °` | taqqoslash va geometriya belgilari |
| `∠ ⊥ ∥ → ⇒` | geometriya va mantiq belgilari |
| `α β γ θ λ μ ∆` | yunon harflari |

Matematika rejimini o'chirish uchun Studio'da "Matematika" tugmasini o'chiring — u holda belgilar
o'zgartirilmasdan, oddiy matn sifatida yoziladi.

## Bot buyruqlari

| Buyruq | Nima qiladi |
| --- | --- |
| `/start`, `/help` | tanishtiruv va qo'llanma |
| `/settings` | inline tugmalar bilan sozlash |
| `/lined`, `/grid`, `/plain` | yo'l-yo'l, katak, toza varaq |
| `/blue`, `/black`, `/graphite` | siyoh rangi |
| `/green`, `/red`, `/purple` | qo'shimcha ranglar |
| `/fonts` | kutubxonadagi barcha 39 shrift ro'yxatini ko'rsatadi (id, kategoriya, kirillcha) |
| `/font <id>` | yozuv shriftini almashtiradi, masalan `/font badscript` |
| `/caveat`, `/marck` | tez-tez ishlatiladigan ikki shrift uchun qisqa buyruqlar |
| `/size 34` | yozuv o'lchami (26–52) |
| `/file` | natijani rasm emas, PNG fayl qilib yuborish |
| `/id` | chat ID'ni ko'rsatadi (sozlashda yordam beradi) |

## Muhit o'zgaruvchilari

| Kalit | Majburiy | Tavsif |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | ✅ | @BotFather bergan token |
| `BOT_SECRET` | ➖ | webhook uchun maxfiy kalit (ixtiyoriy) |
| `PORT` | ➖ | webhook server porti (standart `8080`) |
| `BOT_DATA_DIR` | ➖ | chat sozlamalari saqlanadigan papka (standart `./bot/data`) |
| `TELEGRAM_API_BASE` | ➖ | o'z Bot API serveringiz yoki test uchun API manzili (standart `https://api.telegram.org`) |

Freebuff'da kalitlarni **Settings → Environment (Keys)** bo'limida qo'shing; mahalliy ishda `.env`
faylida saqlang. `.env` faylini hech qachon repozitoriyga qo'shmang.

## Serverga joylash (deployment)

O'z Ubuntu/Debian serveringizga botni doimiy xizmat sifatida o'rnatish uchun tayyor skript va
qadam-baqadam qo'llanma `deploy/` papkasida:

- **[deploy/README.md](deploy/README.md)** — SSH dan tortib loglarni kuzatishgacha bo'lgan to'liq qo'llanma;
- **`deploy/deploy.sh`** — Bun, kerakli paketlar, `daftar` foydalanuvchisi, loyiha fayllari va systemd
  xizmatini bir marta o'rnatadi (qayta ishga tushirish xavfsiz, `.env` saqlanib qoladi);
- **`deploy/daftar-bot.service`** — systemd unit fayli (`systemctl enable --now daftar-bot`).

Qisqacha:

```bash
sudo bash deploy/deploy.sh                       # loyiha shu papkada
sudo bash deploy/deploy.sh https://github.com/siz/daftar-bot.git   # git'dan
sudo bash deploy/deploy.sh --token-file=/root/token.txt            # tokenni fayldan o'qib o'rnatish
git -C /opt/daftar-bot pull && sudo systemctl restart daftar-bot   # yangilash
```

Qo'lda ishga tushirish variantlari:

- **Studio** — statik sayt. `bun run build` natijasida `dist/` papkasi hosil bo'ladi; uni istalgan statik
  hostingga (yoki Freebuff hostingiga) qo'yish mumkin. Backend talab qilinmaydi. nginx bilan shu serverning
  o'zida ko'rsatish misoli `deploy/README.md` da.
- **Bot** — doimiy ishlaydigan Node/Bun jarayoni kerak (`bun bot/index.ts poll`). Serverless muhitda
  **webhook** rejimidan foydalaning: `bun bot/index.ts webhook https://domen.example`. Telegram webhook
  uchun HTTPS va ochiq domen shart.
- Polling va webhook bir vaqtda ishlamaydi — bittasini tanlang.

## Muammolar

| Alomat | Yechim |
| --- | --- |
| `401 Unauthorized` | token xato yoki bekor qilingan — @BotFather'dan yangi token oling |
| `409 Conflict` | polling va webhook birga ishlayapti — `bun bot/index.ts delete-webhook` |
| Rasm chiqmayapti | bot jarayoni ishlab turibdimi, terminalni tekshiring (`bun bot/index.ts info`) |
| Uzun matn | matn bir necha varaqqa bo'linadi va har biri alohida rasm bo'ladi |
| Belgida ogohlantirish | belgi shriftda yo'q — javobdagi ogohlantirishni o'qing |
| Kirill harflar boshqacha ko'rinadi | tanlangan shriftda kirill yo'q — `/fonts` bilan kirillcha biladigan shriftni tanlang |
| Shrift kutubxonasi yangilanmayapti | `bun scripts/fetch-fonts.ts` ni ishga tushiring; xato bo'lsa internetni tekshiring |

## Tekshiruvlar

```bash
bun run check          # ikkala tekshiruv ketma-ket
bun run check:render   # namuna varaqalar (PNG), matematika geometriyasi, sahifalash
bun run check:bot      # bot: soxta Telegram server bilan matn → rasm → yuborish oqimi (token kerak emas)
```

`check:render` namunalarni `/tmp/daftar-check/` papkasiga yozadi va natijani ASCII ko'rinishida
chiqaradi — rasm haqiqatan daftarga o'xshashini shu yerda ko'rish mumkin.

## Shriftlar kutubxonasi

Daftar Bot'da **39 xil qo'lyozma shrifti** bor — har biri boshqa qo'l bilan yozilgandek ko'rinadi.
Ro'yxat `src/lib/handwriting/fonts.generated.ts` faylida saqlanadi, shrift fayllari esa
`src/assets/fonts/` papkasida.

**Kategoriyalar** (6 ta):

| Kategoriya | Tavsif | Misol shriftlar |
| --- | --- | --- |
| Erkin qo'lyozma | Tez, bemalol yozilgan — kundalik daftar uslubi | `caveat`, `kalam`, `reeniebeanie` |
| Ozoda yozuv | Tekis va o'qishga qulay — diktant, nazorat ishi | `marckscript`, `badscript` |
| Bosma (pechat) uslub | Harflar alohida-alohida — kichik sinflar uchun | `neucha`, `patrickhand`, `architectsdaughter` |
| Kitobiy kursiv | Qiyalik bilan bog'langan chiroyli yozuv | `dancingscript`, `allura`, `parisienne` |
| Mo'yqalam va bo'r | Qalin, ta'sirchan shtrixlar | `lobster`, `pacifico`, `caveatbrush` |
| Bolalar yozuvi | Yumaloq, quvnoq harflar | `pangolin`, `indieflower` |

**Kirillcha matn:** 13 shrift kirill alifbosini to'liq biladi (`caveat`, `marckscript`, `badscript`,
`neucha`, `pangolin`, `underdog`, `marmelad`, `yesevaone`, `comforter`, `lobster`, `pacifico`,
`greatvibes`, `amaticsc`). Agar tanlangan shriftda kirill harfi bo'lmasa, o'sha harflar zaxira
shriftda (Caveat) chiziladi va bot bu haqda bir marta ogohlantiradi.

**Qanday tanlanadi:**

- Telegram botda: `/fonts` — to'liq ro'yxat, `/font <id>` — almashtirish (`/font badscript`),
  `/settings` esa tugmalar bilan; har bir rasmdan keyin tezkor tugmalar ham chiqadi.
- Studioda: shrift galereyasida kategoriya bo'yicha ko'rib, jonli namunasini ko'rasiz.

**O'lchamlar tenglashtirilgan:** har bir shriftning x-balandligi o'lchanadi va shunga mos koeffitsient
(`sizeScale`) hisoblanadi — shuning uchun bir xil `fontSize` da hamma shrift taxminan bir xil
kattalikda ko'rinadi.

**Kutubxonani yangilash** (yangi shriftlar yuklab olish va ro'yxatni qayta hisoblash):

```bash
bun scripts/fetch-fonts.ts
```

Skript shriftlarni google/fonts repozitoriyasidan yuklab oladi, opentype.js bilan tekshiradi (lotin va
kirill qamrovi), x-balandlikni o'lchaydi, litsenziya matnlarini saqlaydi va manifestni qaytadan yozadi.
Kutubxonani ko'paytirish uchun `scripts/fetch-fonts.ts` ichidagi `CANDIDATES` ro'yxatiga yangi qatorlar
qo'shib, skriptni qayta ishga tushirish kifoya. Chizish paytida internet umuman kerak emas.

Barcha shriftlar **SIL Open Font License 1.1** shartlari ostida tarqatiladi va google/fonts
repozitoriyasidan olingan. Litsenziya matnlari `src/assets/fonts/licenses/` papkasida
(masalan `caveat.txt`, `marckscript.txt`).

## Akkaunt kerakmi?

Yo'q. Studio butunlay brauzerda ishlaydi: matn hech qanday serverga yuborilmaydi, rasm shu qurilmaning
o'zida chiziladi. Bot esa siz o'zingiz ishga tushiradigan jarayon — shuning uchun ro'yxatdan o'tish,
profil va ma'lumotlar bazasi yo'q.
