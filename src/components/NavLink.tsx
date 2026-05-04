import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { memo, useMemo } from 'react';

interface NavLinkProps {
  to: string;
  icon: LucideIcon;
  label: string;
  badge?: number;
}

export const NavLink = memo(function NavLink({ to, icon: Icon, label, badge }: NavLinkProps) {
  const location = useLocation();
  const isActive = useMemo(() => location.pathname === to, [location.pathname, to]);

  return (
    <Link
      to={to}
      className={`relative flex items-center gap-3 px-4 py-3 rounded-[14px] transition-all duration-300 group ${
        isActive
          ? 'bg-primary/10 text-primary shadow-glow-primary/10 border border-primary/20'
          : 'text-muted-foreground hover:bg-white/5 hover:text-foreground border border-transparent'
      }`}
      aria-current={isActive ? 'page' : undefined}
    >
      {isActive && (
        <motion.div
          layoutId="activeNavIndicator"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-primary shadow-glow-primary"
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        />
      )}

      <div className={`relative transition-transform duration-300 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`}>
        <Icon className="w-5 h-5" aria-hidden="true" />
        {badge !== undefined && badge > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-destructive text-white text-[9px] font-bold flex items-center justify-center shadow-sm">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </div>

      <span className="font-bold tracking-tight text-sm">{label}</span>
    </Link>
  );
});
