/* ============================================================
   CONFIG.JS — v3 (corrigido)
   - flowType 'implicit' (PKCE causa bugs em apps multipágina)
   - migração agressiva de chaves antigas
   - client único compartilhado entre todas as páginas
   ============================================================ */
(function () {
    'use strict';

    var CONFIG = {
        url: 'https://qswvoxkhicficbdkcpzn.supabase.co',
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzd3ZveGtoaWNmaWNiZGtjcHpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNjAyNzMsImV4cCI6MjEwMzkzNjI3M30.KmzjytD0K7AxpY0n3teAUftWXzqitRLMyefsPq5F0KA'
    };

    /* Chave única e definitiva */
    var STORAGE_KEY = 'auloo-auth';

    /* Padrões que identificam chaves legadas/duplicadas */
    var PADROES_LEGADOS = [
        'acervo-auth',
        'sb-',
        'supabase-auth'
    ];

    /* ---------- Migração: remove chaves antigas que confundem o cliente ---------- */
    function migrarChavesAntigas() {
        try {
            var aRemover = [];
            Object.keys(localStorage).forEach(function (chave) {
                if (chave === STORAGE_KEY) return;
                var deveRemover = PADROES_LEGADOS.some(function (p) {
                    return chave.indexOf(p) === 0;
                });
                if (chave.indexOf(STORAGE_KEY) === 0) deveRemover = true;

                if (deveRemover) aRemover.push(chave);
            });

            aRemover.forEach(function (chave) {
                localStorage.removeItem(chave);
            });

            if (aRemover.length) {
                console.log('[config] removidas chaves antigas:', aRemover);
            }
        } catch (e) {
            console.warn('[config] migração falhou:', e);
        }
    }

    /* ---------- Inicialização ---------- */
    var cliente = null;

    function inicializar() {
        if (cliente) return cliente;
        if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
            return null;
        }

        migrarChavesAntigas();

        try {
            cliente = window.supabase.createClient(CONFIG.url, CONFIG.anonKey, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true,
                    /* ✔ IMPLICIT: ideal para login por senha + OAuth.
                       PKCE causa bugs de sessão em apps multipágina. */
                    flowType: 'implicit',
                    storage: window.localStorage,
                    storageKey: STORAGE_KEY
                }
            });
            window.supabaseClient = cliente;
            console.log('[config] Supabase pronto (storageKey: ' + STORAGE_KEY + ')');
            return cliente;
        } catch (erro) {
            console.error('[config] Falha ao criar client:', erro);
            return null;
        }
    }

    /* ---------- API pública ---------- */
    window.SUPABASE_CONFIG = CONFIG;
    window.getSupabaseClient = inicializar;
    window.getSupabaseClientSeguro = function () {
        return cliente || inicializar();
    };

    window.aguardarSupabase = function (tentativas, intervaloMs) {
        tentativas = tentativas || 40;
        intervaloMs = intervaloMs || 200;
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

    inicializar();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    }
    window.addEventListener('load', inicializar);
})();