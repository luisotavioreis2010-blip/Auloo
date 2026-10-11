// ==============================================
// CONFIG.JS - detectSessionInUrl ON (OAuth + recovery funcionam)
// ==============================================

var SUPABASE_CONFIG = {
    url: 'https://qswvoxkhicficbdkcpzn.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzd3ZveGtoaWNmaWNiZGtjcHpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNjAyNzMsImV4cCI6MjEwMzkzNjI3M30.KmzjytD0K7AxpY0n3teAUftWXzqitRLMyefsPq5F0KA'
};

var supabaseClient = null;

function inicializarSupabase() {
    try {
        if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
            supabaseClient = window.supabase.createClient(
                SUPABASE_CONFIG.url,
                SUPABASE_CONFIG.anonKey,
                {
                    auth: {
                        persistSession: true,
                        autoRefreshToken: true,
                        detectSessionInUrl: true,
                        flowType: 'pkce'
                    }
                }
            );

            window.supabaseClient = supabaseClient;

            console.log('Supabase inicializado (detectSessionInUrl ON)');
            return true;
        }

        console.error('Biblioteca Supabase nao carregada');
        return false;
    } catch (error) {
        console.error('Erro ao inicializar Supabase:', error);
        return false;
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializarSupabase);
} else {
    inicializarSupabase();
}

window.SUPABASE_CONFIG = SUPABASE_CONFIG;

console.log('Config.js carregado!');