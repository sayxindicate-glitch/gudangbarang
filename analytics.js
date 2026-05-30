// ============================================================================
// GOEDANG GROSIR - SINGULARITY ANALYTICS MODULE (v.GOD-MODE) + PRIVACY
// Predictive AI, Micro-Tremors, Kinematics & Cookie Consent Compliance
// ============================================================================

(function() {
    const GA_MEASUREMENT_ID = 'G-XXXXXXXXXX'; // GANTI DENGAN ID GOOGLE ANALYTICS ANDA

    // ============================================================================
    // 1. OMNI-API (REMOTE CONTROL UNTUK HTML LAINNYA)
    // Dideklarasikan di awal agar tidak menyebabkan error di file HTML lain.
    // Jika user menolak Cookie, fungsi ini akan diam (silent) dan tidak melacak.
    // ============================================================================
    window.GoedangAnalytics = {
        _safeTrack: function(eventName, payload) {
            if (window.gtag && localStorage.getItem('gg_cookie_consent') === 'accepted') {
                gtag('event', eventName, payload);
            }
        },
        trackFunnel: function(stepName) { this._safeTrack('funnel_step', { step: stepName }); },
        trackViewItem: function(id, name, price, category = "Uncategorized") {
            this._safeTrack('view_item', { currency: "IDR", value: price, items: [{ item_id: id, item_name: name, price: price, item_category: category }] });
        },
        trackAddToCart: function(id, name, price, qty) {
            this._safeTrack('add_to_cart', { currency: "IDR", value: price * qty, items: [{ item_id: id, item_name: name, price: price, quantity: qty }] });
        },
        trackCheckout: function(totalValue, itemsArray) {
            this._safeTrack('begin_checkout', { currency: "IDR", value: totalValue, items: itemsArray });
        }
    };

    // ============================================================================
    // 2. MANAJEMEN PERSETUJUAN (COOKIE CONSENT - UU PDP COMPLIANCE)
    // ============================================================================
    function checkConsent() {
        const consent = localStorage.getItem('gg_cookie_consent');
        if (consent === 'accepted') {
            startOmniscientTracking();
        } else if (consent !== 'declined') {
            showConsentBanner();
        }
    }

    function showConsentBanner() {
        // Suntikkan CSS Neumorphism untuk Pop-up Cookie
        const style = document.createElement('style');
        style.innerHTML = `
            #gg-cookie-banner {
                position: fixed; bottom: 20px; left: 20px; right: 20px; z-index: 9999;
                background: var(--bg-color, #e0e5ec); padding: 20px; border-radius: 20px;
                box-shadow: 9px 9px 16px var(--shadow-dark, #a3b1c6), -9px -9px 16px var(--shadow-light, #ffffff);
                display: flex; flex-direction: column; gap: 15px; font-family: 'Poppins', sans-serif;
                transition: transform 0.5s ease, opacity 0.5s ease;
                color: var(--text-main, #2d3436);
            }
            [data-theme="dark"] #gg-cookie-banner {
                background: #1a1b1e; box-shadow: 9px 9px 16px rgba(0,0,0,0.6), -9px -9px 16px rgba(255,255,255,0.05); color: #f5f6fa;
            }
            .gg-cookie-text { font-size: 12px; color: var(--text-muted, #636e72); line-height: 1.6; }
            [data-theme="dark"] .gg-cookie-text { color: #a4b0be; }
            .gg-cookie-buttons { display: flex; gap: 10px; justify-content: flex-end; }
            .gg-cookie-btn {
                padding: 10px 20px; border-radius: 12px; border: none; font-size: 12px; font-weight: 700; cursor: pointer;
                box-shadow: 5px 5px 10px var(--shadow-dark, #a3b1c6), -5px -5px 10px var(--shadow-light, #ffffff); 
                background: var(--bg-color, #e0e5ec); color: var(--text-muted, #636e72); transition: all 0.2s;
            }
            [data-theme="dark"] .gg-cookie-btn { background: #1a1b1e; box-shadow: 5px 5px 10px rgba(0,0,0,0.6), -5px -5px 10px rgba(255,255,255,0.05); }
            .gg-cookie-btn:active { box-shadow: inset 4px 4px 8px var(--shadow-dark, #a3b1c6), inset -4px -4px 8px var(--shadow-light, #ffffff); }
            .gg-cookie-btn.accept { color: var(--accent-color, #0984e3); }
            [data-theme="dark"] .gg-cookie-btn.accept { color: #00e5ff; }
            @media(max-width: 768px) { #gg-cookie-banner { bottom: 90px; } .gg-cookie-buttons { flex-direction: column; } .gg-cookie-btn { width: 100%; text-align: center; } }
        `;
        document.head.appendChild(style);

        // Suntikkan HTML Pop-up
        const banner = document.createElement('div');
        banner.id = 'gg-cookie-banner';
        banner.innerHTML = `
            <div style="font-weight: 700; font-size: 14px; display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-shield-alt" style="color: var(--accent-color, #0984e3);"></i> Privasi & Keamanan Data
            </div>
            <div class="gg-cookie-text">
                Kami menggunakan teknologi pelacakan analitik tingkat lanjut untuk memahami perilaku belanja Anda dan memberikan penawaran yang dipersonalisasi. Dengan menekan "Terima", Anda menyetujui pengumpulan data metrik performa dan preferensi sesuai dengan Undang-Undang Pelindungan Data.
            </div>
            <div class="gg-cookie-buttons">
                <button class="gg-cookie-btn" id="gg-btn-decline">Tolak</button>
                <button class="gg-cookie-btn accept" id="gg-btn-accept">Terima & Lanjutkan</button>
            </div>
        `;
        document.body.appendChild(banner);

        // Aksi Tombol
        document.getElementById('gg-btn-accept').addEventListener('click', () => {
            localStorage.setItem('gg_cookie_consent', 'accepted');
            banner.style.opacity = '0';
            setTimeout(() => { banner.remove(); startOmniscientTracking(); }, 400);
        });

        document.getElementById('gg-btn-decline').addEventListener('click', () => {
            localStorage.setItem('gg_cookie_consent', 'declined');
            banner.style.opacity = '0';
            setTimeout(() => banner.remove(), 400);
        });
    }

    // ============================================================================
    // 3. THE SINGULARITY RADAR (HANYA AKTIF JIKA USER MENYETUJUI COOKIE)
    // ============================================================================
    function startOmniscientTracking() {
        if (window.gtag) return;

        // Injeksi Google Analytics
        const script = document.createElement('script');
        script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
        script.async = true;
        document.head.appendChild(script);

        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        window.gtag = gtag; 
        gtag('js', new Date());

        let persistentId = localStorage.getItem('gg_permanent_id');
        if (!persistentId) {
            persistentId = 'GG-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now();
            localStorage.setItem('gg_permanent_id', persistentId);
        }

        gtag('config', GA_MEASUREMENT_ID, { user_id: persistentId, send_page_view: true });

        // --- SENSOR PSIKOLOGI, BIOMETRIK & HARDWARE ---
        
        // A. ENVIRONMENTAL IMPULSIVITY (Kondisi Malam Hari)
        const hour = new Date().getHours();
        const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        if ((hour >= 23 || hour <= 4) && isDarkMode) {
            gtag('event', 'user_state', { condition: 'late_night_impulsive', page: window.location.pathname });
        }

        // B. DEVICE KINEMATICS (Gyroscope HP: Duduk vs Rebahan)
        if (window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission !== 'function') {
            window.addEventListener('deviceorientation', (e) => {
                if (!e.beta || !e.gamma) return;
                let posture = 'unknown';
                if (e.beta > 70 && e.beta < 110) posture = 'sitting_upright'; 
                else if (e.beta < 30 && e.beta > -30) posture = 'lying_down'; 
                
                if (!window.sessionPostureTracked && posture !== 'unknown') {
                    gtag('event', 'physical_posture', { stance: posture });
                    window.sessionPostureTracked = true; 
                }
            }, { once: true });
        }

        // C. MICRO-TREMOR & VELOCITY (Stres Jari/Kursor)
        let lastMouseX = 0, lastMouseY = 0, lastMouseTime = Date.now();
        let tremorScore = 0;
        document.addEventListener('mousemove', (e) => {
            const now = Date.now();
            const timeDiff = now - lastMouseTime;
            if (timeDiff > 10 && timeDiff < 100) {
                const speed = Math.sqrt(Math.pow(e.clientX - lastMouseX, 2) + Math.pow(e.clientY - lastMouseY, 2)) / timeDiff;
                if (speed > 5) tremorScore++;
                if (tremorScore > 20) {
                    gtag('event', 'biometric_anxiety_detected', { page: window.location.pathname });
                    tremorScore = 0; 
                }
            }
            lastMouseX = e.clientX; lastMouseY = e.clientY; lastMouseTime = now;
        }, { passive: true });

        // D. COGNITIVE LOAD & SKIMMING (Skimming Cepat vs Membaca Detail)
        let scrollTimeStart = Date.now();
        let lastScrollY = window.scrollY;
        window.addEventListener('scroll', () => {
            const now = Date.now();
            if (now - scrollTimeStart > 1000) { 
                const distance = Math.abs(window.scrollY - lastScrollY);
                if (distance > 2000) { 
                    gtag('event', 'reading_behavior', { type: 'skimming_fast', page: window.location.pathname });
                } else if (distance > 0 && distance < 300) { 
                    gtag('event', 'reading_behavior', { type: 'deep_reading', page: window.location.pathname });
                }
                lastScrollY = window.scrollY;
                scrollTimeStart = now;
            }
        }, { passive: true });

        // E. PREDICTIVE CHURN ENGINE (AI Prediksi Batal Bayar)
        let tabSwitches = 0;
        let idleTime = 0;
        let lastActive = Date.now();
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                tabSwitches++;
                idleTime += (Date.now() - lastActive);
            } else {
                lastActive = Date.now();
                if (window.location.pathname.includes('keranjang') || window.location.pathname.includes('checkout')) {
                    if (tabSwitches >= 3 && idleTime > 15000) {
                        gtag('event', 'predictive_churn_alert', { probability: '85%', reason: 'Comparison & Idle' });
                        tabSwitches = 0; 
                    }
                }
            }
        });

        // F. PSYCHOLOGICAL SENSORS (Ragu, Hapus-ketik, Panik)
        // 1. Hover Hesitation (Ragu Klik)
        let hoverTimer;
        document.addEventListener('mouseover', (e) => {
            const isClickable = e.target.closest('button, .neu-btn, .btn-checkout');
            if (isClickable) {
                const btnName = isClickable.innerText?.substring(0, 20) || 'button';
                hoverTimer = setTimeout(() => { gtag('event', 'button_hesitation', { element: btnName }); }, 2000);
            }
        });
        document.addEventListener('mouseout', () => clearTimeout(hoverTimer));
        document.addEventListener('click', () => clearTimeout(hoverTimer));

        // 2. Typing Friction (Sering tekan Backspace = Bingung isi alamat)
        let backspaceCount = 0;
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
                if (++backspaceCount === 6) { 
                    gtag('event', 'typing_friction_high', { field: e.target.id || 'unknown' });
                    backspaceCount = 0; 
                }
            }
        });
        document.addEventListener('focusout', () => backspaceCount = 0);

        // 3. Scroll Thrashing (Scroll Atas-Bawah Cepat)
        let scrollChanges = 0, lastDir = null, scrollThrashTimer = null;
        window.addEventListener('scroll', () => {
            let currentDir = window.scrollY > lastScrollY ? 'down' : 'up';
            if (lastDir && currentDir !== lastDir) {
                if (++scrollChanges > 4) { 
                    gtag('event', 'scroll_thrashing_detected', { page: window.location.pathname });
                    scrollChanges = 0; 
                }
            }
            lastDir = currentDir;
            clearTimeout(scrollThrashTimer);
            scrollThrashTimer = setTimeout(() => { scrollChanges = 0; }, 1500); 
        }, { passive: true });

        // G. CLASSIC RADAR (Rage Click, Baterai Lemah, Copy Paste, Niat Kabur)
        if ('getBattery' in navigator) {
            navigator.getBattery().then(b => {
                if (b.level <= 0.15 && !b.charging) gtag('event', 'hardware', { battery: 'critical' });
            }).catch(()=>{});
        }

        let clickCount = 0, lastClickTime = Date.now();
        document.body.addEventListener('click', (e) => {
            let now = Date.now();
            if (now - lastClickTime < 400) { 
                if (++clickCount === 3) { gtag('event', 'rage_click', { element: e.target.tagName }); clickCount = 0; }
            } else { clickCount = 1; }
            lastClickTime = now;
        });

        document.addEventListener('copy', () => {
            const text = document.getSelection().toString().trim();
            if(text.length > 0 && text.length < 50) gtag('event', 'competitor_comparison_check', { copied: text });
        });

        document.addEventListener('mouseout', (e) => {
            if (e.clientY < 0 && !window.exitFired) { gtag('event', 'exit_intent_triggered'); window.exitFired = true; }
        });
    }

    // Eksekusi Pengecekan Consent saat halaman dimuat
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkConsent);
    } else {
        checkConsent();
    }

})();
