import { FullscreenLoader } from "@/components/ui/page-loader";

/** Cockpit plein écran — pas d'AppLayout, loader plein viewport. */
export default function Loading() {
  return <FullscreenLoader label="Palmarès magasins" />;
}
