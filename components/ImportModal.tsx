"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { Upload, FileText, Loader2, CheckCircle, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ParsedRow {
  code: string;
  nom: string;
  tel1: string;
  tel2: string;
  tel3: string;
}

interface ImportResult {
  created: number;
  updated: number;
  errors: string[];
  total: number;
}

interface ImportModalProps {
  onImported?: () => void;
}

interface ParseOutcome {
  rows: ParsedRow[];
  duplicates: number; // nombre de lignes fusionnées (même code)
}

/**
 * Décode un fichier CSV en texte.
 * - Gère le BOM UTF-8.
 * - Décode en UTF-8 d'abord ; si le caractère de remplacement `�` (U+FFFD)
 *   apparaît (typique d'un export Excel FR en Latin1/Windows-1252),
 *   redécode l'intégralité en windows-1252.
 */
function decodeCsv(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // BOM UTF-8 (EF BB BF) → on laisse TextDecoder le gérer en mode non-fatal,
  // mais on le retire explicitement après décodage par sécurité.
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  let text = utf8;
  if (utf8.includes("�")) {
    try {
      text = new TextDecoder("windows-1252").decode(bytes);
    } catch {
      // Environnement sans support windows-1252 → on garde l'UTF-8.
      text = utf8;
    }
  }
  // Retrait du BOM résiduel s'il subsiste.
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parser CSV correct (RFC 4180) :
 *   - champs entre guillemets `"..."` : le séparateur à l'intérieur est ignoré ;
 *   - guillemets échappés `""` → `"` ;
 *   - retours chariot `\r` (CRLF/CR/LF) gérés, y compris dans un champ quoté.
 * Le séparateur est détecté UNE SEULE FOIS sur la 1re ligne (compte , vs ;).
 */
function parseCsvRecords(text: string, sep: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // guillemet échappé
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === sep) {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r") {
      // \r seul ou \r\n → fin de ligne
      pushRecord();
      i += text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (ch === "\n") {
      pushRecord();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Dernier champ/enregistrement si le fichier ne finit pas par un saut de ligne.
  if (field.length > 0 || record.length > 0) pushRecord();
  return records;
}

/** Détecte le séparateur (`,` ou `;`) sur la 1re ligne brute, hors guillemets. */
function detectSeparator(text: string): string {
  const firstLineEnd = text.search(/[\r\n]/);
  const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
  let comma = 0;
  let semi = 0;
  let inQuotes = false;
  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === ",") comma++;
    else if (!inQuotes && ch === ";") semi++;
  }
  return semi > comma ? ";" : ",";
}

function parseCSV(text: string): ParseOutcome {
  if (!text.trim()) return { rows: [], duplicates: 0 };

  const sep = detectSeparator(text);
  const records = parseCsvRecords(text, sep)
    .map((cols) => cols.map((c) => c.trim()))
    // Ignore les lignes entièrement vides.
    .filter((cols) => cols.some((c) => c.length > 0));

  if (records.length === 0) return { rows: [], duplicates: 0 };

  // Détection d'en-tête sur la 1re ligne parsée.
  const firstJoined = records[0].join(" ").toLowerCase();
  const hasHeader =
    firstJoined.includes("code") ||
    firstJoined.includes("nom") ||
    firstJoined.includes("tel");

  const dataRecords = hasHeader ? records.slice(1) : records;

  // Dédoublonnage par code (dernier gagne) tout en conservant l'ordre d'apparition.
  const byCode = new Map<string, ParsedRow>();
  let duplicates = 0;
  for (const cols of dataRecords) {
    const code = (cols[0] || "").trim();
    if (!code) continue;
    const key = code.toUpperCase();
    if (byCode.has(key)) duplicates++;
    byCode.set(key, {
      code,
      nom: cols[1] || "",
      tel1: cols[2] || "",
      tel2: cols[3] || "",
      tel3: cols[4] || "",
    });
  }

  return { rows: Array.from(byCode.values()), duplicates };
}

