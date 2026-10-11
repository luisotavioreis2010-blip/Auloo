# Auloo

Plataforma educacional com autenticacao via Supabase.

## Tecnologias

- HTML5 + CSS3 (vanilla)
- JavaScript (ES2020)
- Supabase (auth + database + storage)
- Deno Edge Functions
- Lottie para animacoes

## Estrutura

Auloo/
  index.html              # Landing + login
  dashboard.html          # Area autenticada
  assets/
    css/                  # Estilos
    js/
      config.js           # Config Supabase
      auth.js             # Funcoes de autenticacao
      pages/              # Scripts por pagina
    img/                  # Imagens
  supabase/
    functions/
      check-email/        # Edge Function

## Setup

1. Clone o repositorio
2. Copie .env.example para .env
3. Rode um servidor local:
   python -m http.server 8000
4. Acesse http://localhost:8000

## Seguranca

- RLS ativado em todas as tabelas Supabase
- Sanitizacao de HTML em toda entrada de usuario
- CSP configurada nos HTMLs
- Chaves em .env (nao commitadas)

## Licenca

MIT
