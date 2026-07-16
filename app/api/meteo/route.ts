import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const revalidate = 900; // 15 min — la météo n'a pas besoin d'être temps réel

/**
 * GET /api/meteo?q=<ville> → { ok, city, temp, code, wind, days }
 *
 * Météo d'une ZONE (ville), pour le bandeau d'accueil (MeteoBar).
 * Source : Open-Meteo (gratuit, sans clé). Deux appels enchaînés :
 *   1. géocodage de la ville → latitude/longitude ;
 *   2. relevé courant (température, code temps WMO, vent) + PRÉVISION 7 JOURS
 *      (température moyenne + code temps par jour, timezone de la ville —
 *      `days[0]` = aujourd'hui).
 * Les réponses amont sont mises en cache 15 min (revalidate). Tout échec est
 * avalé → { ok:false } : le bandeau se masque de lui-même, l'accueil ne casse pas.
 *
 * NB : le mapping code WMO → libellé + icône est fait côté client (MeteoBar),
 * pour rester au plus près des icônes lucide et de la langue FR.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ ok: false, error: "Zone manquante" });

  try {
    // 1. Géocodage ville → coordonnées.
    const geoUrl =
      "https://geocoding-api.open-meteo.com/v1/search" +
      `?name=${encodeURIComponent(q)}&count=1&language=fr&format=json`;
    const geoRes = await fetch(geoUrl, { next: { revalidate } });
    if (!geoRes.ok) throw new Error(`geocode ${geoRes.status}`);
    const geo = await geoRes.json();
    const place = geo?.results?.[0];
    if (!place?.latitude || !place?.longitude) {
      return NextResponse.json({ ok: false, error: "Zone introuvable" });
    }

    // 2. Relevé courant + prévision 7 jours (moyenne journalière, avec repli
    //    (max+min)/2 si la moyenne manque sur un jour).
    const wUrl =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${place.latitude}&longitude=${place.longitude}` +
      "&current=temperature_2m,weather_code,wind_speed_10m" +
      "&daily=weather_code,temperature_2m_mean,temperature_2m_max,temperature_2m_min" +
      "&forecast_days=7&timezone=auto";
    const wRes = await fetch(wUrl, { next: { revalidate } });
    if (!wRes.ok) throw new Error(`forecast ${wRes.status}`);
    const w = await wRes.json();
    const cur = w?.current;
    if (!cur || cur.temperature_2m == null) {
      return NextResponse.json({ ok: false, error: "Relevé indisponible" });
    }

    const d = w?.daily ?? {};
    const days = ((d.time ?? []) as string[])
      .map((date, i) => {
        const mean = d.temperature_2m_mean?.[i];
        const max = d.temperature_2m_max?.[i];
        const min = d.temperature_2m_min?.[i];
        const t = mean ?? (max != null && min != null ? (max + min) / 2 : null);
        if (t == null) return null;
        return { date, temp: Math.round(Number(t)), code: Number(d.weather_code?.[i] ?? 0) };
      })
      .filter(Boolean);

    return NextResponse.json({
      ok: true,
      city: place.name as string,
      temp: Math.round(Number(cur.temperature_2m)),
      code: Number(cur.weather_code ?? 0),
      wind: Math.round(Number(cur.wind_speed_10m ?? 0)),
      days,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Erreur météo" });
  }
}
