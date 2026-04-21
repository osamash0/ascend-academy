import { ReactNode } from 'react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { NotificationBell } from '@/components/NotificationBell';

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background selection:bg-primary/20">
        <AppSidebar />
        <main className="flex-1 overflow-x-hidden relative">
          <header className="sticky top-0 z-40 w-full glass-panel border-b-0 px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <SidebarTrigger className="text-muted-foreground hover:text-primary transition-colors" />
            </div>
            <NotificationBell />
          </header>
          <div className="relative z-0">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
