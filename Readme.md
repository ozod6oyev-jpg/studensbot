# Daftar Bot 📓

Matnni **qo'lda yozilgan daftar sahifasi** ko'rinishida rasmga aylantiruvchi Telegram bot + brauzerdagi
Studio. Foydalanuvchi matn yuboradi — bot uni yo'l-yo'l (chiziqli) yoki katak daftarga yozib, rasm qilib
qaytaradi: xuddi o'quvchi daftarga yozgandek. Dvigatel **adabiyot** matnlari uchun ham, **matematika**
formulalari uchun ham ishlaydi.

## Nima qiladi

- 📝 Matnni qatorlarga bo'lib, chegaraga yetganda so'zni keyingi qatorga ko'chiradi.
- 📄 Varaq to'lganda keyingi varaqani ochadi; daftardagidek **old tomonida chegara chapda, orqa tomonida o'ngda** bo'ladi va yozuv varaqdan varaqqa uzluksiz davom etadi.
- 📐 **Yo'l-yo'l** (chiziqli, chegarasi qizil chiziqli), **katak** (5 mm) va **toza** oq varaq — hammasi A4 o'lchamda.
- 🖋 **39 shriftdan iborat qo'lyozma kutubxonasi**, 6 kategoriyada: erkin qo'lyozma, ozoda yozuv, bosma (pechat) uslub, kitobiy kursiv, mo'yqalam-bo'r va bolalar yozuvi. Shulardan 13 tasi kirillcha matnni ham biladi.
- 🎨 **O'nta siyoh rangi**: ko'k, qora, qalam, yashil, qizil, siyohrang, to'q sariq, pushti, havorang, jigarrang.
- 📚 **Daftar bazasi**: foydalanuvchi 12, 36, 48 yoki 96 varaqli daftar yaratadi (har varaqning ikki tomoni bor) va yozgan matni shu daftarga varaqma-varaq joylashib boradi. Daftarga **nom berish** va **nomini o'zgartirish** mumkin, u **kitobdek PDF** qilib yuklab olinadi.
- ➗ Matematika: daraja (`x^2`), indeks (`a_1`), kasr (`\frac{a}{b}`), ildiz (`\sqrt{x}`), √ ∫ ∑ ≤ ≥ ≠ ∞ π ∠ ⊥ ∥ va yunon harflari.
- 🤖 Telegram bot: pastdagi **doimiy menyu** (`✍️ Matn kiritish`, `⚙️ Sozlamalar`) — tugmalar chat ichida emas, har bir sozlama alohida ochiladi.
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
│   │   ├── names.ts            # shrift nomlarini ko'rsatish (bot, galereya, varaqa)
│   │   ├── font-sheet.ts       # shriftlar varaqasi: nomlar o'z shriftida chizilgan rasm (Telegram uchun)
│   │   ├── fit.ts              # matnni bitta varaq tomoniga sig'dirish (daftar uchun)
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
├── bot/index.ts                # Telegram bot: polling, webhook, menyu va buyruqlar
│   ├── db.ts                   # daftar bazasi (JSON ombor)
│   └── data/                   # ishlash paytida yaratiladi: settings.json + notebooks.json (git'ga tushmaydi)
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

## Bot interfeysi

Bot pastdagi **doimiy menyu** bilan boshqariladi — tugmalar chat ichida emas, matn yoziladigan
qatorning tagida turadi:

