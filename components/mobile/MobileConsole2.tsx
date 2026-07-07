"use client";

/**
 * CONSOLE 2 MOBILE — saisie de bon de livraison ALLÉGÉE (téléphone / tablette).
 *
 * Reprise de l'Écran 2 de la console (constructeur de commande piloté par le
 * stock) avec BEAUCOUP moins d'informations : pas de promos, pas de densité,
 * pas de mode modification. On GARDE les tags produit (marque · conditionnement
 * · origine — mêmes couleurs partout, cf. DesignationChips) sur la liste stock
 * ET sur les lignes du panier, les FAVORIS du commercial (groupe ⭐ épinglé en
 * tête + étoile par article, /api/favorites) et les TARIFS FIXES du client
 * (groupe « Tarif client » épinglé, prix négocié en violet, prioritaire au panier).
 *
 * Flux : rechercher un compte → toucher un article pour l'ajouter au panier →
 * ajuster quantités/prix → transporteur + tournée (pré-remplis, obligatoires)
 * → créer le BL (POST /api/sap/orders, mêmes garde-fous encours que l'Écran 2).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  BadgeEuro, ChevronDown, Loader2, Minus, Plus, Search, ShoppingCart, Star, Trash2, Truck, X,
} from "lucide-react";
import { splitByWarehouse, totalAvailable, unitInfo } from "@/lib/gervifrais-calc";
import { nextDeliveryDate, nextWorkingDeliveryDay, isPrecommande } from "@/lib/livraison";
import { familyOf } from "@/lib/familles";
import { priceForArticle, type TarifFruitRow } from "@/lib/tarifFruits";
import { useTourneeSelection } from "@/lib/useTourneeSelection";
import { DesignationChips } from "@/components/entrees/DesignationChips";

/* ── Types (miroir des API, mêmes formes que l'Écran 2) ────────────────── */
interface StockEntry { available: number }
interface Product {
  id: string; itemCode: string; itemName: string; groupName: string | null;
  salesUnit: string | null; salesQtyPerPackUnit: number | null;
  salesUnitWeight?: number | null; salesItemsPerUnit?: number | null;
  uMarque: string | null; uPays: string | null; uCondi: string | null; uUvc: string | null;
  frgnName?: string | null;
  stockByWarehouse: Record<string, StockEntry>;
}
interface Hint { prixConseille: number | null; calibre: string | null }
interface CartLine {
  itemCode: string; itemName: string; unit: string; priceUnit: string; packDivisor: number;
  availByWarehouse: Record<string, number>;
  quantity: number; price: number | null; stepColis: number;
  marque: string | null; condi: string | null; pays: string | null;
}
interface DeliveryMode { id: string; name: string; sapCardCode: string; isDefault: boolean }
interface SearchClient { id: string; code: string; nom: string; type: string | null }
type ApiLine = {
  itemCode: string; quantity: number; displayQuantity: number;
  displayUnit: string; warehouseCode: string; price?: number;
};

const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

const TYPE_BADGE: Record<string, string> = {
  EXPORT: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
  GMS: "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300",
  CHR: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
};

/** Groupes ÉPINGLÉS en tête de liste (mêmes principes que l'Écran 2) :
 *  ⭐ favoris du commercial et tarifs fixes (cotations) du client. */
const FAV_KEY = "__fav__";
const TARIF_KEY = "__tarif__";

/** Unités, dispo par entrepôt (en unité d'affichage), dispo totale et pas « un
 *  colis » d'un produit — même logique que l'Écran 2 (buildLine), calculée UNE
 *  fois par produit au chargement : la liste peut porter ~3000 lignes, on ne
 *  recalcule pas unitInfo/totalAvailable à chaque render. */
