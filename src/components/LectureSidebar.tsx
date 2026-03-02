import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, CheckCircle2, Circle } from 'lucide-react';
import { Button } from './ui/button';

interface Slide {
    id: string;
    slide_number: number;
    title: string | null;
}

interface LectureSidebarProps {
    slides: Slide[];
    currentSlideIndex: number;
    onSelectSlide: (index: number) => void;
    isCollapsed: boolean;
    onToggle: () => void;
}

export function LectureSidebar({
    slides,
    currentSlideIndex,
    onSelectSlide,
    isCollapsed,
    onToggle,
}: LectureSidebarProps) {
    return (
        <motion.div
            initial={false}
            animate={{ width: isCollapsed ? 80 : 280 }}
            className="h-full bg-card border-r border-border flex flex-col transition-all duration-300 relative"
        >
            {/* Toggle Button */}
            <Button
                variant="ghost"
                size="icon"
                onClick={onToggle}
                className="absolute -right-4 top-10 z-10 bg-card border border-border rounded-full shadow-md hover:bg-accent"
            >
                {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </Button>

            <div className="p-6 border-b border-border">
                <h2 className={`font-bold text-foreground transition-opacity duration-300 ${isCollapsed ? 'opacity-0 h-0 overflow-hidden' : 'opacity-100'}`}>
                    Course Content
                </h2>
                {isCollapsed && (
                    <div className="flex justify-center">
                        <CheckCircle2 className="w-6 h-6 text-primary" />
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1 custom-scrollbar">
                {slides.map((slide, index) => {
                    const isActive = index === currentSlideIndex;
                    const isCompleted = index < currentSlideIndex;

                    return (
                        <button
                            key={slide.id}
                            onClick={() => onSelectSlide(index)}
                            className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group ${isActive
                                ? 'bg-primary/10 text-primary'
                                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                                } cursor-pointer`}
                        >
                            <div className="flex-shrink-0">
                                {isCompleted ? (
                                    <CheckCircle2 className="w-5 h-5 text-success" />
                                ) : isActive ? (
                                    <div className="w-5 h-5 rounded-full border-2 border-primary flex items-center justify-center">
                                        <div className="w-2 h-2 rounded-full bg-primary" />
                                    </div>
                                ) : (
                                    <Circle className="w-5 h-5 text-muted-foreground group-hover:text-foreground" />
                                )}
                            </div>

                            {!isCollapsed && (
                                <div className="flex-1 text-left truncate">
                                    <p className="text-sm font-medium truncate">
                                        {slide.title || `Slide ${slide.slide_number}`}
                                    </p>
                                    <p className="text-xs opacity-60">Slide {slide.slide_number}</p>
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>

            {!isCollapsed && (
                <div className="p-4 bg-secondary/30 border-t border-border">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                        <span>Progress</span>
                        <span>{Math.round(((currentSlideIndex + 1) / slides.length) * 100)}%</span>
                    </div>
                    <div className="h-1.5 bg-border rounded-full overflow-hidden">
                        <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${((currentSlideIndex + 1) / slides.length) * 100}%` }}
                            className="h-full bg-primary"
                        />
                    </div>
                </div>
            )}
        </motion.div>
    );
}
