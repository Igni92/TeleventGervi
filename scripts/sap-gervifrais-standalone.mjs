/**
 * SAP B1 Service Layer — Setup standalone pour Gervifrais SARL
 * ============================================================
 *
 * Fichier unique, ZÉRO dépendance npm (uniquement node:https / node:fs).
 * Copie-colle ce fichier dans n'importe quel projet Node 18+ et utilise-le.
 *
 * Usage minimal :
 *   node sap-gervifrais-standalone.mjs              → exécute la démo en bas du fichier
 *
 * Usage en module :
 *   import { sap } from "./sap-gervifrais-standalone.mjs";
 *   const items = await sap.getAll("Items?$top=10");
 *
 * Tested:
 *   - Node ≥ 18 (fetch / https / URL natifs)
 *   - SAP B1 v10.0 Patch 150 (Service Layer)
 *
 * ─────────────────────────────────────────────────────────────
 * CONFIG — à mettre dans .env.local du nouveau projet
 * ─────────────────────────────────────────────────────────────
 *
 * SAP_B1_BASE_URL=https://185.57.12.2:40021/b1s/v1
 * SAP_B1_COMPANY_DB=GERVIFRAIS              # ou GERVIFRAIS_TEST pour la base de test
 * SAP_B1_USERNAME=GERJMG
 * SAP_B1_PASSWORD=Tks\$Ws74                 # ATTENTION : escaper le $ avec \
 * SAP_B1_TLS_INSECURE=1                     # cert self-signed → 1 en dev, à RETIRER en prod
 *
 * Bases dispo (testées) :
 *   - GERVIFRAIS         (productive)
 *   - GERVIFRAIS_TEST    (testing, mêmes codes user/password)
 *
 * Notes Service Layer :
 *   - Auth : POST /Login renvoie un cookie B1SESSION (timeout 30 min idle)
 *   - SAP B1 Service Layer n'aime PAS la concurrence sur les requêtes lourdes
 *     (ItemWarehouseInfoCollection) → faire du séquentiel
 *   - $filter ne supporte pas substringof, utiliser contains() ou startswith()
 *   - Pour booleans enum SAP : $filter=Valid eq 'tYES' and Frozen eq 'tNO'
 *   - Pagination : @odata.nextLink rare, fallback $skip/$top manuel
 *
 * ═════════════════════════════════════════════════════════════
 * CHAMPS CUSTOM GERVIFRAIS (U_*) IMPORTANTS — découverts via probe
 * ═════════════════════════════════════════════════════════════
 *
 * Sur Items (article master) :
 *   U_Pays                  → ex. "Portugal" (pays d'origine)
 *   U_GER_Marque            → ex. "Driscolls"
 *   U_GER_Det_Condt         → ex. "12x125g" (détail conditionnement)
 *   U_GER_UVC               → ex. "125g" (poids unitaire)
 *   U_GER_NB_BARQ_COLIS     → ex. 12 (barquettes par colis)
 *
 * Sur lignes d'Order (à remplir EXPLICITEMENT à la création) :
 *   U_NoLot                 → numéro de lot (depuis BatchNumberDetails)
 *   U_GER_Pays              → copié depuis Items.U_Pays
 *   U_GER_Marque            → copié depuis Items.U_GER_Marque
 *   U_GER_Condi             → copié depuis Items.U_GER_Det_Condt
 *   U_NomMag                → nom humain entrepôt ("Stock", "J+1", etc.)
 *
 * Entrepôts Gervifrais :
 *   000 = A/C - A/D     (réception / dispatch)
 *   01  = Stock physique
 *   R1-R7 = Stock projeté J+1 à J+7
 *   SHOP = Boutique
 *   ZZ / ZZX = Destruction
 *
 * Groupes articles à ignorer (parasites / emballages) :
 *   100, 104, 105, 111, 112, 117, 121, 126, 128, 130 (noms "." ".." etc.)
 *   114 = Emballage
 *
 * Champs prix SAP :
 *   PriceListNum sur BusinessPartner → SAP applique auto le tarif si Price omis
 *   PriceSource sur ligne = "dpsActivePriceList" si appliqué
 *   VatGroup = "C3" pour TVA 5.5% (produits frais France)
 */

import https from "node:https";
import fs from "node:fs";
import { URL } from "node:url";

