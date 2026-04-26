import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, CheckCircle2, Star } from 'lucide-react';
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
            animate={{ width: isCollapsed ? 72 : 280 }}
            className="h-full glass-panel border-r border-white/5 flex flex-col relative z-20"
            style={{ flexShrink: 0 }}
        >
            {/* Toggle Button */}
            <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={onToggle}
                className="absolute -right-3 top-20 z-30 w-6 h-6 glass-panel-strong border border-white/10 rounded-full flex items-center justify-center text-primary shadow-glow-primary/20 cursor-pointer"
            >
                {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
            </motion.button>

            {/* Header */}
            <div className="p-5 border-b border-white/5 bg-surface-1/30">
                {!isCollapsed ? (
                    <div className="space-y-1">
                        <h2 className="text-[10px] font-bold text-primary uppercase tracking-widest">Syllabus</h2>
                        <p className="text-sm font-bold text-foreground">Lecture Content</p>
                        <div className="flex items-center gap-2 mt-2">
                          <div className="flex-1 h-1 bg-surface-2 rounded-full overflow-hidden">
                            <motion.div 
                              className="h-full bg-primary"
                              animate={{ width: `${((currentSlideIndex + 1) / slides.length) * 100}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-bold text-muted-foreground">{currentSlideIndex + 1}/{slides.length}</span>
                        </div>
                    </div>
                ) : (
                    <div className="flex justify-center">
                        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                          <CheckCircle2 className="w-4 h-4 text-primary" />
                        </div>
                    </div>
                )}
            </div>

            {/* Timeline list */}
            <div className="flex-1 overflow-y-auto py-6 custom-scrollbar">
                <div className="relative">
                    {/* Vertical track line */}
                    {!isCollapsed && (
                        <div className="absolute left-[31px] top-4 bottom-4 w-[1px] bg-white/5 z-0" />
                    )}

                    {/* Filled progress line */}
                    {!isCollapsed && slides.length > 1 && (
                        <motion.div
                            className="absolute left-[31px] top-4 w-[1px] bg-gradient-to-b from-primary to-secondary z-0 origin-top shadow-glow-primary/50"
                            initial={{ height: 0 }}
                            animate={{ height: `calc(${progressPct}% - 0px)` }}
                            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                        />
                    )}

                    <div className="space-y-2 px-3">
                        {slides.map((slide, index) => {
                            const isActive = index === currentSlideIndex;
                            const isDone = completedSlides.includes(slide.slide_number) || index < currentSlideIndex;

                            return (
                                <button
                                    key={slide.id}
                                    ref={isActive ? activeRef : undefined}
                                    onClick={() => onSelectSlide(index)}
                                    className={`w-full flex items-center gap-4 py-2.5 px-2 rounded-xl transition-all duration-300 group relative z-10 ${isActive
                                            ? 'bg-primary/10 text-primary'
                                            : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                                        } cursor-pointer`}
                                >
                                    {/* Node */}
                                    <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center relative">
                                        {isActive && (
                                          <motion.div 
                                            layoutId="activeNodeGlow"
                                            className="absolute inset-0 bg-primary/20 blur-md rounded-full"
                                          />
                                        )}
                                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center relative z-10 transition-all duration-300 ${
                                          isActive 
                                            ? 'bg-primary text-white shadow-glow-primary' 
                                            : isDone 
                                              ? 'bg-success/20 text-success border border-success/30' 
                                              : 'bg-surface-2 text-muted-foreground border border-white/5 group-hover:border-primary/30'
                                        }`}>
                                          {isDone ? (
                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                          ) : (
                                            <span className="text-[10px] font-bold">{slide.slide_number}</span>
                                          )}
                                        </div>
                                    </div>

                                    {/* Label */}
                                    {!isCollapsed && (
                                        <div className="flex-1 text-left min-w-0">
                                            <p className={`text-sm font-bold truncate transition-colors ${isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`}>
                                                {slide.title || `Slide ${slide.slide_number}`}
                                            </p>
                                            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                                              {isDone ? 'Completed' : isActive ? 'Current' : 'Remaining'}
                                            </p>
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Bottom Footer */}
            {!isCollapsed && (
                <div className="p-4 border-t border-white/5 bg-surface-1/30">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center">
                        <Star className="w-4 h-4 text-xp" />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Session Bonus</p>
                        <p className="text-xs font-bold text-foreground">+10 XP per Quiz</p>
                      </div>
                    </div>
                </div>
            )}
        </motion.div>
    );
}