interface ProductDisplay {
  packDivisor: number; displayUnit: string; priceUnit: string;
  avail: Record<string, number>; dispo: number; stepColis: number;
}
function computeDisplay(p: Product): ProductDisplay {
  const { packDivisor, displayUnit, priceUnit } = unitInfo(p.salesUnit, p.salesQtyPerPackUnit);
  const avail: Record<string, number> = {};
  for (const w of ["000", "01", "R1"]) avail[w] = Math.max(0, Math.floor(((p.stockByWarehouse[w]?.available ?? 0) / packDivisor) * 10) / 10);
  // Incrément « un colis » : article vendu au kg → pas du POIDS d'un colis.
  let colisW = unitInfo(p.salesUnit, p.salesQtyPerPackUnit, p.salesItemsPerUnit ?? null, p.salesUnitWeight).colisWeightKg ?? null;
  if ((colisW == null || colisW <= 0) && displayUnit === "kg") {
    const q = p.salesQtyPerPackUnit && p.salesQtyPerPackUnit > 1 ? p.salesQtyPerPackUnit : 1;
    const w = p.salesUnitWeight && p.salesUnitWeight > 0 ? p.salesUnitWeight : 1;
    colisW = Math.round(q * w * 1000) / 1000;
  }
  const stepColis = displayUnit === "kg" ? (colisW && colisW > 0 ? Math.round(colisW * 100) / 100 : 1) : 1;
  return { packDivisor, displayUnit, priceUnit, avail, dispo: Math.round(totalAvailable(avail) * 10) / 10, stepColis };
}