// ─────────────────────────────────────────────────────────────
// 1. ENV LOADER (sans dépendance dotenv)
// ─────────────────────────────────────────────────────────────
function loadEnv(path = ".env.local") {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      let v = m[2].trim();
      // Strip surrounding quotes
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      // Unescape \$ → $ (sinon dotenv-expand mange le $)
      v = v.replace(/\\\$/g, "$");
      process.env[m[1]] = v;
    }
  }
}
loadEnv();

// ─────────────────────────────────────────────────────────────
// 2. CONFIG
// ─────────────────────────────────────────────────────────────
const BASE = process.env.SAP_B1_BASE_URL ?? "https://185.57.12.2:40021/b1s/v1";
const COMPANY = process.env.SAP_B1_COMPANY_DB ?? "GERVIFRAIS";
const USER = process.env.SAP_B1_USERNAME ?? "GERJMG";
const PASS = process.env.SAP_B1_PASSWORD ?? "Tks$Ws74";
const INSECURE = (process.env.SAP_B1_TLS_INSECURE ?? "1") === "1";

if (!BASE || !COMPANY || !USER || !PASS) {
  throw new Error("Missing SAP env vars. See header comments.");
}

const agent = new https.Agent({
  rejectUnauthorized: !INSECURE,
  keepAlive: true,
  timeout: 90_000,
});

// ─────────────────────────────────────────────────────────────
// 3. SESSION + CLIENT HTTP
// ─────────────────────────────────────────────────────────────
let cookieHeader = null;
let loginInflight = null;

