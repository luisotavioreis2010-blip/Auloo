/* ============================================================
   AUTH.JS — v3
   Helpers de autenticação (sem duplicação)
   ============================================================ */
(function () {
    'use strict';

    var MIN_SENHA = 8;

    function validateEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
    }

    function validarSenhaForte(senha) {
        senha = String(senha || '');
        if (senha.length < MIN_SENHA)              return { valida: false, mensagem: 'Pelo menos ' + MIN_SENHA + ' caracteres!' };
        if (!/[A-Z]/.test(senha))                  return { valida: false, mensagem: 'Falta letra maiúscula!' };
        if (!/[a-z]/.test(senha))                  return { valida: false, mensagem: 'Falta letra minúscula!' };
        if (!/[0-9]/.test(senha))                  return { valida: false, mensagem: 'Falta um número!' };
        if (!/[!@#$%^&*(),.?":{}|<>]/.test(senha)) return { valida: false, mensagem: 'Falta um símbolo!' };
        return { valida: true, mensagem: 'Senha forte!' };
    }

    function sanitizar(texto) {
        if (!texto) return '';
        var d = document.createElement('div');
        d.textContent = texto;
        return d.innerHTML;
    }

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

    function getDb() {
        return window.getSupabaseClientSeguro ? window.getSupabaseClientSeguro()
                                              : window.getSupabaseClient();
    }

    async function checkEmailExists(email) {
        var c = getDb();
        if (!c) return { exists: false, provider: null, hasPassword: false };
        try {
            var r = await c.functions.invoke('check-email', {
                body: { email: String(email).trim().toLowerCase() }
            });
            if (r.error) return { exists: false, provider: null, hasPassword: false };
            return {
                exists: !!r.data.exists,
                provider: r.data.provider || null,
                providers: r.data.providers || [],
                hasPassword: !!r.data.hasPassword
            };
        } catch (e) { return { exists: false, provider: null, hasPassword: false }; }
    }

    async function sendSignupCode(email) {
        var c = getDb();
        if (!c) return { success: false, message: 'Erro de configuração.' };
        try {
            var r = await c.functions.invoke('send-signup-otp', {
                body: { email: String(email).trim().toLowerCase() }
            });
            if (r.error) return { success: false, message: await extrairMensagemErro(r.error, 'Erro ao enviar código.') };
            if (r.data && r.data.error) return { success: false, message: r.data.error };
            return { success: true };
        } catch (e) { return { success: false, message: 'Erro inesperado.' }; }
    }

    async function verifySignupCode(email, code, password, fullName) {
        var c = getDb();
        if (!c) return { success: false, message: 'Erro de configuração.' };
        try {
            var r = await c.functions.invoke('verify-signup-otp', {
                body: {
                    email: String(email).trim().toLowerCase(),
                    code: String(code),
                    password: password,
                    full_name: fullName || email.split('@')[0]
                }
            });
            if (r.error) return { success: false, message: await extrairMensagemErro(r.error, 'Código inválido.') };
            if (r.data && r.data.error) return { success: false, message: r.data.error };
            return { success: true, user_id: r.data.user_id };
        } catch (e) { return { success: false, message: 'Erro inesperado.' }; }
    }

    async function loginUser(email, password) {
        var c = getDb();
        if (!c) return { success: false, message: 'Erro de configuração.' };
        try {
            var r = await c.auth.signInWithPassword({ email: email, password: password });
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
                saveUserToDatabase(r.data.user);
                return { success: true, user: r.data.user };
            }
            return { success: false, message: 'Erro ao fazer login.' };
        } catch (e) { return { success: false, message: 'Erro inesperado.' }; }
    }

    function saveUserToDatabase(user) {
        var c = getDb();
        if (!c || !user || !user.id) return;
        var meta = user.user_metadata || {};
        var nome = meta.full_name || meta.name || (user.email || '').split('@')[0] || 'Usuário';
        /* Não bloqueia o fluxo — só dispara e esquece */
        c.from('profiles').upsert({
            id: user.id,
            email: user.email,
            full_name: nome,
            avatar_url: meta.avatar_url || meta.picture || null,
            updated_at: new Date().toISOString()
        }, { onConflict: 'id' }).catch(function () { /* ignora */ });
    }

    async function recoverPassword(email) {
        var c = getDb();
        if (!c) return { success: false, message: 'Erro de configuração.' };
        try {
            var r = await c.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + '/login.html'
            });
            if (r.error) throw r.error;
            return { success: true };
        } catch (e) { return { success: false, message: 'Erro ao enviar link.' }; }
    }

    async function updatePassword(nova) {
        var c = getDb();
        if (!c) return { success: false, message: 'Erro de configuração.' };
        try {
            var r = await c.auth.updateUser({ password: nova });
            return r.error ? { success: false, message: r.error.message } : { success: true };
        } catch (e) { return { success: false, message: 'Erro ao atualizar senha.' }; }
    }

    async function verifyCurrentPassword(email, senha) {
        var c = getDb();
        if (!c) return { success: false, message: 'Erro de configuração.' };
        try {
            var r = await c.auth.signInWithPassword({ email: email, password: senha });
            return r.error ? { success: false, message: 'Senha atual incorreta!' } : { success: true };
        } catch (e) { return { success: false, message: 'Erro ao verificar senha.' }; }
    }

    async function logoutUser() {
        var c = getDb();
        try { if (c) await c.auth.signOut(); } catch (e) { /* ignora */ }
        try { localStorage.clear(); } catch (e) { /* ignora */ }
        window.location.replace('/login.html');
    }

    /* Exporta */
    window.auth = {
        validateEmail: validateEmail,
        validarSenhaForte: validarSenhaForte,
        sanitizar: sanitizar,
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

    /* Aliases globais (compatibilidade) */
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
})();