import { useRef, useState } from "react";
import { Camera, Check, Loader2, PenLine, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/form";
import { manageStyle, type MiniAppStyleInfo } from "@/lib/telegram/mini-app";
import { cn } from "@/lib/utils";

export interface StyleCopyProps {
  /** Chatdagi saqlangan uslublar (botdan). */
  styles: MiniAppStyleInfo[];
  /** Hozir yoqilgan uslub id'si (bo'lmasa — `null`). */
  styleId: string | null;
  /** Boshqa daftar/uslub amali bajarilmoqda — tugmalar shu vaqtda bloklanadi. */
  busy: boolean;
  /** Uslub o'zgargach Studio holatini qayta o'qish. */
  onReload: () => void;
}

/** Namunani yig'ish qadami: so'zlar → raqamlar → nom. */
type Step = "start" | "words" | "digits" | "save";

interface Outcome {
  ok: boolean;
  message: string;
}

/**
 * Namunadagi eng katta tomon. Server ham xuddi shu o'lchamgacha kichraytiradi
 * (`MAX_SAMPLE_SIDE`), shuning uchun bundan kattaroq surat yuborishdan foyda
 * yo'q — faqat mobil internetni band qiladi.
 */
const SAMPLE_MAX_SIDE = 1600;

/** Telefon surati uchun chegara: undan kattasi baribir kichraytiriladi. */
const MAX_PICK_BYTES = 25 * 1024 * 1024;

/** Rasmni JPEG'ga aylantirib, base64 (prefiksisiz) ko'rinishida qaytaradi. */
async function sampleToBase64(file: File): Promise<string> {
  if (file.size > MAX_PICK_BYTES) {
    throw new Error("Surat juda katta — boshqa surat tanlang.");
  }

  // Rasmni brauzerning o'zi ochadi (HEIC kabi formatlar qo'llab-quvvatlanmasa
  // shu yerda xato beradi) va kerak bo'lsa kichraytiradi.
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, SAMPLE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Rasmni tayyorlab bo'lmadi — boshqa surat bilan urinib ko'ring.");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.9),
  );
  if (!blob) throw new Error("Rasmni tayyorlab bo'lmadi — boshqa surat bilan urinib ko'ring.");

  const buffer = new Uint8Array(await blob.arrayBuffer());
  // base64: katta massivni bo'laklab o'giramiz (`String.fromCharCode` argument
  // chegarasidan oshib ketmasligi uchun).
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < buffer.length; index += chunk) {
    binary += String.fromCharCode(...buffer.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/**
 * «Uslubimni nusxalash» — Mini App'ning o'zida.
 *
 * Foydalanuvchi namunani (10 ta so'z, keyin 10 ta raqam) suratga oladi; Studio
 * rasmni shu yerda kichraytirib JPEG qilib, botga yuboradi. O'lchash va eng
 * yaqin qo'lyozmani tanlash botda bajariladi (u yerda shrift fayllari bor),
 * shuning uchun brauzerga shrift fayllari ham, rasm dekodlash uchun og'ir
 * kutubxonalar ham yuklanmaydi.
 */
export function StyleCopy({ styles, styleId, busy, onReload }: StyleCopyProps) {
  const [step, setStep] = useState<Step>("start");
  const [wordsImage, setWordsImage] = useState<string | null>(null);
  const [digitsImage, setDigitsImage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [measuring, setMeasuring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [armedRemove, setArmedRemove] = useState<string | null>(null);

  const wordsInput = useRef<HTMLInputElement | null>(null);
  const digitsInput = useRef<HTMLInputElement | null>(null);

  /** Suratni tayyorlaydi: o'qilmagan yoki juda katta surat — xato xabari bilan. */
  const prepare = async (file: File): Promise<string | null> => {
    setMeasuring(true);
    setOutcome(null);
    try {
      // Tayyorlash bir necha yuz millisekund oladi; «tayyorlanmoqda…» yozuvi
      // ko'rinib turishi uchun bitta kadr kutamiz.
      await new Promise((resolve) => setTimeout(resolve, 30));
      return await sampleToBase64(file);
    } catch (error) {
      setOutcome({
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Rasm o'qilmadi — boshqa surat bilan urinib ko'ring.",
      });
      return null;
    } finally {
      setMeasuring(false);
    }
  };

  const pickWords = async (file: File | undefined) => {
    if (!file) return;
    const image = await prepare(file);
    if (!image) return;
    setWordsImage(image);
    setStep("digits");
  };

  const pickDigits = async (file: File | undefined) => {
    if (!file) return;
    const image = await prepare(file);
    if (!image) return;
    setDigitsImage(image);
    setStep("save");
  };

  const start = () => {
    setWordsImage(null);
    setDigitsImage(null);
    setName("");
    setOutcome(null);
    setStep("words");
  };

  const reset = () => {
    setWordsImage(null);
    setDigitsImage(null);
    setOutcome(null);
    setStep("start");
  };

  const save = async () => {
    if (!wordsImage) return;
    setSaving(true);
    const trimmed = name.trim();
    const result = await manageStyle({
      action: "measure",
      wordsImage,
      ...(digitsImage ? { digitsImage } : {}),
      ...(trimmed ? { name: trimmed } : {}),
    });
    setSaving(false);
    setOutcome({ ok: result.ok, message: result.message });
    if (result.ok) {
      setName("");
      setWordsImage(null);
      setDigitsImage(null);
      setStep("start");
      onReload();
    }
  };

  const applyStyle = async (id: string) => {
    setArmedRemove(null);
    const result = await manageStyle({ action: "apply", styleId: id });
    setOutcome({ ok: result.ok, message: result.message });
    if (result.ok) onReload();
  };

  const removeStyle = async (id: string) => {
    setArmedRemove(null);
    const result = await manageStyle({ action: "remove", styleId: id });
    setOutcome({ ok: result.ok, message: result.message });
    if (result.ok) onReload();
  };

  const working = measuring || saving || busy;

  return (
    <Card className="bg-white/70">
      <CardHeader>
        <CardTitle className="hand text-2xl">Uslubimni nusxalash</CardTitle>
        <CardDescription>
          O&apos;z qo&apos;lyozmangizni suratga olasiz — bot uni o&apos;lchab, eng yaqin
          qo&apos;lyozma shriftini sizning qiyaligingiz, shtrix qalinligingiz va harflar
          orasiga moslaydi.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {step === "start" && (
          <div className="space-y-2">
            <ul className="ml-4 list-disc space-y-1 text-xs leading-relaxed text-pencil/75">
              <li>1-qadam: 10 ta so&apos;zni yo&apos;l-yo&apos;l daftarga yozib suratga olasiz.</li>
              <li>2-qadam: 10 ta raqamni katak daftarga yozasiz (o&apos;tkazib yuborish ham mumkin).</li>
              <li>Yozuv butun varaqada, soyasiz va aniq ko&apos;rinishi kerak.</li>
              <li>Surat o&apos;lchash uchun botga yuboriladi; uslub chatda saqlanadi.</li>
            </ul>
            <Button variant="marker" size="sm" disabled={working} onClick={start}>
              <PenLine className="h-4 w-4" />
              Namunani boshlash
            </Button>
          </div>
        )}

        {step === "words" && (
          <div className="space-y-2 rounded-xl border border-marker/40 bg-marker-soft/20 p-3">
            <p className="text-xs leading-relaxed text-pencil/80">
              1-qadam: 10 ta so&apos;z yozilgan varaqani suratga oling (masalan «salom,
              maktab, daftar…»).
            </p>
            <Button
              variant="marker"
              size="sm"
              disabled={working}
              onClick={() => wordsInput.current?.click()}
            >
              {measuring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              So&apos;zlar rasmini tanlash
            </Button>
            <Button variant="ghost" size="sm" disabled={working} onClick={reset}>
              <X className="h-4 w-4" />
              Bekor qilish
            </Button>
          </div>
        )}

        {step === "digits" && (
          <div className="space-y-2 rounded-xl border border-marker/40 bg-marker-soft/20 p-3">
            <p className="text-xs leading-relaxed text-pencil/80">
              So&apos;zlar surati tayyor. 2-qadam: 10 ta raqam yozilgan varaqani suratga oling
              yoki raqamlarsiz davom eting.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="marker"
                size="sm"
                disabled={working}
                onClick={() => digitsInput.current?.click()}
              >
                {measuring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                Raqamlar rasmini tanlash
              </Button>
              <Button variant="outline" size="sm" disabled={working} onClick={() => setStep("save")}>
                ⏭ Raqamlarsiz davom etish
              </Button>
            </div>
          </div>
        )}

        {step === "save" && (
          <div className="space-y-3 rounded-xl border border-marker/40 bg-marker-soft/20 p-3">
            <p className="text-xs leading-relaxed text-pencil/80">
              Namuna tayyor
              {digitsImage ? " — raqamlar ham hisobga olinadi" : " — raqamlar namunasiz"}. Endi
              uslubga nom bering va saqlang: o&apos;lchash shu yerda boshlanadi.
            </p>
            <div>
              <Label>Uslub nomi (ixtiyoriy)</Label>
              <Input
                value={name}
                maxLength={28}
                placeholder="Mening yozuvim"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="marker" size="sm" disabled={working} onClick={() => void save()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Saqlash
              </Button>
              <Button variant="ghost" size="sm" disabled={working} onClick={reset}>
                <X className="h-4 w-4" />
                Bekor qilish
              </Button>
            </div>
          </div>
        )}

        {styles.length > 0 && (
          <div className="space-y-2 rounded-xl border border-paper-edge bg-white/70 p-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-pencil/60">
              Saqlangan uslublar
            </span>
            {styles.map((entry) => {
              const active = entry.id === styleId || entry.active;
              return (
                <div
                  key={entry.id}
                  className={cn(
                    "space-y-1.5 rounded-xl border p-2.5",
                    active ? "border-marker/50 bg-marker-soft/20" : "border-ink/15 bg-white",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{entry.name}</span>
                    {active && (
                      <span className="flex items-center gap-1 rounded-full bg-marker/25 px-2 py-0.5 text-[10px] font-semibold text-ink">
                        <Sparkles className="h-3 w-3" />
                        yoqilgan
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] leading-relaxed text-pencil/70">
                    {[entry.baseFont, entry.summary].filter((row) => row.length > 0).join(" • ")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {!active && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={working}
                        onClick={() => void applyStyle(entry.id)}
                      >
                        🖋 Yoqish
                      </Button>
                    )}
                    {armedRemove !== entry.id ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-margin hover:bg-margin-soft/40"
                        disabled={working}
                        onClick={() => setArmedRemove(entry.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                        O&apos;chirish
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="default"
                          size="sm"
                          disabled={working}
                          onClick={() => void removeStyle(entry.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                          Ha, o&apos;chirish
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={working}
                          onClick={() => setArmedRemove(null)}
                        >
                          <X className="h-4 w-4" />
                          Yo&apos;q
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {outcome && (
          <p
            className={cn(
              "flex gap-2 rounded-xl border p-2.5 text-xs leading-relaxed",
              outcome.ok
                ? "border-sage/40 bg-sage-soft/40 text-ink"
                : "border-margin/40 bg-margin-soft/40 text-margin",
            )}
          >
            <span>{outcome.message}</span>
          </p>
        )}

        <input
          ref={wordsInput}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="So'zlar namunasi"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void pickWords(file);
          }}
        />
        <input
          ref={digitsInput}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Raqamlar namunasi"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void pickDigits(file);
          }}
        />
      </CardContent>
    </Card>
  );
}

export default StyleCopy;
