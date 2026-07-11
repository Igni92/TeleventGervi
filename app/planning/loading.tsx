import { PageLoader } from "@/components/ui/page-loader";

/** Suspense de section — la coquille reste visible, le contenu charge. */
export default function Loading() {
  return <PageLoader label="Planning" />;
}
