import React from 'react';

interface CustomTooltipProps {
    active?: boolean;
    payload?: any[];
    label?: string;
    valueFormatter?: (value: number) => string;
}

export function CustomTooltip({ active, payload, label, valueFormatter }: CustomTooltipProps) {
    if (active && payload && payload.length) {
        return (
            <div className="bg-card/90 backdrop-blur-xl border border-border/50 shadow-xl rounded-xl p-4 min-w-[160px]">
                {label && <p className="text-sm font-semibold text-foreground mb-3">{label}</p>}
                <div className="space-y-2">
                    {payload.map((entry, index) => (
                        <div key={index} className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-2">
                                <div
                                    className="w-3 h-3 rounded-full"
                                    style={{ backgroundColor: entry.color }}
                                />
                                <span className="text-xs font-medium text-muted-foreground">
                                    {entry.name}
                                </span>
                            </div>
                            <span className="text-sm font-bold text-foreground">
                                {valueFormatter ? valueFormatter(entry.value) : entry.value}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return null;
}
