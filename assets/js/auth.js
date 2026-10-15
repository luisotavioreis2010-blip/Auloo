// ==============================================
// AUTH.JS
// ==============================================

function getSupabaseClient() {
    if (!supabaseClient) {
        console.error('Supabase nao inicializado');
        return null;
    }
    return supabaseClient;
}

// ===== VALIDAR EMAIL =====
function validateEmail(email) {
    var regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
}

// ===== VALIDAR SENHA FORTE =====
function validarSenhaForte(senha) {
    if (senha.length < 8) return { valida: false, mensagem: 'Pelo menos 8 caracteres!' };
    if (!/[A-Z]/.test(senha)) return { valida: false, mensagem: 'Falta letra maiuscula!' };
    if (!/[a-z]/.test(senha)) return { valida: false, mensagem: 'Falta letra minuscula!' };
    if (!/[0-9]/.test(senha)) return { valida: false, mensagem: 'Falta um numero!' };
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(senha)) return { valida: false, mensagem: 'Falta um simbolo!' };
    return { valida: true, mensagem: 'Senha forte!' };
}

// ===== HELPER: extrai a mensagem real do erro da Edge Function =====
async function extrairMensagemErro(error, fallback) {
    var msg = fallback || 'Erro inesperado.';
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
    return msg;
}

// ===== VERIFICAR SE EMAIL EXISTE (via Edge Function) =====
async function checkEmailExists(email) {
    var client = getSupabaseClient();
    if (!client) return { exists: false, source: null, provider: null, hasPassword: false };

    try {
        var { data, error } = await client.functions.invoke('check-email', {
            body: { email: email.trim().toLowerCase() }
        });

        if (error) {
            console.error('Erro na Edge Function:', error);
            return { exists: false, source: null, provider: null, hasPassword: false };
        }

        return {
            exists: !!data.exists,
            source: data.source || null,
            provider: data.provider || null,
            providers: data.providers || [],
            hasPassword: !!data.hasPassword
        };
    } catch (error) {
        console.error('Erro ao verificar:', error);
        return { exists: false, source: null, provider: null, hasPassword: false };
    }
}

// ===== ENVIAR CODIGO DE CADASTRO =====
async function sendSignupCode(email) {
    var client = getSupabaseClient();
    if (!client) return { success: false, message: 'Erro de configuracao.' };

    try {
        var { data, error } = await client.functions.invoke('send-signup-otp', {
            body: { email: String(email).trim().toLowerCase() }
        });

        if (error) {
            console.error('Erro na Edge Function:', error);
            var msg = await extrairMensagemErro(error, 'Erro ao enviar codigo.');
            return { success: false, message: msg };
        }

        if (data && data.error) {
            return { success: false, message: data.error };
        }

        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false, message: 'Erro inesperado.' };
    }
}

// ===== VERIFICAR CODIGO E SO ENTAO CRIAR A CONTA =====
async function verifySignupCode(email, code, password, fullName) {
    var client = getSupabaseClient();
    if (!client) return { success: false, message: 'Erro de configuracao.' };

    try {
        var { data, error } = await client.functions.invoke('verify-signup-otp', {
            body: {
                email: String(email).trim().toLowerCase(),
                code: String(code),
                password: password,
                full_name: fullName || email.split('@')[0]
            }
        });

        if (error) {
            console.error('Erro na Edge Function:', error);
            var msg = await extrairMensagemErro(error, 'Codigo invalido.');
            return { success: false, message: msg };
        }

        if (data && data.error) {
            return { success: false, message: data.error };
        }

        return { success: true, user_id: data.user_id };
    } catch (e) {
        console.error(e);
        return { success: false, message: 'Erro inesperado.' };
    }
}

