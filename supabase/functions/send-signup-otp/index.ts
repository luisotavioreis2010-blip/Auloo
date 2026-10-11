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

function montarHtml(codigo: string, email: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirme seu e-mail — Auloo</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0; padding:0; background:#E5D9C0; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#E5D9C0; padding:56px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:460px; background:#F5EDDD; border:1px solid #C9B896; border-radius:2px;">
          <tr>
            <td style="padding:48px 44px 48px 44px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px;">
                <tr>
                  <td align="center">
                    <div style="font-family:'Playfair Display',Georgia,'Times New Roman',Times,serif; font-size:28px; font-weight:600; font-style:italic; color:#4A0E0E; letter-spacing:0.5px; line-height:1;">
                      Auloo<span style="color:#B8894A; font-style:normal;">.</span>
                    </div>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:36px;">
                <tr>
                  <td align="center">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td valign="middle" style="width:48px;"><div style="height:1px; background:rgba(184,137,74,0.6);"></div></td>
                        <td valign="middle" style="padding:0 14px;"><div style="font-size:11px; color:#B8894A; line-height:1;">✦</div></td>
                        <td valign="middle" style="width:48px;"><div style="height:1px; background:rgba(184,137,74,0.6);"></div></td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
                <tr>
                  <td align="center">
                    <h1 style="margin:0; font-family:'Playfair Display',Georgia,'Times New Roman',Times,serif; font-size:26px; font-weight:500; font-style:italic; color:#4A0E0E; letter-spacing:-0.2px; line-height:1.3;">
                      Confirme seu e-mail
                    </h1>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:36px;">
                <tr>
                  <td align="center">
                    <p style="margin:0; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:14px; font-weight:400; color:#5C5445; line-height:1.65;">
                      Use o código abaixo para confirmar<br>
                      <span style="color:#4A0E0E; font-weight:600;">${email}</span>
                    </p>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:36px;">
                <tr>
                  <td align="center">
                    <div style="font-family:'Playfair Display',Georgia,'Times New Roman',Times,serif; font-size:34px; font-weight:500; font-style:italic; color:#4A0E0E; letter-spacing:10px; text-indent:10px; line-height:1; font-variant-numeric:tabular-nums; font-feature-settings:'tnum' 1;">
                      ${codigo}
                    </div>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
                <tr>
                  <td align="center">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td valign="middle" style="width:48px;"><div style="height:1px; background:rgba(184,137,74,0.6);"></div></td>
                        <td valign="middle" style="padding:0 14px;"><div style="font-size:11px; color:#B8894A; line-height:1;">✦</div></td>
                        <td valign="middle" style="width:48px;"><div style="height:1px; background:rgba(184,137,74,0.6);"></div></td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
                <tr>
                  <td align="center">
                    <p style="margin:0; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; font-size:12px; font-weight:400; color:#7A6E5A; line-height:1.65;">
                      O código expira em alguns minutos.
                    </p>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center">
                    <p style="margin:0; font-family:'Playfair Display',Georgia,'Times New Roman',Times,serif; font-size:11px; font-style:italic; color:#B0A79A; letter-spacing:0.5px;">
                      © Auloo
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { email } = await req.json()
    if (!email) return json({ error: 'Email obrigatorio.' }, 400)

    const normalized = String(email).trim().toLowerCase()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', normalized)
      .maybeSingle()

    if (profile) return json({ error: 'Este email ja esta cadastrado.' }, 400)

    const { data: existing } = await supabase
      .from('signup_pending')
      .select('created_at')
      .eq('email', normalized)
      .maybeSingle()

    if (existing && new Date(existing.created_at).getTime() > Date.now() - 60000) {
      return json({ error: 'Aguarde antes de pedir outro codigo.' }, 429)
    }

    const code = String(Math.floor(100000 + Math.random() * 900000))
    const codeHash = await sha256(code)

    await supabase.from('signup_pending').upsert({
      email: normalized,
      code_hash: codeHash,
      expires_at: new Date(Date.now() + 15 * 60000).toISOString(),
      attempts: 0,
      created_at: new Date().toISOString(),
    })

    const RESEND = Deno.env.get('RESEND_API_KEY')
    const FROM   = Deno.env.get('EMAIL_FROM') ?? 'onboarding@resend.dev'

    if (!RESEND) {
      console.log('CODIGO GERADO (dev):', code)
      return json({ success: true, dev: true })
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: normalized,
        subject: 'Confirme seu e-mail — Auloo',
        html: montarHtml(code, normalized),
      }),
    })

    if (!res.ok) {
      console.error('Resend error:', await res.text())
      return json({ error: 'Falha ao enviar email.' }, 500)
    }

    return json({ success: true })
  } catch (e) {
    console.error(e)
    return json({ error: String(e) }, 500)
  }
})