export function MobileConsole2() {
  const searchParams = useSearchParams();
  const clientParam = searchParams.get("client");
  const returnTo = searchParams.get("returnTo");
  const [client, setClient] = useState<SearchClient | null>(null);

  // Pré-sélection depuis l'URL (?client=<id>) — arrivée depuis la fiche client
  // (« Commander »). On récupère le compte pour l'afficher directement.
  useEffect(() => {
    if (!clientParam || client) return;
    let cancelled = false;
    fetch(`/api/clients/${clientParam}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => { if (!cancelled && c?.id) setClient({ id: c.id, code: c.code, nom: c.nom, type: c.type ?? null }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clientParam, client]);

  return (
    <div className="space-y-4">
      <ClientPicker client={client} onPick={setClient} onClear={() => setClient(null)} />
      {client ? (
        <OrderBuilder key={client.id} client={client} returnTo={returnTo} />
      ) : (
        <p className="text-[13px] text-muted-foreground px-1">
          Recherche un compte ci-dessus pour afficher son stock et saisir un bon de livraison.
        </p>
      )}
    </div>
  );
}

/* ── Sélecteur de compte (recherche débouncée /api/clients) ─────────────── */
function ClientPicker({ client, onPick, onClear }: {
  client: SearchClient | null;
  onPick: (c: SearchClient) => void;
  onClear: () => void;
}) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = term.trim();
    if (t.length < 2) { setResults([]); setLoading(false); setOpen(false); return; }
    const my = ++seq.current;
    setLoading(true);
    const h = setTimeout(() => {
      fetch(`/api/clients?search=${encodeURIComponent(t)}&limit=8`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j: { clients?: SearchClient[] }) => {
          if (my !== seq.current) return;
          setResults(j.clients ?? []); setOpen(true);
        })
        .catch(() => { if (my === seq.current) setResults([]); })
        .finally(() => { if (my === seq.current) setLoading(false); });
    }, 250);
    return () => clearTimeout(h);
  }, [term]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  if (client) {
    return (
      <div className="panel px-3.5 py-2.5 flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-foreground truncate leading-tight">{client.nom}</p>
          <p className="text-[10.5px] font-mono tnum text-muted-foreground">{client.code}</p>
        </div>
        {client.type && (
          <span className={`shrink-0 text-[9.5px] font-bold tracking-[0.14em] uppercase px-1.5 py-0.5 rounded ${TYPE_BADGE[client.type] ?? TYPE_BADGE.CHR}`}>
            {client.type}
          </span>
        )}
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 inline-flex items-center gap-1 h-9 px-2.5 rounded-lg border border-border bg-card text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" /> Changer
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        placeholder="Rechercher un compte (nom ou code)…"
        aria-label="Rechercher un compte client"
        className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-9 text-[14px] focus:outline-none focus:ring-2 focus:ring-ring/40"
      />
      {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
          {results.length === 0 ? (
            <p className="px-3 py-2.5 text-[12.5px] text-muted-foreground">Aucun compte trouvé.</p>
          ) : (
            <ul className="max-h-[300px] overflow-y-auto py-1">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => { onPick(c); setTerm(""); setResults([]); setOpen(false); }}
                    className="w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-secondary/40 transition-colors"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-medium text-foreground truncate">{c.nom}</span>
                      <span className="block text-[10.5px] font-mono tnum text-muted-foreground">{c.code}</span>
                    </span>
                    {c.type && (
                      <span className={`shrink-0 text-[9px] font-bold tracking-wider px-1.5 py-px rounded ${TYPE_BADGE[c.type] ?? TYPE_BADGE.CHR}`}>
                        {c.type}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Constructeur de commande allégé ────────────────────────────────────── */
function OrderBuilder({ client, returnTo }: { client: SearchClient; returnTo?: string | null }) {
  const router = useRouter();
  const [grouped, setGrouped] = useState<Record<string, Product[]>>({});
  const [loading, setLoading] = useState(true);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("");
  const [hints, setHints] = useState<Record<string, Hint>>({});
  const hintsRequested = useRef<Set<string>>(new Set());
  const [tarifByCode, setTarifByCode] = useState<Map<string, number>>(new Map());
  const [cart, setCart] = useState<CartLine[]>([]);
  // Défaut = prochaine livraison POSSIBLE (J+1 / samedi → lundi, en sautant les
  // dimanches ET jours fériés).
  const [deliveryDate, setDeliveryDate] = useState(nextWorkingDeliveryDay(nextDeliveryDate()));
  // « Bon de commande » : aucun auto-lot (lots affectés ensuite). Coché à la main
  // ou forcé quand la livraison est une précommande.
  const [bonCommandeManual, setBonCommandeManual] = useState(false);
  const precommande = isPrecommande(deliveryDate);
  const isBonCommande = precommande || bonCommandeManual;
  const [numAtCard, setNumAtCard] = useState("");
  const [comments, setComments] = useState("");
  const [modes, setModes] = useState<DeliveryMode[]>([]);
  const [modeId, setModeId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const {
    carriers, carrierSap, setCarrierSap,
    tournees, tourneeId, setTourneeId,
    validateTournee, tourneePayload,
  } = useTourneeSelection(client.id);

  // Stock en date (articles en stock uniquement — pas de vente à découvert ici).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/products?limit=3000&inStock=true`)
      .then((r) => r.json())
      .then((json: { products?: Product[] }) => {
        if (cancelled) return;
        const byGroup: Record<string, Product[]> = {};
        for (const p of json.products ?? []) {
          const g = p.groupName?.trim() || "Autres";
          (byGroup[g] ||= []).push(p);
        }
        Object.values(byGroup).forEach((a) => a.sort((x, y) => x.itemName.localeCompare(y.itemName)));
        setGrouped(byGroup);
        // Mobile : groupes famille FERMÉS par défaut (écran court) — seuls les
        // groupes épinglés (⭐ Favoris, Tarif client) s'ouvrent d'office.
        setOpenGroups({ [FAV_KEY]: true, [TARIF_KEY]: true });
      })
      .catch(() => { if (!cancelled) setGrouped({}); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ── Favoris du commercial connecté (⭐) — chargés une fois, toggle optimiste. ──
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  useEffect(() => {
    fetch(`/api/favorites`).then((r) => r.json())
      .then((d) => setFavorites(new Set<string>(d?.itemCodes ?? [])))
      .catch(() => { /* favoris optionnels */ });
  }, []);
  const toggleFavorite = useCallback((itemCode: string) => {
    const wasFav = favorites.has(itemCode);
    setFavorites((prev) => {
      const next = new Set(prev);
      if (wasFav) next.delete(itemCode); else next.add(itemCode);
      return next;
    });
    const req = wasFav
      ? fetch(`/api/favorites?itemCode=${encodeURIComponent(itemCode)}`, { method: "DELETE" })
      : fetch(`/api/favorites`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemCode }),
        });
    req.then((r) => { if (!r.ok) throw new Error(); }).catch(() => {
      setFavorites((prev) => {
        const next = new Set(prev);
        if (wasFav) next.add(itemCode); else next.delete(itemCode);
        return next;
      });
      toast.error("Favori non enregistré");
    });
  }, [favorites]);

  // Cotations spécifiques du client (prix négocié prioritaire au panier).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clients/${client.id}/tarif`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { ok?: boolean; items?: { itemCode: string; price: number }[] }) => {
        if (!cancelled && j?.ok) setTarifByCode(new Map((j.items ?? []).map((t) => [t.itemCode, t.price])));
      })
      .catch(() => { /* cotations optionnelles */ });
    return () => { cancelled = true; };
  }, [client.id]);

  // Tarif PAR FRUITS du client (famille · origine · calibre · variété) — appliqué au panier.
  const [tarifFruits, setTarifFruits] = useState<TarifFruitRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clients/${client.id}/tarif-fruits`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j?.ok) setTarifFruits(j.rows ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [client.id]);

  // Adresses de livraison du client (sélecteur seulement s'il y a le choix).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clients/${client.id}/delivery-modes`)
      .then((r) => r.json())
      .then((d: { modes?: DeliveryMode[] }) => {
        if (cancelled) return;
        const ms = d.modes ?? [];
        setModes(ms);
        const def = ms.find((m) => m.isDefault) ?? ms[0];
        setModeId(def?.id ?? "");
      })
      .catch(() => { /* adresse par défaut côté serveur */ });
    return () => { cancelled = true; };
  }, [client.id]);

  /** Prix conseillés d'un lot de codes — chargés PAR GROUPE OUVERT (léger sur
   *  mobile : pas les ~3000 hints d'un coup comme sur l'Écran 2). Tranches de
   *  40 en PARALLÈLE, un seul setHints à l'arrivée (un render, pas un par tranche). */
  const loadHints = useCallback(async (codes: string[]) => {
    const fresh = codes.filter((c) => !hintsRequested.current.has(c));
    if (!fresh.length) return;
    fresh.forEach((c) => hintsRequested.current.add(c));
    const slices: string[][] = [];
    for (let i = 0; i < fresh.length; i += 40) slices.push(fresh.slice(i, i + 40));
    const parts = await Promise.all(slices.map(async (slice) => {
      try {
        const params = new URLSearchParams({ clientId: client.id, items: slice.join(",") });
        const res = await fetch(`/api/sap/prices?${params}`);
        const json = await res.json();
        return (json.prices ?? {}) as Record<string, Hint>;
      } catch { return {} as Record<string, Hint>; }   // prix optionnel
    }));
    const merged = Object.assign({}, ...parts) as Record<string, Hint>;
    if (Object.keys(merged).length) setHints((cur) => ({ ...cur, ...merged }));
  }, [client.id]);

  const toggleGroup = (g: string, prods: Product[]) => {
    setOpenGroups((cur) => ({ ...cur, [g]: !cur[g] }));
    if (!openGroups[g]) loadHints(prods.map((p) => p.itemCode));
  };

  // Affichage précalculé PAR PRODUIT (unités, dispo, pas colis) — une fois par
  // chargement du stock, partagé entre la liste et le panier.
  const displayByCode = useMemo(() => {
    const m = new Map<string, ProductDisplay>();
    for (const prods of Object.values(grouped)) for (const p of prods) m.set(p.itemCode, computeDisplay(p));
    return m;
  }, [grouped]);

  /* ── Panier ── */
  const buildLine = useCallback((p: Product): CartLine => {
    const d = displayByCode.get(p.itemCode) ?? computeDisplay(p);
    // Prix : cotation SKU exacte > tarif PAR FRUITS (désignation) > prix conseillé.
    const fruitPrice = tarifFruits.length
      ? priceForArticle(tarifFruits, {
          family: familyOf(p.itemName, p.groupName ?? null).key,
          pays: p.uPays ?? null,
          calibre: hints[p.itemCode]?.calibre ?? null,
          variete: p.frgnName ?? null,
        })
      : null;
    return {
      itemCode: p.itemCode, itemName: p.itemName, unit: d.displayUnit, priceUnit: d.priceUnit,
      packDivisor: d.packDivisor,
      availByWarehouse: d.avail, quantity: d.stepColis,
      price: tarifByCode.get(p.itemCode) ?? fruitPrice ?? hints[p.itemCode]?.prixConseille ?? null,
      stepColis: d.stepColis,
      marque: p.uMarque ?? null, condi: p.uCondi ?? p.uUvc ?? null, pays: p.uPays ?? null,
    };
  }, [displayByCode, hints, tarifByCode, tarifFruits]);

  const toggleCart = (p: Product) => {
    loadHints([p.itemCode]);
    setCart((cur) => cur.some((l) => l.itemCode === p.itemCode)
      ? cur.filter((l) => l.itemCode !== p.itemCode)
      : [...cur, buildLine(p)]);
  };
  const updateLine = (i: number, patch: Partial<CartLine>) =>
    setCart((c) => c.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => setCart((c) => c.filter((_, k) => k !== i));

  // Prix arrivé APRÈS l'ajout au panier (hint chargé en différé) → complète les
  // lignes restées sans prix, sans écraser une saisie manuelle.
  useEffect(() => {
    setCart((cur) => {
      let changed = false;
      const next = cur.map((l) => {
        if (l.price != null) return l;
        const p = tarifByCode.get(l.itemCode) ?? hints[l.itemCode]?.prixConseille ?? null;
        if (p == null) return l;
        changed = true;
        return { ...l, price: p };
      });
      return changed ? next : cur;
    });
  }, [hints, tarifByCode]);

  const totalHT = useMemo(
    () => cart.reduce((s, l) => s + (l.price ?? 0) * l.quantity * l.packDivisor, 0),
    [cart],
  );

  /* ── Création du BL ── */
  const buildApiLines = (): ApiLine[] =>
    cart.flatMap((l) =>
      splitByWarehouse(l.quantity, l.availByWarehouse).map((c) => ({
        itemCode: l.itemCode,
        quantity: c.qty * l.packDivisor,   // colis → pièces pour SAP
        displayQuantity: c.qty, displayUnit: l.unit,
        warehouseCode: c.warehouse,
        ...(l.price != null && l.price > 0 ? { price: l.price } : {}),
      })));

  const submit = async () => {
    if (submitting) return;   // anti-double-clic (évite le double-BL)
    if (cart.length === 0) { toast.error("Panier vide"); return; }
    const tourneeError = validateTournee();
    if (tourneeError) { toast.error(tourneeError); return; }
    setSubmitting(true);
    try {
      const post = (confirmEncours: boolean) =>
        fetch("/api/sap/orders", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: client.id,
            deliveryModeId: modeId || undefined,
            ...(tourneePayload() ?? {}),
            deliveryDate: new Date(`${deliveryDate}T09:00:00`).toISOString(),
            numAtCard: numAtCard.trim() || undefined,
            comments: comments.trim() || undefined,
            confirmEncours,
            docKind: isBonCommande ? "COMMANDE" : "BL",
            lines: buildApiLines(),
          }),
        });
      let res = await post(false);
      let json = await res.json().catch(() => null);
      if (res.status === 409 && json?.needsConfirm === "encours") {
        const ok = window.confirm(`${json.error}\n\nCréer le BL quand même ?`);
        if (!ok) return;
        res = await post(true);
        json = await res.json().catch(() => null);
      }
      if (!res.ok || !json?.ok) {
        toast.error(json?.blocked ? "🚫 Client bloqué" : "❌ Échec de la création", { description: json?.error, duration: 10000 });
        return;
      }
      if (json.bonPrep) {
        toast.success("📝 Bon de préparation créé (export)", {
          description: "Affecte les lots dans « Détail livraison » puis crée le BL.",
          duration: 10000,
        });
      } else {
        toast.success(`✅ Commande #${json.docNum} créée${json.totalTTC != null ? ` — ${json.totalTTC.toFixed(2)} € TTC` : ""}`, { duration: 10000 });
      }
      setCart([]); setNumAtCard(""); setComments("");
      // Arrivé depuis la fiche client (« Commander ») → on y RETOURNE une fois la
      // commande passée (petit délai pour laisser voir le toast de succès).
      // Chemin INTERNE seulement (pas d'open-redirect).
      if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
        setTimeout(() => router.push(returnTo), 700);
      }
    } catch (e) {
      toast.error(`❌ ${e instanceof Error ? e.message : "Erreur réseau"}`);
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Liste stock filtrée : groupes ÉPINGLÉS (⭐ Favoris, Tarif client) en
        tête, puis les familles. Les épinglés sont des COPIES (les originaux
        restent à leur place dans leur famille). ── */
  const needle = filter.trim().toLowerCase();
  interface GroupEntry { key: string; label: string; prods: Product[]; pinned?: "fav" | "tarif" }
  const groups = useMemo<GroupEntry[]>(() => {
    const matches = (p: Product) =>
      !needle || p.itemName.toLowerCase().includes(needle) || p.itemCode.toLowerCase().includes(needle);
    const all = Object.values(grouped).flat();
    const out: GroupEntry[] = [];
    const favProds = all.filter((p) => favorites.has(p.itemCode) && matches(p));
    if (favProds.length) out.push({ key: FAV_KEY, label: "⭐ Favoris", prods: favProds, pinned: "fav" });
    const tarifProds = all.filter((p) => tarifByCode.has(p.itemCode) && matches(p));
    if (tarifProds.length) out.push({ key: TARIF_KEY, label: "Tarif client (prix fixés)", prods: tarifProds, pinned: "tarif" });
    for (const [g, prods] of Object.entries(grouped)) {
      const kept = prods.filter(matches);
      if (kept.length) out.push({ key: g, label: g, prods: kept });
    }
    return out;
  }, [grouped, needle, favorites, tarifByCode]);
  // Prix des groupes épinglés (ouverts d'office) — chargés dès qu'ils existent.
  useEffect(() => {
    const codes = groups.filter((g) => g.pinned).flatMap((g) => g.prods.map((p) => p.itemCode));
    if (codes.length) loadHints(codes);
  }, [groups, loadHints]);
  const inCart = useMemo(() => new Set(cart.map((l) => l.itemCode)), [cart]);

  return (
    <div className="space-y-4 pb-28">
      {/* ── Panier (en tête : c'est l'objet du geste) ── */}
      {cart.length > 0 && (
        <section className="rounded-2xl border border-brand-400/50 bg-card overflow-hidden">
          <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border bg-secondary/30">
            <ShoppingCart className="h-4 w-4 text-brand-600 dark:text-brand-400 shrink-0" />
            <p className="text-[13px] font-semibold text-foreground flex-1">
              Panier — {cart.length} ligne{cart.length > 1 ? "s" : ""}
            </p>
            <p className="text-[13px] font-bold tnum text-foreground">{eur.format(totalHT)} HT</p>
          </div>
          <ul className="divide-y divide-border/60">
            {cart.map((l, i) => (
              <li key={l.itemCode} className="px-3.5 py-2.5 space-y-1.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium text-foreground leading-tight">{l.itemName}</p>
                    {/* Tags produit — conservés sur la version allégée. */}
                    <DesignationChips marque={l.marque} condt={l.condi} pays={l.pays} className="mt-1" />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    aria-label={`Retirer ${l.itemName} du panier`}
                    className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-rose-500 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Quantité : − / valeur / + (pas d'un colis, poids si vendu au kg) */}
                  <div className="inline-flex items-center rounded-lg border border-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => updateLine(i, { quantity: Math.max(l.stepColis, Math.round((l.quantity - l.stepColis) * 100) / 100) })}
                      aria-label="Diminuer la quantité"
                      className="h-9 w-9 inline-flex items-center justify-center text-muted-foreground hover:bg-secondary/60 active:bg-secondary"
                    ><Minus className="h-4 w-4" /></button>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={l.quantity}
                      min={0}
                      step={l.stepColis}
                      onChange={(e) => updateLine(i, { quantity: Math.max(0, Number(e.target.value) || 0) })}
                      aria-label={`Quantité de ${l.itemName} (${l.unit})`}
                      className="h-9 w-[64px] border-x border-border bg-card text-center text-[13.5px] font-semibold tnum focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => updateLine(i, { quantity: Math.round((l.quantity + l.stepColis) * 100) / 100 })}
                      aria-label="Augmenter la quantité"
                      className="h-9 w-9 inline-flex items-center justify-center text-muted-foreground hover:bg-secondary/60 active:bg-secondary"
                    ><Plus className="h-4 w-4" /></button>
                  </div>
                  <span className="text-[11px] text-muted-foreground">{l.unit}</span>
                  {/* Prix (€/unité de prix) — cotation client ou conseillé pré-rempli */}
                  <div className="inline-flex items-center gap-1 ml-auto">
                    <input
                      type="number"
                      inputMode="decimal"
                      value={l.price ?? ""}
                      min={0}
                      step={0.01}
                      placeholder="Prix"
                      onChange={(e) => updateLine(i, { price: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
                      aria-label={`Prix de ${l.itemName} (€/${l.priceUnit})`}
                      className="h-9 w-[84px] rounded-lg border border-border bg-card px-2 text-right text-[13.5px] font-semibold tnum focus:outline-none focus:ring-2 focus:ring-ring/40"
                    />
                    <span className="text-[11px] text-muted-foreground">€/{l.priceUnit}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* Livraison : date · adresse (si choix) · transporteur · tournée */}
          <div className="px-3.5 py-3 border-t border-border space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Livraison le</span>
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-border bg-card px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring/40"
                />
              </label>
              <label className="block">
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Réf. client</span>
                <input
                  value={numAtCard}
                  onChange={(e) => setNumAtCard(e.target.value)}
                  placeholder="Optionnel"
                  className="mt-1 h-10 w-full rounded-lg border border-border bg-card px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring/40"
                />
              </label>
            </div>
            {modes.length > 1 && (
              <label className="block">
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Adresse de livraison</span>
                <select
                  value={modeId}
                  onChange={(e) => setModeId(e.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-border bg-card px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring/40"
                >
                  {modes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
            )}
            {/* Bon de commande — aucun auto-lot ; lots affectés ensuite. Forcé si précommande. */}
            <label
              className={`flex items-center gap-2.5 rounded-lg border px-3 h-11 text-[13px] select-none ${precommande ? "cursor-default" : "cursor-pointer"} ${
                isBonCommande ? "border-amber-400/60 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-border text-muted-foreground"
              }`}
            >
              <input type="checkbox" checked={isBonCommande} disabled={precommande}
                onChange={(e) => setBonCommandeManual(e.target.checked)}
                className="h-4 w-4 accent-amber-600" />
              <span className="font-semibold">Bon de commande</span>
              <span className="text-[11px] opacity-80 truncate">
                {precommande ? "· précommande" : "· lots affectés plus tard"}
              </span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Transporteur</span>
                <select
                  value={carrierSap}
                  onChange={(e) => setCarrierSap(e.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-border bg-card px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring/40"
                >
                  <option value="">Choisir…</option>
                  {carriers.map((c) => <option key={c.sapValue} value={c.sapValue}>{c.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Tournée</span>
                <select
                  value={tourneeId}
                  onChange={(e) => setTourneeId(e.target.value)}
                  disabled={tournees === undefined || (tournees ?? []).length === 0}
                  className="mt-1 h-10 w-full rounded-lg border border-border bg-card px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-60"
                >
                  <option value="">{tournees === undefined ? "Chargement…" : "Choisir…"}</option>
                  {(tournees ?? []).map((t) => (
                    <option key={t.lineId} value={String(t.lineId)}>
                      {t.nom || t.des || "Tournée"}{t.heure ? ` · ${t.heure.slice(0, 5)}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Note sur le bon</span>
              <input
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="Optionnel"
                className="mt-1 h-10 w-full rounded-lg border border-border bg-card px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
            </label>
            <button
              type="button"
              onClick={submit}
              disabled={submitting || cart.length === 0}
              className="w-full inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-[14.5px] font-semibold disabled:opacity-50 active:scale-[0.99] transition-all"
            >
              {submitting ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Truck className="h-4.5 w-4.5" />}
              Créer le BL — {eur.format(totalHT)} HT
            </button>
          </div>
        </section>
      )}

      {/* ── Liste stock (groupes famille repliés, tags conservés) ── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrer les articles…"
          aria-label="Filtrer les articles"
          className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-ring/40"
        />
      </div>
      {loading ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground px-1">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement du stock…
        </p>
      ) : groups.length === 0 ? (
        <p className="text-[13px] text-muted-foreground px-1">Aucun article en stock.</p>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const isOpen = needle ? true : !!openGroups[g.key];
            return (
              <section key={g.key} className={`rounded-2xl border bg-card overflow-hidden ${
                g.pinned === "fav" ? "border-amber-400/50" : g.pinned === "tarif" ? "border-violet-400/50" : "border-border"
              }`}>
                <button
                  type="button"
                  onClick={() => toggleGroup(g.key, g.prods)}
                  className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-left hover:bg-secondary/30 transition-colors"
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    {g.pinned === "tarif" && <BadgeEuro className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />}
                    <span className="text-[13px] font-semibold text-foreground truncate">{g.label}</span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-muted-foreground">{g.prods.length}</span>
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                  </span>
                </button>
                {isOpen && (
                  <ul className="divide-y divide-border/50 border-t border-border/60">
                    {g.prods.map((p) => {
                      const d = displayByCode.get(p.itemCode) ?? computeDisplay(p);
                      const tarif = tarifByCode.get(p.itemCode) ?? null;
                      const price = tarif ?? hints[p.itemCode]?.prixConseille ?? null;
                      const added = inCart.has(p.itemCode);
                      const isFav = favorites.has(p.itemCode);
                      return (
                        <li key={p.itemCode} className={`flex items-stretch ${added ? "bg-brand-50 dark:bg-brand-950/30" : ""}`}>
                          {/* Étoile FAVORI — bouton séparé (pas de bouton imbriqué). */}
                          <button
                            type="button"
                            onClick={() => toggleFavorite(p.itemCode)}
                            aria-pressed={isFav}
                            aria-label={isFav ? `Retirer ${p.itemName} des favoris` : `Ajouter ${p.itemName} aux favoris`}
                            className="shrink-0 w-10 inline-flex items-center justify-center text-muted-foreground/50 hover:text-amber-500 transition-colors"
                          >
                            <Star className={`h-4 w-4 ${isFav ? "fill-amber-400 text-amber-500" : ""}`} />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleCart(p)}
                            className={`min-w-0 flex-1 text-left pr-3.5 py-2.5 flex items-center gap-2.5 transition-colors ${added ? "" : "hover:bg-secondary/30"}`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13.5px] font-medium text-foreground leading-tight">{p.itemName}</span>
                              <DesignationChips
                                marque={p.uMarque} condt={p.uCondi ?? p.uUvc} calibre={hints[p.itemCode]?.calibre} pays={p.uPays}
                                className="mt-1"
                              />
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block text-[15px] font-bold tnum text-foreground leading-none">
                                {d.dispo.toLocaleString("fr-FR")}
                                <span className="ml-0.5 text-[9.5px] font-semibold uppercase text-muted-foreground">{d.displayUnit}</span>
                              </span>
                              {price != null && (
                                // Prix VIOLET = tarif fixé pour ce client (cotation), sinon prix conseillé.
                                <span
                                  title={tarif != null ? "Prix fixé pour ce client (tarif)" : "Prix conseillé"}
                                  className={`block text-[11px] tnum mt-0.5 ${tarif != null ? "font-bold text-violet-600 dark:text-violet-400" : "text-muted-foreground"}`}
                                >
                                  {eur.format(price)}
                                </span>
                              )}
                            </span>
                            <span className={`shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
                              added
                                ? "border-brand-500 bg-brand-600 text-white"
                                : "border-border text-muted-foreground"
                            }`}>
                              {added ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
