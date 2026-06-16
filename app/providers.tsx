"use client";

import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { CommandPalette } from "@/components/CommandPalette";

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
          {children}
          <CommandPalette />
        </QueryClientProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
