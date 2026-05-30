import { ReactElement, ReactNode } from "react";
import { render, RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "next-themes";

interface Options extends Omit<RenderOptions, "wrapper"> {
  initialEntries?: string[];
}

function AllProviders({
  children,
  initialEntries,
}: {
  children: ReactNode;
  initialEntries?: string[];
}) {
  return (
    <MemoryRouter initialEntries={initialEntries ?? ["/"]}>
      <ThemeProvider attribute="class" defaultTheme="light">
        {children}
      </ThemeProvider>
    </MemoryRouter>
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