| Bo'lim | Tugmalar |
| --- | --- |
| Asosiy menyu (`/start`) | `✍️ Matn kiritish`, `⚙️ Sozlamalar`, `ℹ️ Yordam`, `🆔 Chat ID` (Mini App sozlangan bo'lsa — `🖥 Studio (Mini App)`) |
| `⚙️ Sozlamalar` | `🖋 Siyoh rangi`, `📄 Qog'oz turi`, `✍️ Yozuv uslubi`, `📐 Yozuv sozlamalari`, `📚 Daftarlar`, `🖋 Uslubimni nusxalash`, `⬅️ Asosiy menyu` |
| `🖋 Siyoh rangi` | 10 rang (joriysi ✓ bilan): Ko'k, Qora, Qalam, Yashil, Qizil, Siyohrang, To'q sariq, Pushti, Havorang, Jigarrang |
| `📄 Qog'oz turi` | `Yo'l-yo'l`, `Katak`, `Toza (A4)` — daftarsiz varaqalar uchun (daftar ichida daftarning o'z qog'ozi ishlatiladi) |
| `✍️ Yozuv uslubi` | sahifalab: 8 shriftdan iborat **rasm varaqasi** va `1 Caveat`, `2 Marck Script`, … tugmalari, `⬅️ Oldingi`, `Keyingi ➡️` |
| `📐 Yozuv sozlamalari` | `🔠 O'lcham`, `〰️ Qo'l tebranishi`, `📏 Qator oralig'i`, `🔢 Matematika`, `🖼 Yuborish turi` |
| `📚 Daftarlar` | daftarlar ro'yxati (`📖 1-daftar • 5/24`), `➕ Yangi daftar` |
| daftar kartasi (ro'yxatdagi `📖 …` tugmasi) | `✍️ Shu daftarga yozish`, `⬇️ PDF yuklab olish`, `🛠 Tahrirlash`, `✏️ Nomini o'zgartirish`, `⬅️ Daftarlar` |
| `➕ Yangi daftar` | `12 varaq`, `36 varaq`, `48 varaq`, `96 varaq`, so'ng qog'oz turi: `📏 Yo'l-yo'l daftar`, `🔲 Katak daftar`, `📄 Oq qog'oz`, keyin nom so'rash: `⏭ Nomsiz qoldirish` |

**Mini App (Studio Telegram ichida):** `MINI_APP_URL` sozlangan bo'lsa, bot ishga tushganda
Telegram'ning **menyu tugmasini** (matn yoziladigan qator yonidagi tugma) Studio sahifasiga
bog'laydi va pastdagi menyuga `🖥 Studio (Mini App)` tugmasini qo'shadi; `/studio` buyrug'i ham
shu sahifani ochadigan tugma yuboradi. Sahifa Telegram oynasida ochiladi, matn va sozlamalar
Telegram imzosi (`initData`) bilan botga yuboriladi, bot esa natijani o'sha chatga rasm qilib
qaytaradi (serverga joylash: [deploy/README.md](deploy/README.md)).

**Daftar bilan ishlash:** `➕ Yangi daftar` orqali varaq soni (12/36/48/96) tanlanadi — har varaqning
ikki tomoni bo'ladi, ya'ni jami 24/72/96/192 bet. So'ng **qog'oz turi** tanlanadi (`📏 Yo'l-yo'l
daftar`, `🔲 Katak daftar`, `📄 Oq qog'oz`) va bu tanlov **daftarda saqlanadi**: har bir daftarning
betlari (rasmi, slaydi va PDF kitobi) o'z qog'ozida chiziladi — shuning uchun bitta chatda yo'l-yo'l
va katak daftar birga turishi mumkin. `✍️ Matn kiritish` daftarlar ro'yxatini chiqaradi;
hali daftar bo'lmasa, avval yangi daftar yaratish kerakligi aytiladi. Tanlangan daftarga yuborilgan
matn varaqma-varaq yoziladi va har bir tomon alohida rasm bo'lib qaytadi — old tomonida chegara
chapda, orqa tomonida o'ngda (xuddi haqiqiy daftar kabi).

**Daftarga nom berish:** varaq soni va qog'oz turi tanlangach bot nom so'raydi — matn yuborsangiz,
daftar shu nom bilan yaratiladi. Tasdiqda tanlangan qog'oz ham aytiladi (masalan, «✅ «1-daftar»
yaratildi — 12 varaq (24 bet), katak daftar»), daftar kartasida esa `📄 Qog'oz: katak daftar` qatori
ko'rinadi. `⏭ Nomsiz qoldirish` bosilsa, nom avtomatik qo'yiladi (`1-daftar`, keyingisi
`2-daftar`) va daftar ochiladi.

**Daftar kartasi:** `📚 Daftarlar` ro'yxatidagi istalgan `📖 …` tugmasi bosilganda daftar kartasi
chiqadi:

| Karta tugmasi | Nima qiladi |
| --- | --- |
| `✍️ Shu daftarga yozish` | yozish joyini so'raydi: qaysi betning qaysi qatoridan yoziladi (pastga qarang) |
| `⬇️ PDF yuklab olish` | daftarning barcha yozilgan betlarini kitobdek PDF hujjat qilib beradi |
| `🛠 Tahrirlash` | tahrirlash menyusi: `✂️ Yozuvni o'chirish`, `↩️ Oxirgi amalni qaytarish`, `✏️ Nomini o'zgartirish` |
| `✏️ Nomini o'zgartirish` | yangi nomni matn ko'rinishida so'raydi — keyingi xabar daftar nomi bo'ladi |
| `⬅️ Daftarlar` | ro'yxatga qaytaradi |

**Yozish joyini tanlash:** `✍️ Shu daftarga yozish` bosilganda bot avval **qayerga yozilganini**
ko'rsatadi (oxirgi bet va qator raqami), so'ng betning tepasidan sanab **nechta qator bo'sh
turganini** aytadi va joy tanlashni so'raydi:

| Tugma | Nima qiladi |
| --- | --- |
| `▶️ Davom etish` | oxirgi yozuvdan keyingi birinchi bo'sh qatordan davom etadi |
| `➕ Yangi betdan` | keyingi betni ochib, 1-qatordan boshlaydi |
| `🔢 Qatorni tanlash` | betdagi bo'sh qatorlarni raqamlab beradi — qatorni tanlaysiz |

Keyin bot **nechta qator tashlab ketishni** so'raydi: `⬇️ Yozuvning tagidan` (0 qator — oldingi
yozuvning tagidan), `⏭ 1`, `⏭ 2`, `⏭ 3`, `⏭ 5` (shuncha qator bo'sh qoladi) va
"✅ Tayyor! Yozish N-betning M-qatoridan boshlanadi" deb tasdiqlaydi. Shundan keyin yuborilgan matn
aynan shu joydan boshlab yoziladi; javobda yozuv qayerdan boshlangani va betda **nechta qator toza
qolgani** qayta sanab beriladi. Yozuv juda uzun bo'lsa, davomi keyingi betdan ketadi.

**Yozuvni orqaga qaytarish:** har bir yozuv va o'chirish tarixga yoziladi. Yozilgan bet ostidagi
`↩️ Yozuvni orqaga qaytarish` (yoki daftar kartasidagi `↩️ Oxirgi amalni qaytarish`) bosilsa,
oxirgi amal bekor qilinadi va betlar avvalgi holatida qayta chizilib yuboriladi.

**Yozuvni o'chirish:** `🛠 Tahrirlash` → `✂️ Yozuvni o'chirish` daftarning **yozilgan betlarini
slayd** qilib ko'rsatadi va bosqichma-bosqich so'raydi:

1. o'chirish boshlanadigan **bet** tanlanadi;
2. shu betdagi qatorlar matni bilan ko'rsatiladi — **qator raqami** kiritiladi;
3. qatordagi so'zlar raqamlab beriladi (`1) so'z`, `2) so'z`, …) — boshlanish **so'zi** tanlanadi (u
   ham o'chiriladi);
4. shundan keyin betlar yana slayd qilinadi va **qayergacha** o'chirish so'raladi (bet → qator →
   so'z);
5. oxirida "❓ O'chirishni tasdiqlaysizmi?" bilan o'chiriladigan oraliq va so'zlar soni ko'rsatiladi —
   `✅ Ha, o'chirish` bosilganda so'zlar o'chiriladi va tahrirlangan betlar rasm bo'lib qaytadi.

