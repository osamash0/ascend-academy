import { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { NotificationBell } from '@/components/NotificationBell';
import { useTheme } from '@/lib/theme';

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background selection:bg-primary/20">
        <AppSidebar />
        <main className="flex-1 overflow-x-hidden relative">
          <header className="sticky top-0 z-40 w-full glass-panel border-b-0 px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <SidebarTrigger className="text-muted-foreground hover:text-primary transition-colors" />
            </div>
            <div className="flex items-center gap-3">
              {/* Theme toggle button */}
              <motion.button
                onClick={toggleTheme}
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                className="relative w-14 h-7 rounded-full border border-border bg-surface-2 flex items-center px-1 transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                aria-label="Toggle theme"
              >
                {/* Track fill */}
                <motion.span
                  className="absolute inset-0 rounded-full"
                  animate={{
                    background: theme === 'light'
                      ? 'linear-gradient(90deg, hsl(45 90% 80%), hsl(38 92% 75%))'
                      : 'linear-gradient(90deg, hsl(234 89% 25%), hsl(270 60% 25%))',
                  }}
                  transition={{ duration: 0.3 }}
                />
                {/* Thumb */}
                <motion.span
                  className="relative z-10 w-5 h-5 rounded-full flex items-center justify-center shadow-md"
                  animate={{
                    x: theme === 'light' ? 28 : 0,
                    background: theme === 'light' ? 'hsl(45 90% 55%)' : 'hsl(234 89% 68%)',
                  }}
                  transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                >
                  {theme === 'dark' ? (
                    <Moon className="w-3 h-3 text-white" />
                  ) : (
                    <Sun className="w-3 h-3 text-white" />
                  )}
                </motion.span>
              </motion.button>
              <NotificationBell />
            </div>
          </header>
          <div className="relative z-0">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
