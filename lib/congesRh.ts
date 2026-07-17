/**
 * CONGÉS — persistance AppSetting (`rhconge:<email>:<id>`). Séparé de lib/conges
 * (pur, client-safe) pour ne pas embarquer Prisma dans le bundle client.
 */
import { prisma } from "./prisma";
import { parseConge, type CongeRequest } from "./conges";

const PREFIX = "rhconge:";
const emailKey = (e: string) => e.trim().toLowerCase();
const keyOf = (email: string, id: string) => `${PREFIX}${emailKey(email)}:${id}`;

export async function saveConge(c: CongeRequest): Promise<CongeRequest> {
  const clean = parseConge(c, c.email, c.id);
  const key = keyOf(clean.email, clean.id);
  const value = JSON.stringify(clean);
  await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  return clean;
}

export async function getConge(email: string, id: string): Promise<CongeRequest | null> {
  if (!email || !id) return null;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: keyOf(email, id) } });
    return row ? parseConge(JSON.parse(row.value) as Partial<CongeRequest>, email, id) : null;
  } catch {
    return null;
  }
}

function parseRow(key: string, value: string): CongeRequest | null {
  const rest = key.slice(PREFIX.length);
  const i = rest.lastIndexOf(":");
  if (i <= 0) return null;
  const email = rest.slice(0, i);
  const id = rest.slice(i + 1);
  try { return parseConge(JSON.parse(value) as Partial<CongeRequest>, email, id); } catch { return null; }
}

/** Demandes d'UN salarié, plus récentes d'abord. */
export async function listUserConges(email: string): Promise<CongeRequest[]> {
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: `${PREFIX}${emailKey(email)}:` } } });
    return rows.map((r) => parseRow(r.key, r.value)).filter((c): c is CongeRequest => !!c)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch { return []; }
}

/** TOUTES les demandes (direction), plus récentes d'abord. */
export async function listAllConges(): Promise<CongeRequest[]> {
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: PREFIX } } });
    return rows.map((r) => parseRow(r.key, r.value)).filter((c): c is CongeRequest => !!c)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch { return []; }
}

/* ── JUSTIFICATIF (arrêt maladie) : le FICHIER (data-URL base64) vit à part du
      congé — clé `congejustif:<email>:<id>` — pour ne pas alourdir les listes
      (listAllConges scanne tous les congés ; on ne veut pas y charger les PDF). ── */

const JUSTIF_PREFIX = "congejustif:";
const justifKey = (email: string, id: string) => `${JUSTIF_PREFIX}${emailKey(email)}:${id}`;

export async function saveCongeJustificatif(email: string, id: string, dataUrl: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: justifKey(email, id) },
    update: { value: dataUrl },
    create: { key: justifKey(email, id), value: dataUrl },
  });
}

export async function getCongeJustificatif(email: string, id: string): Promise<string | null> {
  if (!email || !id) return null;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: justifKey(email, id) } });
    return row?.value ?? null;
  } catch {
    return null;
  }
}
