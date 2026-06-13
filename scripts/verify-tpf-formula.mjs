/** Simule le calcul TPF du route /api/sap/orders pour la commande de #24011201. */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Lignes exactes du BL #24011201 (= reproduit #24011199)
const lines = [
  { itemCode: "FE1SL",     quantity: 40,  price: 5.80 },
  { itemCode: "FRAMB12PD", quantity: 12,  price: 2.30 },
  { itemCode: "K100",      quantity: 104, price: 1.05 },
];

// U_Taux SAP réels (déjà confirmés par probe AdditionalExpenses)
const ITFEL_TAUX = 0.21;     // %
const DDG_TAUX   = 0.02;     // € / colis

const prods = await prisma.product.findMany({
  where: { itemCode: { in: lines.map((l) => l.itemCode) } },
  select: { itemCode: true, salesQtyPerPackUnit: true, salesUnitWeight: true, salesUnit: true },
});
const map = new Map(prods.map((p) => [p.itemCode, p]));

let totalITFEL = 0, totalDDG = 0;
console.log(`${"Item".padEnd(12)} | qty | packDiv | nbColis | LineHT  | ITFEL (0.21%) | DDG (0.02/colis)`);
console.log("-".repeat(95));
for (const l of lines) {
  const meta = map.get(l.itemCode);
  const packDiv = (meta?.salesQtyPerPackUnit && meta.salesQtyPerPackUnit > 1) ? meta.salesQtyPerPackUnit : 1;
  const nbColis = l.quantity / packDiv;
  const lineHT  = l.price * l.quantity;
  const itfel = Math.round(lineHT * (ITFEL_TAUX / 100) * 100) / 100;
  const ddg   = Math.round(nbColis * DDG_TAUX * 100) / 100;
  totalITFEL += itfel; totalDDG += ddg;
  console.log(`${l.itemCode.padEnd(12)} | ${String(l.quantity).padStart(3)} | ${String(packDiv).padStart(7)} | ${String(nbColis).padStart(7)} | ${lineHT.toFixed(2).padStart(7)} | ${itfel.toFixed(2).padStart(13)} | ${ddg.toFixed(2)}`);
}
console.log("-".repeat(95));
console.log(`${" ".repeat(43)}TOTAL : ${"INTERFEL=" + totalITFEL.toFixed(2) + " €"} | DDG=${totalDDG.toFixed(2)} €`);
console.log(`${" ".repeat(50)}TPF total = ${(totalITFEL + totalDDG).toFixed(2)} €`);
console.log(`\nAttendu ORDELION (après recalc) : 1.62 €`);
console.log(`Match : ${(totalITFEL + totalDDG).toFixed(2) === "1.62" ? "✅ OK" : "❌ ÉCART"}`);

await prisma.$disconnect();