// ===== LOGIN =====
async function loginUser(email, password) {
    var client = getSupabaseClient();
    if (!client) return { success: false, message: 'Erro de configuracao.' };

    try {
        var { data, error } = await client.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            if (error.message.includes('Invalid login credentials')) {
                var check = await checkEmailExists(email);

                if (check.exists && check.provider === 'google' && !check.hasPassword) {
                    return {
                        success: false,
                        message: 'Use o botao "Entrar com Google".'
                    };
                }

                return { success: false, message: 'E-mail ou senha incorretos.' };
            }
            return { success: false, message: error.message };
        }

        if (data.user) {
            await saveUserToDatabase(data.user);
            localStorage.setItem('acervo_user', JSON.stringify(data.user));
            localStorage.setItem('acervo_saved_email', email);
            return { success: true, user: data.user };
        }

        return { success: false, message: 'Erro ao fazer login.' };
    } catch (error) {
        return { success: false, message: 'Erro inesperado.' };
    }
}

// ===== SALVAR USUARIO NO BANCO =====
async function saveUserToDatabase(user) {
    var client = getSupabaseClient();
    if (!client || !user || !user.id) return;

    try {
        var fullName = user.user_metadata?.full_name ||
                        user.user_metadata?.name ||
                        user.email?.split('@')[0] ||
                        'Usuario';

        var userData = {
            id: user.id,
            email: user.email,
            full_name: fullName,
            avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
            updated_at: new Date().toISOString()
        };

        var { error } = await client
            .from('profiles')
            .upsert(userData, { onConflict: 'id' });

        if (error) {
            console.error('Erro ao salvar perfil:', error);
        }
    } catch (error) {
        console.error('Erro ao salvar usuario:', error);
    }
}

// ===== RECUPERAR SENHA =====
async function recoverPassword(email) {
    var client = getSupabaseClient();
    if (!client) return { success: false, message: 'Erro de configuracao.' };

    try {
        var { error } = await client.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/login.html'
        });

        if (error) throw error;
        return { success: true, message: 'Link enviado!' };
    } catch (error) {
        return { success: false, message: 'Erro ao enviar link.' };
    }
}

// ===== ATUALIZAR SENHA =====
async function updatePassword(newPassword) {
    var client = getSupabaseClient();
    if (!client) return { success: false, message: 'Erro de configuracao.' };

    try {
        var { error } = await client.auth.updateUser({ password: newPassword });

        if (error) {
            return { success: false, message: error.message };
        }

        return { success: true, message: 'Senha atualizada!' };
    } catch (error) {
        return { success: false, message: 'Erro ao atualizar senha.' };
    }
}

// ===== VERIFICAR SENHA ATUAL =====
async function verifyCurrentPassword(email, password) {
    var client = getSupabaseClient();
    if (!client) return { success: false, message: 'Erro de configuracao.' };

    try {
        var { error } = await client.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            return { success: false, message: 'Senha atual incorreta!' };
        }

        return { success: true };
    } catch (error) {
        return { success: false, message: 'Erro ao verificar senha.' };
    }
}

// ===== LOGOUT =====
async function logoutUser() {
    var client = getSupabaseClient();
    if (!client) return;

    try {
        await client.auth.signOut();
        localStorage.removeItem('acervo_user');
        localStorage.removeItem('acervo_saved_email');
        window.location.href = '/login.html';
    } catch (error) {
        localStorage.removeItem('acervo_user');
        localStorage.removeItem('acervo_saved_email');
        window.location.href = '/login.html';
    }
}

// ===== SANITIZACAO =====
function sanitizar(texto) {
    if (!texto) return '';
    var div = document.createElement('div');
    div.textContent = texto;
    return div.innerHTML;
}

// ===== UI HELPERS =====
function mostrarLoading(botao) {
    botao.disabled = true;
    botao.innerHTML = '<span class="button-loading"></span>';
}

function restaurarBotao(botao, textoOriginal) {
    botao.disabled = false;
    botao.textContent = textoOriginal;
}

// ===== EXPORTAR =====
window.auth = {
    validateEmail,
    validarSenhaForte,
    sanitizar,
    mostrarLoading,
    restaurarBotao,
    checkEmailExists,
    sendSignupCode,
    verifySignupCode,
    loginUser,
    saveUserToDatabase,
    recoverPassword,
    updatePassword,
    verifyCurrentPassword,
    logoutUser
};

console.log('Auth.js carregado!');