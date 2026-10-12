// ==============================================
// EDGE FUNCTION: check-email (v6 - FINAL)
// Usa getUserById para pegar identities
// ==============================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!supabaseUrl || !serviceRoleKey) {
            return new Response(
                JSON.stringify({ exists: false, error: 'Variaveis de ambiente ausentes' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
            auth: { persistSession: false },
        });

        const body = await req.json();
        const { email } = body;

        if (!email || typeof email !== 'string') {
            return new Response(
                JSON.stringify({ exists: false, error: 'Email invalido' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const emailNormalizado = email.trim().toLowerCase();
        console.log('Buscando email:', emailNormalizado);

        /* ==========================================
           1. Achar o ID do usuario via listUsers
           ========================================== */
        let userIdEncontrado: string | null = null;
        let pagina = 1;
        const porPagina = 1000;

        while (pagina <= 10 && !userIdEncontrado) {
            const { data, error } = await supabaseAdmin.auth.admin.listUsers({
                page: pagina,
                perPage: porPagina,
            });

            if (error) {
                console.error('Erro ao listar users (pagina ' + pagina + '):', error);
                break;
            }

            if (!data || !data.users || data.users.length === 0) {
                break;
            }

            const achado = data.users.find(
                (u: any) => (u.email || '').toLowerCase() === emailNormalizado
            );

            if (achado) {
                userIdEncontrado = achado.id;
                break;
            }

            if (data.users.length < porPagina) break;

            pagina++;
        }

        /* ==========================================
           2. Se achou, busca o usuario individualmente
              (para pegar as identities)
           ========================================== */
        if (userIdEncontrado) {
            const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(
                userIdEncontrado
            );

            if (userError || !userData || !userData.user) {
                console.error('Erro ao buscar usuario por ID:', userError);
                /* Fallback: retorna o que temos */
                return new Response(
                    JSON.stringify({
                        exists: true,
                        source: 'auth',
                        provider: null,
                        providers: [],
                        hasPassword: false
                    }),
                    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            const usuario = userData.user;
            const identities = usuario.identities || [];
            const providers = identities.map((i: any) => i.provider);

            const temSenha = providers.includes('email');
            const temGoogle = providers.includes('google');

            let providerPrincipal: string | null = null;
            if (temSenha) providerPrincipal = 'email';
            else if (temGoogle) providerPrincipal = 'google';

            console.log('Encontrado. Providers:', providers, '| Senha:', temSenha);

            return new Response(
                JSON.stringify({
                    exists: true,
                    source: 'auth',
                    provider: providerPrincipal,
                    providers: providers,
                    hasPassword: temSenha
                }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        /* ==========================================
           3. Fallback: checar na tabela profiles
           ========================================== */
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('email', emailNormalizado)
            .maybeSingle();

        if (profile) {
            console.log('Encontrado em profiles');
            return new Response(
                JSON.stringify({
                    exists: true,
                    source: 'profiles',
                    provider: null,
                    providers: [],
                    hasPassword: false
                }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        /* ==========================================
           4. Nao encontrado
           ========================================== */
        console.log('Nao encontrado');
        return new Response(
            JSON.stringify({
                exists: false,
                source: null,
                provider: null,
                providers: [],
                hasPassword: false
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (err: any) {
        console.error('Erro inesperado:', err.message || String(err));
        return new Response(
            JSON.stringify({ exists: false, error: err.message || 'Erro inesperado' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});