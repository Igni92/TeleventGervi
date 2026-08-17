/**
 * Rattachement d'un PDF archivé à un document SAP + un client — TOLÉRANT.
 *
 * Format d'objet observé (boîte factures-archive@) :
 *   "CODECLIENT - TYPE NUM du JOUR JJ.MM.AAAA"
 *   ex. "MEDESSOR CLT - FA 127811 du VEN 14.08.2026"
 *       "ALAXOU - BL 24012456 du LUN 17.08.26"
 *   TYPE : FA = facture · BL = bon de livraison · AV = avoir.
 *   Le préfixe est le CODE CLIENT SAP (ex. « SOFRUCE CLT »).
 *
 * Stratégie :
 *   1) le n° résout le miroir SAP (SapInvoice/SapOrder/SapCreditNote) → client,
 *      docEntry, docDate, type SAP (source de vérité) ;
 *   2) à défaut (n° pas encore synchronisé), on rattache le client par le CODE
 *      lu en préfixe du sujet ;
 *   3) sinon non résolu (typé au mieux par le mot-clé).
 */
import { prisma } from "@/lib/prisma";

export type DocType = "BL" | "FACTURE" | "AVOIR" | "AUTRE";
type KnownType = Exclude<DocType, "AUTRE">;

export interface MatchResult {
  docType: DocType;
  docNum: string | null;
  docEntry: number | null;
  cardCode: string | null;
  clientId: string | null;
  docDate: Date | null;
  matched: boolean;
}

const strip = (s: string) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Parse l'objet structuré « CODE - TYPE NUM … ». */
function parseSubject(subject: string): { cardCode: string | null; type: KnownType | null; num: string | null } {
  const m = (subject || "").match(/^\s*(.+?)\s*[-–]\s*(facture|fac|fa|avoir|av|bl)\b\s*(\d{3,})?/i);
  if (!m) return { cardCode: null, type: null, num: null };
  const tok = m[2].toLowerCase();
  const type: KnownType = tok.startsWith("fa") ? "FACTURE" : tok.startsWith("av") ? "AVOIR" : "BL";
  return { cardCode: (m[1] || "").trim() || null, type, num: m[3] ?? null };
}

/** Devine le type par mots-clés (repli si l'objet n'est pas structuré). */
function typeHintKeyword(fileName: string, subject: string): KnownType | null {
  const s = strip(`${fileName} ${fileName} ${subject}`); // nom compté double
  if (/\bavoir\b|\bav\b|credit/.test(s)) return "AVOIR";
  if (/facture|invoice|\bfac?\b|\bfc\b/.test(s)) return "FACTURE";
  if (/\bbl\b|bon de livraison|livraison|delivery/.test(s)) return "BL";
  return null;
}

/** N° candidats (≥4 chiffres), dates retirées d'abord (sinon l'année pollue). */
function candidateNumbers(fileName: string, subject: string): number[] {
  const noDates = (s: string) => (s || "").replace(/\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/g, " ");
  const grab = (s: string) => (noDates(s).match(/\d{4,}/g) ?? []).map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n));
  const seen = new Set<number>();
  const out: number[] = [];
  for (const n of [...grab(fileName), ...grab(subject)]) {
    if (!seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out.slice(0, 12);
}

/** Résout un Client par son code (exact, puis insensible à la casse). */
async function resolveClientByCode(code: string): Promise<string | null> {
  const exact = await prisma.client.findUnique({ where: { code }, select: { id: true } }).catch(() => null);
  if (exact) return exact.id;
  const ci = await prisma.client
    .findFirst({ where: { code: { equals: code, mode: "insensitive" } }, select: { id: true } })
    .catch(() => null);
  return ci?.id ?? null;
}

export async function matchDocument(fileName: string, subject: string): Promise<MatchResult> {
  const parsed = parseSubject(subject);
  const hint = parsed.type ?? typeHintKeyword(fileName, subject);

  // Candidats : le n° structuré d'abord, puis ceux extraits.
  const nums: number[] = [];
  if (parsed.num) nums.push(parseInt(parsed.num, 10));
  for (const n of candidateNumbers(fileName, subject)) if (!nums.includes(n)) nums.push(n);

  // 1) Résolution par le miroir SAP.
  if (nums.length > 0) {
    const [invoices, orders, credits] = await Promise.all([
      prisma.sapInvoice.findMany({ where: { docNum: { in: nums } }, select: { docNum: true, docEntry: true, cardCode: true, docDate: true } }),
      prisma.sapOrder.findMany({ where: { docNum: { in: nums } }, select: { docNum: true, docEntry: true, cardCode: true, docDate: true } }),
      prisma.sapCreditNote.findMany({ where: { docNum: { in: nums } }, select: { docNum: true, docEntry: true, cardCode: true, docDate: true } }),
    ]);
    type Row = { docNum: number | null; docEntry: number; cardCode: string; docDate: Date };
    const byType: Record<KnownType, Map<number, Row>> = {
      FACTURE: new Map(invoices.filter((r) => r.docNum != null).map((r) => [r.docNum as number, r as Row])),
      BL:      new Map(orders.filter((r) => r.docNum != null).map((r) => [r.docNum as number, r as Row])),
      AVOIR:   new Map(credits.filter((r) => r.docNum != null).map((r) => [r.docNum as number, r as Row])),
    };
    const order: KnownType[] = hint
      ? [hint, ...(["FACTURE", "BL", "AVOIR"] as const).filter((t) => t !== hint)]
      : ["FACTURE", "BL", "AVOIR"];

    for (const n of nums) {
      for (const t of order) {
        const row = byType[t].get(n);
        if (row) {
          const client = row.cardCode ? await resolveClientByCode(row.cardCode) : null;
          return {
            docType: t,
            docNum: String(n),
            docEntry: row.docEntry,
            cardCode: row.cardCode,
            clientId: client,
            docDate: row.docDate,
            matched: !!client,
          };
        }
      }
    }
  }

  // 2) Repli : rattachement du client par le CODE lu en préfixe du sujet.
  if (parsed.cardCode) {
    const clientId = await resolveClientByCode(parsed.cardCode);
    if (clientId) {
      return {
        docType: hint ?? "AUTRE",
        docNum: parsed.num ?? (nums[0] != null ? String(nums[0]) : null),
        docEntry: null,
        cardCode: parsed.cardCode,
        clientId,
        docDate: null,
        matched: true,
      };
    }
  }

  // 3) Non résolu.
  return {
    docType: hint ?? "AUTRE",
    docNum: parsed.num ?? (nums[0] != null ? String(nums[0]) : null),
    docEntry: null,
    cardCode: parsed.cardCode,
    clientId: null,
    docDate: null,
    matched: false,
  };
}
