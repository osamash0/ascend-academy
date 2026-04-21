import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { GraduationCap, BookOpen, Trophy, Zap, Target, BarChart3, ArrowRight, Sparkles, Star, Flame } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background overflow-hidden relative">
      {/* Animated Background Decor */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-primary/10 blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full bg-secondary/10 blur-[120px] animate-pulse delay-1000" />
        <div className="absolute top-[20%] left-[10%] w-[30%] h-[30%] rounded-full bg-xp/5 blur-[100px] animate-float" />
      </div>

      {/* Header */}
      <header className="relative z-50 glass-panel border-b border-white/5 sticky top-0">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4 group cursor-pointer" onClick={() => navigate('/')}>
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-glow-primary group-hover:scale-110 transition-transform">
              <GraduationCap className="w-7 h-7 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-xl text-foreground tracking-tight">Ascend Academy</span>
              <span className="text-[10px] font-bold text-primary uppercase tracking-[0.2em] leading-none">v2.0 Orbital</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => navigate('/auth')} className="text-sm font-bold text-muted-foreground hover:text-foreground">
              Login
            </Button>
            <Button 
              onClick={() => navigate('/auth')}
              className="bg-primary hover:bg-primary/90 text-white font-bold rounded-2xl px-6 shadow-glow-primary/20 border-none"
            >
              Get Started
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-20 pb-32 lg:pt-32 lg:pb-48 z-10">
        <div className="container mx-auto px-6">
          <div className="max-w-5xl mx-auto text-center space-y-10">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="inline-flex items-center gap-3 px-5 py-2 glass-panel border-white/10 rounded-full mb-4 shadow-xl"
            >
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-[10px] font-bold text-foreground uppercase tracking-widest">
                The Future of Cognitive Learning
              </span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-5xl lg:text-8xl font-bold text-foreground mb-8 leading-[1.1] tracking-tight"
            >
              Ascend to <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-secondary to-xp shadow-glow-primary/20">Mastery</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-xl text-muted-foreground mb-12 max-w-3xl mx-auto leading-relaxed"
            >
              Transform static lectures into dynamic orbital missions. Upload your curriculum and let our neural engine generate interactive summaries, competitive quizzes, and deep-telemetry analytics.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-6"
            >
              <Button 
                size="xl" 
                onClick={() => navigate('/auth')}
                className="bg-gradient-to-r from-primary to-secondary text-white font-bold rounded-3xl px-10 h-16 shadow-glow-primary hover:scale-105 transition-all text-lg border-none"
              >
                Initiate Mission
                <ArrowRight className="w-6 h-6 ml-3" />
              </Button>
              <Button 
                variant="outline" 
                size="xl" 
                onClick={() => navigate('/auth')}
                className="glass-panel-strong border-white/10 rounded-3xl px-10 h-16 text-foreground font-bold hover:bg-white/5 text-lg"
              >
                Professor Access
              </Button>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-32 relative z-10">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-24 space-y-4"
          >
            <h2 className="text-4xl lg:text-5xl font-bold text-foreground tracking-tight">
              Orbital Features
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto font-medium">
              A comprehensive toolkit for neural engagement and knowledge synthesis.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: BookOpen,
                title: 'Neural Slide Viewer',
                description: 'Advanced PDF ingestion with real-time AI context generation and slide-level summaries.',
                color: 'primary',
              },
              {
                icon: Target,
                title: 'Cognitive Quizzes',
                description: 'Automatically generated challenge sets designed to maximize neural retention and recall.',
                color: 'success',
              },
              {
                icon: Zap,
                title: 'Experience Economy',
                description: 'Earn XP for every correct response. Level up and climb the global orbital leaderboard.',
                color: 'xp',
              },
              {
                icon: Flame,
                title: 'Retention Streaks',
                description: 'Build cognitive momentum with consecutive wins and unlock exclusive performance badges.',
                color: 'warning',
              },
              {
                icon: Trophy,
                title: 'Valor Hall',
                description: 'Showcase your cognitive milestones with a premium collection of achievement medals.',
                color: 'secondary',
              },
              {
                icon: BarChart3,
                title: 'Command Analytics',
                description: 'Deep-telemetry for professors to track student progress and optimize learning paths.',
                color: 'primary',
              },
            ].map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.05 }}
                className="glass-card border-white/5 rounded-[32px] p-10 hover:border-primary/50 transition-all duration-500 group relative overflow-hidden"
              >
                <div className={`w-16 h-16 rounded-2xl bg-${feature.color}/10 flex items-center justify-center mb-8 group-hover:scale-110 transition-transform shadow-glow-${feature.color}/10`}>
                  <feature.icon className={`w-8 h-8 text-${feature.color}`} />
                </div>
                <h3 className="text-2xl font-bold text-foreground mb-4">{feature.title}</h3>
                <p className="text-muted-foreground leading-relaxed font-medium">{feature.description}</p>
                <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-32 bg-white/2 relative z-10 border-y border-white/5">
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-12">
            {[
              { value: '10+', label: 'XP per Synapse' },
              { value: '100%', label: 'Retention Target' },
              { value: '∞', label: 'Orbital Modules' },
              { value: '🏆', label: 'Global Medals' },
            ].map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="text-center space-y-2"
              >
                <p className="text-5xl lg:text-7xl font-bold text-foreground tracking-tighter">{stat.value}</p>
                <p className="text-[10px] font-bold text-primary uppercase tracking-[0.3em]">{stat.label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-32 lg:py-48 relative z-10">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="glass-card rounded-[48px] p-16 lg:p-24 text-center relative overflow-hidden shadow-2xl border-white/10"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-secondary/20 opacity-30" />
            <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[120px] animate-pulse" />
            <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-secondary/10 blur-[120px] animate-pulse delay-700" />

            <div className="relative z-10 space-y-8">
              <div className="flex items-center justify-center gap-4 mb-4">
                {[Star, Sparkles, Star].map((Icon, i) => (
                  <Icon key={i} className="w-8 h-8 text-primary shadow-glow-primary" />
                ))}
              </div>
              <h2 className="text-4xl lg:text-6xl font-bold text-foreground tracking-tight">
                Ready to Initiate <span className="text-primary">Ascension?</span>
              </h2>
              <p className="text-xl text-muted-foreground mb-12 max-w-2xl mx-auto leading-relaxed">
                Join the next generation of cognitive explorers. Synchronize your learning with the orbital economy today.
              </p>
              <Button
                size="xl"
                onClick={() => navigate('/auth')}
                className="bg-primary hover:bg-primary/90 text-white font-bold rounded-3xl px-12 h-20 shadow-glow-primary text-xl border-none"
              >
                Get Started Free
                <ArrowRight className="w-6 h-6 ml-3" />
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-white/5 relative z-10 bg-background">
        <div className="container mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                <GraduationCap className="w-6 h-6 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-foreground">Ascend Academy</span>
                <span className="text-[8px] font-bold text-muted-foreground uppercase tracking-widest leading-none">© 2025 Orbital Protocol</span>
              </div>
            </div>
            <div className="flex items-center gap-8 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              <a href="/impressum" className="hover:text-primary transition-colors">Impressum</a>
              <a href="/datenschutz" className="hover:text-primary transition-colors">Datenschutz</a>
              <a href="#" className="hover:text-primary transition-colors">Terms of Service</a>
            </div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-50">
              Built for the next generation of scholars.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
