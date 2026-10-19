const crypto = require('crypto');

// Catálogo de categorías con 3 variaciones SVG cada una (100x100)
const CATEGORIAS = {
    computadora: {
        nombre: 'Computadoras / Laptops',
        icono: '💻',
        svgs: [
            // Laptop abierta moderna
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#e0f2fe"/>
                <rect x="22" y="24" width="56" height="38" rx="4" fill="#1e293b"/>
                <rect x="26" y="28" width="48" height="30" rx="2" fill="#38bdf8"/>
                <rect x="30" y="32" width="20" height="4" rx="1" fill="#ffffff" opacity="0.8"/>
                <rect x="30" y="39" width="30" height="3" rx="1" fill="#ffffff" opacity="0.6"/>
                <rect x="30" y="45" width="24" height="3" rx="1" fill="#ffffff" opacity="0.6"/>
                <polygon points="12,68 22,62 78,62 88,68" fill="#64748b"/>
                <rect x="42" y="65" width="16" height="2" rx="1" fill="#94a3b8"/>
                <rect x="14" y="68" width="72" height="4" rx="2" fill="#475569"/>
            </svg>`,
            // PC de escritorio con CPU
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#ede9fe"/>
                <rect x="15" y="22" width="50" height="36" rx="3" fill="#334155"/>
                <rect x="18" y="25" width="44" height="30" rx="2" fill="#818cf8"/>
                <circle cx="30" cy="38" r="5" fill="#ffffff" opacity="0.8"/>
                <path d="M 22 50 L 32 40 L 42 50 Z" fill="#ffffff" opacity="0.7"/>
                <rect x="37" y="58" width="6" height="8" fill="#64748b"/>
                <rect x="28" y="66" width="24" height="3" rx="1.5" fill="#475569"/>
                <rect x="70" y="25" width="18" height="44" rx="3" fill="#1e293b"/>
                <circle cx="79" cy="32" r="2.5" fill="#38bdf8"/>
                <line x1="74" y1="40" x2="84" y2="40" stroke="#475569" stroke-width="2"/>
                <line x1="74" y1="45" x2="84" y2="45" stroke="#475569" stroke-width="2"/>
                <rect x="22" y="73" width="36" height="5" rx="1.5" fill="#94a3b8"/>
            </svg>`,
            // Monitor Ultrawide
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#e0e7ff"/>
                <rect x="14" y="20" width="72" height="44" rx="4" fill="#0f172a"/>
                <rect x="18" y="24" width="64" height="36" rx="2" fill="#6366f1"/>
                <circle cx="50" cy="38" r="8" fill="#a5b4fc"/>
                <rect x="35" y="50" width="30" height="4" rx="2" fill="#ffffff" opacity="0.8"/>
                <path d="M 46 64 L 46 73 L 34 78 L 66 78 L 54 73 L 54 64 Z" fill="#64748b"/>
            </svg>`
        ]
    },
    automovil: {
        nombre: 'Automóviles / Carros',
        icono: '🚗',
        svgs: [
            // Auto rojo sedán
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#fee2e2"/>
                <path d="M 12 55 L 24 55 L 34 38 L 66 38 L 76 50 L 88 52 C 91 53 92 56 92 60 L 92 66 L 8 66 L 8 60 C 8 57 9 55 12 55 Z" fill="#ef4444"/>
                <path d="M 36 41 L 48 41 L 48 53 L 26 53 Z" fill="#bae6fd"/>
                <path d="M 52 41 L 64 41 L 72 53 L 52 53 Z" fill="#bae6fd"/>
                <circle cx="28" cy="67" r="9" fill="#1e293b"/>
                <circle cx="28" cy="67" r="4" fill="#cbd5e1"/>
                <circle cx="72" cy="67" r="9" fill="#1e293b"/>
                <circle cx="72" cy="67" r="4" fill="#cbd5e1"/>
                <rect x="88" y="56" width="4" height="4" rx="1" fill="#fef08a"/>
                <rect x="8" y="58" width="3" height="4" rx="1" fill="#fca5a5"/>
            </svg>`,
            // Camioneta SUV azul
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#dbeafe"/>
                <line x1="28" y1="30" x2="68" y2="30" stroke="#475569" stroke-width="3" stroke-linecap="round"/>
                <line x1="34" y1="30" x2="34" y2="34" stroke="#475569" stroke-width="2"/>
                <line x1="62" y1="30" x2="62" y2="34" stroke="#475569" stroke-width="2"/>
                <path d="M 10 54 L 20 54 L 26 34 L 72 34 L 76 48 L 90 50 C 93 51 94 54 94 58 L 94 65 L 6 65 L 6 58 C 6 55 8 54 10 54 Z" fill="#2563eb"/>
                <rect x="28" y="38" width="18" height="14" rx="2" fill="#bfdbfe"/>
                <rect x="50" y="38" width="20" height="14" rx="2" fill="#bfdbfe"/>
                <circle cx="26" cy="66" r="10" fill="#0f172a"/>
                <circle cx="26" cy="66" r="4" fill="#94a3b8"/>
                <circle cx="74" cy="66" r="10" fill="#0f172a"/>
                <circle cx="74" cy="66" r="4" fill="#94a3b8"/>
                <rect x="90" y="52" width="4" height="4" rx="1" fill="#fef08a"/>
            </svg>`,
            // Auto deportivo verde
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#dcfce7"/>
                <rect x="10" y="44" width="6" height="3" fill="#15803d"/>
                <line x1="12" y1="47" x2="12" y2="53" stroke="#15803d" stroke-width="2"/>
                <path d="M 10 55 C 20 54 30 42 45 40 L 68 42 L 86 52 C 92 55 92 60 92 64 L 8 64 Z" fill="#16a34a"/>
                <path d="M 42 43 L 64 43 L 74 52 L 36 52 Z" fill="#a7f3d0"/>
                <circle cx="26" cy="65" r="9" fill="#1e293b"/>
                <circle cx="26" cy="65" r="4" fill="#e2e8f0"/>
                <circle cx="76" cy="65" r="9" fill="#1e293b"/>
                <circle cx="76" cy="65" r="4" fill="#e2e8f0"/>
                <polygon points="88,55 93,56 89,59" fill="#fef08a"/>
            </svg>`
        ]
    },
    telefono: {
        nombre: 'Teléfonos inteligentes',
        icono: '📱',
        svgs: [
            // Smartphone con apps
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#f1f5f9"/>
                <rect x="30" y="14" width="40" height="72" rx="8" fill="#1e293b"/>
                <rect x="33" y="18" width="34" height="64" rx="4" fill="#3b82f6"/>
                <rect x="44" y="20" width="12" height="3" rx="1.5" fill="#1e293b"/>
                <rect x="38" y="28" width="6" height="6" rx="2" fill="#ffffff" opacity="0.9"/>
                <rect x="47" y="28" width="6" height="6" rx="2" fill="#fef08a"/>
                <rect x="56" y="28" width="6" height="6" rx="2" fill="#f43f5e"/>
                <rect x="38" y="38" width="6" height="6" rx="2" fill="#10b981"/>
                <rect x="47" y="38" width="6" height="6" rx="2" fill="#a855f7"/>
                <rect x="56" y="38" width="6" height="6" rx="2" fill="#fb923c"/>
                <rect x="42" y="76" width="16" height="2" rx="1" fill="#ffffff" opacity="0.8"/>
            </svg>`,
            // Smartphone morado con chat
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#fae8ff"/>
                <rect x="30" y="14" width="40" height="72" rx="8" fill="#581c87"/>
                <rect x="33" y="18" width="34" height="64" rx="4" fill="#f3e8ff"/>
                <circle cx="50" cy="22" r="1.5" fill="#581c87"/>
                <rect x="36" y="28" width="20" height="9" rx="3" fill="#a855f7"/>
                <rect x="44" y="42" width="20" height="9" rx="3" fill="#3b82f6"/>
                <rect x="36" y="56" width="18" height="9" rx="3" fill="#a855f7"/>
                <rect x="44" y="76" width="12" height="2" rx="1" fill="#a855f7"/>
            </svg>`,
            // Smartphone oscuro con reloj
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#e2e8f0"/>
                <rect x="31" y="14" width="38" height="72" rx="7" fill="#09090b"/>
                <rect x="33" y="17" width="34" height="66" rx="4" fill="#18181b"/>
                <rect x="39" y="32" width="22" height="12" rx="3" fill="#27272a"/>
                <circle cx="50" cy="56" r="10" fill="#06b6d4" opacity="0.4"/>
                <circle cx="50" cy="56" r="6" fill="#06b6d4"/>
                <circle cx="50" cy="77" r="3" fill="#71717a"/>
            </svg>`
        ]
    },
    taza: {
        nombre: 'Tazas de café',
        icono: '☕',
        svgs: [
            // Taza humeante clásica
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#fef3c7"/>
                <path d="M 40 28 C 38 23 42 19 40 14" stroke="#d97706" stroke-width="2.5" fill="none" stroke-linecap="round"/>
                <path d="M 50 28 C 48 22 52 18 50 12" stroke="#d97706" stroke-width="2.5" fill="none" stroke-linecap="round"/>
                <path d="M 60 28 C 58 23 62 19 60 14" stroke="#d97706" stroke-width="2.5" fill="none" stroke-linecap="round"/>
                <path d="M 30 35 L 70 35 L 66 70 C 66 75 60 78 50 78 C 40 78 34 75 34 70 Z" fill="#b45309"/>
                <path d="M 68 42 C 78 42 80 50 80 56 C 80 62 76 66 66 66" stroke="#b45309" stroke-width="5" fill="none" stroke-linecap="round"/>
                <ellipse cx="50" cy="81" rx="30" ry="5" fill="#78350f"/>
            </svg>`,
            // Vaso de café para llevar
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#ffedd5"/>
                <rect x="32" y="20" width="36" height="6" rx="2" fill="#334155"/>
                <rect x="36" y="16" width="28" height="5" rx="1.5" fill="#475569"/>
                <polygon points="34,26 66,26 60,82 40,82" fill="#ea580c"/>
                <polygon points="36,44 64,44 62,62 38,62" fill="#fed7aa"/>
                <circle cx="50" cy="53" r="5" fill="#9a3412"/>
            </svg>`,
            // Taza verde azulada
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#ccfbf1"/>
                <path d="M 45 26 C 43 21 47 17 45 12" stroke="#0d9488" stroke-width="2.5" fill="none" stroke-linecap="round"/>
                <path d="M 55 26 C 53 21 57 17 55 12" stroke="#0d9488" stroke-width="2.5" fill="none" stroke-linecap="round"/>
                <path d="M 28 34 L 72 34 L 68 68 C 68 76 60 80 50 80 C 40 80 32 76 32 68 Z" fill="#0f766e"/>
                <path d="M 70 42 C 82 42 82 54 82 58 C 82 64 78 66 68 66" stroke="#0f766e" stroke-width="5" fill="none"/>
                <ellipse cx="50" cy="83" rx="28" ry="4" fill="#115e59"/>
            </svg>`
        ]
    },
    avion: {
        nombre: 'Aviones',
        icono: '✈️',
        svgs: [
            // Avión comercial azul
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#e0f2fe"/>
                <circle cx="25" cy="72" r="12" fill="#ffffff" opacity="0.7"/>
                <circle cx="40" cy="70" r="16" fill="#ffffff" opacity="0.7"/>
                <circle cx="55" cy="74" r="10" fill="#ffffff" opacity="0.7"/>
                <path d="M 82 32 C 84 34 84 38 80 42 L 28 66 C 24 68 20 66 18 64 L 14 62 L 18 52 L 28 52 L 48 44 L 38 24 L 46 22 L 64 40 L 76 34 Z" fill="#2563eb"/>
                <polygon points="46,46 36,74 44,74 58,48" fill="#1d4ed8"/>
                <circle cx="68" cy="40" r="1.5" fill="#ffffff"/>
                <circle cx="62" cy="43" r="1.5" fill="#ffffff"/>
                <circle cx="56" cy="46" r="1.5" fill="#ffffff"/>
            </svg>`,
            // Avión visto desde arriba
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#eff6ff"/>
                <polygon points="50,15 54,26 88,60 88,66 54,54 54,80 66,90 66,94 50,90 34,94 34,90 46,80 46,54 12,66 12,60 46,26" fill="#0284c7"/>
                <ellipse cx="50" cy="40" rx="5" ry="25" fill="#0369a1"/>
                <circle cx="50" cy="18" r="4" fill="#38bdf8"/>
            </svg>`,
            // Avión blanco con franja roja
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#f0f9ff"/>
                <path d="M 84 28 C 88 32 86 36 80 40 L 32 68 L 22 68 L 18 58 L 26 56 L 46 46 L 38 26 L 46 24 L 64 40 L 78 32 Z" fill="#e2e8f0"/>
                <path d="M 80 34 L 30 62 L 28 66 L 78 38 Z" fill="#dc2626"/>
                <polygon points="48,46 38,72 46,72 60,48" fill="#cbd5e1"/>
            </svg>`
        ]
    },
    bicicleta: {
        nombre: 'Bicicletas',
        icono: '🚲',
        svgs: [
            // Bicicleta azul
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#f0fdf4"/>
                <circle cx="26" cy="65" r="14" stroke="#334155" stroke-width="3" fill="none"/>
                <circle cx="26" cy="65" r="3" fill="#334155"/>
                <circle cx="74" cy="65" r="14" stroke="#334155" stroke-width="3" fill="none"/>
                <circle cx="74" cy="65" r="3" fill="#334155"/>
                <polyline points="26,65 46,65 64,48 74,65" stroke="#0284c7" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                <polyline points="46,65 40,44 64,48" stroke="#0284c7" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                <line x1="26" y1="65" x2="40" y2="44" stroke="#0284c7" stroke-width="3.5" stroke-linecap="round"/>
                <line x1="36" y1="42" x2="44" y2="42" stroke="#1e293b" stroke-width="4" stroke-linecap="round"/>
                <line x1="64" y1="48" x2="66" y2="38" stroke="#0284c7" stroke-width="3.5" stroke-linecap="round"/>
                <line x1="62" y1="36" x2="72" y2="38" stroke="#1e293b" stroke-width="3.5" stroke-linecap="round"/>
            </svg>`,
            // Bicicleta roja
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#fff1f2"/>
                <circle cx="26" cy="65" r="14" stroke="#1e293b" stroke-width="3" fill="none"/>
                <circle cx="74" cy="65" r="14" stroke="#1e293b" stroke-width="3" fill="none"/>
                <polyline points="26,65 46,65 64,48 74,65" stroke="#e11d48" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                <polyline points="46,65 40,44 64,48" stroke="#e11d48" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                <line x1="26" y1="65" x2="40" y2="44" stroke="#e11d48" stroke-width="3.5" stroke-linecap="round"/>
                <line x1="36" y1="42" x2="44" y2="42" stroke="#0f172a" stroke-width="4" stroke-linecap="round"/>
                <line x1="64" y1="48" x2="66" y2="38" stroke="#e11d48" stroke-width="3.5"/>
                <line x1="62" y1="36" x2="72" y2="38" stroke="#0f172a" stroke-width="3.5" stroke-linecap="round"/>
            </svg>`,
            // Bicicleta con canasta
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#fefce8"/>
                <circle cx="26" cy="65" r="14" stroke="#475569" stroke-width="3" fill="none"/>
                <circle cx="74" cy="65" r="14" stroke="#475569" stroke-width="3" fill="none"/>
                <polyline points="26,65 46,65 64,48 74,65" stroke="#16a34a" stroke-width="3.5" fill="none" stroke-linecap="round"/>
                <polyline points="46,65 40,44 64,48" stroke="#16a34a" stroke-width="3.5" fill="none" stroke-linecap="round"/>
                <line x1="26" y1="65" x2="40" y2="44" stroke="#16a34a" stroke-width="3.5"/>
                <rect x="68" y="38" width="10" height="8" rx="1.5" fill="#d97706"/>
                <line x1="36" y1="42" x2="44" y2="42" stroke="#1e293b" stroke-width="4" stroke-linecap="round"/>
                <line x1="64" y1="48" x2="66" y2="36" stroke="#16a34a" stroke-width="3.5"/>
                <line x1="62" y1="35" x2="72" y2="35" stroke="#1e293b" stroke-width="3"/>
            </svg>`
        ]
    },
    bombilla: {
        nombre: 'Bombillas / Focos',
        icono: '💡',
        svgs: [
            // Foco encendido brillante
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#fef9c3"/>
                <line x1="50" y1="10" x2="50" y2="16" stroke="#eab308" stroke-width="3" stroke-linecap="round"/>
                <line x1="22" y1="24" x2="27" y2="28" stroke="#eab308" stroke-width="3" stroke-linecap="round"/>
                <line x1="78" y1="24" x2="73" y2="28" stroke="#eab308" stroke-width="3" stroke-linecap="round"/>
                <line x1="12" y1="44" x2="18" y2="44" stroke="#eab308" stroke-width="3" stroke-linecap="round"/>
                <line x1="88" y1="44" x2="82" y2="44" stroke="#eab308" stroke-width="3" stroke-linecap="round"/>
                <path d="M 32 44 C 32 34 40 26 50 26 C 60 26 68 34 68 44 C 68 52 62 58 60 64 L 40 64 C 38 58 32 52 32 44 Z" fill="#facc15"/>
                <path d="M 45 64 L 46 48 L 50 52 L 54 48 L 55 64" stroke="#ca8a04" stroke-width="2" fill="none"/>
                <rect x="42" y="66" width="16" height="3" rx="1" fill="#94a3b8"/>
                <rect x="43" y="71" width="14" height="3" rx="1" fill="#94a3b8"/>
                <path d="M 45 76 L 55 76 L 52 80 L 48 80 Z" fill="#475569"/>
            </svg>`,
            // Foco Edison vintage
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#ffedd5"/>
                <path d="M 34 42 C 34 32 41 24 50 24 C 59 24 66 32 66 42 C 66 50 60 56 59 64 L 41 64 C 40 56 34 50 34 42 Z" fill="#fed7aa" stroke="#f97316" stroke-width="2"/>
                <path d="M 46 64 L 46 42 C 46 36 54 36 54 42 L 54 64" stroke="#ea580c" stroke-width="2.5" fill="none"/>
                <rect x="43" y="66" width="14" height="3" rx="1" fill="#64748b"/>
                <rect x="44" y="71" width="12" height="3" rx="1" fill="#64748b"/>
                <path d="M 46 76 L 54 76 L 52 79 L 48 79 Z" fill="#334155"/>
            </svg>`,
            // Foco LED azul
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#e0f2fe"/>
                <path d="M 32 42 C 32 32 40 24 50 24 C 60 24 68 32 68 42 C 68 52 62 58 60 64 L 40 64 C 38 58 32 52 32 42 Z" fill="#38bdf8"/>
                <circle cx="50" cy="40" r="8" fill="#ffffff" opacity="0.6"/>
                <rect x="42" y="66" width="16" height="4" rx="1" fill="#94a3b8"/>
                <rect x="43" y="72" width="14" height="4" rx="1" fill="#64748b"/>
            </svg>`
        ]
    },
    reloj: {
        nombre: 'Relojes',
        icono: '⏰',
        svgs: [
            // Reloj despertador rojo
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#fee2e2"/>
                <path d="M 28 22 C 22 28 22 34 26 38 L 34 30 Z" fill="#ef4444"/>
                <path d="M 72 22 C 78 28 78 34 74 38 L 66 30 Z" fill="#ef4444"/>
                <rect x="48" y="16" width="4" height="6" fill="#64748b"/>
                <line x1="32" y1="74" x2="24" y2="82" stroke="#64748b" stroke-width="4" stroke-linecap="round"/>
                <line x1="68" y1="74" x2="76" y2="82" stroke="#64748b" stroke-width="4" stroke-linecap="round"/>
                <circle cx="50" cy="52" r="26" fill="#ef4444"/>
                <circle cx="50" cy="52" r="21" fill="#ffffff"/>
                <line x1="50" y1="52" x2="42" y2="40" stroke="#1e293b" stroke-width="3" stroke-linecap="round"/>
                <line x1="50" y1="52" x2="62" y2="42" stroke="#1e293b" stroke-width="2.5" stroke-linecap="round"/>
                <circle cx="50" cy="52" r="2.5" fill="#dc2626"/>
            </svg>`,
            // Reloj de pared azul
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#dbeafe"/>
                <circle cx="50" cy="50" r="30" fill="#2563eb"/>
                <circle cx="50" cy="50" r="25" fill="#f8fafc"/>
                <line x1="50" y1="28" x2="50" y2="32" stroke="#64748b" stroke-width="2"/>
                <line x1="50" y1="68" x2="50" y2="72" stroke="#64748b" stroke-width="2"/>
                <line x1="28" y1="50" x2="32" y2="50" stroke="#64748b" stroke-width="2"/>
                <line x1="68" y1="50" x2="72" y2="50" stroke="#64748b" stroke-width="2"/>
                <line x1="50" y1="50" x2="50" y2="36" stroke="#0f172a" stroke-width="3" stroke-linecap="round"/>
                <line x1="50" y1="50" x2="63" y2="50" stroke="#0f172a" stroke-width="2.5" stroke-linecap="round"/>
                <circle cx="50" cy="50" r="3" fill="#2563eb"/>
            </svg>`,
            // Smartwatch verde
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#f1f5f9"/>
                <rect x="40" y="12" width="20" height="76" rx="4" fill="#475569"/>
                <rect x="33" y="32" width="34" height="36" rx="8" fill="#0f172a"/>
                <rect x="36" y="35" width="28" height="30" rx="6" fill="#10b981"/>
                <line x1="50" y1="50" x2="45" y2="43" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
                <line x1="50" y1="50" x2="57" y2="46" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
                <circle cx="50" cy="50" r="2" fill="#ffffff"/>
            </svg>`
        ]
    },
    camara: {
        nombre: 'Cámaras fotográficas',
        icono: '📷',
        svgs: [
            // Cámara réflex negra
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#f3f4f6"/>
                <path d="M 22 40 L 35 40 L 40 32 L 60 32 L 65 40 L 78 40 C 82 40 84 42 84 46 L 84 72 C 84 76 82 78 78 78 L 22 78 C 18 78 16 76 16 72 L 16 46 C 16 42 18 40 22 40 Z" fill="#1f2937"/>
                <rect x="25" y="36" width="6" height="4" rx="1" fill="#4b5563"/>
                <circle cx="70" cy="48" r="3" fill="#facc15"/>
                <circle cx="50" cy="58" r="16" fill="#374151"/>
                <circle cx="50" cy="58" r="12" fill="#0284c7"/>
                <circle cx="50" cy="58" r="7" fill="#0369a1"/>
                <circle cx="47" cy="55" r="3" fill="#ffffff" opacity="0.6"/>
            </svg>`,
            // Cámara retro turquesa
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#ccfbf1"/>
                <rect x="18" y="36" width="64" height="42" rx="6" fill="#0d9488"/>
                <rect x="18" y="36" width="64" height="14" rx="3" fill="#99f6e4"/>
                <rect x="24" y="32" width="7" height="4" fill="#0f766e"/>
                <circle cx="50" cy="57" r="15" fill="#134e4a"/>
                <circle cx="50" cy="57" r="10" fill="#5eead4"/>
                <circle cx="47" cy="54" r="3" fill="#ffffff"/>
            </svg>`,
            // Cámara compacta roja
            `<svg viewBox="0 0 100 100" width="100%" height="100%">
                <rect width="100" height="100" rx="8" fill="#fee2e2"/>
                <rect x="20" y="38" width="60" height="40" rx="6" fill="#dc2626"/>
                <circle cx="46" cy="58" r="14" fill="#1f2937"/>
                <circle cx="46" cy="58" r="9" fill="#60a5fa"/>
                <rect x="66" y="44" width="8" height="6" rx="1.5" fill="#fef08a"/>
                <rect x="26" y="34" width="8" height="4" rx="1" fill="#7f1d1d"/>
            </svg>`
        ]
    }
};

