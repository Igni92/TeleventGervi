"use client";

import { useState } from "react";
import { FabriquerPanel } from "./FabriquerPanel";
import { RecettesPanel } from "./RecettesPanel";
import { RunsHistory } from "./RunsHistory";

/**
 * Orchestrateur client de la page Fabrication :
 *   - Fabriquer (run de production, lots tracés)
 *   - Recettes (familles + ratio « tour »)
 *   - Historique des runs (en bas)
 * Les compteurs de version forcent le rechargement croisé entre panneaux.
 */
export function FabricationClient() {
  const [recipesVersion, setRecipesVersion] = useState(0);
  const [runsVersion, setRunsVersion] = useState(0);

  return (
    <div className="space-y-6">
      <FabriquerPanel
        recipesVersion={recipesVersion}
        onRunDone={() => setRunsVersion((v) => v + 1)}
      />
      <RecettesPanel onRecipesChanged={() => setRecipesVersion((v) => v + 1)} />
      <RunsHistory version={runsVersion} />
    </div>
  );
}
