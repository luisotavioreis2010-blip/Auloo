// ==============================================
// EDGE FUNCTION: verify-signup-otp
// Verifica o código e só então cria a conta.
// ==============================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: any, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

async function sha256(text: string) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0')).join('');
}

const MAX_TENTATIVAS = 5;

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const { email, code, password, full_name } = await req.json();

        if (!email || !code || !password) {
            return json({ error: 'Dados incompletos.' }, 400);
        }

        const normalized = String(email).trim().toLowerCase();
        const codigo = String(code).trim();

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        );

        /* 1. Busca o código pendente */
        const { data: pending, error: errBusca } = await supabase
            .from('signup_pending')
            .select('code_hash, expires_at, attempts')
            .eq('email', normalized)
            .maybeSingle();

        if (errBusca || !pending) {
            return json({ error: 'Código não encontrado. Solicite outro.' }, 400);
        }

        /* 2. Verifica expiração */
        if (new Date(pending.expires_at).getTime() < Date.now()) {
            await supabase.from('signup_pending').delete().eq('email', normalized);
            return json({ error: 'Código expirado. Solicite outro.' }, 400);
        }

        /* 3. Verifica tentativas */
        if ((pending.attempts || 0) >= MAX_TENTATIVAS) {
            await supabase.from('signup_pending').delete().eq('email', normalized);
            return json({ error: 'Muitas tentativas. Solicite outro código.' }, 429);
        }

        /* 4. Compara hashes */
        const hash = await sha256(codigo);
        if (hash !== pending.code_hash) {
            await supabase.from('signup_pending')
                .update({ attempts: (pending.attempts || 0) + 1 })
                .eq('email', normalized);
            return json({ error: 'Código inválido.' }, 400);
        }

        /* 5. Cria o usuário */
        const { data: criado, error: errCriar } = await supabase.auth.admin.createUser({
            email: normalized,
            password: password,
            email_confirm: true,
            user_metadata: { full_name: full_name || normalized.split('@')[0] },
        });

        if (errCriar) {
            return json({ error: errCriar.message || 'Erro ao criar conta.' }, 400);
        }

        /* 6. Limpa o pendente */
        await supabase.from('signup_pending').delete().eq('email', normalized);

        /* 7. Garante o profile */
        await supabase.from('profiles').upsert({
            id: criado.user.id,
            email: normalized,
            full_name: full_name || normalized.split('@')[0],
            updated_at: new Date().toISOString(),
        });

        return json({ success: true, user_id: criado.user.id });
    } catch (e) {
        console.error(e);
        return json({ error: String(e) }, 500);
    }
});