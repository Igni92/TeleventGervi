import { prisma } from "@/lib/prisma";

/**
 * Recalcule la DATE D'ENTRÉE d'un salarié = date de début du PLUS ANCIEN contrat.
 * Règle métier : l'embauche correspond au premier contrat effectué (ex. un CDD
 * suivi d'un CDI → entrée = début du CDD). À appeler après toute création /
 * modification / suppression de contrat. Sans contrat, l'entrée est laissée telle
 * quelle (saisie manuelle possible avant le 1er contrat).
 */
export async function syncHireDate(employeeId: string): Promise<void> {
  const first = await prisma.contract.findFirst({
    where: { employeeId },
    orderBy: { dateDebut: "asc" },
    select: { dateDebut: true },
  });
  if (!first) return;
  await prisma.employee.update({ where: { id: employeeId }, data: { hireDate: first.dateDebut } });
}