function rawRequest(path, opts = {}) {
  const { method = "GET", body, headers = {}, timeoutMs = 90_000 } = opts;
  const baseWithSlash = BASE.endsWith("/") ? BASE : BASE + "/";
  const target = new URL(path.replace(/^\//, ""), baseWithSlash);
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`SAP request timeout after ${timeoutMs}ms: ${path}`));
    }, timeoutMs);
    const req = https.request({
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      method,
      agent,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        ...headers,
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        clearTimeout(timer);
        let parsed = data;
        if (res.headers["content-type"]?.includes("application/json") && data) {
          try { parsed = JSON.parse(data); } catch { /* keep string */ }
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on("error", (e) => { clearTimeout(timer); reject(e); });
    if (body !== undefined && body !== null) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function login() {
  if (loginInflight) return loginInflight;
  loginInflight = (async () => {
    const res = await rawRequest("Login", {
      method: "POST",
      body: { CompanyDB: COMPANY, UserName: USER, Password: PASS },
    });
    if (res.status !== 200) {
      cookieHeader = null;
      throw new Error(`SAP login failed: ${res.body?.error?.message?.value ?? `HTTP ${res.status}`}`);
    }
    const set = res.headers["set-cookie"];
    cookieHeader = Array.isArray(set)
      ? set.map((c) => c.split(";")[0]).join("; ")
      : "";
  })();
  try { await loginInflight; } finally { loginInflight = null; }
}

async function logout() {
  if (!cookieHeader) return;
  try { await rawRequest("Logout", { method: "POST" }); } catch { /* ignore */ }
  cookieHeader = null;
}

async function call(path, opts = {}) {
  if (!cookieHeader && !opts.noRetry) await login();
  let res = await rawRequest(path, opts);
  // Auto re-login on 401 (session expired)
  if (res.status === 401 && !opts.noRetry) {
    cookieHeader = null;
    await login();
    res = await rawRequest(path, opts);
  }
  if (res.status >= 400) {
    const errBody = res.body;
    const message = typeof errBody === "object" && errBody?.error?.message?.value
      ? errBody.error.message.value
      : typeof errBody === "string" ? errBody.slice(0, 300) : `HTTP ${res.status}`;
    throw new Error(`SAP ${opts.method ?? "GET"} ${path} → ${res.status}: ${message}`);
  }
  return res.body;
}

// ─────────────────────────────────────────────────────────────
// 4. PUBLIC API
// ─────────────────────────────────────────────────────────────
export const sap = {
  login,
  logout,
  isAuthenticated: () => cookieHeader !== null,

  get(path, opts = {}) { return call(path, { ...opts, method: "GET" }); },
  post(path, body, opts = {}) { return call(path, { ...opts, method: "POST", body }); },
  patch(path, body, opts = {}) { return call(path, { ...opts, method: "PATCH", body }); },
  delete(path, opts = {}) { return call(path, { ...opts, method: "DELETE" }); },

  /**
   * Pagination OData : nextLink + fallback $skip/$top
   * @param {string} path - ex. "Items?$select=ItemCode&$filter=Valid eq 'tYES'"
   * @param {object} opts - { pageSize = 500, maxPages = 50 }
   */
  async getAll(path, opts = {}) {
    const { pageSize = 500, maxPages = 50 } = opts;
    const all = [];
    let next = path;
    let page = 0;
    while (next && page < maxPages) {
      const res = await call(next, { headers: { Prefer: `odata.maxpagesize=${pageSize}` } });
      const batch = res.value ?? [];
      all.push(...batch);
      if (res["@odata.nextLink"]) {
        next = res["@odata.nextLink"];
      } else if (batch.length === pageSize) {
        const sep = path.includes("?") ? "&" : "?";
        next = `${path}${sep}$skip=${all.length}`;
      } else {
        next = null;
      }
      page++;
    }
    return all;
  },
};

// ─────────────────────────────────────────────────────────────
// 5. HELPERS HAUT-NIVEAU GERVIFRAIS
// ─────────────────────────────────────────────────────────────

/** Liste les articles valides + actifs avec leurs U_* Gervifrais. */
export async function fetchActiveItems() {
  return sap.getAll(
    "Items?$filter=Valid eq 'tYES' and Frozen eq 'tNO'"
    + "&$select=ItemCode,ItemName,ItemsGroupCode,SalesUnit,SalesPackagingUnit,SalesQtyPerPackUnit,"
    + "SalesUnitWeight,InventoryUOM,PurchaseUnit,ManageBatchNumbers,QuantityOnStock,"
    + "ItemWarehouseInfoCollection,U_Pays,U_GER_Marque,U_GER_Det_Condt,U_GER_UVC,U_GER_NB_BARQ_COLIS",
    { pageSize: 500 }
  );
}

/** Liste les clients actifs. */
export async function fetchActiveCustomers() {
  return sap.getAll(
    "BusinessPartners?$filter=CardType eq 'cCustomer' and Frozen eq 'tNO'"
    + "&$select=CardCode,CardName,PriceListNum,SalesPersonCode,Currency,VatLiable,EmailAddress,Phone1",
    { pageSize: 500 }
  );
}

/** Lot le plus ancien (FIFO sur DLC) disponible pour un article. */
export async function findOldestActiveLot(itemCode) {
  const r = await sap.get(
    `BatchNumberDetails?$filter=ItemCode eq '${encodeURIComponent(itemCode)}' and Status eq 'bdsStatus_Released'`
    + `&$orderby=ExpirationDate asc,SystemNumber asc&$top=1&$select=Batch,ExpirationDate`
  );
  return r.value?.[0] ?? null;
}

const WAREHOUSE_NAMES = {
  "000": "A/C - A/D", "01": "Stock", "R1": "J+1",
  "R2": "J+2", "R3": "J+3", "R4": "J+4", "R5": "J+5",
  "R6": "J+6", "R7": "J+7", "SHOP": "Shop",
};

/**
 * Crée une Commande Client (Sales Order) avec tous les champs Gervifrais.
 *
 * @param {object} params
 * @param {string} params.cardCode      - CardCode SAP du client
 * @param {string} params.docDueDate    - YYYY-MM-DD (date de livraison)
 * @param {string} [params.comments]
 * @param {Array<{
 *   itemCode: string;
 *   quantity: number;          // en unité de stock SAP (pie, kg…)
 *   warehouseCode: string;     // "000" | "01" | "R1"…
 *   price?: number;            // optionnel, sinon SAP applique la PriceList
 * }>} params.lines
 *
 * @returns {Promise<object>} l'order créé (avec DocNum, DocEntry, DocTotal, VatSum, lignes enrichies)
 */
export async function createOrder({ cardCode, docDueDate, comments, lines }) {
  // 1. Pré-validation
  for (const l of lines) {
    try {
      await sap.get(`Items('${encodeURIComponent(l.itemCode)}')?$select=ItemCode`);
    } catch {
      throw new Error(`Article ${l.itemCode} introuvable dans SAP "${COMPANY}"`);
    }
  }
  try {
    await sap.get(`BusinessPartners('${encodeURIComponent(cardCode)}')?$select=CardCode`);
  } catch {
    throw new Error(`Client ${cardCode} introuvable dans SAP "${COMPANY}"`);
  }

  // 2. Enrichissement des lignes avec U_* (Pays, Marque, Condi, Lot)
  const documentLines = [];
  for (const l of lines) {
    const item = await sap.get(
      `Items('${encodeURIComponent(l.itemCode)}')?$select=U_Pays,U_GER_Marque,U_GER_Det_Condt,ManageBatchNumbers`
    );
    const line = {
      ItemCode: l.itemCode,
      Quantity: l.quantity,
      WarehouseCode: l.warehouseCode,
      ...(l.price != null && l.price > 0 ? { Price: l.price } : {}),
      ...(item.U_Pays ? { U_GER_Pays: item.U_Pays } : {}),
      ...(item.U_GER_Marque ? { U_GER_Marque: item.U_GER_Marque } : {}),
      ...(item.U_GER_Det_Condt ? { U_GER_Condi: item.U_GER_Det_Condt } : {}),
      ...(WAREHOUSE_NAMES[l.warehouseCode] ? { U_NomMag: WAREHOUSE_NAMES[l.warehouseCode] } : {}),
    };

    // Auto-FIFO lot si batch-managed
    if (item.ManageBatchNumbers === "tYES") {
      const lot = await findOldestActiveLot(l.itemCode);
      if (lot?.Batch) {
        line.U_NoLot = lot.Batch;
        line.BatchNumbers = [{ BatchNumber: lot.Batch, Quantity: l.quantity }];
      }
    }
    documentLines.push(line);
  }

  // 3. POST /Orders
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    CardCode: cardCode,
    DocDate: today,
    DocDueDate: docDueDate,
    TaxDate: today,
    Comments: comments ?? "Commande créée via Service Layer",
    DocumentLines: documentLines,
  };
  const created = await sap.post("/Orders", payload);

  // 4. Refetch pour avoir les totaux/lots/prix appliqués par SAP
  const enriched = await sap.get(`/Orders(${created.DocEntry})`);
  return enriched;
}

// ─────────────────────────────────────────────────────────────
// 6. DÉMO (s'exécute quand le fichier est lancé directement)
// ─────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`
    || process.argv[1].endsWith("sap-gervifrais-standalone.mjs")) {
  console.log("─────────────────────────────────────────────");
  console.log("  SAP B1 Gervifrais — Démo standalone");
  console.log("─────────────────────────────────────────────");
  console.log("URL    :", BASE);
  console.log("DB     :", COMPANY);
  console.log("User   :", USER);
  console.log("TLS    :", INSECURE ? "DISABLED (dev)" : "enabled");
  console.log();

  await sap.login();
  console.log("✅ Login OK\n");

  // Démo 1 : 3 articles avec stock
  console.log("📦 3 articles avec stock > 0 :");
  const items = await sap.get(
    "Items?$top=3&$filter=Valid eq 'tYES' and QuantityOnStock gt 0&$select=ItemCode,ItemName,QuantityOnStock,U_Pays,U_GER_Marque"
  );
  items.value.forEach(i => console.log(`  • ${i.ItemCode.padEnd(15)} | ${i.ItemName.padEnd(25)} | stock=${i.QuantityOnStock} | ${i.U_Pays ?? "?"} | ${i.U_GER_Marque ?? "?"}`));

  // Démo 2 : 3 derniers Orders
  console.log("\n📋 3 dernières commandes clients :");
  const orders = await sap.get(
    "Orders?$top=3&$orderby=DocEntry desc&$select=DocNum,DocDate,CardCode,CardName,DocTotal,VatSum"
  );
  orders.value.forEach(o => console.log(`  • #${o.DocNum} | ${o.DocDate} | ${o.CardCode.padEnd(12)} | ${o.DocTotal}€ TTC (TVA ${o.VatSum}€)`));

  // Démo 3 : créer une commande de test (commenté par sécurité)
  /*
  console.log("\n📝 Création d'une commande test :");
  const created = await createOrder({
    cardCode: "AAUXERRE",
    docDueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    comments: "Test SAP standalone",
    lines: [
      { itemCode: "FRAMB12PD", quantity: 12, warehouseCode: "01" }, // 12 pie = 1 colis
    ],
  });
  console.log(`✅ Commande créée — DocNum #${created.DocNum} | Total ${created.DocTotal}€ TTC`);
  */

  await sap.logout();
  console.log("\n🔚 Session fermée proprement.");
}
