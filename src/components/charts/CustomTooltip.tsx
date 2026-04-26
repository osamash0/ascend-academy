import { motion } from 'framer-motion';

interface TooltipPayloadEntry {
    color: string;
    name: string;
    value: number | string;
}

interface CustomTooltipProps {
    active?: boolean;
    payload?: TooltipPayloadEntry[];
    label?: string;
    valueFormatter?: (value: number | string) => string;
}

export function CustomTooltip({ active, payload, label, valueFormatter }: CustomTooltipProps) {
    if (active && payload && payload.length) {
        return (
            <motion.div 
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className="glass-panel-strong rounded-xl p-4 min-w-[180px] shadow-2xl border-white/20 dark:border-white/10"
            >
                {label && (
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 pb-2 border-b border-white/10 dark:border-white/5">
                        {label}
                    </p>
                )}
                <div className="space-y-2.5">
                    {payload.map((entry, index) => (
                        <div key={index} className="flex items-center justify-between gap-6">
                            <div className="flex items-center gap-2.5">
                                <div
                                    className="w-2.5 h-2.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.1)]"
                                    style={{ backgroundColor: entry.color }}
                                />
                                <span className="text-xs font-semibold text-foreground/80">
                                    {entry.name}
                                </span>
                            </div>
                            <span className="text-sm font-bold text-foreground">
                                {valueFormatter ? valueFormatter(entry.value) : entry.value}
                            </span>
                        </div>
                    ))}
                </div>
            </motion.div>
        );
    }

    return null;
}
