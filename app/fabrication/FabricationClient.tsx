"use client";

import { useState } from "react";
import { Factory, BookOpen, History } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { FabriquerPanel } from "./FabriquerPanel";
import { RecettesPanel } from "./RecettesPanel";
import { RunsHistory } from "./RunsHistory";

/**
 * Orchestrateur client de la page Fabrication.
 *   - « Fabriquer » seul à l'écran par défaut (le geste quotidien) ;
 *   - « Recettes » et « Historique » derrière des onglets (SegmentedControl),
 *     pour ne pas noyer l'action principale.
 * Les compteurs de version forcent le rechargement croisé entre panneaux.
 */
type Tab = "fabriquer" | "recettes" | "historique";

export function FabricationClient() {
  const [tab, setTab] = useState<Tab>("fabriquer");
  const [recipesVersion, setRecipesVersion] = useState(0);
  const [runsVersion, setRunsVersion] = useState(0);

  return (
    <div className="space-y-5">
      <SegmentedControl<Tab>
        value={tab}
        onChange={setTab}
        aria-label="Sections fabrication"
        className="max-w-md"
        options={[
          { value: "fabriquer", label: "Fabriquer", icon: <Factory /> },
          { value: "recettes", label: "Recettes", icon: <BookOpen /> },
          { value: "historique", label: "Historique", icon: <History /> },
        ]}
      />

      {tab === "fabriquer" && (
        <FabriquerPanel
          recipesVersion={recipesVersion}
          onRunDone={() => setRunsVersion((v) => v + 1)}
        />
      )}
      {tab === "recettes" && (
        <RecettesPanel onRecipesChanged={() => setRecipesVersion((v) => v + 1)} />
      )}
      {tab === "historique" && <RunsHistory version={runsVersion} />}
    </div>
  );
}
