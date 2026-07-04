"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  Home, Radio, ClipboardList, Users, Package, PackagePlus, PackageCheck, Factory, Truck,
  LayoutDashboard, Receipt, Briefcase, Settings, Search, CornerDownLeft, Store, ShoppingCart,
  ClipboardCheck,
} from "lucide-react";

interface NavItem { href: string; label: string; icon: typeof Home; keywords?: string }
const NAV: NavItem[] = [
  { href: "/accueil", label: "Accueil", icon: Home },
  { href: "/console", label: "Console d'appels", icon: Radio, keywords: "commande bl vente télévente" },
  { href: "/console2", label: "Console 2 · Commande", icon: ShoppingCart, keywords: "bl bon livraison mobile saisie commande" },
  { href: "/clients", label: "Clients", icon: Users, keywords: "base contacts" },
  { href: "/plan-appel", label: "Plan d'appel", icon: ClipboardList, keywords: "televente appels clients" },
  { href: "/ventes-du-jour", label: "Ventes du jour", icon: Store, keywords: "ventes préparation livraison magasin mise en prep" },
  { href: "/livraisons", label: "Préparation livraisons", icon: Truck, keywords: "détail livraison bons transporteur tournée manquants" },
  { href: "/products", label: "Stock", icon: Package, keywords: "produits articles" },
  { href: "/inventaire", label: "Inventaire", icon: ClipboardCheck, keywords: "comptage stock entrepôt" },
  { href: "/commandes-fournisseurs", label: "Commandes fournisseurs", icon: PackageCheck, keywords: "achat fournisseur cf réception" },
  { href: "/entrees", label: "Entrées marchandises", icon: PackagePlus, keywords: "réception marchandise em agréage réserve" },
  { href: "/fabrication", label: "Fabrication", icon: Factory, keywords: "production deco kit" },
  { href: "/dashboard", label: "Statistiques · Carte", icon: LayoutDashboard, keywords: "pilotage dashboard géo carte stats" },
  { href: "/encours", label: "Encours clients", icon: Receipt, keywords: "factures impayés" },
  { href: "/commerciaux", label: "Équipe commerciale", icon: Briefcase, keywords: "commerciaux objectifs slp équipe personnel préparateur rôles effectifs" },
  { href: "/parametres", label: "Paramètres", icon: Settings, keywords: "réglages sap import thème" },
];

interface ClientHit { id: string; nom: string; code: string; type?: string | null }

/**
 * Palette de commandes ⌘K / Ctrl+K — navigation instantanée + recherche clients.
 * Montée globalement (cf. app/providers). Façon Linear/Raycast.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [clients, setClients] = useState<ClientHit[]>([]);

  // Raccourci global ⌘K / Ctrl+K (et fermeture Échap).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { if (!open) setQ(""); }, [open]);

  // Recherche clients live (debounce) dès 2 caractères.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setClients([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/clients?search=${encodeURIComponent(term)}&limit=8`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => setClients(Array.isArray(j?.clients) ? j.clients : []))
        .catch(() => {});
    }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  const go = (href: string) => { setOpen(false); router.push(href); };

  if (!open) return null;

  const ql = q.toLowerCase();
  const navShown = NAV.filter((n) => !ql || n.label.toLowerCase().includes(ql) || (n.keywords ?? "").includes(ql));

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/55 backdrop-blur-sm p-4 pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      <Command
        shouldFilter={false}
        label="Palette de commandes"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-2xl border border-border bg-popover shadow-modal overflow-hidden"
      >
        <div className="flex items-center gap-2 px-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Command.Input
            autoFocus
            value={q}
            onValueChange={setQ}
            placeholder="Rechercher une page, un client…"
            className="flex-1 h-12 bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground outline-none"
          />
          <kbd className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        <Command.List className="max-h-[60vh] overflow-y-auto p-2">
          <Command.Empty className="py-6 text-center text-[12.5px] text-muted-foreground">
            Aucun résultat.
          </Command.Empty>

          {navShown.length > 0 && (
            <Command.Group heading="Aller à" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-muted-foreground">
              {navShown.map((n) => {
                const Icon = n.icon;
                return (
                  <Command.Item
                    key={n.href}
                    value={`nav:${n.href}`}
                    onSelect={() => go(n.href)}
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-foreground/85 cursor-pointer data-[selected=true]:bg-secondary data-[selected=true]:text-foreground"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {n.label}
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}

          {clients.length > 0 && (
            <Command.Group heading="Clients" className="mt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-muted-foreground">
              {clients.map((c) => (
                <Command.Item
                  key={c.id}
                  value={`client:${c.id}`}
                  onSelect={() => go(`/clients/${c.id}`)}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-foreground/85 cursor-pointer data-[selected=true]:bg-secondary data-[selected=true]:text-foreground"
                >
                  <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate flex-1">{c.nom}</span>
                  <span className="text-[10.5px] text-muted-foreground shrink-0">{c.code}{c.type ? ` · ${c.type}` : ""}</span>
                  <CornerDownLeft className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
