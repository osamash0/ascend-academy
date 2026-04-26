import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useScroll, useTransform, useSpring, useMotionValue, AnimatePresence } from 'framer-motion';
import { 
  Rocket, BookOpen, Brain, Zap, Shield, ChevronRight, Star, 
  Users, BarChart3, Sparkles, ArrowRight, Play, X, Menu,
  Globe, Cpu, Target, Flame, Trophy, ChevronDown
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════
   TYPE DEFINITIONS
   ═══════════════════════════════════════════════════════════════ */

interface StarField {
  id: number;
  x: number;
  y: number;
  size: number;
  opacity: number;
  speed: number;
  twinkle: boolean;
}

interface NavLink {
  label: string;
  href: string;
}

interface Feature {
  icon: React.ElementType;
  title: string;
  description: string;
  color: string;
  glowColor: string;
}

interface Stat {
  value: string;
  label: string;
  icon: React.ElementType;
}

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════ */

const NAV_LINKS: NavLink[] = [
  { label: 'Features', href: '#features' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'For Professors', href: '#professors' },
  { label: 'Pricing', href: '#pricing' },
];

const FEATURES: Feature[] = [
  {
    icon: Brain,
    title: 'AI Tutor',
    description: 'Your personal AI companion that adapts to your learning style, answers questions in real-time, and guides you through complex topics.',
    color: 'from-cyan-400 to-blue-500',
    glowColor: 'shadow-cyan-500/30',
  },
  {
    icon: BarChart3,
    title: 'Live Analytics',
    description: 'Mission-control dashboards track your progress with precision. See your XP, streaks, and skill mastery in real-time.',
    color: 'from-violet-400 to-purple-500',
    glowColor: 'shadow-violet-500/30',
  },
  {
    icon: Target,
    title: 'Adaptive Quizzes',
    description: 'Smart assessments that evolve with your knowledge. Wrong answers become learning opportunities, not setbacks.',
    color: 'from-emerald-400 to-teal-500',
    glowColor: 'shadow-emerald-500/30',
  },
  {
    icon: Users,
    title: 'Professor Command',
    description: 'Instructors get a full mission control suite: upload lectures, track class performance, and deploy AI-powered insights.',
    color: 'from-amber-400 to-orange-500',
    glowColor: 'shadow-amber-500/30',
  },
  {
    icon: Shield,
    title: 'Secure Vault',
    description: 'Your learning data is encrypted and protected. Enterprise-grade security with privacy-first architecture.',
    color: 'from-rose-400 to-pink-500',
    glowColor: 'shadow-rose-500/30',
  },
  {
    icon: Globe,
    title: 'Universal Access',
    description: 'Learn anywhere, on any device. Sync progress across platforms with offline capability for deep-space learning.',
    color: 'from-sky-400 to-indigo-500',
    glowColor: 'shadow-sky-500/30',
  },
];

const STATS: Stat[] = [
  { value: '50K+', label: 'Active Learners', icon: Users },
  { value: '12M+', label: 'Questions Answered', icon: Brain },
  { value: '98%', label: 'Retention Rate', icon: Target },
  { value: '4.9', label: 'User Rating', icon: Star },
];

/* ═══════════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════════ */

/* ── Starfield Background ── */
function StarfieldBackground() {
  const [stars, setStars] = useState<StarField[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const generateStars = () => {
      const newStars: StarField[] = [];
      for (let i = 0; i < 200; i++) {
        newStars.push({
          id: i,
          x: Math.random() * 100,
          y: Math.random() * 100,
          size: Math.random() * 2 + 0.5,
          opacity: Math.random() * 0.8 + 0.2,
          speed: Math.random() * 0.02 + 0.005,
          twinkle: Math.random() > 0.7,
        });
      }
      setStars(newStars);
    };
    generateStars();
  }, []);

  // Canvas-based warp speed effect on scroll
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let scrollSpeed = 0;
    
    const handleScroll = () => {
      scrollSpeed = Math.min(window.scrollY * 0.001, 2);
    };
    
    window.addEventListener('scroll', handleScroll, { passive: true });

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const particles: { x: number; y: number; z: number; px: number; py: number }[] = [];
    for (let i = 0; i < 400; i++) {
      particles.push({
        x: (Math.random() - 0.5) * 2000,
        y: (Math.random() - 0.5) * 2000,
        z: Math.random() * 2000,
        px: 0,
        py: 0,
      });
    }

    const animate = () => {
      ctx.fillStyle = 'rgba(8, 12, 24, 0.3)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      particles.forEach((p) => {
        p.z -= 2 + scrollSpeed * 5;
        if (p.z <= 0) {
          p.x = (Math.random() - 0.5) * 2000;
          p.y = (Math.random() - 0.5) * 2000;
          p.z = 2000;
        }

        const scale = 500 / p.z;
        const x = p.x * scale + cx;
        const y = p.y * scale + cy;

        const size = (1 - p.z / 2000) * 3;
        const opacity = (1 - p.z / 2000) * 0.8;

        // Draw trail
        if (p.px !== 0 && scrollSpeed > 0.1) {
          ctx.beginPath();
          ctx.moveTo(p.px, p.py);
          ctx.lineTo(x, y);
          ctx.strokeStyle = `rgba(100, 150, 255, ${opacity * 0.3})`;
          ctx.lineWidth = size * 0.5;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(150, 180, 255, ${opacity})`;
        ctx.fill();

        p.px = x;
        p.py = y;
      });

      animationId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="fixed inset-0 z-0"
        style={{ background: 'linear-gradient(180deg, #060a14 0%, #0a0f1e 50%, #0d1326 100%)' }}
      />
      {/* Static twinkling stars overlay */}
      <div className="fixed inset-0 z-[1] pointer-events-none">
        {stars.map((star) => (
          <motion.div
            key={star.id}
            className="absolute rounded-full bg-white"
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: star.size,
              height: star.size,
            }}
            animate={star.twinkle ? {
              opacity: [star.opacity, star.opacity * 0.3, star.opacity],
              scale: [1, 1.2, 1],
            } : {}}
            transition={{
              duration: 2 + Math.random() * 3,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        ))}
      </div>
      
      {/* Nebula clouds */}
      <div className="fixed inset-0 z-[1] pointer-events-none overflow-hidden">
        <motion.div
          className="absolute top-[-20%] left-[-10%] w-[70%] h-[70%] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(59, 130, 246, 0.08) 0%, transparent 70%)',
            filter: 'blur(100px)',
          }}
          animate={{ scale: [1, 1.1, 1], x: [0, 30, 0], y: [0, 20, 0] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(139, 92, 246, 0.06) 0%, transparent 70%)',
            filter: 'blur(120px)',
          }}
          animate={{ scale: [1, 1.15, 1], x: [0, -20, 0], y: [0, -30, 0] }}
          transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut', delay: 5 }}
        />
        <motion.div
          className="absolute top-[40%] right-[20%] w-[40%] h-[40%] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(6, 182, 212, 0.05) 0%, transparent 70%)',
            filter: 'blur(80px)',
          }}
          animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut', delay: 10 }}
        />
      </div>
    </>
  );
}

/* ── HUD Grid Overlay ── */
function HUDGrid() {
  return (
    <div className="fixed inset-0 z-[2] pointer-events-none opacity-[0.03]">
      <div 
        className="w-full h-full"
        style={{
          backgroundImage: `
            linear-gradient(rgba(100, 150, 255, 0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(100, 150, 255, 0.5) 1px, transparent 1px)
          `,
          backgroundSize: '80px 80px',
        }}
      />
    </div>
  );
}

/* ── Navigation ── */
function Navigation() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <motion.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled 
          ? 'bg-[#060a14]/80 backdrop-blur-xl border-b border-white/5' 
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 lg:h-20">
          {/* Logo */}
          <motion.div 
            onClick={() => navigate('/')}
            className="flex items-center gap-3 group cursor-pointer"
            whileHover={{ scale: 1.02 }}
          >
            <div className="relative w-10 h-10">
              <motion.div
                className="absolute inset-0 bg-gradient-to-tr from-cyan-400 to-blue-500 rounded-xl blur-lg opacity-60"
                animate={{ scale: [1, 1.2, 1], opacity: [0.4, 0.7, 0.4] }}
                transition={{ duration: 3, repeat: Infinity }}
              />
              <div className="relative w-10 h-10 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/20">
                <Rocket className="w-5 h-5 text-white" />
              </div>
            </div>
            <span className="text-xl font-bold text-white tracking-tight">
              Ascend<span className="text-cyan-400">Academy</span>
            </span>
          </motion.div>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-8">
            {NAV_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="text-sm text-slate-400 hover:text-white transition-colors relative group"
              >
                {link.label}
                <span className="absolute -bottom-1 left-0 w-0 h-px bg-cyan-400 group-hover:w-full transition-all duration-300" />
              </a>
            ))}
          </div>

          {/* CTA Buttons */}
          <div className="hidden md:flex items-center gap-4">
            <button
              onClick={() => navigate('/auth')}
              className="text-sm text-slate-300 hover:text-white transition-colors"
            >
              Sign In
            </button>
            <motion.button
              onClick={() => navigate('/auth')}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-semibold rounded-xl shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-shadow"
            >
              Launch Mission
            </motion.button>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden text-white p-2"
          >
            {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-[#060a14]/95 backdrop-blur-xl border-b border-white/5"
          >
            <div className="px-6 py-6 space-y-4">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="block text-slate-300 hover:text-white py-2"
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </a>
              ))}
              <div className="pt-4 border-t border-white/10 space-y-3">
                <button onClick={() => { navigate('/auth'); setMobileOpen(false); }} className="block text-slate-300 py-2 w-full text-left">Sign In</button>
                <button
                  onClick={() => { navigate('/auth'); setMobileOpen(false); }}
                  className="block px-5 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-center font-semibold rounded-xl w-full"
                >
                  Launch Mission
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}

/* ── Hero Section ── */
function HeroSection() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end start'],
  });

  const y = useTransform(scrollYProgress, [0, 1], [0, 200]);
  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.5], [1, 0.9]);

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    mouseX.set((e.clientX - rect.left - rect.width / 2) * 0.02);
    mouseY.set((e.clientY - rect.top - rect.height / 2) * 0.02);
  }, [mouseX, mouseY]);

  const springX = useSpring(mouseX, { stiffness: 150, damping: 15 });
  const springY = useSpring(mouseY, { stiffness: 150, damping: 15 });

  return (
    <section
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20"
    >
      <motion.div 
        style={{ y, opacity, scale }}
        className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8 text-center"
      >
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 mb-8"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400" />
          </span>
          <span className="text-sm text-cyan-300 font-medium">v2.0 Now Orbiting</span>
        </motion.div>

        {/* Main Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-5xl sm:text-6xl lg:text-8xl font-bold text-white tracking-tight leading-[1.1] mb-6"
        >
          Your Learning
          <br />
          <span className="relative inline-block">
            <span className="bg-gradient-to-r from-cyan-400 via-blue-500 to-violet-500 bg-clip-text text-transparent">
              Mission Control
            </span>
            <motion.div
              className="absolute -inset-4 bg-gradient-to-r from-cyan-500/20 to-violet-500/20 blur-2xl -z-10"
              animate={{ opacity: [0.5, 0.8, 0.5] }}
              transition={{ duration: 4, repeat: Infinity }}
            />
          </span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.6 }}
          className="text-lg sm:text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed"
        >
          Ascend Academy's next-generation platform. AI-powered tutoring, 
          real-time analytics, and immersive course experiences — all from your command center.
        </motion.p>

        {/* CTA Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 0.6 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16"
        >
          <motion.button
            onClick={() => navigate('/auth')}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="group relative px-8 py-4 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold rounded-2xl shadow-xl shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-shadow overflow-hidden"
          >
            <span className="relative z-10 flex items-center gap-2">
              Launch Your Mission
              <Rocket className="w-5 h-5 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          </motion.button>
          
          <motion.button
            onClick={() => navigate('/auth')}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="group px-8 py-4 bg-white/5 border border-white/10 text-white font-semibold rounded-2xl hover:bg-white/10 transition-colors flex items-center gap-2"
          >
            <Play className="w-5 h-5 text-cyan-400" />
            Watch Demo
          </motion.button>
        </motion.div>

        {/* Dashboard Preview — Floating HUD */}
        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1, duration: 1, ease: [0.16, 1, 0.3, 1] }}
          style={{ x: springX, y: springY }}
          className="relative max-w-5xl mx-auto"
        >
          {/* Glow behind dashboard */}
          <div className="absolute -inset-4 bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-violet-500/10 rounded-3xl blur-2xl" />
          
          {/* Dashboard Frame */}
          <div className="relative rounded-2xl border border-white/10 bg-[#0d1326]/80 backdrop-blur-xl overflow-hidden shadow-2xl">
            {/* HUD Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
                <Cpu className="w-3 h-3" />
                SYSTEM ONLINE
              </div>
            </div>

            {/* Dashboard Content */}
            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Stats Cards */}
              {[
                { label: 'XP Earned', value: '12,450', color: 'from-cyan-400 to-blue-500', icon: Zap },
                { label: 'Current Streak', value: '14 Days', color: 'from-amber-400 to-orange-500', icon: Flame },
                { label: 'Accuracy', value: '94.2%', color: 'from-emerald-400 to-teal-500', icon: Target },
              ].map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1.2 + i * 0.1 }}
                  className="rounded-xl border border-white/5 bg-white/[0.03] p-4 hover:bg-white/[0.05] transition-colors group"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-slate-500 uppercase tracking-wider">{stat.label}</span>
                    <stat.icon className="w-4 h-4 text-slate-600 group-hover:text-cyan-400 transition-colors" />
                  </div>
                  <div className={`text-2xl font-bold bg-gradient-to-r ${stat.color} bg-clip-text text-transparent`}>
                    {stat.value}
                  </div>
                  <div className="mt-2 h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full bg-gradient-to-r ${stat.color}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${70 + i * 15}%` }}
                      transition={{ delay: 1.5 + i * 0.2, duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                </motion.div>
              ))}

              {/* Course Progress */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.5 }}
                className="md:col-span-2 rounded-xl border border-white/5 bg-white/[0.03] p-4"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs text-slate-500 uppercase tracking-wider">Active Course</span>
                  <span className="text-xs text-cyan-400 font-mono">IN PROGRESS</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                    <BookOpen className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-white font-semibold mb-1">Advanced Machine Learning</h4>
                    <p className="text-sm text-slate-500 mb-2">Module 4 of 12 • Neural Networks</p>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-gradient-to-r from-violet-400 to-purple-500 rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: '35%' }}
                        transition={{ delay: 1.8, duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-violet-400">35%</div>
                </div>
              </motion.div>

              {/* AI Tutor Mini-Preview */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.6 }}
                className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-20 h-20 bg-cyan-500/10 rounded-full blur-2xl" />
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="text-xs text-cyan-400 font-mono uppercase">AI Tutor Active</span>
                </div>
                <p className="text-sm text-slate-400 mb-3">"How do backpropagation gradients flow through a neural network?"</p>
                <div className="flex items-center gap-2 text-xs text-cyan-400">
                  <span className="animate-pulse flex items-center gap-2">
                    <Sparkles className="w-3 h-3" />
                    <span>Generating response...</span>
                  </span>
                </div>
              </motion.div>
            </div>
          </div>

          {/* Floating Orbs around dashboard */}
          <motion.div
            className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-cyan-500/20 blur-3xl"
            animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 5, repeat: Infinity }}
          />
          <motion.div
            className="absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-violet-500/20 blur-3xl"
            animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.5, 0.2] }}
            transition={{ duration: 7, repeat: Infinity, delay: 2 }}
          />
        </motion.div>
      </motion.div>

      {/* Scroll Indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="flex flex-col items-center gap-2 text-slate-500"
        >
          <span className="text-xs uppercase tracking-widest">Scroll to Explore</span>
          <ChevronDown className="w-5 h-5" />
        </motion.div>
      </motion.div>
    </section>
  );
}

/* ── Stats Bar ── */
function StatsBar() {
  return (
    <section className="relative z-10 py-20 border-y border-white/5 bg-white/[0.02]">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {STATS.map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1, duration: 0.6 }}
              className="text-center group"
            >
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-white/5 border border-white/10 mb-4 group-hover:border-cyan-500/30 transition-colors">
                <stat.icon className="w-5 h-5 text-cyan-400" />
              </div>
              <div className="text-3xl lg:text-4xl font-bold text-white mb-1">{stat.value}</div>
              <div className="text-sm text-slate-500">{stat.label}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Features Grid ── */
function FeaturesSection() {
  return (
    <section id="features" className="relative z-10 py-32">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-20"
        >
          <span className="text-cyan-400 text-sm font-mono uppercase tracking-widest mb-4 block">
            Ship Systems
          </span>
          <h2 className="text-4xl lg:text-5xl font-bold text-white mb-6">
            Everything You Need to{' '}
            <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              Reach Orbit
            </span>
          </h2>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Six powerful systems working in harmony to deliver the most advanced learning experience in the galaxy.
          </p>
        </motion.div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              whileHover={{ y: -4, scale: 1.02 }}
              className={`group relative rounded-2xl border border-white/5 bg-white/[0.03] p-8 hover:bg-white/[0.06] transition-all duration-500 ${index === 0 || index === 3 ? 'lg:col-span-2' : ''}`}
            >
              {/* Hover glow */}
              <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${feature.color} opacity-0 group-hover:opacity-5 transition-opacity duration-500`} />
              
              <div className="relative">
                <div className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br ${feature.color} mb-6 shadow-lg ${feature.glowColor} group-hover:scale-110 transition-transform duration-300`}>
                  <feature.icon className="w-7 h-7 text-white" />
                </div>
                
                <h3 className="text-xl font-bold text-white mb-3 group-hover:text-cyan-300 transition-colors">
                  {feature.title}
                </h3>
                
                <p className="text-slate-400 leading-relaxed">
                  {feature.description}
                </p>

                <div className="mt-6 flex items-center gap-2 text-sm text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span>Learn more</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── How It Works — Timeline ── */
function HowItWorksSection() {
  const steps = [
    {
      number: '01',
      title: 'Launch Your Profile',
      description: 'Create your astronaut profile. Set your learning goals, choose your mission path, and calibrate your AI tutor.',
      icon: Rocket,
    },
    {
      number: '02',
      title: 'Engage Courses',
      description: 'Enter immersive lecture environments. Navigate slides, interact with content, and let the AI guide your journey.',
      icon: BookOpen,
    },
    {
      number: '03',
      title: 'AI-Powered Mastery',
      description: 'Ask questions in real-time. Get personalized explanations, practice with adaptive quizzes, and level up your skills.',
      icon: Brain,
    },
    {
      number: '04',
      title: 'Track & Celebrate',
      description: 'Watch your progress in the command center. Earn XP, maintain streaks, unlock achievements, and reach new levels.',
      icon: Trophy,
    },
  ];

  return (
    <section id="how-it-works" className="relative z-10 py-32">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-20"
        >
          <span className="text-violet-400 text-sm font-mono uppercase tracking-widest mb-4 block">
            Flight Path
          </span>
          <h2 className="text-4xl lg:text-5xl font-bold text-white mb-6">
            Four Stages to{' '}
            <span className="bg-gradient-to-r from-violet-400 to-purple-500 bg-clip-text text-transparent">
              Liftoff
            </span>
          </h2>
        </motion.div>

        <div className="relative">
          {/* Connection Line */}
          <div className="absolute left-8 lg:left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-cyan-500/50 via-violet-500/50 to-transparent hidden md:block" />

          <div className="space-y-16">
            {steps.map((step, index) => (
              <motion.div
                key={step.number}
                initial={{ opacity: 0, x: index % 2 === 0 ? -30 : 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.2, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className={`relative flex flex-col md:flex-row items-start gap-8 ${index % 2 === 0 ? 'md:flex-row' : 'md:flex-row-reverse'}`}
              >
                {/* Timeline Node */}
                <div className="absolute left-8 lg:left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-gradient-to-r from-cyan-400 to-violet-500 shadow-lg shadow-cyan-500/30 hidden md:block" />

                {/* Content */}
                <div className={`md:w-1/2 ${index % 2 === 0 ? 'md:pr-16 lg:pr-24' : 'md:pl-16 lg:pl-24'}`}>
                  <div className="flex items-center gap-4 mb-4">
                    <span className="text-5xl font-bold text-white/10 font-mono">{step.number}</span>
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-white/10 flex items-center justify-center">
                      <step.icon className="w-6 h-6 text-cyan-400" />
                    </div>
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-3">{step.title}</h3>
                  <p className="text-slate-400 leading-relaxed">{step.description}</p>
                </div>

                {/* Spacer for other side */}
                <div className="hidden md:block md:w-1/2" />
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Professor Section ── */
function ProfessorSection() {
  const navigate = useNavigate();
  return (
    <section id="professors" className="relative z-10 py-32">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left Content */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="text-amber-400 text-sm font-mono uppercase tracking-widest mb-4 block">
              For Commanders
            </span>
            <h2 className="text-4xl lg:text-5xl font-bold text-white mb-6">
              Professor{' '}
              <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
                Mission Control
              </span>
            </h2>
            <p className="text-slate-400 text-lg mb-8 leading-relaxed">
              Deploy courses, monitor student progress in real-time, and leverage AI analytics 
              to optimize learning outcomes. Your classroom, reimagined as a command center.
            </p>

            <div className="space-y-4 mb-10">
              {[
                'Upload lectures with intelligent slide parsing',
                'Real-time student engagement analytics',
                'AI-generated quiz questions per slide',
                'Performance dashboards with exportable reports',
              ].map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.2 + i * 0.1 }}
                  className="flex items-center gap-3"
                >
                  <div className="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                    <ChevronRight className="w-3 h-3 text-amber-400" />
                  </div>
                  <span className="text-slate-300">{item}</span>
                </motion.div>
              ))}
            </div>

            <motion.button
              onClick={() => navigate('/auth')}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-semibold rounded-2xl shadow-lg shadow-amber-500/25"
            >
              <Rocket className="w-5 h-5" />
              Start Teaching
            </motion.button>
          </motion.div>

          {/* Right Visual — Professor Dashboard Preview */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="relative"
          >
            <div className="absolute -inset-4 bg-gradient-to-r from-amber-500/10 to-orange-500/10 rounded-3xl blur-2xl" />
            
            <div className="relative rounded-2xl border border-white/10 bg-[#0d1326]/90 backdrop-blur-xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
                <div className="flex items-center gap-3">
                  <BarChart3 className="w-5 h-5 text-amber-400" />
                  <span className="text-white font-semibold">Class Analytics</span>
                </div>
                <span className="text-xs text-emerald-400 font-mono">● LIVE</span>
              </div>

              {/* Chart Placeholder */}
              <div className="p-6 space-y-4">
                <div className="flex items-end gap-2 h-32">
                  {[40, 65, 45, 80, 55, 90, 70, 85, 60, 75, 95, 50].map((h, i) => (
                    <motion.div
                      key={i}
                      initial={{ height: 0 }}
                      whileInView={{ height: `${h}%` }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.5 + i * 0.05, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                      className="flex-1 rounded-t bg-gradient-to-t from-amber-500/20 to-amber-400/40 hover:from-amber-500/40 hover:to-amber-400/60 transition-colors"
                    />
                  ))}
                </div>
                <div className="flex justify-between text-xs text-slate-500 font-mono">
                  <span>W1</span><span>W2</span><span>W3</span><span>W4</span>
                  <span>W5</span><span>W6</span><span>W7</span><span>W8</span>
                  <span>W9</span><span>W10</span><span>W11</span><span>W12</span>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-white/5">
                  {[
                    { label: 'Avg Score', value: '87.3%', color: 'text-emerald-400' },
                    { label: 'Attendance', value: '94%', color: 'text-cyan-400' },
                    { label: 'Engagement', value: 'High', color: 'text-amber-400' },
                  ].map((metric) => (
                    <div key={metric.label} className="text-center">
                      <div className={`text-xl font-bold ${metric.color}`}>{metric.value}</div>
                      <div className="text-xs text-slate-500 mt-1">{metric.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/* ── CTA Section ── */
function CTASection() {
  const navigate = useNavigate();
  return (
    <section className="relative z-10 py-32">
      <div className="max-w-5xl mx-auto px-6 lg:px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="relative rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-transparent p-12 lg:p-16 overflow-hidden"
        >
          {/* Background effects */}
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 via-transparent to-violet-500/5" />
          <motion.div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-cyan-500/10 rounded-full blur-3xl"
            animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 8, repeat: Infinity }}
          />

          <div className="relative">
            <motion.div
              initial={{ scale: 0 }}
              whileInView={{ scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-cyan-400 to-blue-600 mb-8 shadow-xl shadow-cyan-500/30"
            >
              <Rocket className="w-10 h-10 text-white" />
            </motion.div>

            <h2 className="text-4xl lg:text-6xl font-bold text-white mb-6">
              Ready for{' '}
              <span className="bg-gradient-to-r from-cyan-400 via-blue-500 to-violet-500 bg-clip-text text-transparent">
                Liftoff?
              </span>
            </h2>
            
            <p className="text-slate-400 text-lg max-w-2xl mx-auto mb-10">
              Join 50,000+ learners already on their mission. Your AI tutor is standing by, 
              your dashboard is calibrated, and the stars are waiting.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <motion.button
                onClick={() => navigate('/auth')}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="px-10 py-5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-lg rounded-2xl shadow-xl shadow-cyan-500/30 hover:shadow-cyan-500/50 transition-shadow"
              >
                Begin Your Mission
              </motion.button>
              <motion.button
                onClick={() => navigate('/auth')}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="px-10 py-5 border border-white/20 text-white font-semibold rounded-2xl hover:bg-white/5 transition-colors"
              >
                Contact Sales
              </motion.button>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ── Footer ── */
function Footer() {
  return (
    <footer className="relative z-10 border-t border-white/5 bg-[#060a14]/50 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-12 mb-12">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-lg flex items-center justify-center">
                <Rocket className="w-4 h-4 text-white" />
              </div>
              <span className="text-lg font-bold text-white">
                Ascend<span className="text-cyan-400">Academy</span>
              </span>
            </div>
            <p className="text-sm text-slate-500 leading-relaxed">
              The next-generation learning platform. AI-powered, data-driven, and built for the future of education.
            </p>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-4">Platform</h4>
            <ul className="space-y-3">
              {['Features', 'Pricing', 'Security', 'Enterprise'].map((item) => (
                <li key={item}>
                  <a href="#" className="text-sm text-slate-500 hover:text-cyan-400 transition-colors">{item}</a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-4">Resources</h4>
            <ul className="space-y-3">
              {['Documentation', 'API Reference', 'Community', 'Blog'].map((item) => (
                <li key={item}>
                  <a href="#" className="text-sm text-slate-500 hover:text-cyan-400 transition-colors">{item}</a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold mb-4">Company</h4>
            <ul className="space-y-3">
              {['About', 'Careers', 'Contact', 'Privacy'].map((item) => (
                <li key={item}>
                  <a href="#" className="text-sm text-slate-500 hover:text-cyan-400 transition-colors">{item}</a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-slate-600">
            © 2025 Ascend Academy. All systems nominal.
          </p>
          <div className="flex items-center gap-6">
            <a href="#" className="text-slate-600 hover:text-cyan-400 transition-colors">
              <span className="sr-only">Twitter</span>
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8.29 20.251c7.547 0 11.675-6.253 11.675-11.675 0-.178 0-.355-.012-.53A8.348 8.348 0 0022 5.92a8.19 8.19 0 01-2.357.646 4.118 4.118 0 001.804-2.27 8.224 8.224 0 01-2.605.996 4.107 4.107 0 00-6.993 3.743 11.65 11.65 0 01-8.457-4.287 4.106 4.106 0 001.27 5.477A4.072 4.072 0 012.8 9.713v.052a4.105 4.105 0 003.292 4.022 4.095 4.095 0 01-1.853.07 4.108 4.108 0 003.834 2.85A8.233 8.233 0 012 18.407a11.616 11.616 0 006.29 1.84" /></svg>
            </a>
            <a href="#" className="text-slate-600 hover:text-cyan-400 transition-colors">
              <span className="sr-only">GitHub</span>
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" /></svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN HOMEPAGE COMPONENT
   ═══════════════════════════════════════════════════════════════ */

export default function Landing() {
  return (
    <div className="relative min-h-screen bg-[#060a14] text-white overflow-x-hidden">
      <StarfieldBackground />
      <HUDGrid />
      <Navigation />
      
      <main>
        <HeroSection />
        <StatsBar />
        <FeaturesSection />
        <HowItWorksSection />
        <ProfessorSection />
        <CTASection />
      </main>
      
      <Footer />
    </div>
  );
}
