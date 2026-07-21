"use client";

import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { CommandPalette } from "@/components/CommandPalette";
import { HoverContrastGate } from "@/components/settings/HoverContrastGate";
import { UsageTracker } from "@/components/UsageTracker";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 60 * 1000 },
        },
      })
  );

  return (
    <ThemeProvider>
      <SessionProvider>
        <QueryClientProvider client={queryClient}>
          <HoverContrastGate />
          {children}
          <CommandPalette />
          {/* Analytique d'usage — temps + clics + problèmes par écran (audit). */}
          <UsageTracker />
        </QueryClientProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
