// ==============================================
// EDGE FUNCTION: check-email (v4)
// Retorna: { exists, source, provider, hasPassword }
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

        /* 1. Procura o usuario no Auth */
        const { data: usersData, error: usersError } = await supabaseAdmin.auth.admin.listUsers({
            page: 1,
            perPage: 200,
        });

        if (usersError) {
            console.error('Erro ao listar users:', usersError);
            return new Response(
                JSON.stringify({ exists: false, error: usersError.message }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const usuario = usersData && usersData.users
            ? usersData.users.find((u) => (u.email || '').toLowerCase() === emailNormalizado)
            : null;

        if (usuario) {
            /* Descobre os providers do usuario */
            const providers = (usuario.identities || []).map((i) => i.provider);
            const temSenha = providers.includes('email');
            const temGoogle = providers.includes('google');

            let providerPrincipal = null;
            if (temSenha) providerPrincipal = 'email';
            else if (temGoogle) providerPrincipal = 'google';

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

        /* 2. Se nao achou no Auth, checa na tabela profiles */
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('email', emailNormalizado)
            .maybeSingle();

        if (profile) {
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

    } catch (err) {
        console.error('Erro inesperado:', err.message || String(err));
        return new Response(
            JSON.stringify({ exists: false, error: err.message || 'Erro inesperado' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});