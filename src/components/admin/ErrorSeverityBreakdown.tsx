import React from 'react';

interface ErrorSeverityBreakdownProps {
  errors: Array<{ count: number; level: string }>;
}

/**
 * Severity breakdown derived entirely from the live `errors` prop (real
 * Sentry issue data, or an empty list when Sentry isn't configured).
 *
 * This used to be paired with a fake hardcoded "Error Volume (Last 7 Days)"
 * trend chart with invented per-day counts and hover tooltips. There is no
 * real historical error-volume data source in the backend today, so rather
 * than keep shipping a chart that lies to operators, it was removed outright
 * — an admin seeing no chart is honest; an admin seeing a fabricated one
 * isn't. See Milestone-4/APP_AUDIT_REPORT.md, finding R3.
 */
export function ErrorSeverityBreakdown({ errors }: ErrorSeverityBreakdownProps) {
  const fatalCount = errors.filter(e => e.level === 'fatal').reduce((sum, e) => sum + e.count, 0);
  const errorCount = errors.filter(e => e.level === 'error').reduce((sum, e) => sum + e.count, 0);
  const warnCount = errors.filter(e => e.level === 'warning').reduce((sum, e) => sum + e.count, 0);
  const total = fatalCount + errorCount + warnCount || 1;

  return (
    <div className="grid grid-cols-1 gap-6 mb-8">
      {/* Severity Breakdown (real data — derived from the errors prop) */}
      <div className="p-5 rounded-xl border border-white/10 bg-white/5">
        <h3 className="text-sm font-semibold text-slate-300 mb-4">Severity Breakdown</h3>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-red-400 font-medium">Fatal ({fatalCount})</span>
              <span className="text-slate-400">{Math.round((fatalCount / total) * 100)}%</span>
            </div>
            <div className="h-1.5 bg-black/50 rounded-full overflow-hidden">
              <div className="h-full bg-red-500 rounded-full" style={{ width: `${(fatalCount / total) * 100}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-orange-400 font-medium">Error ({errorCount})</span>
              <span className="text-slate-400">{Math.round((errorCount / total) * 100)}%</span>
            </div>
            <div className="h-1.5 bg-black/50 rounded-full overflow-hidden">
              <div className="h-full bg-orange-500 rounded-full" style={{ width: `${(errorCount / total) * 100}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-yellow-400 font-medium">Warning ({warnCount})</span>
              <span className="text-slate-400">{Math.round((warnCount / total) * 100)}%</span>
            </div>
            <div className="h-1.5 bg-black/50 rounded-full overflow-hidden">
              <div className="h-full bg-yellow-400 rounded-full" style={{ width: `${(warnCount / total) * 100}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