export function ImportModal({ onImported }: ImportModalProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const buffer = e.target?.result;
      if (!(buffer instanceof ArrayBuffer)) {
        toast.error("Lecture du fichier impossible");
        return;
      }
      const text = decodeCsv(buffer);
      const { rows: parsed, duplicates } = parseCSV(text);
      setRows(parsed);
      setResult(null);
      if (parsed.length === 0) {
        toast.error("Aucune ligne valide détectée dans le fichier");
      } else if (duplicates > 0) {
        toast.warning(
          `${duplicates} doublon${duplicates > 1 ? "s" : ""} de code fusionné${duplicates > 1 ? "s" : ""} (dernière occurrence conservée)`,
        );
      }
    };
    reader.onerror = () => toast.error("Erreur de lecture du fichier");
    reader.readAsArrayBuffer(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    if (rows.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/clients/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
      toast.success(`Import terminé : ${data.created} créés, ${data.updated} mis à jour`);
      onImported?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur d'import");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setRows([]);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Upload className="h-4 w-4" />
          Importer CSV
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            Import clients depuis CSV
          </DialogTitle>
          <DialogDescription className="sr-only">
            Importez une liste de clients depuis un fichier CSV (code, nom, téléphones).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Format attendu */}
          <div className="rounded-md bg-secondary/60 border border-border p-3 text-xs text-foreground/80">
            <p className="font-semibold mb-1">Format attendu (séparateur : virgule ou point-virgule) :</p>
            <code className="block font-mono">Code,Nom,Standard,Direct1,Direct2</code>
            <code className="block font-mono text-muted-foreground/70">CLI001,Dupont SA,0612345678,0187654321,</code>
            <p className="mt-1 text-muted-foreground">Seul le <strong>Code</strong> est obligatoire. L&apos;en-tête est détecté automatiquement.</p>
          </div>

          {/* Zone de dépôt */}
          {rows.length === 0 && !result && (
            <div
              className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-brand-400 dark:hover:border-brand-500 hover:bg-brand-500/5 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-8 w-8 mx-auto text-muted-foreground/70 mb-2" />
              <p className="text-sm font-medium text-foreground/80">
                Glissez votre fichier CSV ici ou cliquez pour sélectionner
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">Fichiers .csv acceptés</p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
              />
            </div>
          )}

          {/* Aperçu des données */}
          {rows.length > 0 && !result && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground/80">
                  {rows.length} ligne{rows.length > 1 ? "s" : ""} détectée{rows.length > 1 ? "s" : ""}
                </p>
                <Button variant="ghost" size="sm" onClick={reset} className="gap-1">
                  <X className="h-3.5 w-3.5" /> Annuler
                </Button>
              </div>

              <div className="rounded-md border border-border overflow-auto max-h-52">
                <table className="w-full text-xs">
                  <thead className="bg-secondary/60 sticky top-0">
                    <tr>
                      {["Code", "Nom", "Standard", "Direct 1", "Direct 2"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 20).map((row, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-1.5 font-mono font-medium text-foreground">{row.code}</td>
                        <td className="px-3 py-1.5 text-foreground">{row.nom || <span className="text-muted-foreground/50">—</span>}</td>
                        <td className="px-3 py-1.5 font-mono text-foreground">{row.tel1 || <span className="text-muted-foreground/50">—</span>}</td>
                        <td className="px-3 py-1.5 font-mono text-foreground">{row.tel2 || <span className="text-muted-foreground/50">—</span>}</td>
                        <td className="px-3 py-1.5 font-mono text-foreground">{row.tel3 || <span className="text-muted-foreground/50">—</span>}</td>
                      </tr>
                    ))}
                    {rows.length > 20 && (
                      <tr className="border-t border-border bg-secondary/40">
                        <td colSpan={5} className="px-3 py-1.5 text-center text-muted-foreground">
                          ... et {rows.length - 20} autre{rows.length - 20 > 1 ? "s" : ""} lignes
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <Button
                onClick={handleImport}
                disabled={loading}
                className="w-full"
              >
                {loading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Import en cours...</>
                ) : (
                  <><Upload className="mr-2 h-4 w-4" />Importer {rows.length} client{rows.length > 1 ? "s" : ""}</>
                )}
              </Button>
            </div>
          )}

          {/* Résultat */}
          {result && (
            <div className="space-y-3">
              <div className="rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-500/30 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                  <span className="font-semibold text-green-800 dark:text-green-300">Import terminé</span>
                </div>
                <div className="text-sm text-green-700 dark:text-green-400 space-y-1">
                  <p>✅ {result.created} client{result.created > 1 ? "s" : ""} créé{result.created > 1 ? "s" : ""}</p>
                  <p>🔄 {result.updated} client{result.updated > 1 ? "s" : ""} mis à jour</p>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                    <span className="text-sm font-semibold text-red-800 dark:text-red-300">
                      {result.errors.length} erreur{result.errors.length > 1 ? "s" : ""}
                    </span>
                  </div>
                  <ul className="text-xs text-red-700 dark:text-red-400 space-y-0.5">
                    {result.errors.map((e, i) => <li key={i}>• {e}</li>)}
                  </ul>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" onClick={reset} className="flex-1">
                  Nouvel import
                </Button>
                <Button onClick={() => setOpen(false)} className="flex-1">
                  Fermer
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