O'chirish ham orqaga qaytariladi (`↩️ Oxirgi amalni qaytarish`) — daftar o'chirishdan oldingi holatga
qaytadi.

**Daftarni kitobdek yuklab olish:** `⬇️ PDF yuklab olish` bosilganda daftardagi barcha yozilgan
betlar ketma-ket (old tomon, orqa tomon, keyingi varaq, …) **A4 sahifali ko'p betli PDF** qilib
yuboriladi (sahifalar joriy siyoh va shrift hamda **daftarning o'z qog'ozi** bilan chiziladi) — fayl nomi `<daftar nomi>.pdf`; xuddi asl daftarni varaqlayotgandek o'qib yoki chop etib
bo'ladi. Varaq soni juda ko'p bo'lsa, PDF bir necha qismga bo'linadi (`-1-qism`, `-2-qism`, …). U
`🖼 Yuborish turi` sozlamasidan qat'i nazar **hujjat** sifatida yuboriladi.

**Shriftlar rasm ko'rinishida:** Telegram o'z shriftlarini ko'rsata olmaydi, shuning uchun
`✍️ Yozuv uslubi` bo'limida ro'yxat har bir nom o'z shriftida chizilgan **rasm** ko'rinishida
yuboriladi va tagidagi tugmalar (`1 Caveat`, `2 Marck Script`, …) shu varaqqa mos keladi.

