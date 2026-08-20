"use client";

import type { CarrierOption, TourneeOption } from "@/lib/useTourneeSelection";

/**
 * Pied de la colonne « Commande » (mode CRÉATION uniquement).
 * Sélecteur UNIQUE transporteur / compte de livraison, tournée (obligatoire dès
 * qu'un transporteur en définit), date de livraison et bascule « Bon de
 * commande ». Rendu inchangé — extrait tel quel de Ecran2Order. Le garde `!modif`
 * reste chez l'appelant.
 */
export function FooterBar({
  carriers, carrierSap, setCarrierSap, tournees, tourneeId, setTourneeId,
  deliveryModes, deliveryModeId, onDeliveryModeChange,
  deliveryDate, setDeliveryDate, hasDecouvert, precommande, isBonCommande, setBonCommandeManual,
}: {
  carriers: CarrierOption[];
  carrierSap: string;
  setCarrierSap: (v: string) => void;
  tournees: TourneeOption[] | undefined;
  tourneeId: string;
  setTourneeId: (v: string) => void;
  deliveryModes: { id: string; name: string; sapCardCode: string; isDefault: boolean }[];
  deliveryModeId: string;
  onDeliveryModeChange?: (id: string) => void;
  deliveryDate: string;
  setDeliveryDate: (v: string) => void;
  hasDecouvert: boolean;
  precommande: boolean;
  isBonCommande: boolean;
  setBonCommandeManual: (v: boolean) => void;
}) {
  return (
    <>
      {/* SÉLECTION UNIQUE : transporteur OU compte de livraison (LPOI,
          SCACHAP…) dans le MÊME sélecteur — choisir un compte fait
          partir le bon sur ce compte SAP ; choisir un transporteur
          ramène le bon sur le compte par défaut du client. */}
      {(() => {
        const needsTournee = !!carrierSap && tournees !== undefined && tournees.some((t) => t.heure);
        const missingCarrier = !carrierSap;
        const missingTournee = needsTournee && !tourneeId;
        const warnCls = "border-warning/60 bg-warning/[0.06]";
        const defaultMode = deliveryModes.find((m) => m.isDefault) ?? deliveryModes[0];
        const accountModes = deliveryModes.filter((m) => !m.isDefault);
        const activeAccount = accountModes.find((m) => m.id === deliveryModeId) ?? null;
        // Valeur combinée : compte non-défaut sélectionné → « m:<id> »,
        // sinon le transporteur courant → « c:<code> ».
        const combined = activeAccount ? `m:${activeAccount.id}` : (carrierSap ? `c:${carrierSap}` : "");
        const onCombined = (v: string) => {
          if (v.startsWith("m:")) {
            onDeliveryModeChange?.(v.slice(2));
          } else if (v.startsWith("c:")) {
            if (defaultMode) onDeliveryModeChange?.(defaultMode.id);
            setCarrierSap(v.slice(2));
          }
        };
        return (
          <div className="flex gap-1.5">
            <select value={combined} onChange={(e) => onCombined(e.target.value)}
              aria-label="Transporteur ou compte de livraison"
              title="Transporteur du bon (défaut du client pré-sélectionné) — ou compte sur lequel le bon doit partir (LPOI, SCACHAP…)"
              className={`min-w-0 flex-1 h-9 rounded-md border bg-background text-body px-2 ${
                missingCarrier && !activeAccount ? warnCls : "border-border"}`}>
              <option value="" disabled>Transporteur…</option>
              {/* Transporteurs (optgroup labellisé — plus d'emoji dans les options) ;
                  B3 — count présent quand la liste est filtrée par client (habitudes). */}
              <optgroup label="Transporteurs">
                {carriers.map((c) => (
                  <option key={c.id} value={`c:${c.sapValue}`}>
                    {c.name}{c.count ? ` · ${c.count} cde${c.count > 1 ? "s" : ""}` : ""}
                  </option>
                ))}
              </optgroup>
              {accountModes.length > 0 && (
                <optgroup label="Livré sur un autre compte">
                  {accountModes.map((m) => (
                    <option key={m.id} value={`m:${m.id}`}>
                      Compte {m.name} ({m.sapCardCode})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <select value={tourneeId} onChange={(e) => setTourneeId(e.target.value)}
              disabled={!carrierSap || tournees === undefined || (tournees !== undefined && !needsTournee)}
              aria-label="Tournée"
              title={!carrierSap ? "Choisis d'abord le transporteur"
                : tournees === undefined ? "Chargement des tournées…"
                : needsTournee ? "Tournée du bon (fixe l'heure, mémorisée pour le client)"
                : "Aucune tournée définie pour ce transporteur"}
              className={`min-w-0 flex-1 h-9 rounded-md border bg-background text-body px-2 disabled:opacity-60 ${
                missingTournee ? warnCls : "border-border"}`}>
              <option value="" disabled>
                {!carrierSap ? "Tournée…"
                  : tournees === undefined ? "Chargement…"
                  : needsTournee ? "Tournée…" : "Aucune tournée définie"}
              </option>
              {(tournees ?? []).filter((t) => t.heure).map((t) => (
                <option key={t.lineId} value={String(t.lineId)}>
                  {t.nom}{t.des ? ` (${t.des})` : ""} — {(t.heure as string).slice(0, 5)}
                </option>
              ))}
            </select>
          </div>
        );
      })()}
      {/* Date de livraison SANS heure (l'heure est portée par la TOURNÉE)
          + bascule « Bon de commande » COMPACTE sur la même rangée. */}
      <div className="flex gap-1.5">
        <input type="date" value={deliveryDate.slice(0, 10)} onChange={(e) => setDeliveryDate(e.target.value)}
          aria-label="Date de livraison"
          className="min-w-0 flex-1 h-9 rounded-md border border-border bg-background text-body px-2" />
        {/* Bon de commande (aucun auto-lot, lots affectés plus tard) — compact.
            Forcé (coché + verrouillé) si précommande OU article à découvert. */}
        <label
          title={hasDecouvert
            ? "Article à découvert (stock insuffisant) → forcé en bon de commande : il ne réserve pas de stock et se validera automatiquement en commande à la réception"
            : precommande
            ? "Livraison au-delà du prochain jour livrable → précommande : créée en bon de commande (lots affectés plus tard)"
            : "Créer en bon de commande : aucun lot automatique, tu affectes les lots ensuite dans l'onglet Bons de commande"}
          className={`shrink-0 inline-flex items-center gap-1.5 rounded-md border px-2 h-9 text-caption2 select-none ${precommande || hasDecouvert ? "cursor-default" : "cursor-pointer"} ${
            isBonCommande ? "border-warning/50 bg-warning/10 text-warning" : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          <input type="checkbox" checked={isBonCommande} disabled={precommande || hasDecouvert}
            onChange={(e) => setBonCommandeManual(e.target.checked)}
            className="h-3.5 w-3.5 accent-[hsl(var(--warning))]" />
          <span className="font-semibold whitespace-nowrap">Bon de commande</span>
        </label>
      </div>
    </>
  );
}
