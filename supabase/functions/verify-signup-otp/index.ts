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

// Procura um usuário do Auth pelo e-mail (o admin API não filtra por e-mail).
async function acharUsuario(supabase: any, email: string) {
  const porPagina = 200
  for (let pagina = 1; pagina <= 10; pagina++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page: pagina, perPage: porPagina })
    if (error || !data) return null
    const achado = data.users.find((u: any) => (u.email || '').toLowerCase() === email)
    if (achado) return achado
    if (data.users.length < porPagina) return null
  }
  return null
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { email, code, password, full_name, check_only } = await req.json()
    if (!email || !code || (!password && !check_only)) return json({ error: 'Dados incompletos.' }, 400)

    const normalized = String(email).trim().toLowerCase()
    const nome = full_name || normalized.split('@')[0]

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

    // Só conferência (passo do código): nada é criado nem apagado; o código
    // continua válido para o passo final, que traz a senha.
    if (check_only) return json({ success: true, checked: true })

    // Código correto. Se sobrou um usuário NÃO confirmado de tentativas antigas
    // (status "Waiting for verification"), aproveita-o em vez de falhar com
    // "already registered". Usuário já confirmado = e-mail realmente em uso.
    let userId: string | null = null
    const existente = await acharUsuario(supabase, normalized)

    if (existente) {
      if (existente.email_confirmed_at) {
        await supabase.from('signup_pending').delete().eq('email', normalized)
        return json({ error: 'Este email ja esta cadastrado.' }, 400)
      }

      const { data: atualizado, error: updErr } = await supabase.auth.admin.updateUserById(existente.id, {
        password,
        email_confirm: true,
        user_metadata: { full_name: nome },
      })
      if (updErr) return json({ error: updErr.message }, 400)
      userId = atualizado.user.id
    } else {
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email: normalized,
        password,
        email_confirm: true,
        user_metadata: { full_name: nome },
      })
      if (createErr) return json({ error: createErr.message }, 400)
      userId = created.user.id
    }

    await supabase.from('profiles').upsert({
      id: userId,
      email: normalized,
      full_name: nome,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })

    await supabase.from('signup_pending').delete().eq('email', normalized)

    return json({ success: true, user_id: userId })
  } catch (e) {
    console.error(e)
    return json({ error: String(e) }, 500)
  }
})