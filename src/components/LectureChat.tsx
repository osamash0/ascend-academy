import { useState, useRef, useEffect } from 'react';
import { useAiModel, type AiModelChoice } from '@/hooks/use-ai-model';
import { useAuth } from '@/lib/auth';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Bot, User, Loader2, Sparkles, ChevronDown, BookOpen, StopCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/apiClient';
import { logLearningEvent } from '@/services/studentService';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import 'katex/dist/katex.min.css';

interface Message {
    role: 'user' | 'model';
    content: string;
    timestamp?: Date;
}

interface LectureChatProps {
    isOpen: boolean;
    onClose: () => void;
    slideText: string;
    slideTitle: string;
}

/* ── Typing Indicator Animation ── */
function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-2">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-primary/60"
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </div>
  );
}

export function LectureChat({ isOpen, onClose, slideText, slideTitle }: LectureChatProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { aiModel: selectedModel, setAiModel: setSelectedModel } = useAiModel();
    const { user } = useAuth();
    const [isExpanded, setIsExpanded] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    useEffect(() => {
        setMessages([
            {
                role: 'model',
                content: `Hi! I'm your AI Tutor. I'm ready to answer any questions you have about **"${slideTitle}"**. What would you like to explore?`,
                timestamp: new Date(),
            }
        ]);
    }, [slideTitle, slideText]);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            setTimeout(() => inputRef.current?.focus(), 300);
        }
    }, [isOpen]);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMsg = input.trim();
        const newMessages: Message[] = [...messages, { 
            role: 'user', 
            content: userMsg,
            timestamp: new Date(),
        }];

        setMessages(newMessages);
        setInput('');
        setIsLoading(true);

        try {
            const historyToPass = newMessages.slice(1, -1);

            abortControllerRef.current = new AbortController();

            const res = await apiClient.stream(
                '/api/ai/chat',
                {
                    slide_text: slideText,
                    user_message: userMsg,
                    chat_history: historyToPass,
                    ai_model: selectedModel,
                },
                abortControllerRef.current.signal,
            );

            // Fire-and-forget analytics event
            if (user) {
                logLearningEvent(user.id, 'ai_tutor_query', {
                    lectureId: window.location.pathname.split('/').pop(),
                    slideTitle,
                    query: userMsg,
                    timestamp: new Date().toISOString(),
                }).catch(err => console.error('Failed to log AI tutor query event:', err));
            }

            const data = await res.json();

            setMessages((prev) => [
                ...prev,
                { role: 'model', content: data.reply, timestamp: new Date() }
            ]);

        } catch (err: unknown) {
            if (err instanceof Error && err.name === 'AbortError') {
                // User cancelled — remove the pending user message
                setMessages((prev) => prev.slice(0, -1));
            } else {
                console.error(err);
                setMessages((prev) => [
                    ...prev,
                    {
                        role: 'model',
                        content: "I'm experiencing a connection issue. Please try again in a moment.",
                        timestamp: new Date(),
                    }
                ]);
            }
        } finally {
            setIsLoading(false);
            abortControllerRef.current = null;
        }
    };

    const handleCancel = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const formatTime = (date?: Date) => {
        if (!date) return '';
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Mobile Overlay with blur */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-background/60 backdrop-blur-sm z-40 md:hidden"
                    />

                    {/* Chat Panel — Orbital Design */}
                    <motion.div
                        initial={{ x: '100%', opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: '100%', opacity: 0 }}
                        transition={{ type: 'spring', damping: 28, stiffness: 220 }}
                        className="fixed inset-y-0 right-0 w-full md:w-[440px] z-50 flex flex-col"
                    >
                        {/* Glassmorphism Panel */}
                        <div className="absolute inset-0 glass-panel-strong border-l border-white/10" />
                        
                        {/* Header */}
                        <div className="relative flex shrink-0 items-center justify-between px-5 py-4 border-b border-white/5">
                            <div className="flex items-center gap-3">
                                {/* Animated AI Avatar */}
                                <div className="relative">
                                    <motion.div
                                        className="absolute inset-0 bg-gradient-to-tr from-primary to-secondary rounded-full blur-lg"
                                        animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
                                        transition={{ duration: 3, repeat: Infinity }}
                                    />
                                    <div className="relative w-9 h-9 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-glow-primary">
                                        <Sparkles className="w-5 h-5 text-white" />
                                    </div>
                                    {/* Online indicator */}
                                    <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-success border-2 border-surface-1" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-foreground leading-none text-sm">AI Tutor</h3>
                                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                                        Online
                                    </p>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-2">
                                <Select 
                                    value={selectedModel} 
                                    onValueChange={(val) => {
                                        setSelectedModel(val as AiModelChoice);
                                    }}
                                >
                                    <SelectTrigger className="h-8 w-[150px] text-xs glass-card border-none focus:ring-1 focus:ring-primary/30">
                                        <SelectValue placeholder="Model" />
                                    </SelectTrigger>
                                    <SelectContent className="glass-panel-strong border-white/10">
                                        <SelectItem value="llama3">Llama 3 (Local)</SelectItem>
                                        <SelectItem value="gemini-1.5-flash">Gemini Flash</SelectItem>
                                        <SelectItem value="groq">Groq Llama 3.3</SelectItem>
                                    </SelectContent>
                                </Select>

                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={onClose}
                                    className="rounded-full text-muted-foreground hover:text-foreground hover:bg-white/5"
                                >
                                    <X className="w-5 h-5" />
                                </Button>
                            </div>
                        </div>

                        {/* Slide Context Banner */}
                        <div className="relative px-5 py-3 border-b border-white/5 bg-primary/5">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <BookOpen className="w-3.5 h-3.5" />
                                <span className="truncate">Context: <span className="text-foreground font-medium">{slideTitle}</span></span>
                            </div>
                        </div>

                        {/* Chat Messages */}
                        <div className="relative flex-1 min-h-0 overflow-y-auto p-5 space-y-6 custom-scrollbar">
                            {messages.map((msg, idx) => (
                                <motion.div
                                    key={idx}
                                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                >
                                    <div className={`flex items-start gap-3 max-w-[88%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                                        {/* Avatar */}
                                        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-1 ${msg.role === 'user'
                                                ? 'bg-primary/20 text-primary'
                                                : 'bg-surface-2 text-secondary-foreground border border-white/5'
                                            }`}>
                                            {msg.role === 'user' ? (
                                                <User className="w-3.5 h-3.5" />
                                            ) : (
                                                <Sparkles className="w-3.5 h-3.5" />
                                            )}
                                        </div>

                                        {/* Message Bubble */}
                                        <div className="space-y-1">
                                            <div className={`px-4 py-3 rounded-2xl ${msg.role === 'user'
                                                    ? 'bg-primary text-primary-foreground rounded-tr-sm shadow-glow-primary/20'
                                                    : 'glass-card rounded-tl-sm'
                                                }`}>
                                                {msg.role === 'user' ? (
                                                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                                                ) : (
                                                    <div className="prose prose-sm dark:prose-invert 
                                                        prose-p:leading-relaxed prose-p:mb-3
                                                        prose-pre:bg-surface-1/80 prose-pre:border prose-pre:border-white/5
                                                        prose-pre:rounded-xl prose-pre:p-3 prose-pre:shadow-inner
                                                        prose-code:text-primary prose-code:bg-primary/10 prose-code:px-1.5 prose-code:py-0.5
                                                        prose-code:rounded-md prose-code:text-sm prose-code:font-mono
                                                        prose-h3:text-base prose-h3:font-semibold prose-h3:text-foreground prose-h3:mt-4
                                                        prose-h4:text-sm prose-h4:font-medium prose-h4:text-muted-foreground
                                                        prose-li:marker:text-primary/60 prose-li:my-1
                                                        prose-ul:space-y-1
                                                        max-w-none text-sm break-words">
                                                        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                                            {msg.content}
                                                        </ReactMarkdown>
                                                    </div>
                                                )}
                                            </div>
                                            <span className="text-[10px] text-muted-foreground/60 px-1">
                                                {formatTime(msg.timestamp)}
                                            </span>
                                        </div>
                                    </div>
                                </motion.div>
                            ))}

                            {isLoading && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="flex justify-start"
                                >
                                    <div className="flex items-start gap-3 max-w-[88%]">
                                        <div className="w-7 h-7 rounded-full bg-surface-2 text-secondary-foreground border border-white/5 flex items-center justify-center flex-shrink-0 mt-1">
                                            <Sparkles className="w-3.5 h-3.5" />
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <div className="glass-card rounded-2xl rounded-tl-sm px-5 py-4">
                                                <TypingIndicator />
                                            </div>
                                            {/* Cancel button */}
                                            <motion.button
                                                initial={{ opacity: 0, scale: 0.9 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                transition={{ delay: 0.5 }}
                                                onClick={handleCancel}
                                                className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground hover:text-destructive uppercase tracking-widest transition-colors self-start px-1"
                                            >
                                                <StopCircle className="w-3 h-3" />
                                                Cancel
                                            </motion.button>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input Area */}
                        <div className="relative p-4 border-t border-white/5 bg-surface-1/30 backdrop-blur-xl">
                            <form
                                onSubmit={(e) => { e.preventDefault(); handleSend(); }}
                                className="relative flex items-center"
                            >
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Ask about this slide..."
                                    className="w-full bg-surface-2/50 text-foreground rounded-2xl pl-5 pr-14 py-3.5 text-sm 
                                        placeholder:text-muted-foreground/50
                                        focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-surface-2/80
                                        border border-white/5 transition-all duration-300"
                                    disabled={isLoading}
                                />
                                <Button
                                    type="submit"
                                    size="icon"
                                    disabled={!input.trim() || isLoading}
                                    className="absolute right-1.5 w-10 h-10 rounded-xl bg-gradient-to-r from-primary to-secondary 
                                        hover:opacity-90 text-white shadow-glow-primary/30 
                                        transition-all duration-200 disabled:opacity-30 disabled:shadow-none"
                                    title="Send message"
                                >
                                    <Send className="w-4 h-4" />
                                </Button>
                            </form>
                            <p className="text-[10px] text-muted-foreground/40 text-center mt-2">
                                AI responses are generated and may require verification
                            </p>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
