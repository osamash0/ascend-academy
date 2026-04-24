import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, CheckCircle2 } from 'lucide-react';
import { Button } from './ui/button';

interface Slide {
    id: string;
    slide_number: number;
    title: string | null;
}

interface LectureSidebarProps {
    slides: Slide[];
    currentSlideIndex: number;
    completedSlides?: number[];
    onSelectSlide: (index: number) => void;
    isCollapsed: boolean;
    onToggle: () => void;
}

export function LectureSidebar({
    slides,
    currentSlideIndex,
    completedSlides = [],
    onSelectSlide,
    isCollapsed,
    onToggle,
}: LectureSidebarProps) {
    const activeRef = useRef<HTMLButtonElement>(null);

    // Auto-scroll active slide into view
    useEffect(() => {
        activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [currentSlideIndex]);

    const progressPct = slides.length > 1
        ? (currentSlideIndex / (slides.length - 1)) * 100
        : 100;

    return (
        <motion.div
            initial={false}
            animate={{ width: isCollapsed ? 64 : 280 }}
            className="h-full bg-card border-r border-border flex flex-col relative overflow-hidden"
            style={{ flexShrink: 0 }}
        >
            {/* Toggle Button */}
            <Button
                variant="ghost"
                size="icon"
                onClick={onToggle}
                className="absolute -right-4 top-10 z-20 bg-card border border-border rounded-full shadow-md hover:bg-accent"
            >
                {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </Button>

            {/* Header */}
            <div className="p-4 border-b border-border flex-shrink-0">
                {!isCollapsed ? (
                    <div>
                        <h2 className="font-bold text-foreground text-sm">Course Content</h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {currentSlideIndex + 1} of {slides.length} slides
                        </p>
                    </div>
                ) : (
                    <div className="flex justify-center">
                        <CheckCircle2 className="w-5 h-5 text-primary" />
                    </div>
                )}
            </div>

            {/* Timeline list */}
            <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
                <div className="relative">
                    {/* Vertical track line */}
                    {!isCollapsed && (
                        <div className="absolute left-[27px] top-3 bottom-3 w-0.5 bg-border z-0" />
                    )}

                    {/* Filled progress line */}
                    {!isCollapsed && slides.length > 1 && (
                        <motion.div
                            className="absolute left-[27px] top-3 w-0.5 bg-primary z-0 origin-top"
                            initial={{ height: 0 }}
                            animate={{ height: `calc(${progressPct}% - 12px)` }}
                            transition={{ duration: 0.4, ease: 'easeOut' }}
                        />
                    )}

                    <div className="space-y-1 px-3">
                        {slides.map((slide, index) => {
                            const isActive = index === currentSlideIndex;
                            const isDone = completedSlides.includes(slide.slide_number) || index < currentSlideIndex;

                            return (
                                <button
                                    key={slide.id}
                                    ref={isActive ? activeRef : undefined}
                                    onClick={() => onSelectSlide(index)}
                                    className={`w-full flex items-center gap-3 py-2 px-1 rounded-xl transition-all duration-200 group relative z-10 ${isActive
                                            ? 'text-primary'
                                            : isDone
                                                ? 'text-success'
                                                : 'text-muted-foreground hover:text-foreground'
                                        } cursor-pointer`}
                                >
                                    {/* Node */}
                                    <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                                        {isDone ? (
                                            <motion.div
                                                initial={{ scale: 0 }}
                                                animate={{ scale: 1 }}
                                                className="w-5 h-5 rounded-full bg-success flex items-center justify-center"
                                            >
                                                <CheckCircle2 className="w-3.5 h-3.5 text-success-foreground" />
                                            </motion.div>
                                        ) : isActive ? (
                                            <motion.div
                                                className="w-5 h-5 rounded-full border-2 border-primary flex items-center justify-center"
                                                animate={{ boxShadow: ['0 0 0 0 rgba(var(--primary),0.4)', '0 0 0 6px rgba(var(--primary),0)', '0 0 0 0 rgba(var(--primary),0)'] }}
                                                transition={{ duration: 1.5, repeat: Infinity }}
                                            >
                                                <div className="w-2 h-2 rounded-full bg-primary" />
                                            </motion.div>
                                        ) : (
                                            <div className="w-4 h-4 rounded-full border-2 border-border group-hover:border-muted-foreground transition-colors" />
                                        )}
                                    </div>

                                    {/* Label */}
                                    {!isCollapsed && (
                                        <div className="flex-1 text-left min-w-0">
                                            <p className={`text-sm font-medium truncate ${isActive ? 'text-primary' : ''}`}>
                                                {slide.title || `Slide ${slide.slide_number}`}
                                            </p>
                                            <p className="text-xs opacity-50">Slide {slide.slide_number}</p>
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Bottom progress bar */}
            {!isCollapsed && (
                <div className="p-4 bg-secondary/30 border-t border-border flex-shrink-0">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                        <span>Progress</span>
                        <span>{Math.round(((currentSlideIndex + 1) / slides.length) * 100)}%</span>
                    </div>
                    <div className="h-1.5 bg-border rounded-full overflow-hidden">
                        <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${((currentSlideIndex + 1) / slides.length) * 100}%` }}
                            className="h-full bg-primary rounded-full"
                            transition={{ duration: 0.4 }}
                        />
                    </div>
                </div>
            )}
        </motion.div>
    );
}
