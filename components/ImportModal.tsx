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

function parseCSV(text: string): ParsedRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  // Détecter si la première ligne est un en-tête
  const firstLine = lines[0].toLowerCase();
  const hasHeader =
    firstLine.includes("code") || firstLine.includes("nom") || firstLine.includes("tel");

  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines
    .map((line) => {
      // Gère les virgules et les points-virgules comme séparateur
      const sep = line.includes(";") ? ";" : ",";
      const cols = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
      return {
        code: cols[0] || "",
        nom: cols[1] || "",
        tel1: cols[2] || "",
        tel2: cols[3] || "",
        tel3: cols[4] || "",
      };
    })
    .filter((r) => r.code);
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
      const text = e.target?.result as string;
      const parsed = parseCSV(text);
      setRows(parsed);
      setResult(null);
    };
    reader.readAsText(file, "utf-8");
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
        </DialogHeader>

        <div className="space-y-4">
          {/* Format attendu */}
          <div className="rounded-md bg-slate-50 dark:bg-slate-800/50 border border-border p-3 text-xs text-slate-600 dark:text-slate-300">
            <p className="font-semibold mb-1">Format attendu (séparateur : virgule ou point-virgule) :</p>
            <code className="block font-mono">Code,Nom,Standard,Direct1,Direct2</code>
            <code className="block font-mono text-slate-400 dark:text-slate-500">CLI001,Dupont SA,0612345678,0187654321,</code>
            <p className="mt-1 text-slate-500 dark:text-slate-400">Seul le <strong>Code</strong> est obligatoire. L&apos;en-tête est détecté automatiquement.</p>
          </div>

          {/* Zone de dépôt */}
          {rows.length === 0 && !result && (
            <div
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-8 text-center cursor-pointer hover:border-brand-400 dark:hover:border-brand-500 hover:bg-brand-50/30 dark:hover:bg-brand-900/10 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-8 w-8 mx-auto text-slate-400 dark:text-slate-500 mb-2" />
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                Glissez votre fichier CSV ici ou cliquez pour sélectionner
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Fichiers .csv acceptés</p>
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
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {rows.length} ligne{rows.length > 1 ? "s" : ""} détectée{rows.length > 1 ? "s" : ""}
                </p>
                <Button variant="ghost" size="sm" onClick={reset} className="gap-1">
                  <X className="h-3.5 w-3.5" /> Annuler
                </Button>
              </div>

              <div className="rounded-md border border-border overflow-auto max-h-52">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 sticky top-0">
                    <tr>
                      {["Code", "Nom", "Standard", "Direct 1", "Direct 2"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-slate-600 dark:text-slate-400">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 20).map((row, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-1.5 font-mono font-medium text-foreground">{row.code}</td>
                        <td className="px-3 py-1.5 text-foreground">{row.nom || <span className="text-slate-400 dark:text-slate-600">—</span>}</td>
                        <td className="px-3 py-1.5 font-mono text-foreground">{row.tel1 || <span className="text-slate-400 dark:text-slate-600">—</span>}</td>
                        <td className="px-3 py-1.5 font-mono text-foreground">{row.tel2 || <span className="text-slate-400 dark:text-slate-600">—</span>}</td>
                        <td className="px-3 py-1.5 font-mono text-foreground">{row.tel3 || <span className="text-slate-400 dark:text-slate-600">—</span>}</td>
                      </tr>
                    ))}
                    {rows.length > 20 && (
                      <tr className="border-t border-border bg-slate-50 dark:bg-slate-800/40">
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
