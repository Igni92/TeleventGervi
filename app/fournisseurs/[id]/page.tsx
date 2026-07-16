import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ArrowLeft, Hash, Truck, Link2, Factory } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/clients/SectionCard";
import { SupplierForm } from "@/components/suppliers/SupplierForm";
import { SupplierContactsEditor } from "@/components/suppliers/SupplierContactsEditor";
import { SupplierActions } from "@/components/suppliers/SupplierActions";
import { requirePreparateurOrAdmin } from "@/lib/permissions";

export async function generateMetadata(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supplier = await prisma.supplier.findUnique({
    where: { id: params.id },
    select: { nom: true },
  });
  return { title: supplier ? `${supplier.nom} | Fournisseur` : "Fournisseur | Gervi" };
}

export default async function SupplierDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();
  if (!session) redirect("/login");
  const canManage = await requirePreparateurOrAdmin(session);

  const supplier = await prisma.supplier.findUnique({ where: { id: params.id } });
  if (!supplier) notFound();

  const formData = {
    id: supplier.id,
    code: supplier.code,
    nom: supplier.nom,
    type: supplier.type || "",
    sapCardCode: supplier.sapCardCode || "",
    email: supplier.email || "",
    tel1: supplier.tel1 || "",
    tel2: supplier.tel2 || "",
    tel3: supplier.tel3 || "",
    adresse: supplier.adresse || "",
    notes: supplier.notes || "",
    active: supplier.active,
  };

  return (
    <div className="max-w-[1100px] space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/fournisseurs" className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Fournisseurs
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="flex items-start gap-4 min-w-0">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-500/12 text-brand-600 ring-1 ring-brand-500/20 dark:text-brand-400">
            <Factory className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[22px] sm:text-[26px] font-bold text-foreground tracking-tight leading-tight">
              {supplier.nom}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 font-mono text-[12px] text-muted-foreground">
                <Hash className="h-3 w-3" /> {supplier.code}
              </span>
              {supplier.type && <Badge variant="secondary">{supplier.type}</Badge>}
              {!supplier.active && <Badge variant="annule">Archivé</Badge>}
              {supplier.sapCardCode && (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/12 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300">
                  <Link2 className="h-3 w-3" /> SAP · {supplier.sapCardCode}
                </span>
              )}
            </div>
          </div>
        </div>
        <SupplierActions supplierId={supplier.id} active={supplier.active} canManage={canManage} />
      </div>

      {/* Corps : infos + interlocuteurs */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SectionCard
          accent="brand"
          title="Informations fournisseur"
          subtitle="Coordonnées · famille d'achat · rattachement SAP"
          icon={<Truck />}
          className="lg:col-span-2"
        >
          <SupplierForm initialData={formData} mode="edit" />
        </SectionCard>

        <SectionCard bare className="lg:col-span-2">
          <SupplierContactsEditor supplierId={supplier.id} />
        </SectionCard>
      </div>
    </div>
  );
}
