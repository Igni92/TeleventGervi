import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ArrowLeft, Hash, Package, Link2, Boxes } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ArticleFiche } from "@/components/articles/ArticleFiche";
import { requirePreparateurOrAdmin } from "@/lib/permissions";

export async function generateMetadata(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const p = await prisma.product.findUnique({ where: { id: params.id }, select: { itemName: true } });
  return { title: p ? `${p.itemName} | Article` : "Article | Gervi" };
}

export default async function ArticleDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) redirect("/login");
  const canEdit = await requirePreparateurOrAdmin(session);

  const product = await prisma.product.findUnique({
    where: { id: params.id },
    select: { id: true, itemCode: true, itemName: true, itemGroup: true, groupName: true, manageBatch: true },
  });
  if (!product) notFound();

  return (
    <div className="max-w-[1100px] space-y-5">
      {/* Fil d'Ariane */}
      <div className="flex items-center gap-3">
        <Link href="/articles" className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Articles
        </Link>
      </div>

      {/* En-tête */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="flex items-start gap-4 min-w-0">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-500/12 text-brand-600 ring-1 ring-brand-500/20 dark:text-brand-400">
            <Package className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[22px] sm:text-[26px] font-bold text-foreground tracking-tight leading-tight">
              {product.itemName}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 font-mono text-[12px] text-muted-foreground">
                <Hash className="h-3 w-3" /> {product.itemCode}
              </span>
              {product.groupName && (
                <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
                  <Boxes className="h-3 w-3" /> {product.groupName}
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/12 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300">
                <Link2 className="h-3 w-3" /> SAP
              </span>
              {product.manageBatch && <Badge variant="secondary">Géré par lots</Badge>}
            </div>
          </div>
        </div>
      </div>

      <ArticleFiche id={product.id} canEdit={canEdit} />
    </div>
  );
}
