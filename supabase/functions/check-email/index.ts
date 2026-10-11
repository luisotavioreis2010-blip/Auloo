// ==============================================
// EDGE FUNCTION: check-email (v2 - imports confiáveis)
// ==============================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
    // Preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        console.log('URL presente:', !!supabaseUrl);
        console.log('Service role presente:', !!serviceRoleKey);

        if (!supabaseUrl || !serviceRoleKey) {
            return new Response(
                JSON.stringify({ exists: false, error: 'Variáveis de ambiente ausentes' }),
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
                JSON.stringify({ exists: false, error: 'Email inválido' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const emailNormalizado = email.trim().toLowerCase();
        console.log('Consultando email:', emailNormalizado);

        const { data, error } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('email', emailNormalizado)
            .maybeSingle();

        if (error) {
            console.error('Erro ao consultar profiles:', JSON.stringify(error));
            return new Response(
                JSON.stringify({ exists: false, error: error.message }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        console.log('Resultado:', data ? 'existe' : 'não existe');

        return new Response(
            JSON.stringify({ exists: !!data }),
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