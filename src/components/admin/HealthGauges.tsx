import React from 'react';
import { motion } from 'framer-motion';
import { Activity, Database, Cpu, BrainCircuit } from 'lucide-react';
import { DeploymentTelemetry } from '@/services/adminService';

interface HealthGaugesProps {
  info: DeploymentTelemetry | null;
  loading: boolean;
}

export function HealthGauges({ info, loading }: HealthGaugesProps) {
  if (loading || !info) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-32 bg-white/5 animate-pulse rounded-xl border border-white/10" />
        ))}
      </div>
    );
  }

  const { health } = info;
  const dbMax = parseInt(String(info.environment.DB_POOL_MAX || '20'), 10);
  const dbUsagePercent = Math.min((health.database_connections / dbMax) * 100, 100);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
      case 'connected':
      case 'active':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'unhealthy':
      case 'disconnected':
      case 'error':
        return 'text-red-400 bg-red-500/10 border-red-500/20';
      default:
        return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    }
  };

  const getPulseColor = (status: string) => {
    switch (status) {
      case 'healthy':
      case 'connected':
      case 'active':
        return 'bg-emerald-500';
      case 'unhealthy':
      case 'disconnected':
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-amber-500';
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
      {/* Overall Platform */}
      <div className="p-5 rounded-xl border border-white/10 bg-white/5 flex flex-col justify-between relative overflow-hidden">
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-2 text-slate-300 font-medium">
            <Activity className="w-4 h-4 text-blue-400" />
            <span>Platform API</span>
          </div>
          <div className="flex h-3 w-3 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
          </div>
        </div>
        <div>
          <div className="text-2xl font-bold text-white mb-1">99.99%</div>
          <div className="text-xs text-slate-500">Uptime (30 days)</div>
        </div>
      </div>

      {/* Database Pool */}
      <div className="p-5 rounded-xl border border-white/10 bg-white/5 flex flex-col justify-between">
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-2 text-slate-300 font-medium">
            <Database className="w-4 h-4 text-purple-400" />
            <span>DB Connections</span>
          </div>
          <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${getStatusColor(health.database)}`}>
            {health.database}
          </span>
        </div>
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-white font-medium">{health.database_connections} / {dbMax} used</span>
            <span className="text-slate-400">{Math.round(dbUsagePercent)}%</span>
          </div>
          <div className="h-2 bg-black/50 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${dbUsagePercent}%` }}
              transition={{ duration: 1 }}
              className={`h-full rounded-full ${
                dbUsagePercent > 80 ? 'bg-red-500' : dbUsagePercent > 60 ? 'bg-amber-400' : 'bg-emerald-500'
              }`} 
            />
          </div>
        </div>
      </div>

      {/* AI Services */}
      <div className="p-5 rounded-xl border border-white/10 bg-white/5 flex flex-col justify-between">
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-2 text-slate-300 font-medium">
            <BrainCircuit className="w-4 h-4 text-orange-400" />
            <span>AI Pipeline</span>
          </div>
          <div className="flex h-3 w-3 relative">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${getPulseColor(health.ai_services)}`}></span>
            <span className={`relative inline-flex rounded-full h-3 w-3 ${getPulseColor(health.ai_services)}`}></span>
          </div>
        </div>
        <div>
          <div className={`inline-flex px-2 py-1 rounded text-xs uppercase font-bold border ${getStatusColor(health.ai_services)}`}>
            {health.ai_services.replace('_', ' ')}
          </div>
        </div>
      </div>

      {/* App Environment */}
      <div className="p-5 rounded-xl border border-white/10 bg-white/5 flex flex-col justify-between">
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-2 text-slate-300 font-medium">
            <Cpu className="w-4 h-4 text-teal-400" />
            <span>Environment</span>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold border border-white/10 text-slate-300 bg-black/40">
            {info.deployments.app_version}
          </span>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">OS</span>
            <span className="text-white font-mono">{info.system.os}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Python</span>
            <span className="text-white font-mono">{info.system.python_version}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
