// ==============================================
// CONFIG.JS - Supabase com retry e deteccao OAuth
// ==============================================

var SUPABASE_CONFIG = {
    url: 'https://qswvoxkhicficbdkcpzn.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzd3ZveGtoaWNmaWNiZGtjcHpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNjAyNzMsImV4cCI6MjEwMzkzNjI3M30.KmzjytD0K7AxpY0n3teAUftWXzqitRLMyefsPq5F0KA'
};

var supabaseClient = null;

function inicializarSupabase() {
    try {
        if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
            console.warn('Supabase ainda nao carregou, tentando novamente...');
            setTimeout(inicializarSupabase, 200);
            return false;
        }

        if (supabaseClient) return true;

        supabaseClient = window.supabase.createClient(
            SUPABASE_CONFIG.url,
            SUPABASE_CONFIG.anonKey,
            {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true,
                    flowType: 'pkce',
                    storage: window.localStorage,
                    storageKey: 'auloo-auth'
                }
            }
        );

        window.supabaseClient = supabaseClient;
        console.log('Supabase inicializado');
        return true;
    } catch (error) {
        console.error('Erro ao inicializar Supabase:', error);
        return false;
    }
}

inicializarSupabase();
document.addEventListener('DOMContentLoaded', inicializarSupabase);
window.addEventListener('load', inicializarSupabase);

window.SUPABASE_CONFIG = SUPABASE_CONFIG;
console.log('Config.js carregado!');