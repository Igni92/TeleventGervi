import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getRelanceEmailSettings, getSapCredentialOverride, getArchiveSettings, INTEGRATION_KEYS } from "@/lib/integrationSettings";

/**
 * GET / PATCH /api/admin/integration-settings — réglages d'intégration
 * modifiables (Paramètres → Administration), réservés admin.
 *
 *   • Envoi des relances : boîte expéditrice, destinataire de TEST, mode live.
 *   • Identifiants SAP référents : utilisateur + mot de passe (surcharge de l'env).
 *
 * Le mot de passe SAP n'est JAMAIS renvoyé (on expose seulement s'il est défini).
 * Une valeur VIDE efface la surcharge (retour aux identifiants d'environnement).
 */
export const dynamic = "force-dynamic";

async function currentState() {
  const email = await getRelanceEmailSettings();
  const sap = await getSapCredentialOverride();
  const archive = await getArchiveSettings();
  return {
    from: email.from,
    testRecipient: email.testRecipient,
    live: email.live,
    // Utilisateur SAP effectif : surcharge si définie, sinon l'utilisateur d'env (GERMM).
    sapUser: sap.user ?? process.env.SAP_B1_USERNAME ?? "",
    sapUserIsOverride: sap.user != null,
    sapPassIsSet: sap.pass != null,
    // Archive documents
    archiveEnabled: archive.enabled,
    archiveMailbox: archive.mailbox,
    archiveEmailSubject: archive.subjectTemplate,
    archiveEmailBody: archive.bodyTemplate,
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé à la direction / aux administrateurs" }, { status: 403 });
  }
  return NextResponse.json({ ok: true, ...(await currentState()) });
}

const PatchSchema = z.object({
  from: z.string().trim().email("Email expéditeur invalide").or(z.literal("")).optional(),
  testRecipient: z.string().trim().email("Email de test invalide").or(z.literal("")).optional(),
  live: z.boolean().optional(),
  sapUser: z.string().trim().max(100).optional(),
  sapPass: z.string().max(200).optional(),
  archiveEnabled: z.boolean().optional(),
  archiveMailbox: z.string().trim().email("Boîte d'archive invalide").or(z.literal("")).optional(),
  archiveEmailSubject: z.string().max(300).optional(),
  archiveEmailBody: z.string().max(4000).optional(),
});

/** Upsert (valeur non vide) ou suppression (valeur vide) d'une clé AppSetting. */
async function setOrClear(key: string, value: string) {
  if (value === "") {
    await prisma.appSetting.deleteMany({ where: { key } });
  } else {
    await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (!(await requireAdmin(session))) {
    return NextResponse.json({ error: "Réservé à la direction / aux administrateurs" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  if (d.from !== undefined) await setOrClear(INTEGRATION_KEYS.from, d.from);
  if (d.testRecipient !== undefined) await setOrClear(INTEGRATION_KEYS.testRecipient, d.testRecipient);
  if (d.live !== undefined) await setOrClear(INTEGRATION_KEYS.live, d.live ? "1" : "0");
  if (d.sapUser !== undefined) await setOrClear(INTEGRATION_KEYS.sapUser, d.sapUser);
  // Mot de passe : n'écrase que si une valeur est fournie ; "" = effacer la surcharge.
  if (d.sapPass !== undefined) await setOrClear(INTEGRATION_KEYS.sapPass, d.sapPass);
  if (d.archiveEnabled !== undefined) await setOrClear(INTEGRATION_KEYS.archiveEnabled, d.archiveEnabled ? "1" : "0");
  if (d.archiveMailbox !== undefined) await setOrClear(INTEGRATION_KEYS.archiveMailbox, d.archiveMailbox);
  if (d.archiveEmailSubject !== undefined) await setOrClear(INTEGRATION_KEYS.archiveEmailSubject, d.archiveEmailSubject);
  if (d.archiveEmailBody !== undefined) await setOrClear(INTEGRATION_KEYS.archiveEmailBody, d.archiveEmailBody);

  return NextResponse.json({ ok: true, ...(await currentState()) });
}
