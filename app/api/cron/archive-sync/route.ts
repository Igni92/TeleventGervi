import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cronAuth";
import { prisma } from "@/lib/prisma";
import { getArchiveSettings } from "@/lib/integrationSettings";
import {
  listMailboxMessagesWithAttachments,
  listMessageFileAttachments,
  getAttachmentBase64,
  deleteMailboxMessage,
} from "@/lib/graph";
import { matchDocument } from "@/lib/archive/match";
import { savePdf } from "@/lib/archive/storage";

/**
 * Synchro de la boîte partagée factures-archive@ → archive locale des PDF.
 *
 * Idempotent : dédup par (graphMessageId, graphAttachmentId). Fenêtre = depuis la
 * dernière synchro (chevauchement 1 j) ou 60 j au 1er passage. Ne fait RIEN tant
 * que l'archive n'est pas activée (Paramètres) — à activer une fois la permission
 * d'application Mail.Read accordée sur la boîte.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const LAST_SYNC_KEY = "archive:lastSync";
const MAX_STORE_BYTES = 25 * 1024 * 1024; // 25 Mo/fichier (garde-fou mémoire)

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const settings = await getArchiveSettings();
  if (!settings.enabled) {
    return NextResponse.json({
      ok: true,
      skipped: "archive désactivée — activer dans Paramètres → Intégrations une fois Mail.Read accordée",
    });
  }

  // Fenêtre de récupération.
  const lastRow = await prisma.appSetting.findUnique({ where: { key: LAST_SYNC_KEY } }).catch(() => null);
  const since = new Date();
  const lastMs = lastRow?.value ? Date.parse(lastRow.value) : NaN;
  if (Number.isFinite(lastMs)) {
    since.setTime(lastMs);
    since.setDate(since.getDate() - 1); // chevauchement de sécurité
  } else {
    since.setDate(since.getDate() - 60);
  }
  const sinceISO = since.toISOString();

  let examines = 0, neuf = 0, doublons = 0, nonResolus = 0, erreurs = 0, supprimes = 0;

  try {
    const messages = await listMailboxMessagesWithAttachments(settings.mailbox, sinceISO);
    for (const m of messages) {
      let atts;
      try {
        atts = await listMessageFileAttachments(settings.mailbox, m.id);
      } catch {
        erreurs++;
        continue;
      }
      // Suivi par MESSAGE : on ne supprime le mail que si TOUS ses PDF sont
      // traités (archivés ou déjà présents) et qu'aucun n'a échoué.
      let msgPdf = 0, msgOk = 0;
      for (const a of atts) {
        const isPdf = a.isFile && ((a.contentType ?? "").toLowerCase().includes("pdf") || /\.pdf$/i.test(a.name));
        if (!isPdf) continue;
        examines++;
        msgPdf++;

        const exists = await prisma.archivedDocument
          .findUnique({
            where: { graphMessageId_graphAttachmentId: { graphMessageId: m.id, graphAttachmentId: a.id } },
            select: { id: true },
          })
          .catch(() => null);
        if (exists) { doublons++; msgOk++; continue; }

        try {
          const b64 = await getAttachmentBase64(settings.mailbox, m.id, a.id);
          const buffer = Buffer.from(b64, "base64");
          if (buffer.length === 0 || buffer.length > MAX_STORE_BYTES) { erreurs++; continue; }

          const match = await matchDocument(a.name, m.subject ?? "");
          const saved = await savePdf({
            cardCode: match.cardCode,
            docType: match.docType,
            docNum: match.docNum,
            buffer,
            uniqueKey: `${m.id}:${a.id}`,
          });

          await prisma.archivedDocument.create({
            data: {
              docType: match.docType,
              docNum: match.docNum,
              docEntry: match.docEntry,
              cardCode: match.cardCode,
              clientId: match.clientId,
              docDate: match.docDate,
              matched: match.matched,
              fileName: a.name,
              filePath: saved.relPath,
              sizeBytes: saved.sizeBytes,
              graphMessageId: m.id,
              graphAttachmentId: a.id,
              mailSubject: m.subject ?? null,
              receivedAt: new Date(m.receivedDateTime),
            },
          });
          neuf++;
          msgOk++;
          if (!match.matched) nonResolus++;
        } catch {
          erreurs++;
        }
      }

      // Vider la boîte : suppression du mail une fois TOUS ses PDF traités.
      // (Si la suppression échoue, le mail reste et sera retenté — la dédup
      // évite tout ré-archivage.)
      if (settings.deleteAfter && msgPdf > 0 && msgOk === msgPdf) {
        try {
          await deleteMailboxMessage(settings.mailbox, m.id);
          supprimes++;
        } catch {
          erreurs++;
        }
      }
    }

    // Avance le curseur (les chevauchements sont couverts par la dédup).
    const nowISO = new Date().toISOString();
    await prisma.appSetting.upsert({
      where: { key: LAST_SYNC_KEY },
      update: { value: nowISO },
      create: { key: LAST_SYNC_KEY, value: nowISO },
    });

    return NextResponse.json({ ok: true, examines, neuf, doublons, nonResolus, supprimes, erreurs });
  } catch (e) {
    // Échec dur (souvent : Mail.ReadWrite non accordée → 403). Visible dans l'état des crons.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), examines, neuf, doublons, nonResolus, supprimes, erreurs },
      { status: 500 },
    );
  }
}
