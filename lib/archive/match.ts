/**
 * Rattachement d'un PDF archivé à un document SAP + un client — TOLÉRANT au
 * format de nommage. On lit le n° de document dans le NOM DE FICHIER (puis
 * l'objet du mail), et on le résout sur le miroir SAP (source de vérité) :
 *   SapInvoice   → FACTURE
 *   SapOrder     → BL        (les Orders SAP SONT les bons de livraison ici)
 *   SapCreditNote→ AVOIR
 * Le type SAP qui matche prime sur le mot-clé du nom ; le mot-clé ne sert qu'à
 * prioriser et à typer les non-résolus.
 */
import { prisma } from "@/lib/prisma";

export type DocType = "BL" | "FACTURE" | "AVOIR" | "AUTRE";

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

/** Devine le type à partir des mots-clés (nom prioritaire sur objet). */
function typeHint(fileName: string, subject: string): DocType | null {
  const s = strip(`${fileName} ${fileName} ${subject}`); // nom compté double
  if (/\bavoir\b|\bav\b|credit/.test(s)) return "AVOIR";
  if (/facture|invoice|\bfac?\b|\bfc\b/.test(s)) return "FACTURE";
  if (/\bbl\b|bon de livraison|livraison|delivery/.test(s)) return "BL";
  return null;
}

/** Extrait les n° candidats (suites de ≥3 chiffres), nom d'abord. */
function candidates(fileName: string, subject: string): number[] {
  const grab = (s: string) => (s.match(/\d{3,}/g) ?? []).map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n));
  const seen = new Set<number>();
  const out: number[] = [];
  for (const n of [...grab(fileName), ...grab(subject)]) {
    if (!seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out.slice(0, 12);
}

export async function matchDocument(fileName: string, subject: string): Promise<MatchResult> {
  const hint = typeHint(fileName, subject);
  const nums = candidates(fileName, subject);

  if (nums.length > 0) {
    // 1 requête par table sur l'ensemble des candidats.
    const [invoices, orders, credits] = await Promise.all([
      prisma.sapInvoice.findMany({ where: { docNum: { in: nums } }, select: { docNum: true, docEntry: true, cardCode: true, docDate: true } }),
      prisma.sapOrder.findMany({ where: { docNum: { in: nums } }, select: { docNum: true, docEntry: true, cardCode: true, docDate: true } }),
      prisma.sapCreditNote.findMany({ where: { docNum: { in: nums } }, select: { docNum: true, docEntry: true, cardCode: true, docDate: true } }),
    ]);
    type Row = { docNum: number | null; docEntry: number; cardCode: string; docDate: Date };
    const byType: Record<Exclude<DocType, "AUTRE">, Map<number, Row>> = {
      FACTURE: new Map(invoices.filter((r) => r.docNum != null).map((r) => [r.docNum as number, r as Row])),
      BL:      new Map(orders.filter((r) => r.docNum != null).map((r) => [r.docNum as number, r as Row])),
      AVOIR:   new Map(credits.filter((r) => r.docNum != null).map((r) => [r.docNum as number, r as Row])),
    };
    // Ordre d'essai des types : l'indice d'abord, puis les autres.
    const order: Exclude<DocType, "AUTRE">[] = hint && hint !== "AUTRE"
      ? [hint, ...(["FACTURE", "BL", "AVOIR"] as const).filter((t) => t !== hint)]
      : ["FACTURE", "BL", "AVOIR"];

    for (const n of nums) {
      for (const t of order) {
        const row = byType[t].get(n);
        if (row) {
          const client = row.cardCode
            ? await prisma.client.findUnique({ where: { code: row.cardCode }, select: { id: true } }).catch(() => null)
            : null;
          return {
            docType: t,
            docNum: String(n),
            docEntry: row.docEntry,
            cardCode: row.cardCode,
            clientId: client?.id ?? null,
            docDate: row.docDate,
            matched: !!client?.id,
          };
        }
      }
    }
  }

  // Aucun match miroir → non résolu, typé au mieux par le mot-clé.
  return {
    docType: hint ?? "AUTRE",
    docNum: nums[0] != null ? String(nums[0]) : null,
    docEntry: null,
    cardCode: null,
    clientId: null,
    docDate: null,
    matched: false,
  };
}