**O'z qo'lyozmangizni nusxalash:** `⚙️ Sozlamalar` → `🖋 Uslubimni nusxalash` (yoki `/style`,
`/uslub` buyrug'i) bo'limida bot sizning yozuvingizni o'lchab, unga mos **shaxsiy uslub** yasaydi:

1. **1-qadam — so'zlar:** yo'l-yo'l daftar varag'iga quyidagi 10 ta so'zni yozib suratga olasiz:
   `salom, maktab, daftar, kitob, qalam, yozuv, o'qituvchi, do'stlik, quyosh, bahor`;
2. **2-qadam — raqamlar:** katak daftarga 10 ta raqam (`0 1 2 3 4 5 6 7 8 9`) yozib suratga olasiz
   yoki `⏭ Raqamlarsiz davom etish` bilan bu qadamni o'tkazib yuborasiz.

Surat varaqning to'rt burchagi bilan, yorug' joyda va to'liq ko'rinadigan qilib olinadi; yozuvni
o'zgartirmasdan, odatdagidek yozish tabiiyroq natija beradi. Qatorlar o'qilmasa yoki siyoh juda kam
bo'lsa, bot varaqni qayta suratga olishni so'raydi.

O'lchovdan keyin bot namunalar eng yaqin **qo'lyozma shriftni** (39 shrift ichidan) tanlaydi va
o'lchangan xususiyatlarni — qiyalik, shtrix qalinligi, harflar kengligi va orasi, tebranish — shu
uslubga qo'shadi. So'ng nom so'raladi: keyingi xabar uslub nomi bo'ladi (28 belgigacha), yoki
`⏭ Nomsiz qoldirish` bosilsa nom «Mening uslubim» bo'ladi. Uslub darhol saqlanadi va yoqiladi.

| Tugma | Nima qiladi |
| --- | --- |
| `✒️ <nom>` | saqlangan uslubni yoqadi (joriysi ✓ bilan belgilanadi) |
| `▶️ Namunani boshlash` | yangi namuna olishni boshlaydi |
| `⏹ Uslubni to'xtatish` | uslubni bazadan o'chirmasdan o'chiradi — ommaviy shriftlar qaytadi |
| `🗑 Uslubni o'chirish` | saqlangan uslubni o'chiradi; bir nechta bo'lsa bot qaysi birini so'raydi (`🗑 <nom>` tugmalari va `❌ Bekor qilish`), bittasi bo'lsa darhol o'chiriladi |
| `❌ Bekor qilish` | namuna olish yoki o'chirishni bekor qiladi |

Bir chat ko'pi bilan **5 ta uslub** saqlaydi (yangi namunaga joy ochish uchun keraksizini `🗑` bilan
o'chirish kerak). Uslublar `BOT_DATA_DIR` papkasidagi `styles.json` faylida yoziladi
(`settings.json`, `notebooks.json` bilan birga) va **faqat egasiga** ko'rinadi — boshqa
foydalanuvchilarga umuman chiqmaydi. Yoqilgan uslub barcha varaqalarga va `⬇️ PDF yuklab olish`
kitobiga qo'llanadi; ommaviy shriftlar (`✍️ Yozuv uslubi`) esa o'z holida qoladi.

Quyidagi buyruqlar ham ishlashda davom etadi (tez tanlash uchun). Ularni yodlash shart emas:
har biri uchun menyuda tugma bor (`ℹ️ Yordam` qisqa qo'llanmani ochadi, noto'g'ri buyruq yozilsa
bot **butun ro'yxatni emas**, faqat qisqa maslahat qaytaradi):

| Buyruq | Nima qiladi |
| --- | --- |
| `/start` | salomlashuv va pastdagi menyu |
| `/help` | qisqa qo'llanma (buyruqlar ro'yxati o'rniga — tugmalar) |
| `/settings` | sozlamalar menyusini ochadi (pastdagi tugmalar) |
| `/lined`, `/grid`, `/plain` | yo'l-yo'l, katak, toza varaq |
| `/blue`, `/black`, `/graphite` | siyoh rangi |
| `/green`, `/red`, `/purple` | qo'shimcha ranglar |
| `/orange`, `/pink`, `/teal`, `/brown` | qolgan to'rtta rang |
| `/fonts` | shriftlar ro'yxatini ko'rsatadi (nomlar o'z shriftida chizilgan rasm ko'rinishida, id va kategoriya bilan) |
| `/font <id>` | yozuv shriftini almashtiradi, masalan `/font badscript` |
| `/style` | shaxsiy uslub bo'limini ochadi (namuna olish, saqlangan uslublar) |
| `/uslub` | xuddi shu bo'lim, o'zbekcha nom bilan |
| `/caveat`, `/marck` | tez-tez ishlatiladigan ikki shrift uchun qisqa buyruqlar |
| `/size 34` | yozuv o'lchami (26–52) |
| `/file` | natijani rasm emas, PNG fayl qilib yuborish |
| `/id` | chat ID'ni ko'rsatadi (sozlashda yordam beradi); xuddi shu narsa `🆔 Chat ID` tugmasida ham bor |
| `/studio` | Studioni Mini App sifatida ochadigan tugma yuboradi (`MINI_APP_URL` sozlangan bo'lsa) |

## Muhit o'zgaruvchilari

| Kalit | Majburiy | Tavsif |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | ✅ | @BotFather bergan token |
| `BOT_SECRET` | ➖ | webhook uchun maxfiy kalit (ixtiyoriy) |
| `PORT` | ➖ | webhook server porti (standart `8080`) |
| `BOT_DATA_DIR` | ➖ | sozlamalar (`settings.json`), daftarlar (`notebooks.json`) va shaxsiy uslublar (`styles.json`) saqlanadigan papka (standart `./bot/data`) |
| `TELEGRAM_API_BASE` | ➖ | o'z Bot API serveringiz yoki test uchun API manzili (standart `https://api.telegram.org`) |
| `MINI_APP_URL` | ➖ | Studio sahifasining **HTTPS** manzili (masalan `https://domen.uz/studio`) — Mini App uchun. O'rnatilsa bot menyu tugmasini Studio'ga bog'laydi va pastdagi menyuga `🖥 Studio (Mini App)` tugmasini qo'shadi |

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
cd ~/daftar-bot && git pull && sudo bash deploy/deploy.sh   # yangilash (kod papkasida)
```

> `/opt/daftar-bot` — **o'rnatilgan** nusxa (`.git` yo'q), shuning uchun u yerda `git pull`
> xato beradi: kod manba papkada yangilanadi. Batafsil: [deploy/README.md](deploy/README.md).

### Telegram Mini App

Studio'ni Telegram ichida **Mini App** sifatida ochish mumkin: bot menyusidagi tugma bosilsa
sahifa Telegram oynasida ochiladi, natija esa o'sha chatga qaytadi.

Mini App uchun **domen va HTTPS majburiy** — Telegram faqat `https://` manzillarni qabul
qiladi, shuning uchun faqat IP manzilli serverda u umuman ochilmaydi. Polling rejimi va
brauzerdagi Studio esa domensiz ham avvalgidek ishlaydi.

**Domeningiz bo'lmasa ham mumkin:** `sslip.io`/`nip.io` nomi (masalan
`95.123.45.67.sslip.io`) orqali certbot bilan bepul sertifikat olinadi yoki Cloudflare Tunnel
bir zumda vaqtinchalik HTTPS manzil beradi — ikkalasi ham qadam-baqadam
[deploy/README.md](deploy/README.md) da yozilgan.

1. saytni yig'ing: `sudo -u daftar /usr/local/bin/bun run build` (natija — `dist/`);
2. `/opt/daftar-bot/.env` ga `MINI_APP_URL=https://domen.uz/studio` qatorini qo'shib,
   `sudo systemctl restart daftar-bot` qiling — bot `PORT` (standart `8080`) portida Mini App
   endpointini ochadi va menyu tugmasini o'zi o'rnatadi;
3. nginx (sayt `dist/` dan, `/mini-app/` bot portiga) va certbot sozlamasi to'liq nginx
   bloki bilan [deploy/README.md](deploy/README.md) da.

Sayt va API turli domenda bo'lsa, yig'ishdan oldin
`VITE_MINI_APP_ENDPOINT=https://bot.domen.uz/mini-app/send` beriladi.

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
| Matn rasm bo'lib qaytmayapti | avval `➕ Yangi daftar` bilan daftar yaratib, `✍️ Matn kiritish` orqali uni tanlang — daftarsiz matn yozilmaydi |
| Daftar to'ldi | varaqlari tugaganda bot yangi daftar yaratishni aytadi; `📚 Daftarlar` bo'limidan yangisini oching |
| `⬇️ PDF yuklab olish` ishlamayapti (bo'sh javob) | daftarda hali yozilgan bet yo'q — avval `✍️ Matn kiritish` orqali matn yuboring, keyin yuklab oling |
| Shrift kutubxonasi yangilanmayapti | `bun scripts/fetch-fonts.ts` ni ishga tushiring; xato bo'lsa internetni tekshiring |
| Mini App tugmasi sahifani ochmayapti | Domen HTTPS emas yoki `MINI_APP_URL` xato — sertifikat (`certbot`) va nginx'dagi `/mini-app/` proxy'sini tekshiring |
| Mini App'da "Telegram ma'lumotlari eskirgan" | `initData` 24 soatdan eski — Mini App'ni yopib, bot menyusidagi tugma bilan qaytadan oching |
| Mini App'da "Bot serveriga ulanib bo'lmadi" | Bot jarayoni ishlamayapti yoki `PORT`da tinglamayapti: `systemctl status daftar-bot` va `curl -s http://127.0.0.1:8080/healthz` |

## Tekshiruvlar

```bash
bun run check          # hamma tekshiruv ketma-ket
bun run check:render   # namuna varaqalar (PNG), matematika geometriyasi, sahifalash
bun run check:bot      # bot: soxta Telegram server bilan matn → rasm → yuborish oqimi (token kerak emas)
bun run check:mini-app # Mini App: initData imzosi, menyu tugmasi va POST /mini-app/send
bun run check:sheet    # shriftlar ro'yxati rasmi (nomlar o'z shriftida, ingichka varaqa)
bun run check:pdf      # kitob PDF: tuzilish, JPEG sahifalar, qismlarga bo'lish
bun run check:deploy   # deploy.sh: clone → .env saqlanishi → git pull → yangilanish (root kerak)
```

`check:pdf` PDF ni tahlil qiladi: `xref` jadvalidagi siljishlar haqiqiy obyektlarga ishora
qilishini, har bir sahifada ochiladigan JPEG rasm borligini va daftar betlaridan yasalgan
kitobda old/orqa tomon chegaralari to'g'ri ekanini tekshiradi.

`check:deploy` haqiqiy `deploy/deploy.sh` ni `/tmp` ichida, stub buyruqlar va lokal git
repozitoriy bilan sinaydi; shuning uchun u **root** huquqini talab qiladi (skriptning o'zi
ham root ostida ishlaydi).

`check:mini-app` Mini App zanjirini boshdan-oxiriga tekshiradi: `initData` imzosi qabul
qilinishi va buzilgan, eskirgan yoki boshqa token bilan imzolangan ma'lumot rad etilishi,
botning menyu tugmasini Studio'ga bog'lashi (pastdagi menyuda ham) hamda
`POST /mini-app/send` so'rovi natijasida chatga haqiqiy PNG varaqa kelishi. Mock Telegram
API ishlatiladi, shuning uchun token yoki internet kerak emas.

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

- Telegram botda: `✍️ Yozuv uslubi` menyusi — ro'yxat har bir nom o'z shriftida chizilgan rasm
  ko'rinishida chiqadi va tugmalar bilan tanlanadi; `/fonts` ham shu varaqani ko'rsatadi,
  `/font <id>` esa to'g'ridan-to'g'ri almashtiradi (`/font badscript`).
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
o'zida chiziladi. Bot ham siz o'zingiz ishga tushiradigan jarayon, ma'lumotlari esa (sozlamalar va
daftarlar) faqat `BOT_DATA_DIR` papkasidagi JSON fayllarda saqlanadi — tashqi xizmat, akkaunt yoki
bulut bazasi ishlatilmaydi.
