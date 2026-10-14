/* ============================================================
   AUTH.JS
   ------------------------------------------------------------
   Camada de autenticação (Supabase + Edge Functions).

   Estrutura:
     1. Constantes
     2. Helpers puros (sem DOM, sem rede)
     3. Storage (localStorage encapsulado)
     4. Acesso ao Supabase
     5. Erros de Edge Function
     6. Verificações de conta
     7. Cadastro (OTP)
     8. Login / Logout
     9. Recuperação / atualização de senha
    10. Exportação (window.Auth)
   ============================================================ */
(function () {
    'use strict';

    /* ============================================================
       1. CONSTANTES
       ============================================================ */
    const STORAGE_KEYS = Object.freeze({
        USER: 'auloo_user',
        EMAIL: 'auloo_saved_email',
    });

    const MENSAGENS = Object.freeze({
        ERRO_CONFIG: 'Erro de configuração.',
        ERRO_INESPERADO: 'Erro inesperado.',
        ERRO_REDE: 'Falha de conexão. Verifique sua internet.',
        CREDENCIAIS: 'E-mail ou senha incorretos.',
        EMAIL_NAO_CONFIRMADO: 'Confirme seu e-mail antes de entrar.',
        USE_GOOGLE: 'Use o botão "Entrar com Google".',
        SENHA_ATUAL_INCORRETA: 'Senha atual incorreta!',
    });

    const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const REGEX_SIMBOLO_SENHA = /[!@#$%^&*(),.?":{}|<>]/;

    /* ============================================================
       2. HELPERS PUROS
       ============================================================ */

    /** Escapa caracteres perigosos sem usar DOM (funciona em worker/test). */
    function sanitizar(valor) {
        if (valor == null) return '';
        return String(valor)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** Normaliza e-mail para comparação/armazenamento. */
    function normalizarEmail(email) {
        return String(email || '').trim().toLowerCase();
    }

    function validateEmail(email) {
        return REGEX_EMAIL.test(String(email || ''));
    }

    function validarSenhaForte(senha) {
        const s = String(senha || '');
        if (s.length < 8)            return { valida: false, mensagem: 'Pelo menos 8 caracteres!' };
        if (!/[A-Z]/.test(s))        return { valida: false, mensagem: 'Falta letra maiúscula!' };
        if (!/[a-z]/.test(s))        return { valida: false, mensagem: 'Falta letra minúscula!' };
        if (!/[0-9]/.test(s))        return { valida: false, mensagem: 'Falta um número!' };
        if (!REGEX_SIMBOLO_SENHA.test(s)) return { valida: false, mensagem: 'Falta um símbolo!' };
        return { valida: true, mensagem: 'Senha forte!' };
    }

    /* ============================================================
       3. STORAGE
       ============================================================ */
    const Storage = {
        salvarUsuario(user) {
            try {
                localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
            } catch (e) {
                console.warn('[auth] Não foi possível salvar usuário:', e);
            }
        },
        salvarEmail(email) {
            try {
                localStorage.setItem(STORAGE_KEYS.EMAIL, email);
            } catch (e) {
                console.warn('[auth] Não foi possível salvar e-mail:', e);
            }
        },
        lerUsuario() {
            try {
                const raw = localStorage.getItem(STORAGE_KEYS.USER);
                return raw ? JSON.parse(raw) : null;
            } catch (e) {
                return null;
            }
        },
        limpar() {
            try {
                localStorage.removeItem(STORAGE_KEYS.USER);
                localStorage.removeItem(STORAGE_KEYS.EMAIL);
            } catch (e) { /* ignora */ }
        },
    };

    /* ============================================================
       4. ACESSO AO SUPABASE
       ============================================================ */
    function getSupabaseClient() {
        const client =
            window.supabaseClient ||
            (typeof supabaseClient !== 'undefined' ? supabaseClient : null);

        if (!client) {
            console.error('[auth] Supabase não inicializado.');
            return null;
        }
        return client;
    }

    /* ============================================================
       5. ERROS DE EDGE FUNCTION
       ============================================================ */

    /**
     * Extrai a mensagem real de um erro retornado por Edge Function.
     * Tenta, em ordem:
     *   1. error.context.json().error
     *   2. error.context.json().message
     *   3. error.message (se não for o genérico "non-2xx")
     *   4. fallback
     */
    async function extrairMensagemErro(error, fallback) {
        const msgFallback = fallback || MENSAGENS.ERRO_INESPERADO;

        if (!error) return msgFallback;

        if (error.context && typeof error.context.json === 'function') {
            try {
                const body = await error.context.json();
                if (body?.error)   return String(body.error);
                if (body?.message) return String(body.message);
            } catch (e) {
                // context não era JSON — segue para próximas tentativas
            }
        }

        if (error.message && error.message !== 'Edge Function returned a non-2xx status code') {
            return error.message;
        }

        return msgFallback;
    }

    /** Envolve chamadas de Edge Function com tratamento uniforme. */
    async function invocarFuncao(nome, body, fallbackErro) {
        const client = getSupabaseClient();
        if (!client) return { success: false, message: MENSAGENS.ERRO_CONFIG };

        try {
            const { data, error } = await client.functions.invoke(nome, { body });

            if (error) {
                console.error(`[auth] ${nome}:`, error);
                const msg = await extrairMensagemErro(error, fallbackErro);
                return { success: false, message: msg };
            }

            if (data?.error) {
                return { success: false, message: data.error };
            }

            return { success: true, data };
        } catch (e) {
            console.error(`[auth] ${nome}:`, e);
            return { success: false, message: MENSAGENS.ERRO_INESPERADO };
        }
    }

    /* ============================================================
       6. VERIFICAÇÕES DE CONTA
       ============================================================ */

    /** Shape consistente mesmo em erro. */
    const CHECK_EMAIL_VAZIO = Object.freeze({
        exists: false,
        source: null,
        provider: null,
        providers: [],
        hasPassword: false,
    });

    async function checkEmailExists(email) {
        const client = getSupabaseClient();
        if (!client) return { ...CHECK_EMAIL_VAZIO };

        try {
            const { data, error } = await client.functions.invoke('check-email', {
                body: { email: normalizarEmail(email) },
            });

            if (error) {
                console.error('[auth] check-email:', error);
                return { ...CHECK_EMAIL_VAZIO };
            }

            return {
                exists:      Boolean(data?.exists),
                source:      data?.source      || null,
                provider:    data?.provider    || null,
                providers:   Array.isArray(data?.providers) ? data.providers : [],
                hasPassword: Boolean(data?.hasPassword),
            };
        } catch (e) {
            console.error('[auth] check-email:', e);
            return { ...CHECK_EMAIL_VAZIO };
        }
    }

    /* ============================================================
       7. CADASTRO (OTP)
       ============================================================ */

    async function sendSignupCode(email) {
        const emailNorm = normalizarEmail(email);
        if (!validateEmail(emailNorm)) {
            return { success: false, message: 'E-mail inválido.' };
        }

        const r = await invocarFuncao(
            'send-signup-otp',
            { email: emailNorm },
            'Erro ao enviar código.'
        );
        return r.success ? { success: true } : r;
    }

    async function verifySignupCode(email, code, password, fullName) {
        const emailNorm = normalizarEmail(email);
        const codigoStr = String(code || '').trim();

        if (!validateEmail(emailNorm)) {
            return { success: false, message: 'E-mail inválido.' };
        }
        if (codigoStr.length !== 6) {
            return { success: false, message: 'Código inválido.' };
        }
        if (!password) {
            return { success: false, message: 'Senha obrigatória.' };
        }

        const r = await invocarFuncao(
            'verify-signup-otp',
            {
                email:     emailNorm,
                code:      codigoStr,
                password,
                full_name: fullName || emailNorm.split('@')[0],
            },
            'Código inválido.'
        );

        if (!r.success) return r;
        return { success: true, user_id: r.data?.user_id };
    }

    /* ============================================================
       8. LOGIN / LOGOUT
       ============================================================ */

    async function loginUser(email, password) {
        const client = getSupabaseClient();
        if (!client) return { success: false, message: MENSAGENS.ERRO_CONFIG };

        const emailNorm = normalizarEmail(email);

        try {
            const { data, error } = await client.auth.signInWithPassword({
                email: emailNorm,
                password,
            });

            if (error) return await tratarErroLogin(error, emailNorm);

            if (!data?.user) {
                return { success: false, message: 'Erro ao fazer login.' };
            }

            // Não bloqueia o login se falhar o upsert do perfil
            saveUserToDatabase(data.user).catch((e) =>
                console.warn('[auth] saveUserToDatabase:', e)
            );

            Storage.salvarUsuario(data.user);
            Storage.salvarEmail(emailNorm);

            return { success: true, user: data.user };
        } catch (e) {
            console.error('[auth] loginUser:', e);
            return { success: false, message: MENSAGENS.ERRO_INESPERADO };
        }
    }

    /** Traduz erros específicos do Supabase Auth em mensagens amigáveis. */
    async function tratarErroLogin(error, email) {
        const msg = String(error?.message || '');

        if (msg.includes('Email not confirmed')) {
            return { success: false, message: MENSAGENS.EMAIL_NAO_CONFIRMADO };
        }

        if (msg.includes('Invalid login credentials')) {
            // Distingue conta Google-only de senha errada
            const check = await checkEmailExists(email);

            if (check.exists && check.provider === 'google' && !check.hasPassword) {
                return { success: false, message: MENSAGENS.USE_GOOGLE };
            }
            return { success: false, message: MENSAGENS.CREDENCIAIS };
        }

        return { success: false, message: error.message || MENSAGENS.ERRO_INESPERADO };
    }

    async function saveUserToDatabase(user) {
        const client = getSupabaseClient();
        if (!client || !user?.id) return;

        const meta = user.user_metadata || {};
        const userData = {
            id:         user.id,
            email:      user.email,
            full_name:  meta.full_name || meta.name || user.email?.split('@')[0] || 'Usuário',
            avatar_url: meta.avatar_url || meta.picture || null,
            updated_at: new Date().toISOString(),
        };

        try {
            const { error } = await client
                .from('profiles')
                .upsert(userData, { onConflict: 'id' });

            if (error) console.error('[auth] upsert profiles:', error);
        } catch (e) {
            console.error('[auth] saveUserToDatabase:', e);
        }
    }

    async function logoutUser() {
        const client = getSupabaseClient();

        try {
            if (client) await client.auth.signOut();
        } catch (e) {
            console.warn('[auth] signOut:', e);
        } finally {
            Storage.limpar();
            window.location.href = 'login.html';
        }
    }

    /* ============================================================
       9. RECUPERAÇÃO / ATUALIZAÇÃO DE SENHA
       ============================================================ */

    async function recoverPassword(email) {
        const client = getSupabaseClient();
        if (!client) return { success: false, message: MENSAGENS.ERRO_CONFIG };

        const emailNorm = normalizarEmail(email);
        if (!validateEmail(emailNorm)) {
            return { success: false, message: 'E-mail inválido.' };
        }

        try {
            const { error } = await client.auth.resetPasswordForEmail(emailNorm, {
                redirectTo: `${window.location.origin}/login.html`,
            });

            if (error) {
                console.error('[auth] resetPasswordForEmail:', error);
                return { success: false, message: error.message || 'Erro ao enviar link.' };
            }

            return { success: true, message: 'Link enviado!' };
        } catch (e) {
            console.error('[auth] recoverPassword:', e);
            return { success: false, message: MENSAGENS.ERRO_REDE };
        }
    }

    async function updatePassword(newPassword) {
        const client = getSupabaseClient();
        if (!client) return { success: false, message: MENSAGENS.ERRO_CONFIG };

        try {
            const { error } = await client.auth.updateUser({ password: newPassword });

            if (error) {
                return { success: false, message: error.message || 'Erro ao atualizar senha.' };
            }
            return { success: true, message: 'Senha atualizada!' };
        } catch (e) {
            console.error('[auth] updatePassword:', e);
            return { success: false, message: MENSAGENS.ERRO_INESPERADO };
        }
    }

    async function verifyCurrentPassword(email, password) {
        const client = getSupabaseClient();
        if (!client) return { success: false, message: MENSAGENS.ERRO_CONFIG };

        try {
            const { error } = await client.auth.signInWithPassword({
                email: normalizarEmail(email),
                password,
            });

            if (error) {
                return { success: false, message: MENSAGENS.SENHA_ATUAL_INCORRETA };
            }
            return { success: true };
        } catch (e) {
            console.error('[auth] verifyCurrentPassword:', e);
            return { success: false, message: MENSAGENS.ERRO_INESPERADO };
        }
    }

    /* ============================================================
       10. EXPORTAÇÃO
       ============================================================ */

    // Exposto como window.Auth E como globais soltas — compatibilidade
    // com login.js atual (que chama `loginUser(...)` direto) e com
    // código futuro (que pode usar `Auth.loginUser(...)`).
    const API = {
        // helpers
        sanitizar,
        normalizarEmail,
        validateEmail,
        validarSenhaForte,
        // storage
        Storage,
        // supabase
        getSupabaseClient,
        // conta
        checkEmailExists,
        saveUserToDatabase,
        // cadastro
        sendSignupCode,
        verifySignupCode,
        // login/logout
        loginUser,
        logoutUser,
        // senha
        recoverPassword,
        updatePassword,
        verifyCurrentPassword,
    };

    window.Auth = API;

    // Compatibilidade com o login.js atual (que usa as funções soltas)
    window.validateEmail         = validateEmail;
    window.validarSenhaForte     = validarSenhaForte;
    window.sanitizar             = sanitizar;
    window.checkEmailExists      = checkEmailExists;
    window.sendSignupCode        = sendSignupCode;
    window.verifySignupCode      = verifySignupCode;
    window.loginUser             = loginUser;
    window.saveUserToDatabase    = saveUserToDatabase;
    window.recoverPassword       = recoverPassword;
    window.updatePassword        = updatePassword;
    window.verifyCurrentPassword = verifyCurrentPassword;
    window.logoutUser            = logoutUser;
})();