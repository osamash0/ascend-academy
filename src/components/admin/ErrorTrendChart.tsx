import React from 'react';
import { motion } from 'framer-motion';

interface ErrorTrendChartProps {
  errors: Array<{ count: number; level: string }>;
}

export function ErrorTrendChart({ errors }: ErrorTrendChartProps) {
  // Mock data for a trend line (since we don't have historical data in the SentryError interface)
  const mockData = [12, 19, 15, 25, 22, 30, 28];
  const max = Math.max(...mockData);
  
  const fatalCount = errors.filter(e => e.level === 'fatal').reduce((sum, e) => sum + e.count, 0);
  const errorCount = errors.filter(e => e.level === 'error').reduce((sum, e) => sum + e.count, 0);
  const warnCount = errors.filter(e => e.level === 'warning').reduce((sum, e) => sum + e.count, 0);
  const total = fatalCount + errorCount + warnCount || 1;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      {/* 7-Day Trend (Mocked representation) */}
      <div className="col-span-2 p-5 rounded-xl border border-white/10 bg-white/5 relative overflow-hidden">
        <h3 className="text-sm font-semibold text-slate-300 mb-4">Error Volume (Last 7 Days)</h3>
        <div className="h-24 flex items-end justify-between gap-2">
          {mockData.map((val, idx) => (
            <div key={idx} className="w-full relative group h-full flex items-end">
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${(val / max) * 100}%` }}
                transition={{ duration: 0.5, delay: idx * 0.1 }}
                className="w-full bg-blue-500/40 rounded-t-sm hover:bg-blue-400/60 transition-colors cursor-pointer"
              />
              <div className="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 bg-black/80 text-white text-xs py-1 px-2 rounded whitespace-nowrap pointer-events-none transition-opacity">
                {val} errors
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Severity Breakdown */}
      <div className="p-5 rounded-xl border border-white/10 bg-white/5 flex flex-col justify-center">
        <h3 className="text-sm font-semibold text-slate-300 mb-4">Severity Breakdown</h3>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-red-400 font-medium">Fatal ({fatalCount})</span>
              <span className="text-slate-400">{Math.round((fatalCount/total)*100)}%</span>
            </div>
            <div className="h-1.5 bg-black/50 rounded-full overflow-hidden">
              <div className="h-full bg-red-500 rounded-full" style={{ width: `${(fatalCount/total)*100}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-orange-400 font-medium">Error ({errorCount})</span>
              <span className="text-slate-400">{Math.round((errorCount/total)*100)}%</span>
            </div>
            <div className="h-1.5 bg-black/50 rounded-full overflow-hidden">
              <div className="h-full bg-orange-500 rounded-full" style={{ width: `${(errorCount/total)*100}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-yellow-400 font-medium">Warning ({warnCount})</span>
              <span className="text-slate-400">{Math.round((warnCount/total)*100)}%</span>
            </div>
            <div className="h-1.5 bg-black/50 rounded-full overflow-hidden">
              <div className="h-full bg-yellow-400 rounded-full" style={{ width: `${(warnCount/total)*100}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
