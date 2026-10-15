/* ============================================================
   CONFIG.JS — v2
   Supabase com sessão resiliente, migração de chaves antigas
   e helpers globais reutilizáveis.
   ============================================================ */
(function () {
    'use strict';

    var CONFIG = {
        url: 'https://qswvoxkhicficbdkcpzn.supabase.co',
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzd3ZveGtoaWNmaWNiZGtjcHpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNjAyNzMsImV4cCI6MjEwMzkzNjI3M30.KmzjytD0K7AxpY0n3teAUftWXzqitRLMyefsPq5F0KA'
    };

    var STORAGE_KEY = 'auloo-auth';
    var CHAVES_LEGADAS = ['sb-qswvoxkhicficbdkcpzn-auth-token', 'acervo-auth', 'acervo_user'];

    /* ---------- Migração: limpa chaves antigas que confundem o supabase-js ---------- */
    function migrarChavesAntigas() {
        try {
            CHAVES_LEGADAS.forEach(function (chave) {
                if (chave !== STORAGE_KEY && localStorage.getItem(chave)) {
                    localStorage.removeItem(chave);
                }
            });
        } catch (e) { /* modo privado: ignora */ }
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
                    flowType: 'pkce',
                    storage: window.localStorage,
                    storageKey: STORAGE_KEY
                }
            });
            window.supabaseClient = cliente;
            console.log('[config] Supabase pronto (key: ' + STORAGE_KEY + ')');
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

    /* Espera o client existir (útil quando config.js carrega antes do CDN) */
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

    /* Tenta inicializar em vários momentos (CDN pode chegar depois) */
    inicializar();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inicializar);
    }
    window.addEventListener('load', inicializar);
})();