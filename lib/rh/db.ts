/**
 * Accès données RH V2 (serveur) — badgeuse + espace salarié. S'appuie sur les
 * nouvelles tables relationnelles (Employee, RhTimeClock, RhTimePunch, …).
 */
import { prisma } from "@/lib/prisma";
import { punchesToMinutes, type Punch } from "@/lib/rh/time";

/** Employé courant depuis la session (par email). Crée un Employee minimal si le
 *  compte connecté n'en a pas encore (self-onboarding léger). */
export async function getOrCreateEmployeeByEmail(email: string, name?: string | null): Promise<{ id: string; email: string }> {
  const e = email.trim().toLowerCase();
  const found = await prisma.employee.findUnique({ where: { email: e }, select: { id: true, email: true } });
  if (found) return found;
  const user = await prisma.user.findFirst({ where: { email: { equals: e, mode: "insensitive" } }, select: { id: true, name: true } });
  return prisma.employee.create({
    data: { email: e, userId: user?.id ?? null, displayName: name ?? user?.name ?? null, statutEmploi: "actif" },
    select: { id: true, email: true },
  });
}

/** Jour UTC (00:00) d'une date locale ISO "YYYY-MM-DD" ou d'un Date. */
function dayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Pointage courant de l'employé aujourd'hui + minutes calculées + état (dedans/dehors). */
export async function getTodayClock(employeeId: string, now = new Date()) {
  const date = dayStart(now);
  const clock = await prisma.rhTimeClock.findUnique({
    where: { employeeId_date: { employeeId, date } },
    include: { punches: { orderBy: { at: "asc" } } },
  });
  const punches: Punch[] = (clock?.punches ?? []).map((p) => ({ kind: p.kind as "in" | "out", at: p.at }));
  const last = punches[punches.length - 1];
  const inside = last?.kind === "in"; // dernier pointage = arrivée → actuellement au travail
  // Minutes travaillées (les paires closes ; le « in » ouvert compte jusqu'à maintenant).
  const closed = punchesToMinutes(punches, clock?.pauseMin ?? 0);
  const openExtra = inside ? Math.max(0, Math.round((now.getTime() - new Date(last.at).getTime()) / 60000)) : 0;
  return {
    date,
    clock,
    punches: (clock?.punches ?? []).map((p) => ({ kind: p.kind, at: p.at, lat: p.lat, lng: p.lng })),
    inside,
    workedMin: closed + openExtra,
    workedMinClosed: closed,
  };
}

/** Ajoute un pointage (arrivée/départ) géolocalisé et met à jour les minutes du jour. */
export async function addPunch(
  employeeId: string,
  kind: "in" | "out",
  geo: { lat?: number; lng?: number; accuracyM?: number } = {},
  now = new Date(),
): Promise<{ inside: boolean; workedMin: number }> {
  const date = dayStart(now);
  const clock = await prisma.rhTimeClock.upsert({
    where: { employeeId_date: { employeeId, date } },
    create: { employeeId, date, statut: "ouvert", source: "badge" },
    update: {},
    include: { punches: { orderBy: { at: "asc" } } },
  });
  await prisma.rhTimePunch.create({
    data: { timeClockId: clock.id, kind, at: now, lat: geo.lat ?? null, lng: geo.lng ?? null, accuracyM: geo.accuracyM ?? null, source: "badge" },
  });
  // Recalcule les minutes closes et les persiste sur la journée.
  const fresh = await prisma.rhTimePunch.findMany({ where: { timeClockId: clock.id }, orderBy: { at: "asc" } });
  const min = punchesToMinutes(fresh.map((p) => ({ kind: p.kind as "in" | "out", at: p.at })), clock.pauseMin);
  await prisma.rhTimeClock.update({ where: { id: clock.id }, data: { heuresMin: min } });
  const last = fresh[fresh.length - 1];
  return { inside: last?.kind === "in", workedMin: min };
}
