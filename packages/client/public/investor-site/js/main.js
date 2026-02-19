/**
 * 2451 Brickell Insights - Main JavaScript
 * Handles language toggle and interactive elements
 */

// ===================================
// LANGUAGE TOGGLE
// ===================================

function initLanguageToggle() {
    const toggle = document.getElementById('langToggle');
    if (!toggle) return;
    
    let currentLang = localStorage.getItem('brickell_lang') || 'en';
    applyLanguage(currentLang);
    updateToggleUI(currentLang);
    
    toggle.addEventListener('click', (e) => {
        if (e.target.classList.contains('lang-option')) {
            const newLang = e.target.dataset.lang;
            if (newLang && newLang !== currentLang) {
                currentLang = newLang;
                localStorage.setItem('brickell_lang', currentLang);
                applyLanguage(currentLang);
                updateToggleUI(currentLang);
            }
        }
    });
}

function updateToggleUI(lang) {
    const options = document.querySelectorAll('.lang-option');
    options.forEach(opt => opt.classList.toggle('active', opt.dataset.lang === lang));
}

function applyLanguage(lang) {
    const elements = document.querySelectorAll('[data-en][data-es]');
    elements.forEach(el => {
        const text = el.getAttribute(`data-${lang}`);
        if (text) el.textContent = text;
    });
    document.documentElement.lang = lang;
}

// ===================================
// ACCORDION
// ===================================

function initAccordion() {
    const accordions = document.querySelectorAll('.accordion');
    accordions.forEach(accordion => {
        const items = accordion.querySelectorAll('.accordion-item');
        items.forEach(item => {
            const header = item.querySelector('.accordion-header');
            header.addEventListener('click', () => {
                const isActive = item.classList.contains('active');
                items.forEach(i => i.classList.remove('active'));
                if (!isActive) item.classList.add('active');
            });
        });
    });
}

// ===================================
// TABS
// ===================================

function initTabs() {
    const tabContainers = document.querySelectorAll('.tabs');
    tabContainers.forEach(container => {
        const buttons = container.querySelectorAll('.tab-btn');
        const panels = container.querySelectorAll('.tab-panel');
        buttons.forEach((btn, index) => {
            btn.addEventListener('click', () => {
                buttons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                panels.forEach(p => p.classList.remove('active'));
                if (panels[index]) panels[index].classList.add('active');
            });
        });
    });
}

// ===================================
// CAROUSEL
// ===================================

function initCarousel() {
    const carousels = document.querySelectorAll('.carousel');
    carousels.forEach(carousel => {
        const track = carousel.querySelector('.carousel-track');
        const slides = carousel.querySelectorAll('.carousel-slide');
        const dots = carousel.querySelectorAll('.carousel-dot');
        const prevBtn = carousel.querySelector('.carousel-arrow.prev');
        const nextBtn = carousel.querySelector('.carousel-arrow.next');
        
        if (!track || slides.length === 0) return;
        
        let currentIndex = 0;
        let autoplayInterval;
        
        function goToSlide(index) {
            if (index < 0) index = slides.length - 1;
            if (index >= slides.length) index = 0;
            currentIndex = index;
            track.style.transform = `translateX(-${currentIndex * 100}%)`;
            dots.forEach((dot, i) => dot.classList.toggle('active', i === currentIndex));
        }
        
        function startAutoplay() {
            autoplayInterval = setInterval(() => goToSlide(currentIndex + 1), 5000);
        }
        
        function stopAutoplay() {
            clearInterval(autoplayInterval);
        }
        
        if (prevBtn) prevBtn.addEventListener('click', () => { stopAutoplay(); goToSlide(currentIndex - 1); startAutoplay(); });
        if (nextBtn) nextBtn.addEventListener('click', () => { stopAutoplay(); goToSlide(currentIndex + 1); startAutoplay(); });
        dots.forEach((dot, index) => dot.addEventListener('click', () => { stopAutoplay(); goToSlide(index); startAutoplay(); }));
        
        startAutoplay();
        carousel.addEventListener('mouseenter', stopAutoplay);
        carousel.addEventListener('mouseleave', startAutoplay);
    });
}

// ===================================
// SCROLL ANIMATIONS
// ===================================

function initScrollAnimations() {
    const elements = document.querySelectorAll('.fade-in');
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) entry.target.classList.add('visible');
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
    elements.forEach(el => observer.observe(el));
}

// ===================================
// ANIMATED COUNTERS
// ===================================

function initCounters() {
    const counters = document.querySelectorAll('.counter');
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !entry.target.classList.contains('counted')) {
                animateCounter(entry.target);
                entry.target.classList.add('counted');
            }
        });
    }, { threshold: 0.5 });
    counters.forEach(counter => observer.observe(counter));
}

function animateCounter(element) {
    const target = parseFloat(element.dataset.target);
    const suffix = element.dataset.suffix || '';
    const prefix = element.dataset.prefix || '';
    const decimals = element.dataset.decimals || 0;
    const duration = 2000;
    const startTime = performance.now();
    
    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const current = target * easeOut;
        element.textContent = prefix + current.toFixed(decimals) + suffix;
        if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
}

// ===================================
// HEADER SCROLL EFFECT
// ===================================

function initHeaderScroll() {
    const header = document.querySelector('.site-header');
    if (!header) return;
    window.addEventListener('scroll', () => {
        header.classList.toggle('scrolled', window.pageYOffset > 50);
    });
}

// ===================================
// MOBILE NAVIGATION
// ===================================

function initMobileNav() {
    const toggle = document.querySelector('.nav-toggle');
    const nav = document.querySelector('.nav-links');
    if (!toggle || !nav) return;
    toggle.addEventListener('click', () => {
        nav.classList.toggle('open');
        toggle.classList.toggle('active');
    });
    nav.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            nav.classList.remove('open');
            toggle.classList.remove('active');
        });
    });
}

// ===================================
// SMOOTH SCROLL
// ===================================

function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            const target = document.querySelector(targetId);
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
}

// ===================================
// FORM HANDLING
// ===================================

function initForms() {
    const forms = document.querySelectorAll('form[data-validate]');
    forms.forEach(form => {
        form.addEventListener('submit', (e) => {
            const requiredFields = form.querySelectorAll('[required]');
            let isValid = true;
            requiredFields.forEach(field => {
                if (!field.value.trim()) {
                    isValid = false;
                    field.classList.add('error');
                } else {
                    field.classList.remove('error');
                }
            });
            if (!isValid) e.preventDefault();
        });
    });
}

// ===================================
// PARALLAX EFFECT
// ===================================

function initParallax() {
    const heroBackground = document.querySelector('.hero-bg');
    if (!heroBackground) return;
    window.addEventListener('scroll', () => {
        heroBackground.style.transform = `translateY(${window.pageYOffset * 0.5}px)`;
    });
}

// ===================================
// INITIALIZATION
// ===================================

document.addEventListener('DOMContentLoaded', () => {
    initLanguageToggle();
    initAccordion();
    initTabs();
    initCarousel();
    initScrollAnimations();
    initCounters();
    initHeaderScroll();
    initMobileNav();
    initSmoothScroll();
    initForms();
    initParallax();
    
    if (typeof lucide !== 'undefined') lucide.createIcons();
});

