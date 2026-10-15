/* ============================================================
   CONFIG.JS — v4 (rápido, robusto, sem PKCE)
   ============================================================ */
(function () {
    'use strict';

    var CONFIG = {
        url: 'https://qswvoxkhicficbdkcpzn.supabase.co',
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzd3ZveGtoaWNmaWNiZGtjcHpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNjAyNzMsImV4cCI6MjEwMzkzNjI3M30.KmzjytD0K7AxpY0n3teAUftWXzqitRLMyefsPq5F0KA'
    };

    var STORAGE_KEY = 'auloo-auth';
    var PADROES_LEGADOS = ['acervo-auth', 'sb-', 'supabase-auth'];

    function migrar() {
        try {
            var remover = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k === STORAGE_KEY) continue;
                if (k.indexOf(STORAGE_KEY) === 0) { remover.push(k); continue; }
                for (var j = 0; j < PADROES_LEGADOS.length; j++) {
                    if (k.indexOf(PADROES_LEGADOS[j]) === 0) { remover.push(k); break; }
                }
            }
            remover.forEach(function (k) { localStorage.removeItem(k); });
            if (remover.length) console.log('[config] migrados:', remover.length);
        } catch (e) { /* privado */ }
    }

    var cliente = null;

    function inicializar() {
        if (cliente) return cliente;
        if (typeof window.supabase === 'undefined' || !window.supabase.createClient) return null;

        migrar();

        try {
            cliente = window.supabase.createClient(CONFIG.url, CONFIG.anonKey, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true,
                    flowType: 'implicit',
                    storage: window.localStorage,
                    storageKey: STORAGE_KEY
                }
            });
            window.supabaseClient = cliente;
            console.log('[config] pronto');
            return cliente;
        } catch (e) {
            console.error('[config]', e);
            return null;
        }
    }

    /* API pública */
    window.SUPABASE_CONFIG = CONFIG;
    window.getSupabaseClient = inicializar;
    window.getSupabaseClientSeguro = function () { return cliente || inicializar(); };

    /* Espera o client (não bloqueia o main thread) */
    window.aguardarSupabase = function (tentativas, intervaloMs) {
        tentativas = tentativas || 20;
        intervaloMs = intervaloMs || 100;
        return new Promise(function (resolve) {
            var i = 0;
            (function loop() {
                var db = cliente || inicializar();
                if (db) return resolve(db);
                if (++i >= tentativas) return resolve(null);
                setTimeout(loop, intervaloMs);
            })();
        });
    };

    /* Obtém sessão com timeout curto e fallback rápido */
    window.obterSessao = async function (timeoutMs) {
        timeoutMs = timeoutMs || 5000;
        var db = await window.aguardarSupabase();
        if (!db) return null;

        var inicio = Date.now();
        while (Date.now() - inicio < timeoutMs) {
            try {
                var r = await db.auth.getSession();
                var s = r && r.data && r.data.session;
                if (s && s.user) return s;
            } catch (e) { /* ignora */ }
            await new Promise(function (res) { setTimeout(res, 200); });
        }
        return null;
    };

    inicializar();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    }
    window.addEventListener('load', inicializar);
})();