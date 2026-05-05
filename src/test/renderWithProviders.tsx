import { ReactElement, ReactNode } from "react";
import { render, RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "next-themes";

interface Options extends Omit<RenderOptions, "wrapper"> {
  initialEntries?: string[];
}

import * as AuthModule from "@/lib/auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

function AllProviders({
  children,
  initialEntries,
}: {
  children: ReactNode;
  initialEntries?: string[];
}) {
  let AuthProvider: any;
  try {
    AuthProvider = (AuthModule as any).AuthProvider;
  } catch (e) {
    AuthProvider = null;
  }
  
  if (!AuthProvider) {
    AuthProvider = ({ children }: { children: ReactNode }) => <>{children}</>;
  }
  
  const content = (
    <MemoryRouter initialEntries={initialEntries ?? ["/"]}>
      <ThemeProvider attribute="class" defaultTheme="light">
        {children}
      </ThemeProvider>
    </MemoryRouter>
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{content}</AuthProvider>
    </QueryClientProvider>
  );
}

export function renderWithProviders(ui: ReactElement, opts: Options = {}) {
  const { initialEntries, ...rest } = opts;
  return render(ui, {
    wrapper: ({ children }) => (
      <AllProviders initialEntries={initialEntries}>{children}</AllProviders>
    ),
    ...rest,
  });
}
