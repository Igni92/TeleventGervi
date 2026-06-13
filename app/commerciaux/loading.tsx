import { PageLoader } from "@/components/ui/page-loader";

/** Suspense de section — la sidebar reste visible, le contenu charge. */
export default function Loading() {
  return <PageLoader label="Commerciaux" />;
}
