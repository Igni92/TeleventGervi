import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
// Sélectionne un pool varié : différents packDivisor, unités, poids, avec stock
const prods = await prisma.product.findMany({
  where: { isPackaging: false, stocks: { some: { available: { gt: 0 } } } },
  select: {
    itemCode: true, itemName: true, groupName: true,
    salesUnit: true, salesPackagingUnit: true, salesQtyPerPackUnit: true, salesUnitWeight: true,
    stocks: { select: { warehouse: true, available: true, inStock: true, committed: true } },
  },
  take: 400,
});
// Catégorise
const kgItems = prods.filter(p => (p.salesQtyPerPackUnit ?? 1) <= 1 && /kg|kilo/i.test(p.salesUnit ?? ""));
const colisItems = prods.filter(p => (p.salesQtyPerPackUnit ?? 1) > 1);
const pieItems = prods.filter(p => (p.salesQtyPerPackUnit ?? 1) <= 1 && !/kg/i.test(p.salesUnit ?? ""));
const multiWhs = prods.filter(p => p.stocks.filter(s => s.available > 0).length >= 2);
console.log("Total avec stock:", prods.length);
console.log("  kg:", kgItems.length, "| colis(pack>1):", colisItems.length, "| pie/autre:", pieItems.length);
console.log("  multi-entrepôt (≥2 whs dispo):", multiWhs.length);
const show = (arr, n=6) => arr.slice(0,n).forEach(p => {
  const st = p.stocks.filter(s=>s.available>0).map(s=>`${s.warehouse}:${s.available}`).join(" ");
  console.log(`   ${p.itemCode.padEnd(12)} pack=${p.salesQtyPerPackUnit} unit=${p.salesUnit} w=${p.salesUnitWeight} | ${st}`);
});
console.log("\n-- kg --"); show(kgItems);
console.log("-- colis --"); show(colisItems);
console.log("-- pie --"); show(pieItems);
console.log("-- multi-whs --"); show(multiWhs, 10);
await prisma.$disconnect();
