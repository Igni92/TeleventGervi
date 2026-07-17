import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isDirection } from "@/lib/permissions";
import { getCongeJustificatif } from "@/lib/congesRh";

export const dynamic = "force-dynamic";

/**
 * JUSTIFICATIF d'un congé (arrêt maladie) — GET ?email=&id= → sert le fichier
 * (image / PDF) décodé depuis la data-URL stockée, en INLINE (ouverture dans
 * l'onglet). Accès : la DIRECTION, ou le SALARIÉ concerné (son propre arrêt).
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const me = (session.user.email ?? "").trim().toLowerCase();

  const { searchParams } = new URL(req.url);
  const email = (searchParams.get("email") ?? "").trim().toLowerCase();
  const id = (searchParams.get("id") ?? "").trim();
  if (!email || !id) return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });

  // La direction voit tout ; un salarié ne voit QUE ses propres justificatifs.
  if (email !== me && !(await isDirection(session))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const dataUrl = await getCongeJustificatif(email, id);
  if (!dataUrl) return NextResponse.json({ error: "Justificatif introuvable" }, { status: 404 });

  const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!m) return NextResponse.json({ error: "Justificatif illisible" }, { status: 500 });
  const [, mime, b64] = m;
  const buf = Buffer.from(b64, "base64");
  const ext = mime === "application/pdf" ? "pdf" : (mime.split("/")[1] || "bin");
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename="justificatif-${id}.${ext}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
