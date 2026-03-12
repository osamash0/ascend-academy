import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Bot, User, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

// Define the API URL base
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

interface Message {
    role: 'user' | 'model';
    content: string;
}

interface LectureChatProps {
    isOpen: boolean;
    onClose: () => void;
    slideText: string;
    slideTitle: string;
}

export function LectureChat({ isOpen, onClose, slideText, slideTitle }: LectureChatProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom of chat
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    // Reset chat when slide changes
    useEffect(() => {
        setMessages([
            {
                role: 'model',
                content: `Hi! I'm your AI Tutor. I'm ready to answer any questions you have about the slide **"${slideTitle}"**. What would you like to know?`
            }
        ]);
    }, [slideTitle, slideText]);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMsg = input.trim();
        const newMessages: Message[] = [...messages, { role: 'user', content: userMsg }];

        setMessages(newMessages);
        setInput('');
        setIsLoading(true);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            // Extract only the history strings to pass to the backend, skipping the initial greeting
            const historyToPass = newMessages.slice(1, -1);

            const res = await fetch(`${API_BASE}/api/ai/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    slide_text: slideText,
                    user_message: userMsg,
                    chat_history: historyToPass,
                    ai_model: localStorage.getItem('ascend-academy-ai-model') || 'llama3'
                }),
            });

            if (!res.ok) throw new Error('Failed to get response');

            const data = await res.json();

            setMessages((prev) => [
                ...prev,
                { role: 'model', content: data.reply }
            ]);

        } catch (err) {
            console.error(err);
            setMessages((prev) => [
                ...prev,
                { role: 'model', content: "Sorry, I'm having trouble connecting to my knowledge base right now. Please try again!" }
            ]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Mobile Overlay */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 md:hidden"
                    />

                    {/* Chat Panel */}
                    <motion.div
                        initial={{ x: '100%', opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: '100%', opacity: 0 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        className="fixed inset-y-0 right-0 w-full md:w-[400px] border-l border-border bg-card shadow-2xl z-50 flex flex-col pt-4 pb-0 md:pt-0"
                    >
                        {/* Header */}
                        <div className="flex shrink-0 items-center justify-between px-4 py-4 border-b border-border bg-card z-10">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center">
                                    <Bot className="w-5 h-5 text-primary-foreground" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-foreground leading-none">AI Tutor</h3>
                                    <p className="text-xs text-muted-foreground mt-1">Context: {slideTitle}</p>
                                </div>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={onClose}
                                className="rounded-full text-muted-foreground hover:text-foreground"
                            >
                                <X className="w-5 h-5" />
                            </Button>
                        </div>

                        {/* Chat Messages */}
                        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6 custom-scrollbar">
                            {messages.map((msg, idx) => (
                                <div
                                    key={idx}
                                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                >
                                    <div
                                        className={`flex items-start gap-3 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                                            }`}
                                    >
                                        <div
                                            className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1 ${msg.role === 'user'
                                                    ? 'bg-primary/20 text-primary'
                                                    : 'bg-secondary text-secondary-foreground border border-border/50'
                                                }`}
                                        >
                                            {msg.role === 'user' ? (
                                                <User className="w-4 h-4" />
                                            ) : (
                                                <Bot className="w-4 h-4" />
                                            )}
                                        </div>

                                        <div
                                            className={`px-4 py-3 rounded-2xl ${msg.role === 'user'
                                                    ? 'bg-primary text-primary-foreground rounded-tr-sm'
                                                    : 'bg-secondary text-secondary-foreground border border-border/50 rounded-tl-sm'
                                                }`}
                                        >
                                            {msg.role === 'user' ? (
                                                <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
                                            ) : (
                                                <div className="prose prose-sm dark:prose-invert prose-p:leading-relaxed prose-pre:bg-background/50 prose-pre:p-3 prose-pre:rounded-xl max-w-none text-sm break-words">
                                                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{msg.content}</ReactMarkdown>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {isLoading && (
                                <div className="flex justify-start">
                                    <div className="flex items-start gap-3 max-w-[85%]">
                                        <div className="w-8 h-8 rounded-full bg-secondary text-secondary-foreground border border-border/50 flex items-center justify-center flex-shrink-0 mt-1">
                                            <Bot className="w-4 h-4" />
                                        </div>
                                        <div className="px-5 py-4 rounded-2xl bg-secondary rounded-tl-sm border border-border/50">
                                            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input Area */}
                        <div className="p-4 bg-card border-t border-border mt-auto shrink-0 z-10">
                            <form
                                onSubmit={(e) => { e.preventDefault(); handleSend(); }}
                                className="relative flex items-center"
                            >
                                <input
                                    type="text"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Ask a question about this slide..."
                                    className="w-full bg-secondary text-secondary-foreground rounded-full pl-5 pr-14 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 border border-border/50 transition-shadow"
                                    disabled={isLoading}
                                />
                                <Button
                                    type="submit"
                                    size="icon"
                                    disabled={!input.trim() || isLoading}
                                    className="absolute right-1.5 w-9 h-9 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm transition-transform active:scale-95 disabled:opacity-50"
                                    title="Send message"
                                >
                                    <Send className="w-4 h-4 mr-[2px] mt-[1px]" />
                                </Button>
                            </form>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
