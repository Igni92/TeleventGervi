/**
 * Stockage FICHIER des PDF archivés — sur le disque du VPS. L'index (recherche,
 * métadonnées) vit en base (modèle ArchivedDocument) ; ici on ne gère que les
 * octets. Arborescence lisible :
 *
 *   <racine>/<CARDCODE|_unmatched>/<TYPE>/<docNum>_<hash>.pdf
 *
 * Racine par défaut : /srv/televent/storage/archive (surchargée par
 * ARCHIVE_STORAGE_DIR). Hors de public/ : jamais servi en statique, uniquement
 * via une route authentifiée (scope client vérifié).
 */
import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";

export function archiveRoot(): string {
  return process.env.ARCHIVE_STORAGE_DIR?.trim() || "/srv/televent/storage/archive";
}

/** Nettoie un segment de chemin (pas de séparateur, pas de « .. »). */
function safeSeg(s: string, fallback: string): string {
  const clean = (s || "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^\.+/, "").slice(0, 60);
  return clean || fallback;
}

export interface SaveResult {
  relPath: string;
  sizeBytes: number;
}

/**
 * Écrit un PDF sur disque et renvoie son chemin RELATIF (à stocker en base) +
 * sa taille réelle. `uniqueKey` (ex. graphMessageId:attachmentId) garantit un
 * nom de fichier stable et non-collisionnant (ré-import idempotent).
 */
export async function savePdf(input: {
  cardCode: string | null;
  docType: string;
  docNum: string | null;
  buffer: Buffer;
  uniqueKey: string;
}): Promise<SaveResult> {
  const dir = path.join(safeSeg(input.cardCode ?? "", "_unmatched"), safeSeg(input.docType, "AUTRE"));
  const hash = createHash("sha1").update(input.uniqueKey).digest("hex").slice(0, 8);
  const base = `${safeSeg(input.docNum ?? "", "sans-num")}_${hash}.pdf`;
  const relPath = path.join(dir, base);
  const abs = path.join(archiveRoot(), relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, input.buffer);
  return { relPath, sizeBytes: input.buffer.length };
}

/** Lit un PDF par son chemin relatif (garde-fou anti-traversée hors racine). */
export async function readPdf(relPath: string): Promise<Buffer> {
  const root = archiveRoot();
  const abs = path.resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("Chemin d'archive invalide.");
  }
  return fs.readFile(abs);
}
