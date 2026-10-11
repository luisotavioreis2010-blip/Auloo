import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function sha256(text: string) {
  const data = new TextEncoder().encode(text)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map((b: number) => b.toString(16).padStart(2, '0')).join('')
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { email, code, password, full_name } = await req.json()
    if (!email || !code || !password) return json({ error: 'Dados incompletos.' }, 400)

    const normalized = String(email).trim().toLowerCase()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: pending } = await supabase
      .from('signup_pending')
      .select('*')
      .eq('email', normalized)
      .maybeSingle()

    if (!pending) return json({ error: 'Codigo invalido ou expirado.' }, 400)

    if (new Date(pending.expires_at) < new Date()) {
      await supabase.from('signup_pending').delete().eq('email', normalized)
      return json({ error: 'Codigo expirado.' }, 400)
    }

    if (pending.attempts >= 5) {
      await supabase.from('signup_pending').delete().eq('email', normalized)
      return json({ error: 'Muitas tentativas. Peca outro codigo.' }, 429)
    }

    const codeHash = await sha256(String(code))
    if (codeHash !== pending.code_hash) {
      await supabase
        .from('signup_pending')
        .update({ attempts: pending.attempts + 1 })
        .eq('email', normalized)
      return json({ error: 'Codigo invalido.' }, 400)
    }

    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: normalized,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name || normalized.split('@')[0] },
    })

    if (createErr) return json({ error: createErr.message }, 400)

    await supabase.from('profiles').upsert({
      id: created.user.id,
      email: normalized,
      full_name: full_name || normalized.split('@')[0],
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })

    await supabase.from('signup_pending').delete().eq('email', normalized)

    return json({ success: true, user_id: created.user.id })
  } catch (e) {
    console.error(e)
    return json({ error: String(e) }, 500)
  }
})
