import React from 'react';
import { motion } from 'framer-motion';
import { Users, BookOpen, Activity, AlertCircle, Server } from 'lucide-react';
import { PlatformStats, DeploymentTelemetry } from '@/services/adminService';
import { Button } from '@/components/ui/button';

interface AdminKPISummaryProps {
  stats: PlatformStats | null;
  telemetry?: DeploymentTelemetry | null;
  loading: boolean;
  /** True when loadStats() failed — rendered distinctly from `loading` so a
   * failed fetch doesn't pulse the skeleton forever with no message or way
   * to retry. */
  isError?: boolean;
  onRetry?: () => void;
}

export function AdminKPISummary({ stats, telemetry, loading, isError = false, onRetry }: AdminKPISummaryProps) {
  if (isError && !stats) {
    return (
      <div
        className="mb-8 p-6 rounded-xl border border-red-500/20 bg-red-500/10 flex flex-col md:flex-row md:items-center justify-between gap-4"
        data-testid="admin-kpi-error"
      >
        <div>
          <p className="text-sm font-semibold text-red-300">Couldn't load platform stats</p>
          <p className="text-xs text-red-300/70 mt-1">Something went wrong reaching the server. Please try again.</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-red-500/30 text-red-300 hover:bg-red-500/10 shrink-0"
          onClick={onRetry}
        >
          Try Again
        </Button>
      </div>
    );
  }

  if (loading || !stats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-24 bg-white/5 animate-pulse rounded-xl border border-white/10" />
        ))}
      </div>
    );
  }

  // Derived from the real /deployment-info health check (not a literal) — the
  // tile reads "Unknown" rather than assuming health when telemetry hasn't
  // loaded yet or failed to load.
  const apiStatus = telemetry?.health.api ?? null;
  const systemHealthValue = apiStatus === null ? 'Unknown' : apiStatus === 'healthy' ? 'Online' : 'Degraded';
  const systemHealthSub = apiStatus === null
    ? 'Health data unavailable'
    : apiStatus === 'healthy'
      ? 'All systems operational'
      : 'A dependency is unreachable — see Health Status';
  const systemHealthColor = apiStatus === null ? 'text-slate-400' : apiStatus === 'healthy' ? 'text-teal-400' : 'text-red-400';
  const systemHealthGradient = apiStatus === null
    ? 'from-slate-500/10 to-transparent'
    : apiStatus === 'healthy'
      ? 'from-teal-500/10 to-transparent'
      : 'from-red-500/10 to-transparent';

  const kpis = [
    {
      title: 'Total Users',
      value: stats.users.total,
      subValue: `${stats.users.active_24h} active 24h`,
      icon: <Users className="w-5 h-5 text-blue-400" />,
      gradient: 'from-blue-500/10 to-transparent'
    },
    {
      title: 'Professors',
      value: stats.users.professors,
      subValue: 'Content creators',
      icon: <BookOpen className="w-5 h-5 text-purple-400" />,
      gradient: 'from-purple-500/10 to-transparent'
    },
    {
      title: 'Active Content',
      value: stats.content.courses,
      subValue: `${stats.content.lectures} total lectures`,
      icon: <Activity className="w-5 h-5 text-emerald-400" />,
      gradient: 'from-emerald-500/10 to-transparent'
    },
    {
      title: 'AI Cost (MTD)',
      value: `$${stats.financial.month_llm_cost_usd.toFixed(2)}`,
      subValue: 'Month to date',
      icon: <AlertCircle className="w-5 h-5 text-orange-400" />,
      gradient: 'from-orange-500/10 to-transparent'
    },
    {
      title: 'System Health',
      value: systemHealthValue,
      subValue: systemHealthSub,
      icon: <Server className={`w-5 h-5 ${systemHealthColor}`} />,
      gradient: systemHealthGradient
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
      {kpis.map((kpi, idx) => (
        <motion.div
          key={kpi.title}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.1 }}
          className={`relative overflow-hidden rounded-xl border border-white/10 bg-black/40 backdrop-blur-xl p-5`}
        >
          <div className={`absolute inset-0 bg-gradient-to-br ${kpi.gradient} opacity-50`} />
          <div className="relative z-10">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-sm font-medium text-slate-400">{kpi.title}</h3>
              <div className="p-2 bg-white/5 rounded-lg border border-white/5">
                {kpi.icon}
              </div>
            </div>
            <div>
              <p className="text-2xl font-bold text-white tracking-tight">{kpi.value}</p>
              <p className="text-xs text-slate-500 mt-1">{kpi.subValue}</p>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
