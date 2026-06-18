/**
 * Test de bout en bout de l'envoi de relance via l'IDENTITÉ APPLICATIVE Graph.
 *
 * Valide la config Azure (permission d'APPLICATION Mail.Send + consentement
 * admin + secret client + ApplicationAccessPolicy) en envoyant un email de test
 * DEPUIS la boîte partagée, SANS passer par l'app Next ni par une connexion.
 *
 * Usage (sur une machine qui a les secrets dans .env/.env.local OU l'env) :
 *   node scripts/test-relance-graph.mjs                 → envoie vers RELANCE_TEST_RECIPIENT
 *   node scripts/test-relance-graph.mjs autre@mail.com  → envoie vers cette adresse
 *
 * Lit AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET + RELANCE_FROM_ADDRESS
 * + RELANCE_TEST_RECIPIENT (mêmes variables que l'app).
 */
import fs from "node:fs";
import path from "node:path";

// ── env (.env puis .env.local, déséchappe \$) — même loader que les autres scripts ──
const env = {};
for (const f of [".env", ".env.local"]) {
  const p = path.resolve(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v.replace(/\\\$/g, "$");
  }
}
const g = (k) => process.env[k] ?? env[k] ?? "";

const tenant = g("AZURE_TENANT_ID");
const clientId = g("AZURE_CLIENT_ID");
const clientSecret = g("AZURE_CLIENT_SECRET");
const from = g("RELANCE_FROM_ADDRESS") || "compta@gervifrais.com";
const to = process.argv[2] || g("RELANCE_TEST_RECIPIENT") || "wahofef603@aratrin.com";

function fail(msg) {
  console.error("\n❌ " + msg);
  process.exit(1);
}

if (!tenant || !clientId || !clientSecret) {
  fail(
    `Config manquante (lue dans .env/.env.local ou l'environnement) :\n` +
      `  AZURE_TENANT_ID     = ${tenant ? "ok" : "MANQUANT"}\n` +
      `  AZURE_CLIENT_ID     = ${clientId ? "ok" : "MANQUANT"}\n` +
      `  AZURE_CLIENT_SECRET = ${clientSecret ? "ok" : "MANQUANT"}`,
  );
}

console.log("→ Tenant       :", tenant);
console.log("→ App (client) :", clientId);
console.log("→ Expéditeur   :", from);
console.log("→ Destinataire :", to);

// ── 1) Jeton applicatif (client credentials) ──────────────────────────────
console.log("\n[1/2] Obtention du jeton applicatif Graph…");
const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  }),
});
const tokenData = await tokenRes.json().catch(() => ({}));
if (!tokenRes.ok || !tokenData.access_token) {
  console.error("Réponse:", JSON.stringify(tokenData, null, 2));
  if (tokenData.error === "invalid_client")
    fail("Secret client invalide/expiré (AZURE_CLIENT_SECRET) — vérifie « Certificates & secrets ».");
  if (tokenData.error === "unauthorized_client" || tokenData.error === "invalid_request")
    fail("App ou tenant incorrect (AZURE_CLIENT_ID / AZURE_TENANT_ID).");
  fail(`Échec d'obtention du jeton (HTTP ${tokenRes.status}).`);
}
console.log("    ✅ Jeton applicatif obtenu.");

// ── 2) Envoi du mail de test depuis la boîte partagée ─────────────────────
console.log(`\n[2/2] Envoi d'un email de test depuis ${from}…`);
const sendRes = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
  method: "POST",
  headers: { Authorization: `Bearer ${tokenData.access_token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    message: {
      subject: "Test TeleVent — relance (identité applicative)",
      body: {
        contentType: "HTML",
        content:
          "<p>Test d'envoi depuis la boîte partagée via l'identité applicative Microsoft Graph.</p>" +
          "<p>Si tu reçois ce message, la configuration Azure est correcte. ✅</p>",
      },
      toRecipients: [{ emailAddress: { address: to } }],
    },
    saveToSentItems: true,
  }),
});

if (sendRes.ok) {
  console.log(`    ✅ Email accepté par Graph (HTTP ${sendRes.status}). Vérifie la boîte ${to}.`);
  console.log(`\n🎉 Config Azure validée : l'application peut envoyer depuis ${from}.`);
  process.exit(0);
}

const errBody = await sendRes.json().catch(() => ({}));
console.error("Réponse:", JSON.stringify(errBody, null, 2));
const code = errBody?.error?.code || "";
if (sendRes.status === 403) {
  fail(
    `403 Refusé. Causes probables :\n` +
      `  - permission d'APPLICATION « Mail.Send » non accordée, ou « Grant admin consent » oublié ;\n` +
      `  - ApplicationAccessPolicy en place mais ${from} hors périmètre (ou propagation en cours, ~quelques minutes) ;\n` +
      `  (code Graph : ${code})`,
  );
}
if (sendRes.status === 404) {
  fail(`404 — boîte « ${from} » introuvable. Vérifie RELANCE_FROM_ADDRESS (adresse exacte de la boîte partagée).`);
}
fail(`Échec d'envoi (HTTP ${sendRes.status}, code ${code}).`);
