import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { TransportWorkspace } from "@/components/transport/TransportWorkspace";

export const metadata = { title: "Expéditions" };
export const dynamic = "force-dynamic";

export default async function ExpeditionsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  return (
    <div className="space-y-6 animate-fade-up max-sm:space-y-3">
      <TransportWorkspace />
    </div>
  );
}
