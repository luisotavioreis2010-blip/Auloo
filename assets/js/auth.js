/* ============================================================
   AUTH.JS — v2
   Helpers de autenticação. Sem duplicação, sem `?.`.
   Depende de: config.js (getSupabaseClientSeguro / aguardarSupabase)
   ============================================================ */
(function () {
    'use strict';

    var MIN_SENHA = 8;

    /* ---------- Validações ---------- */

    function validateEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
    }

    function validarSenhaForte(senha) {
        senha = String(senha || '');
        if (senha.length < MIN_SENHA)        return { valida: false, mensagem: 'Pelo menos ' + MIN_SENHA + ' caracteres!' };
        if (!/[A-Z]/.test(senha))            return { valida: false, mensagem: 'Falta letra maiúscula!' };
        if (!/[a-z]/.test(senha))            return { valida: false, mensagem: 'Falta letra minúscula!' };
        if (!/[0-9]/.test(senha))            return { valida: false, mensagem: 'Falta um número!' };
        if (!/[!@#$%^&*(),.?":{}|<>]/.test(senha))
                                             return { valida: false, mensagem: 'Falta um símbolo!' };
        return { valida: true, mensagem: 'Senha forte!' };
    }

    function sanitizar(texto) {
        if (!texto) return '';
        var div = document.createElement('div');
        div.textContent = texto;
        return div.innerHTML;
    }

    /* ---------- Erros de Edge Function ---------- */

    async function extrairMensagemErro(error, fallback) {
        try {
            if (error && error.context && typeof error.context.json === 'function') {
                var body = await error.context.json();
                if (body && body.error) return body.error;
            }
            if (error && error.message &&
                error.message !== 'Edge Function returned a non-2xx status code') {
                return error.message;
            }
        } catch (e) { /* ignora */ }
        return fallback || 'Erro inesperado.';
    }

    /* ---------- Chamadas ao Supabase ---------- */

    function clientOuNull() {
        return window.getSupabaseClientSeguro ? window.getSupabaseClientSeguro()
                                              : window.getSupabaseClient();
    }

    async function checkEmailExists(email) {
        var client = clientOuNull();
        if (!client) return { exists: false, provider: null, hasPassword: false };

        try {
            var r = await client.functions.invoke('check-email', {
                body: { email: String(email).trim().toLowerCase() }
            });
            if (r.error) return { exists: false, provider: null, hasPassword: false };
            return {
                exists: !!r.data.exists,
                provider: r.data.provider || null,
                providers: r.data.providers || [],
                hasPassword: !!r.data.hasPassword
            };
        } catch (e) {
            return { exists: false, provider: null, hasPassword: false };
        }
    }

    async function sendSignupCode(email) {
        var client = clientOuNull();
        if (!client) return { success: false, message: 'Erro de configuração.' };

        try {
            var r = await client.functions.invoke('send-signup-otp', {
                body: { email: String(email).trim().toLowerCase() }
            });
            if (r.error) {
                return { success: false, message: await extrairMensagemErro(r.error, 'Erro ao enviar código.') };
            }
            if (r.data && r.data.error) return { success: false, message: r.data.error };
            return { success: true };
        } catch (e) {
            return { success: false, message: 'Erro inesperado.' };
        }
    }

    async function verifySignupCode(email, code, password, fullName) {
        var client = clientOuNull();
        if (!client) return { success: false, message: 'Erro de configuração.' };

        try {
            var r = await client.functions.invoke('verify-signup-otp', {
                body: {
                    email: String(email).trim().toLowerCase(),
                    code: String(code),
                    password: password,
                    full_name: fullName || email.split('@')[0]
                }
            });
            if (r.error) {
                return { success: false, message: await extrairMensagemErro(r.error, 'Código inválido.') };
            }
            if (r.data && r.data.error) return { success: false, message: r.data.error };
            return { success: true, user_id: r.data.user_id };
        } catch (e) {
            return { success: false, message: 'Erro inesperado.' };
        }
    }

    async function loginUser(email, password) {
        var client = clientOuNull();
        if (!client) return { success: false, message: 'Erro de configuração.' };

        try {
            var r = await client.auth.signInWithPassword({ email: email, password: password });
            if (r.error) {
                if (String(r.error.message).indexOf('Invalid login credentials') !== -1) {
                    var check = await checkEmailExists(email);
                    if (check.exists && check.provider === 'google' && !check.hasPassword) {
                        return { success: false, message: 'Use o botão "Entrar com Google".' };
                    }
                    return { success: false, message: 'E-mail ou senha incorretos.' };
                }
                return { success: false, message: r.error.message };
            }
            if (r.data && r.data.user) {
                await saveUserToDatabase(r.data.user);
                return { success: true, user: r.data.user };
            }
            return { success: false, message: 'Erro ao fazer login.' };
        } catch (e) {
            return { success: false, message: 'Erro inesperado.' };
        }
    }

    async function saveUserToDatabase(user) {
        var client = clientOuNull();
        if (!client || !user || !user.id) return;
        try {
            var meta = user.user_metadata || {};
            var nome = meta.full_name || meta.name || (user.email || '').split('@')[0] || 'Usuário';
            await client.from('profiles').upsert({
                id: user.id,
                email: user.email,
                full_name: nome,
                avatar_url: meta.avatar_url || meta.picture || null,
                updated_at: new Date().toISOString()
            }, { onConflict: 'id' });
        } catch (e) {
            console.warn('saveUserToDatabase:', e);
        }
    }

    async function recoverPassword(email) {
        var client = clientOuNull();
        if (!client) return { success: false, message: 'Erro de configuração.' };
        try {
            var r = await client.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + '/login.html'
            });
            if (r.error) throw r.error;
            return { success: true };
        } catch (e) {
            return { success: false, message: 'Erro ao enviar link.' };
        }
    }

    async function updatePassword(novaSenha) {
        var client = clientOuNull();
        if (!client) return { success: false, message: 'Erro de configuração.' };
        try {
            var r = await client.auth.updateUser({ password: novaSenha });
            if (r.error) return { success: false, message: r.error.message };
            return { success: true };
        } catch (e) {
            return { success: false, message: 'Erro ao atualizar senha.' };
        }
    }

    async function verifyCurrentPassword(email, senha) {
        var client = clientOuNull();
        if (!client) return { success: false, message: 'Erro de configuração.' };
        try {
            var r = await client.auth.signInWithPassword({ email: email, password: senha });
            return r.error ? { success: false, message: 'Senha atual incorreta!' } : { success: true };
        } catch (e) {
            return { success: false, message: 'Erro ao verificar senha.' };
        }
    }

    async function logoutUser() {
        var client = clientOuNull();
        try { if (client) await client.auth.signOut(); } catch (e) { /* ignora */ }
        try {
            localStorage.removeItem('acervo_user');
            localStorage.removeItem('acervo_saved_email');
        } catch (e) { /* ignora */ }
        window.location.replace('/login.html');
    }

    /* ---------- Helpers de UI ---------- */

    function mostrarLoading(botao) {
        if (!botao) return;
        botao.disabled = true;
        botao.dataset.textoOriginal = botao.textContent;
        botao.textContent = '';
        var span = document.createElement('span');
        span.className = 'button-loading';
        botao.appendChild(span);
    }

    function restaurarBotao(botao) {
        if (!botao) return;
        botao.disabled = false;
        if (botao.dataset.textoOriginal) {
            botao.textContent = botao.dataset.textoOriginal;
            delete botao.dataset.textoOriginal;
        }
    }

    /* ---------- API pública ---------- */

    window.auth = {
        validateEmail: validateEmail,
        validarSenhaForte: validarSenhaForte,
        sanitizar: sanitizar,
        mostrarLoading: mostrarLoading,
        restaurarBotao: restaurarBotao,
        checkEmailExists: checkEmailExists,
        sendSignupCode: sendSignupCode,
        verifySignupCode: verifySignupCode,
        loginUser: loginUser,
        saveUserToDatabase: saveUserToDatabase,
        recoverPassword: recoverPassword,
        updatePassword: updatePassword,
        verifyCurrentPassword: verifyCurrentPassword,
        logoutUser: logoutUser
    };

    /* Aliases globais (compatibilidade com código antigo) */
    window.validateEmail         = validateEmail;
    window.validarSenhaForte     = validarSenhaForte;
    window.checkEmailExists      = checkEmailExists;
    window.sendSignupCode        = sendSignupCode;
    window.verifySignupCode      = verifySignupCode;
    window.loginUser             = loginUser;
    window.recoverPassword       = recoverPassword;
    window.updatePassword        = updatePassword;
    window.verifyCurrentPassword = verifyCurrentPassword;
    window.logoutUser            = logoutUser;

    console.log('[auth] pronto');
})();