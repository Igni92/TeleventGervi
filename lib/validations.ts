import { z } from "zod";

// Regex téléphone FR (souple pour l'import CSV)
const frPhoneRegex =
  /^(?:(?:\+|00)33[\s.-]?(?:\(0\)[\s.-]?)?|0)[1-9](?:(?:[\s.-]?\d{2}){4}|\d{2}(?:[\s.-]?\d{2}){3})$/;

export const clientSchema = z.object({
  code: z
    .string()
    .min(1, "Le code client est requis")
    .max(50, "Le code client ne peut pas dépasser 50 caractères"),
  nom: z
    .string()
    .min(1, "Le nom du client est requis")
    .max(200, "Le nom ne peut pas dépasser 200 caractères"),
  type: z
    .enum(["EXPORT", "GMS", "CHR", "MARCHE", "GROSSISTE"])
    .optional()
    .or(z.literal("")),
  commercial: z
    .string()
    .max(100, "Le nom du commercial ne peut pas dépasser 100 caractères")
    .optional()
    .or(z.literal("")),
  tel1: z
    .string()
    .regex(frPhoneRegex, "Format de téléphone invalide (ex: 06 12 34 56 78)")
    .optional()
    .or(z.literal("")),
  tel2: z
    .string()
    .regex(frPhoneRegex, "Format de téléphone invalide (ex: 06 12 34 56 78)")
    .optional()
    .or(z.literal("")),
  tel3: z
    .string()
    .regex(frPhoneRegex, "Format de téléphone invalide (ex: 06 12 34 56 78)")
    .optional()
    .or(z.literal("")),
  email: z
    .string()
    .email("Format d'email invalide")
    .max(200)
    .optional()
    .or(z.literal("")),
  notes: z
    .string()
    .max(2000, "Les notes ne peuvent pas dépasser 2000 caractères")
    .optional()
    .or(z.literal("")),
  // Jours d'appel : tableau de numbers 0-6 (0=Dim, 1=Lun...6=Sam)
  joursAppel: z.array(z.number().min(0).max(6)).optional(),
  // Jours de livraison : même encodage (défaut lun→sam côté UI)
  joursLivraison: z.array(z.number().min(0).max(6)).optional(),
});

export type ClientFormValues = z.infer<typeof clientSchema>;

// ── Fournisseurs (fiche d'ACHAT, distincte du client de VENTE) ──
export const supplierSchema = z.object({
  code: z
    .string()
    .min(1, "Le code fournisseur est requis")
    .max(50, "Le code fournisseur ne peut pas dépasser 50 caractères"),
  nom: z
    .string()
    .min(1, "Le nom du fournisseur est requis")
    .max(200, "Le nom ne peut pas dépasser 200 caractères"),
  // Famille d'achat libre (Fruits, Emballage, Transport…) — liste réutilisable.
  type: z
    .string()
    .max(100, "La famille ne peut pas dépasser 100 caractères")
    .optional()
    .or(z.literal("")),
  // CardCode SAP du fournisseur (BusinessPartner CardType=V) si rattaché.
  sapCardCode: z
    .string()
    .max(50)
    .optional()
    .or(z.literal("")),
  email: z
    .string()
    .email("Format d'email invalide")
    .max(200)
    .optional()
    .or(z.literal("")),
  tel1: z
    .string()
    .regex(frPhoneRegex, "Format de téléphone invalide (ex: 06 12 34 56 78)")
    .optional()
    .or(z.literal("")),
  tel2: z
    .string()
    .regex(frPhoneRegex, "Format de téléphone invalide (ex: 06 12 34 56 78)")
    .optional()
    .or(z.literal("")),
  tel3: z
    .string()
    .regex(frPhoneRegex, "Format de téléphone invalide (ex: 06 12 34 56 78)")
    .optional()
    .or(z.literal("")),
  adresse: z
    .string()
    .max(500, "L'adresse ne peut pas dépasser 500 caractères")
    .optional()
    .or(z.literal("")),
  notes: z
    .string()
    .max(2000, "Les notes ne peuvent pas dépasser 2000 caractères")
    .optional()
    .or(z.literal("")),
});

export type SupplierFormValues = z.infer<typeof supplierSchema>;

// Schema pour l'import CSV (seul le code est obligatoire)
export const clientImportSchema = z.object({
  code: z.string().min(1, "Code requis"),
  nom: z.string().optional().or(z.literal("")),
  tel1: z.string().optional().or(z.literal("")),
  tel2: z.string().optional().or(z.literal("")),
  tel3: z.string().optional().or(z.literal("")),
});

export type ClientImportRow = z.infer<typeof clientImportSchema>;

export const rappelSchema = z.object({
  clientId: z.string().min(1, "L'identifiant client est requis"),
  dateRappel: z
    .string()
    .min(1, "La date et heure du rappel sont requises")
    .refine((val) => {
      const date = new Date(val);
      return !isNaN(date.getTime()) && date > new Date();
    }, "La date du rappel doit être dans le futur"),
  note: z
    .string()
    .max(500)
    .optional()
    .or(z.literal("")),
});

export type RappelFormValues = z.infer<typeof rappelSchema>;

export const appelLogSchema = z.object({
  clientId: z.string().min(1),
  type: z.enum(["COMMANDE", "DEMAIN"]),
  // Issue de l'appel (audit) — optionnel, rétrocompatible avec `type`.
  outcome: z
    .enum(["COMMANDE", "DEMAIN", "NRP", "REFUS", "REPONDEUR", "LITIGE", "RAPPELE"])
    .optional(),
  note: z.string().max(500).optional().or(z.literal("")),
  // Pré-commande : ISO date string. Si présent, le client est snoozé jusqu'à
  // cette date (commande déjà enregistrée, pas besoin de rappeler).
  scheduledFor: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || !isNaN(new Date(v).getTime()), "Date invalide"),
});

export type AppelLogValues = z.infer<typeof appelLogSchema>;

export const clientQuerySchema = z.object({
  search: z.string().optional(),
  type: z.enum(["EXPORT", "GMS", "CHR", "MARCHE", "GROSSISTE", "ALL"]).optional(),
  commercial: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  // onglet J : filtrer les clients à appeler aujourd'hui
  aujourdhui: z.coerce.boolean().optional(),
});
