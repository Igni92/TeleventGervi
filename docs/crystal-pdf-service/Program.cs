// Service d'export PDF des factures Crystal pour SAP Business One 10.0 (HANA).
// Référence à adapter par l'équipe infra/SAP (EDOS) — voir README.md.
//
// Prérequis :
//   - .NET (6/8) sur un hôte Windows voyant la base HANA
//   - SAP Crystal Reports runtime engine for .NET  (NuGet: CrystalDecisions.* / SAP)
//   - Driver HANA ODBC (HDBODBC)
//   - Le fichier .rpt de la facture exporté depuis SAP (Gestionnaire d'états)
//
// Contrat : GET /invoice-pdf?docEntry=NNN  ->  application/pdf
//
// Variables d'environnement :
//   RPT_PATH        chemin du .rpt facture (ex. C:\layouts\Invoice.rpt)
//   HANA_SERVER     ex. hana-host:30015
//   HANA_DB         schéma de la société (ex. SBO_GERVIFRAIS)
//   HANA_USER / HANA_PASSWORD
//   DOCKEY_PARAM    nom du paramètre de sélection (défaut "DocKey@")
//   API_KEY         (optionnel) jeton attendu en "Authorization: Bearer ..."

using CrystalDecisions.CrystalReports.Engine;
using CrystalDecisions.Shared;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

string Env(string k, string def = "") => Environment.GetEnvironmentVariable(k) ?? def;

app.MapGet("/invoice-pdf", (HttpContext ctx, int docEntry) =>
{
    // Auth optionnelle
    var apiKey = Env("API_KEY");
    if (!string.IsNullOrEmpty(apiKey))
    {
        var auth = ctx.Request.Headers.Authorization.ToString();
        if (auth != $"Bearer {apiKey}") return Results.Unauthorized();
    }

    var rptPath = Env("RPT_PATH");
    if (!File.Exists(rptPath)) return Results.Problem($"RPT introuvable: {rptPath}");

    using var report = new ReportDocument();
    report.Load(rptPath);

    // Connexion HANA (ODBC) pour TOUTES les tables du rapport.
    var logon = new ConnectionInfo
    {
        ServerName = Env("HANA_SERVER"),   // ex. "hana-host:30015"
        DatabaseName = Env("HANA_DB"),     // schéma société
        UserID = Env("HANA_USER"),
        Password = Env("HANA_PASSWORD"),
    };
    foreach (Table table in report.Database.Tables)
    {
        var ti = table.LogOnInfo;
        ti.ConnectionInfo = logon;
        table.ApplyLogOnInfo(ti);
    }

    // Paramètre de sélection du document (DocKey@ en standard B1).
    var docKeyParam = Env("DOCKEY_PARAM", "DocKey@");
    report.SetParameterValue(docKeyParam, docEntry);

    // Export PDF en mémoire.
    using var stream = report.ExportToStream(ExportFormatType.PortableDocFormat);
    using var ms = new MemoryStream();
    stream.CopyTo(ms);
    return Results.File(ms.ToArray(), "application/pdf", $"Facture-{docEntry}.pdf");
});

app.Run();
