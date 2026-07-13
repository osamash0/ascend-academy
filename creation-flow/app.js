/* ============================================================
   Learnstation — Creation Journey Application Logic
   ============================================================ */

// ── State ────────────────────────────────────────────────────
const state = {
    phase: 'idle', // idle | naming | uploading | processing | error-bad | error-parse | quota | ready
    files: [],
    lectureName: '',
    lang: 'en',
    results: null,
    processing: {
        slides:     { current: 0, total: 0, status: 'pending' },
        quizCards:  { current: 0, total: 0, status: 'pending' },
        reviewCards:{ current: 0, total: 0, status: 'pending' },
        tutor:      { status: 'pending' }
    },
    uploadsUsed: 2,
    uploadsMax: 3,
    uploadsResetDate: 'July 1st',
};

// ── Bilingual copy ───────────────────────────────────────────
const COPY = {
    en: {
        spine_add: 'Add',
        spine_transform: 'Transform',
        spine_study: 'Study',
        drop_title: 'Drop in your lecture',
        drop_subtitle: "We'll turn it into something you can study.",
        drop_or: 'or',
        drop_browse: 'browse files',
        drop_types: 'PDF, PowerPoint, or text notes',
        drop_demo: 'Try with a demo file',
        naming_label: "Give it a name you'll recognize later",
        naming_placeholder: 'e.g. Bio 201 — Lecture 7',
        naming_continue: 'Continue',
        naming_add_more: 'Add more files',
        proc_reading: 'Reading your slides',
        proc_quiz: 'Drafting quiz cards',
        proc_review: 'Building review cards',
        proc_tutor: 'Preparing your tutor',
        proc_page: 'Still working through page',
        proc_minute: 'about a minute left',
        ready_title: 'Your lecture is ready',
        ready_slides: 'slides extracted',
        ready_quiz: 'quiz cards drafted',
        ready_review: 'review cards built',
        ready_tutor: 'Your tutor knows this material',
        ready_cta: 'Start studying',
        ready_private: "This one's yours. Only you can see it.",
        ready_new: 'Start a new lecture',
        err_bad_title: "This doesn't look like a lecture file.",
        err_bad_sub: 'Try a PDF, PowerPoint deck, or text notes.',
        err_parse_title: "We couldn't read this one.",
        err_parse_sub: 'It might be image-based or password-protected.',
        err_retry: 'Try a different file',
        quota_title: "You've used all your uploads this month",
        quota_sub: 'Your next one opens on',
        quota_note: 'Three uploads a month keeps things focused.',
        quota_of: 'of',
        quota_uploads: 'uploads this month',
        file_remove: 'Remove file',
    },
    de: {
        spine_add: 'Hinzufügen',
        spine_transform: 'Verwandeln',
        spine_study: 'Lernen',
        drop_title: 'Lade deine Vorlesung rein',
        drop_subtitle: 'Wir machen daraus etwas, mit dem du lernen kannst.',
        drop_or: 'oder',
        drop_browse: 'Datei auswählen',
        drop_types: 'PDF, PowerPoint oder Textnotizen',
        drop_demo: 'Mit einer Demodatei testen',
        naming_label: 'Gib ihr einen Namen, den du später noch erkennst',
        naming_placeholder: 'z.B. Bio 201 — Vorlesung 7',
        naming_continue: 'Weiter',
        naming_add_more: 'Weitere Dateien hinzufügen',
        proc_reading: 'Deine Folien werden gelesen',
        proc_quiz: 'Quizkarten werden erstellt',
        proc_review: 'Wiederholungskarten werden aufgebaut',
        proc_tutor: 'Dein Tutor wird vorbereitet',
        proc_page: 'Arbeiten noch an Seite',
        proc_minute: 'etwa eine Minute übrig',
        ready_title: 'Deine Vorlesung ist bereit',
        ready_slides: 'Folien extrahiert',
        ready_quiz: 'Quizkarten erstellt',
        ready_review: 'Wiederholungskarten aufgebaut',
        ready_tutor: 'Dein Tutor kennt dieses Material',
        ready_cta: 'Loslegen',
        ready_private: 'Das hier gehört dir. Nur du kannst das sehen.',
        ready_new: 'Neue Vorlesung starten',
        err_bad_title: 'Das sieht nicht nach einer Vorlesungsdatei aus.',
        err_bad_sub: 'Versuch es mit einer PDF, einem PowerPoint oder Textnotizen.',
        err_parse_title: 'Wir konnten diese Datei nicht lesen.',
        err_parse_sub: 'Sie könnte bildbasiert oder passwortgeschützt sein.',
        err_retry: 'Andere Datei versuchen',
        quota_title: 'Du hast dieses Monat alle Uploads aufgebraucht',
        quota_sub: 'Der nächste ist am',
        quota_note: 'Drei Uploads im Monat — das hält den Fokus.',
        quota_of: 'von',
        quota_uploads: 'Uploads diesen Monat',
        file_remove: 'Datei entfernen',
    }
};