/**
 * Mezcla aleatoriamente un array (Fisher-Yates)
 */
function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Genera un nuevo desafío CAPTCHA interactivo de 9 casillas (3x3)
 */
function generarCaptcha() {
    const keys = Object.keys(CATEGORIAS);
    // Elegir categoría objetivo al azar
    const targetKey = keys[Math.floor(Math.random() * keys.length)];
    const targetCategory = CATEGORIAS[targetKey];

    // Obtener las 3 imágenes de la categoría objetivo
    const correctTiles = targetCategory.svgs.map((svg) => {
        const id = 'c_' + crypto.randomBytes(4).toString('hex');
        return {
            id: id,
            svg: svg,
            isTarget: true
        };
    });

    // Elegir 6 categorías distintas como distractores
    const distractorKeys = shuffle(keys.filter(k => k !== targetKey)).slice(0, 6);
    const distractorTiles = distractorKeys.map((k) => {
        const cat = CATEGORIAS[k];
        const svgIndex = Math.floor(Math.random() * cat.svgs.length);
        const id = 'd_' + crypto.randomBytes(4).toString('hex');
        return {
            id: id,
            svg: cat.svgs[svgIndex],
            isTarget: false
        };
    });

    // Mezclar las 9 casillas
    const allTiles = shuffle([...correctTiles, ...distractorTiles]);

    return {
        prompt: 'Selecciona todas las imágenes que contengan:',
        targetName: targetCategory.nombre,
        targetIcon: targetCategory.icono,
        correctIds: correctTiles.map(t => t.id),
        // Lo que se enviará al frontend (sin revelar isTarget)
        tiles: allTiles.map(t => ({
            id: t.id,
            svg: t.svg
        }))
    };
}

/**
 * Valida la respuesta del usuario contra las respuestas correctas
 */
function validarCaptcha(correctIds, userSelectedIds) {
    if (!Array.isArray(correctIds) || !Array.isArray(userSelectedIds)) {
        return false;
    }
    if (correctIds.length === 0 || userSelectedIds.length === 0) {
        return false;
    }
    if (correctIds.length !== userSelectedIds.length) {
        return false;
    }
    // Debe haber seleccionado exactamente todas las respuestas correctas y ninguna errónea
    const setCorrect = new Set(correctIds);
    return userSelectedIds.every(id => setCorrect.has(id));
}

module.exports = {
    generarCaptcha,
    validarCaptcha
};