function t(key) { return COPY[state.lang][key] || key; }

// ── Utilities ────────────────────────────────────────────────
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    if (ext === 'pdf') return 'file-text';
    if (['pptx', 'ppt'].includes(ext)) return 'presentation';
    if (['docx', 'doc'].includes(ext)) return 'file-text';
    return 'file';
}

function getFileColor(name) {
    const ext = name.split('.').pop().toLowerCase();
    if (ext === 'pdf') return '#FB923C';
    if (['pptx', 'ppt'].includes(ext)) return '#FCD34D';
    return '#22D3EE';
}

function isAllowedFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    return ['pdf', 'pptx', 'ppt', 'docx', 'doc', 'txt', 'md'].includes(ext);
}

function generateResults() {
    const slides = 28 + Math.floor(Math.random() * 45);
    const quiz  = Math.max(4, Math.floor(slides * 0.22 + Math.random() * 5));
    const review= Math.max(6, Math.floor(slides * 0.28 + Math.random() * 6));
    return { slides, quizCards: quiz, reviewCards: review };
}

// ── Canvas transformation scene ──────────────────────────────
let canvasScene = null;

class TransformationScene {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.particles = [];
        this.startTime = performance.now();
        this.running = false;
        this.destinations = [];
        this.centerX = 0;
        this.centerY = 0;
        this.spawnedCounts = { slides: 0, quiz: 0, review: 0, tutor: 0 };
        this.resize();
    }

    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.w = rect.width;
        this.h = rect.height;
        this.centerX = this.w / 2;
        this.centerY = this.h / 2;

        const mx = this.w * 0.22;
        const my = this.h * 0.28;
        this.destinations = [
            { key: 'slides',  x: mx,          y: my,          color: '#5E6BFF', label: t('ready_slides'),  count: 0 },
            { key: 'quiz',    x: this.w - mx,  y: my,          color: '#22D3EE', label: t('ready_quiz'),    count: 0 },
            { key: 'review',  x: mx,           y: this.h - my, color: '#8B5CF6', label: t('ready_review'),  count: 0 },
            { key: 'tutor',   x: this.w - mx,  y: this.h - my, color: '#FCD34D', label: '',                 count: 0 },
        ];
    }

    start() {
        this.running = true;
        this.startTime = performance.now();
        this.particles = [];
        this.spawnedCounts = { slides: 0, quiz: 0, review: 0, tutor: 0 };
        this.destinations.forEach(d => d.count = 0);
        this.resize();
        this.loop();
    }

    stop() { this.running = false; }

    spawnParticles(key) {
        const dest = this.destinations.find(d => d.key === key);
        if (!dest) return;
        const count = key === 'tutor' ? 6 : 12;
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist  = Math.random() * 8;
            this.particles.push({
                sx: this.centerX + Math.cos(angle) * dist,
                sy: this.centerY + Math.sin(angle) * dist,
                ex: dest.x + (Math.random() - 0.5) * 20,
                ey: dest.y + (Math.random() - 0.5) * 14,
                cx: (this.centerX + dest.x) / 2 + (Math.random() - 0.5) * 60,
                cy: (this.centerY + dest.y) / 2 + (Math.random() - 0.5) * 40,
                color: dest.color,
                progress: 0,
                speed: 0.004 + Math.random() * 0.003,
                size: 1.5 + Math.random() * 2,
                delay: i * 80,
                key: key,
                arrived: false,
            });
        }
    }

    update() {
        if (state.processing.slides.status === 'active' && this.spawnedCounts.slides === 0) {
            this.spawnParticles('slides'); this.spawnedCounts.slides = 1;
        }
        if (state.processing.quizCards.status === 'active' && this.spawnedCounts.quiz === 0) {
            this.spawnParticles('quiz'); this.spawnedCounts.quiz = 1;
        }
        if (state.processing.reviewCards.status === 'active' && this.spawnedCounts.review === 0) {
            this.spawnParticles('review'); this.spawnedCounts.review = 1;
        }
        if (state.processing.tutor.status === 'active' && this.spawnedCounts.tutor === 0) {
            this.spawnParticles('tutor'); this.spawnedCounts.tutor = 1;
        }

        for (const p of this.particles) {
            if (p.delay > 0) { p.delay -= 16; continue; }
            if (p.arrived) continue;
            p.progress += p.speed * 16;
            if (p.progress >= 1) {
                p.progress = 1;
                p.arrived = true;
                const dest = this.destinations.find(d => d.key === p.key);
                if (dest) dest.count++;
            }
        }
    }

    draw() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.w, this.h);

        // Subtle background grid dots
        ctx.fillStyle = 'rgba(255,255,255,0.015)';
        for (let x = 20; x < this.w; x += 24) {
            for (let y = 20; y < this.h; y += 24) {
                ctx.beginPath();
                ctx.arc(x, y, 0.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Center orb glow
        const pulse = 0.85 + Math.sin(performance.now() * 0.002) * 0.15;
        const orbR  = Math.max(1, 22 * pulse);
        const glow  = ctx.createRadialGradient(this.centerX, this.centerY, 0, this.centerX, this.centerY, orbR * 4);
        glow.addColorStop(0,   'rgba(139, 92, 246, 0.2)');
        glow.addColorStop(0.5, 'rgba(94, 107, 255, 0.06)');
        glow.addColorStop(1,   'rgba(94, 107, 255, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, this.w, this.h);

        // Center orb core
        const core = ctx.createRadialGradient(this.centerX, this.centerY, 0, this.centerX, this.centerY, orbR);
        core.addColorStop(0,   'rgba(200, 180, 255, 0.6)');
        core.addColorStop(0.7, 'rgba(94, 107, 255, 0.3)');
        core.addColorStop(1,   'rgba(94, 107, 255, 0)');
        ctx.beginPath();
        ctx.arc(this.centerX, this.centerY, orbR, 0, Math.PI * 2);
        ctx.fillStyle = core;
        ctx.fill();

        // Destination receptacles
        for (const dest of this.destinations) {
            if (dest.count > 0) {
                const rg = ctx.createRadialGradient(dest.x, dest.y, 0, dest.x, dest.y, 35);
                rg.addColorStop(0, dest.color + '20');
                rg.addColorStop(1, dest.color + '00');
                ctx.fillStyle = rg;
                ctx.beginPath();
                ctx.arc(dest.x, dest.y, 35, 0, Math.PI * 2);
                ctx.fill();
            }
            const bw = 52, bh = 36, r = 8;
            ctx.beginPath();
            ctx.roundRect(dest.x - bw/2, dest.y - bh/2, bw, bh, r);
            ctx.fillStyle   = dest.color + (dest.count > 0 ? '18' : '08');
            ctx.strokeStyle = dest.color + (dest.count > 0 ? '40' : '15');
            ctx.lineWidth   = 1;
            ctx.fill();
            ctx.stroke();
            if (dest.label) {
                ctx.font = '10px "Space Grotesk", sans-serif';
                ctx.fillStyle = 'rgba(255,255,255,' + (dest.count > 0 ? '0.5' : '0.15') + ')';
                ctx.textAlign = 'center';
                ctx.fillText(dest.label, dest.x, dest.y + bh/2 + 14);
            }
            if (dest.key === 'tutor') {
                ctx.beginPath();
                ctx.arc(dest.x, dest.y, 6, 0, Math.PI * 2);
                ctx.fillStyle = dest.color + (dest.count > 0 ? '40' : '10');
                ctx.fill();
            }
        }

        // Particles
        for (const p of this.particles) {
            if (p.delay > 0 || p.arrived) continue;
            const tt = p.progress, mt = 1 - tt;
            const x = mt*mt*p.sx + 2*mt*tt*p.cx + tt*tt*p.ex;
            const y = mt*mt*p.sy + 2*mt*tt*p.cy + tt*tt*p.ey;
            const alpha = Math.sin(tt * Math.PI) * 0.8;
            ctx.save();
            ctx.shadowBlur  = 8;
            ctx.shadowColor = p.color;
            ctx.globalAlpha = Math.max(0, alpha);
            ctx.beginPath();
            ctx.arc(x, y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
            ctx.restore();
        }

        // Faint bezier paths for active streams
        ctx.globalAlpha = 0.04;
        ctx.lineWidth   = 1;
        for (const dest of this.destinations) {
            if (this.spawnedCounts[dest.key] > 0) {
                ctx.beginPath();
                ctx.moveTo(this.centerX, this.centerY);
                ctx.quadraticCurveTo(
                    (this.centerX + dest.x) / 2,
                    (this.centerY + dest.y) / 2,
                    dest.x, dest.y
                );
                ctx.strokeStyle = dest.color;
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 1;
    }

    loop() {
        if (!this.running) return;
        this.update();
        this.draw();
        requestAnimationFrame(() => this.loop());
    }
}

// ── Processing simulation ────────────────────────────────────
let processingIntervals = [];

function clearProcessingIntervals() {
    processingIntervals.forEach(id => clearInterval(id));
    processingIntervals = [];
}

function startProcessing() {
    state.phase = 'processing';
    state.results = generateResults();

    state.processing = {
        slides:      { current: 0, total: state.results.slides,      status: 'active' },
        quizCards:   { current: 0, total: state.results.quizCards,   status: 'pending' },
        reviewCards: { current: 0, total: state.results.reviewCards, status: 'pending' },
        tutor:       { status: 'pending' }
    };

    update();

    // Boot canvas scene after DOM paints
    requestAnimationFrame(() => {
        const wrapper = document.getElementById('canvas-wrapper');
        if (!wrapper) return;
        let canvas = document.getElementById('transform-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'transform-canvas';
            wrapper.appendChild(canvas);
        }
        canvasScene = new TransformationScene(canvas);
        canvasScene.start();
    });

    // Slides: 0 → 3.5 s
    const si = setInterval(() => {
        if (state.processing.slides.current < state.processing.slides.total) {
            state.processing.slides.current++;
            updateProgressUI('slides');
        } else {
            clearInterval(si);
            state.processing.slides.status = 'done';
            updateProgressStatus('slides');
        }
    }, 3500 / state.results.slides);
    processingIntervals.push(si);

    // Quiz: starts at 2 s, takes 3 s
    setTimeout(() => {
        state.processing.quizCards.status = 'active';
        updateProgressStatus('quizCards');
        const qi = setInterval(() => {
            if (state.processing.quizCards.current < state.processing.quizCards.total) {
                state.processing.quizCards.current++;
                updateProgressUI('quizCards');
            } else {
                clearInterval(qi);
                state.processing.quizCards.status = 'done';
                updateProgressStatus('quizCards');
            }
        }, 3000 / state.results.quizCards);
        processingIntervals.push(qi);
    }, 2000);

    // Review: starts at 4.5 s, takes 3 s
    setTimeout(() => {
        state.processing.reviewCards.status = 'active';
        updateProgressStatus('reviewCards');
        const ri = setInterval(() => {
            if (state.processing.reviewCards.current < state.processing.reviewCards.total) {
                state.processing.reviewCards.current++;
                updateProgressUI('reviewCards');
            } else {
                clearInterval(ri);
                state.processing.reviewCards.status = 'done';
                updateProgressStatus('reviewCards');
            }
        }, 3000 / state.results.reviewCards);
        processingIntervals.push(ri);
    }, 4500);

    // Tutor: starts at 7 s, takes 1.5 s
    setTimeout(() => {
        state.processing.tutor.status = 'active';
        updateProgressStatus('tutor');
        setTimeout(() => {
            state.processing.tutor.status = 'done';
            updateProgressStatus('tutor');
            setTimeout(() => {
                if (canvasScene) canvasScene.stop();
                state.phase = 'ready';
                update();
            }, 800);
        }, 1500);
    }, 7000);
}

function updateProgressUI(key) {
    const el  = document.getElementById('prog-count-' + key);
    const bar = document.getElementById('prog-bar-' + key);
    if (!el || !bar) return;
    const p = state.processing[key];
    el.textContent = p.current;
    bar.style.width = (p.total > 0 ? (p.current / p.total * 100) : 0) + '%';
}

function updateProgressStatus(key) {
    const row = document.getElementById('prog-row-' + key);
    if (!row) return;
    const p = state.processing[key];
    row.className = row.className.replace(/status-\w+/g, '');
    row.classList.add('status-' + p.status);
    const icon = row.querySelector('.prog-status-icon');
    if (!icon) return;
    if (p.status === 'done') {
        icon.innerHTML = '<i data-lucide="check" class="w-4 h-4 text-emerald-brand"></i>';
        lucide.createIcons({ nodes: [icon] });
    } else if (p.status === 'active') {
        icon.innerHTML = '<div class="w-4 h-4 border-2 border-indigo-brand border-t-transparent rounded-full animate-spin"></div>';
    }
}

// ── Render orchestration ─────────────────────────────────────
function update() {
    updateSpine();
    updateBeatVisibility();
    updateBeat1();
    updateBeat2();
    updateBeat3();
    lucide.createIcons();
}

function getCurrentBeat() {
    if (['idle','naming','error-bad','error-parse','quota'].includes(state.phase)) return 1;
    if (['uploading','processing'].includes(state.phase)) return 2;
    if (state.phase === 'ready') return 3;
    return 1;
}

function updateBeatVisibility() {
    const b = getCurrentBeat();
    document.getElementById('beat1').classList.toggle('hidden', b !== 1);
    document.getElementById('beat2').classList.toggle('hidden', b !== 2);
    document.getElementById('beat3').classList.toggle('hidden', b !== 3);
}

function updateSpine() {
    const beat   = getCurrentBeat();
    const labels = [t('spine_add'), t('spine_transform'), t('spine_study')];

    // Desktop
    for (let i = 1; i <= 3; i++) {
        const node  = document.querySelector('#spine-desktop [data-beat="' + i + '"]');
        const dot   = document.getElementById('spine-dot-' + i);
        const label = document.getElementById('spine-label-' + i);
        const line  = document.getElementById('spine-line-' + i);
        if (!node) continue;
        node.classList.remove('active', 'completed');
        if (i < beat)     node.classList.add('completed');
        else if (i === beat) node.classList.add('active');
        label.textContent = labels[i - 1];
        if (dot) {
            dot.innerHTML = (i < beat)
                ? '<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-brand"></i>'
                : '';
        }
        if (line) {
            if (i < beat) line.classList.add('filled');
            else          line.classList.remove('filled');
        }
    }

    // Mobile
    const smDots   = ['sm-dot-1','sm-dot-2','sm-dot-3'].map(id => document.getElementById(id));
    const smLabels = ['sm-label-1','sm-label-2'].map(id => document.getElementById(id));
    const smLines  = ['sm-line-1','sm-line-2','sm-line-3','sm-line-4'].map(id => document.getElementById(id));
    const smFills  = [beat > 1, beat > 1, beat > 2, beat > 2];

    smDots.forEach((dot, i) => {
        if (!dot) return;
        dot.classList.remove('active','completed');
        if (i + 1 < beat)       dot.classList.add('completed');
        else if (i + 1 === beat) dot.classList.add('active');
    });
    smLabels.forEach((label, i) => {
        if (!label) return;
        label.textContent = labels[i];
        label.classList.remove('active','completed');
        if (i + 1 < beat)       label.classList.add('completed');
        else if (i + 1 === beat) label.classList.add('active');
    });
    smLines.forEach((line, i) => {
        if (!line) return;
        if (smFills[i]) line.classList.add('filled');
        else            line.classList.remove('filled');
    });
}

// ── Beat 1 renderers ─────────────────────────────────────────

function updateBeat1() {
    const c = document.getElementById('beat1');
    if (getCurrentBeat() !== 1) return;

    if (state.phase === 'quota')      { c.innerHTML = renderQuotaState(); return; }
    if (state.phase === 'error-bad')  { c.innerHTML = renderErrorState('bad'); attachErrorEvents(); return; }
    if (state.phase === 'error-parse'){ c.innerHTML = renderErrorState('parse'); attachErrorEvents(); return; }
    if (state.phase === 'naming')     { c.innerHTML = renderNamingState(); attachNamingEvents(); return; }

    c.innerHTML = renderDropZone();
    attachDropZoneEvents();
}

function renderDropZone() {
    const dots = Array.from({ length: state.uploadsMax }, (_, i) =>
        '<div class="quota-dot ' + (i < state.uploadsUsed ? 'used' : '') + '"></div>'
    ).join('');

    return '<div class="slide-up">'
        + '<div class="drop-zone" id="drop-zone">'
        +   '<div class="drop-zone-inner" id="drop-zone-inner">'
        +     '<div class="absolute top-6 left-8 float-icon text-orange-brand/50"><i data-lucide="file-text" class="w-6 h-6"></i></div>'
        +     '<div class="absolute top-8 right-10 float-icon text-gold-brand/50"><i data-lucide="presentation" class="w-7 h-7"></i></div>'
        +     '<div class="absolute bottom-10 left-12 float-icon text-cyan-brand/50"><i data-lucide="file" class="w-5 h-5"></i></div>'
        +     '<div class="w-14 h-14 rounded-2xl flex items-center justify-center mb-2" style="background:linear-gradient(135deg,rgba(94,107,255,0.15),rgba(139,92,246,0.1))">'
        +       '<i data-lucide="upload-cloud" class="w-7 h-7 text-indigo-brand"></i>'
        +     '</div>'
        +     '<h2 class="font-display font-semibold text-xl text-center">' + t('drop_title') + '</h2>'
        +     '<p class="text-white/40 text-sm text-center max-w-xs">' + t('drop_subtitle') + '</p>'
        +     '<div class="flex items-center gap-3 mt-2">'
        +       '<span class="text-white/20 text-sm">' + t('drop_or') + '</span>'
        +       '<button class="btn-ghost text-sm" id="browse-btn">' + t('drop_browse') + '</button>'
        +     '</div>'
        +     '<p class="text-white/15 text-xs mt-1">' + t('drop_types') + '</p>'
        +     '<button class="text-white/20 text-xs hover:text-white/40 transition-colors mt-3 underline underline-offset-2 decoration-white/10" id="demo-file-btn">' + t('drop_demo') + '</button>'
        +   '</div>'
        + '</div>'
        + '<div class="flex items-center justify-center gap-3 mt-5">'
        +   '<div class="quota-dots">' + dots + '</div>'
        +   '<span class="text-white/20 text-xs">' + state.uploadsUsed + ' ' + t('quota_of') + ' ' + state.uploadsMax + ' ' + t('quota_uploads') + '</span>'
        + '</div>'
        + '</div>';
}

function renderNamingState() {
    const chips = state.files.map((f, i) =>
        '<div class="file-chip">'
        + '<i data-lucide="' + getFileIcon(f.name) + '" class="w-4 h-4 shrink-0" style="color:' + getFileColor(f.name) + '"></i>'
        + '<span class="text-white/70 text-sm truncate max-w-[200px]">' + f.name + '</span>'
        + '<span class="text-white/25 text-xs shrink-0">' + formatFileSize(f.size) + '</span>'
        + '<button class="file-chip-remove" data-remove="' + i + '" aria-label="' + t('file_remove') + '">'
        +   '<i data-lucide="x" class="w-3.5 h-3.5"></i>'
        + '</button>'
        + '</div>'
    ).join('');

    const demoName = state.files.length === 1 ? state.files[0].name.replace(/\.[^.]+$/, '') : '';

    return '<div class="slide-up">'
        + '<div class="flex flex-col gap-2 mb-6">' + chips + '</div>'
        + '<button class="text-white/25 text-xs hover:text-white/45 transition-colors mb-6 flex items-center gap-1.5" id="add-more-btn">'
        +   '<i data-lucide="plus" class="w-3.5 h-3.5"></i> ' + t('naming_add_more')
        + '</button>'
        + '<div class="glass p-6">'
        +   '<label class="block text-white/50 text-sm mb-3 font-body">' + t('naming_label') + '</label>'
        +   '<input type="text" class="input-dark mb-5" id="lecture-name-input" placeholder="' + t('naming_placeholder') + '" value="' + demoName + '" autocomplete="off" maxlength="80" />'
        +   '<button class="btn-gradient w-full" id="continue-btn" disabled>' + t('naming_continue') + '</button>'
        + '</div>'
        + '</div>';
}

function renderErrorState(type) {
    const bad = type === 'bad';
    return '<div class="slide-up">'
        + '<div class="drop-zone error-tint" id="drop-zone">'
        +   '<div class="drop-zone-inner" style="min-height:200px">'
        +     '<div class="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style="background:rgba(251,146,60,0.1)">'
        +       '<i data-lucide="alert-circle" class="w-6 h-6 text-orange-brand"></i>'
        +     '</div>'
        +     '<h2 class="font-display font-semibold text-lg text-center">' + (bad ? t('err_bad_title') : t('err_parse_title')) + '</h2>'
        +     '<p class="text-white/35 text-sm text-center max-w-xs">' + (bad ? t('err_bad_sub') : t('err_parse_sub')) + '</p>'
        +     '<button class="btn-ghost text-sm mt-4" id="error-retry-btn">' + t('err_retry') + '</button>'
        +   '</div>'
        + '</div>'
        + '</div>';
}

function renderQuotaState() {
    return '<div class="slide-up">'
        + '<div class="glass p-8 text-center">'
        +   '<div class="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4" style="background:rgba(255,255,255,0.04)">'
        +     '<i data-lucide="calendar" class="w-6 h-6 text-white/30"></i>'
        +   '</div>'
        +   '<h2 class="font-display font-semibold text-lg mb-2">' + t('quota_title') + '</h2>'
        +   '<p class="text-white/40 text-sm mb-1">' + t('quota_sub') + ' <span class="text-white/60">' + state.uploadsResetDate + '</span>.</p>'
        +   '<p class="text-white/20 text-xs mt-4">' + t('quota_note') + '</p>'
        + '</div>'
        + '</div>';
}

// ── Beat 2 renderer ──────────────────────────────────────────

function updateBeat2() {
    const c = document.getElementById('beat2');
    if (getCurrentBeat() !== 2) return;
    c.innerHTML = renderProcessingView();
}

function renderProcessingView() {
    const name = state.files.length === 1 ? state.files[0].name : state.files.length + ' files';
    const icon = state.files.length === 1 ? getFileIcon(state.files[0].name) : 'files';
    const color= state.files.length === 1 ? getFileColor(state.files[0].name) : '#5E6BFF';

    return '<div class="slide-up">'
        + '<div class="flex items-center gap-3 mb-6">'
        +   '<div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style="background:' + color + '15">'
        +     '<i data-lucide="' + icon + '" class="w-4 h-4" style="color:' + color + '"></i>'
        +   '</div>'
        +   '<div>'
        +     '<p class="text-white/80 text-sm font-medium truncate max-w-[300px]">' + (state.lectureName || name) + '</p>'
        +     '<p class="text-white/25 text-xs">' + name + '</p>'
        +   '</div>'
        + '</div>'
        + '<div id="canvas-wrapper" class="mb-8"></div>'
        + '<div class="flex flex-col gap-5">'
        +   renderProgressRow('slides',      t('proc_reading'), state.processing.slides)
        +   renderProgressRow('quizCards',   t('proc_quiz'),    state.processing.quizCards)
        +   renderProgressRow('reviewCards', t('proc_review'),  state.processing.reviewCards)
        +   renderProgressRow('tutor',       t('proc_tutor'),   state.processing.tutor)
        + '</div>'
        + '</div>';
}

function renderProgressRow(key, label, data) {
    const isTutor = key === 'tutor';
    let statusIcon;
    if (data.status === 'pending') {
        statusIcon = '<div class="w-2 h-2 rounded-full bg-white/10"></div>';
    } else if (data.status === 'active') {
        statusIcon = '<div class="w-4 h-4 border-2 border-indigo-brand border-t-transparent rounded-full animate-spin"></div>';
    } else {
        statusIcon = '<i data-lucide="check" class="w-4 h-4 text-emerald-brand"></i>';
    }

    let countHTML = '<span class="prog-status-icon text-white/20">' + statusIcon + '</span>';
    if (!isTutor) {
        countHTML += '<span class="text-white/60 font-display font-medium text-sm tabular-nums" id="prog-count-' + key + '">' + data.current + '</span>'
            + '<span class="text-white/20 text-xs">/</span>'
            + '<span class="text-white/20 text-xs tabular-nums" id="prog-total-' + key + '">' + data.total + '</span>';
    }

    let barHTML = isTutor ? '' : '<div class="progress-track"><div class="progress-fill" id="prog-bar-' + key + '" style="width:' + (data.total > 0 ? (data.current / data.total * 100) : 0) + '%"></div></div>';

    return '<div class="flex flex-col gap-2 status-' + data.status + '" id="prog-row-' + key + '">'
        + '<div class="flex items-center justify-between">'
        +   '<span class="text-white/70 text-sm font-body">' + label + '</span>'
        +   '<div class="flex items-center gap-2">' + countHTML + '</div>'
        + '</div>'
        + barHTML
        + '</div>';
}

// ── Beat 3 renderer ──────────────────────────────────────────

function updateBeat3() {
    const c = document.getElementById('beat3');
    if (getCurrentBeat() !== 3) return;

    c.innerHTML = '<div class="slide-up text-center">'
        + '<div class="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6" style="background:linear-gradient(135deg, #34D399, #22D3EE); box-shadow: 0 8px 32px rgba(52, 211, 153, 0.25)">'
        +   '<i data-lucide="sparkles" class="w-8 h-8 text-white"></i>'
        + '</div>'
        + '<h2 class="font-display font-bold text-2xl md:text-3xl mb-2">' + t('ready_title') + '</h2>'
        + '<p class="text-white/40 text-sm mb-8 truncate max-w-sm mx-auto font-medium">' + state.lectureName + '</p>'
        
        + '<div class="grid grid-cols-3 gap-4 mb-8">'
        +   '<div class="glass p-4 stat-card" id="stat-slides">'
        +     '<p class="text-2xl md:text-3xl font-display font-bold text-indigo-brand">' + state.results.slides + '</p>'
        +     '<p class="text-white/45 text-xs mt-1 font-medium">' + t('ready_slides') + '</p>'
        +   '</div>'
        +   '<div class="glass p-4 stat-card" id="stat-quiz">'
        +     '<p class="text-2xl md:text-3xl font-display font-bold text-cyan-brand">' + state.results.quizCards + '</p>'
        +     '<p class="text-white/45 text-xs mt-1 font-medium">' + t('ready_quiz') + '</p>'
        +   '</div>'
        +   '<div class="glass p-4 stat-card" id="stat-review">'
        +     '<p class="text-2xl md:text-3xl font-display font-bold text-purple-brand">' + state.results.reviewCards + '</p>'
        +     '<p class="text-white/45 text-xs mt-1 font-medium">' + t('ready_review') + '</p>'
        +   '</div>'
        + '</div>'

        + '<div class="glass p-5 mb-8 flex items-center gap-4 text-left stat-card" id="stat-tutor">'
        +   '<div class="w-10 h-10 rounded-xl bg-gold-brand/10 flex items-center justify-center shrink-0">'
        +     '<i data-lucide="bot" class="w-5 h-5 text-gold-brand"></i>'
        +   '</div>'
        +   '<div>'
        +     '<p class="text-white/80 text-sm font-medium">' + t('ready_tutor') + '</p>'
        +     '<p class="text-white/30 text-xs">' + t('ready_private') + '</p>'
        +   '</div>'
        + '</div>'

        + '<div class="flex flex-col gap-3 max-w-sm mx-auto">'
        +   '<button class="btn-gradient w-full py-3.5 text-base" id="start-studying-btn">' + t('ready_cta') + '</button>'
        +   '<button class="text-white/40 hover:text-white/60 transition-colors text-sm py-2 font-display font-medium" id="new-lecture-btn">' + t('ready_new') + '</button>'
        + '</div>'
        + '</div>';

    // Trigger sequential reveal animation for stat cards
    setTimeout(() => {
        const cards = ['stat-slides', 'stat-quiz', 'stat-review', 'stat-tutor'];
        cards.forEach((id, index) => {
            setTimeout(() => {
                const el = document.getElementById(id);
                if (el) el.classList.add('visible');
            }, index * 150);
        });
    }, 100);

    // Attach ready state events
    const startBtn = document.getElementById('start-studying-btn');
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            alert('Study flow starting! (Here we would navigate to the lecture view)');
        });
    }

    const newBtn = document.getElementById('new-lecture-btn');
    if (newBtn) {
        newBtn.addEventListener('click', () => {
            window.demoState('idle');
        });
    }
}

// ── Events Handling ──────────────────────────────────────────

function handleFilesSelected(fileList) {
    const newFiles = Array.from(fileList).filter(isAllowedFile);
    if (newFiles.length === 0) {
        state.phase = 'error-bad';
        update();
        return;
    }

    // Check quota
    if (state.uploadsUsed >= state.uploadsMax) {
        state.phase = 'quota';
        update();
        return;
    }

    state.files = [...state.files, ...newFiles];
    
    if (!state.lectureName && state.files.length > 0) {
        state.lectureName = state.files[0].name.replace(/\.[^.]+$/, '');
    }

    state.phase = 'naming';
    update();
}

function attachDropZoneEvents() {
    const zone = document.getElementById('drop-zone');
    const browseBtn = document.getElementById('browse-btn');
    const demoBtn = document.getElementById('demo-file-btn');
    const fileInput = document.getElementById('file-input');

    if (zone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            zone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        zone.addEventListener('dragover', () => {
            zone.classList.add('drag-over');
        });

        zone.addEventListener('dragleave', () => {
            zone.classList.remove('drag-over');
        });

        zone.addEventListener('drop', (e) => {
            zone.classList.remove('drag-over');
            const dt = e.dataTransfer;
            const files = dt.files;
            handleFilesSelected(files);
        });
    }

    if (browseBtn && fileInput) {
        browseBtn.addEventListener('click', () => {
            fileInput.click();
        });
    }

    if (fileInput) {
        fileInput.onchange = (e) => {
            handleFilesSelected(e.target.files);
            fileInput.value = '';
        };
    }

    if (demoBtn) {
        demoBtn.addEventListener('click', () => {
            const demoFile = {
                name: 'Introduction to Neurobiology.pdf',
                size: 4850000,
                type: 'application/pdf'
            };
            handleFilesSelected([demoFile]);
        });
    }
}

function attachNamingEvents() {
    const input = document.getElementById('lecture-name-input');
    const btn = document.getElementById('continue-btn');
    if (input && btn) {
        btn.disabled = input.value.trim().length === 0;
        input.addEventListener('input', () => {
            state.lectureName = input.value;
            btn.disabled = input.value.trim().length === 0;
        });
        
        btn.addEventListener('click', () => {
            if (state.uploadsUsed < state.uploadsMax) {
                state.uploadsUsed++;
            }
            startProcessing();
        });
    }

    const addMoreBtn = document.getElementById('add-more-btn');
    if (addMoreBtn) {
        addMoreBtn.addEventListener('click', () => {
            document.getElementById('file-input').click();
        });
    }

    document.querySelectorAll('.file-chip-remove').forEach(el => {
        el.addEventListener('click', () => {
            const index = parseInt(el.getAttribute('data-remove'), 10);
            state.files.splice(index, 1);
            if (state.files.length === 0) {
                state.phase = 'idle';
                state.lectureName = '';
            } else {
                state.lectureName = state.files[0].name.replace(/\.[^.]+$/, '');
            }
            update();
        });
    });
}

function attachErrorEvents() {
    const retryBtn = document.getElementById('error-retry-btn');
    if (retryBtn) {
        retryBtn.addEventListener('click', () => {
            state.phase = 'idle';
            state.files = [];
            state.lectureName = '';
            update();
        });
    }
}

// ── Global Initializations ────────────────────────────────────
window.demoState = function(phase) {
    clearProcessingIntervals();
    if (canvasScene) {
        canvasScene.stop();
        canvasScene = null;
    }
    
    state.phase = phase;
    if (phase === 'idle') {
        state.files = [];
        state.lectureName = '';
        state.uploadsUsed = 2;
    } else if (phase === 'error-bad' || phase === 'error-parse') {
        state.files = [{ name: 'corrupted_file.xyz', size: 1024 }];
    } else if (phase === 'quota') {
        state.uploadsUsed = 3;
    } else if (phase === 'ready') {
        state.files = [{ name: 'Introduction to Neurobiology.pdf', size: 4850000 }];
        state.lectureName = 'Introduction to Neurobiology';
        state.results = generateResults();
    }
    update();
};

// Initial document binding
document.addEventListener('DOMContentLoaded', () => {
    // Demo panel binding
    const demoToggle = document.getElementById('demo-toggle');
    const demoOptions = document.getElementById('demo-options');
    if (demoToggle && demoOptions) {
        demoToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            demoOptions.classList.toggle('hidden');
        });
        
        document.addEventListener('click', () => {
            demoOptions.classList.add('hidden');
        });
    }

    // Lang toggle binding
    const langToggle = document.getElementById('lang-toggle');
    if (langToggle) {
        langToggle.addEventListener('click', () => {
            state.lang = state.lang === 'en' ? 'de' : 'en';
            update();
        });
    }

    // Resize binding
    window.addEventListener('resize', () => {
        if (canvasScene && canvasScene.running) {
            canvasScene.resize();
        }
    });

    // Start UI
    update();
});
