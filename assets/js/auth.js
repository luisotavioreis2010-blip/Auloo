// ==============================================
// AUTH.JS - Completo (check-email via Edge Function)
// ==============================================

function getSupabaseClient() {
    if (!supabaseClient) {
        console.error('Supabase não inicializado');
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
    if (!/[A-Z]/.test(senha)) return { valida: false, mensagem: 'Falta letra maiúscula!' };
    if (!/[a-z]/.test(senha)) return { valida: false, mensagem: 'Falta letra minúscula!' };
    if (!/[0-9]/.test(senha)) return { valida: false, mensagem: 'Falta um número!' };
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(senha)) return { valida: false, mensagem: 'Falta um símbolo!' };
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
    if (!client) return { exists: false };

    try {
        console.log('Verificando email:', email);

        var { data, error } = await client.functions.invoke('check-email', {
            body: { email: email.trim().toLowerCase() }
        });

        if (error) {
            console.error('Erro na Edge Function:', error);
            return { exists: false };
        }

        console.log(data.exists ? 'Email EXISTE' : 'Email NÃO existe');
        return { exists: !!data.exists };

    } catch (error) {
        console.error('Erro ao verificar:', error);
        return { exists: false };
    }
}

// ===== ENVIAR CÓDIGO DE CADASTRO (não cria usuário ainda) =====
async function sendSignupCode(email) {
    var client = getSupabaseClient();
    if (!client) return { success: false, message: 'Erro de configuração.' };

    try {
        console.log('Enviando código de cadastro para:', email);

        var { data, error } = await client.functions.invoke('send-signup-otp', {
            body: { email: String(email).trim().toLowerCase() }
        });

        if (error) {
            console.error('Erro na Edge Function:', error);
            var msg = await extrairMensagemErro(error, 'Erro ao enviar código.');
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

// ===== VERIFICAR CÓDIGO E SÓ ENTÃO CRIAR A CONTA =====
async function verifySignupCode(email, code, password, fullName) {
    var client = getSupabaseClient();
    if (!client) return { success: false, message: 'Erro de configuração.' };

    try {
        console.log('Verificando código de cadastro...');

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
            var msg = await extrairMensagemErro(error, 'Código inválido.');
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

// ===== ENVIAR CÓDIGO DE VERIFICAÇÃO (mantido p/ compatibilidade) =====
async function sendVerificationCode(email) {
    var client = getSupabaseClient();
    if (!client) return { success: false, message: 'Erro de configuração.' };

    try {
        console.log('Enviando código para:', email);

        var { error } = await client.auth.signInWithOtp({
            email: email,
            options: {
                shouldCreateUser: true,
                emailRedirectTo: window.location.origin + '/dashboard.html'
            }
        });

        if (error) {
            console.error('Erro ao enviar código:', error);
            return { success: false, message: error.message || 'Erro ao enviar código.' };
        }

        return { success: true, message: 'Código enviado com sucesso!' };
    } catch (error) {
        console.error('Erro inesperado:', error);
        return { success: false, message: 'Erro inesperado. Tente novamente.' };
    }
}

// ===== VERIFICAR CÓDIGO (compatibilidade) =====
async function verifyCodeWithSupabase(email, code) {
    var client = getSupabaseClient();
    if (!client) return { success: false, message: 'Erro de configuração.' };

    try {
        console.log('Verificando código:', code);

        var { data, error } = await client.auth.verifyOtp({
            email: email,
            token: code,
            type: 'email'
        });

        if (error) {
            console.error('Erro na verificação:', error);
            return { success: false, message: 'Código inválido ou expirado.' };
        }

        if (data.user) {
            await saveUserToDatabase(data.user);
            localStorage.setItem('auloo_user', JSON.stringify(data.user));
            localStorage.setItem('auloo_saved_email', email);
            return { success: true, user: data.user };
        }

        return { success: false, message: 'Erro ao verificar código.' };
    } catch (error) {
        console.error('Erro na verificação:', error);
        return { success: false, message: 'Erro ao verificar código.' };
    }
}

// ===== VERIFICAR CÓDIGO E JÁ DEFINIR SENHA =====
async function verifyCodeAndSetPassword(email, code, password) {
    var client = getSupabaseClient();
    if (!client) return { success: false, message: 'Erro de configuração.' };

    try {
        console.log('Verificando código e definindo senha...');

        var { data, error } = await client.auth.verifyOtp({
            email: email,
            token: code,
            type: 'email'
        });

        if (error) {
            console.error('Erro na verificação:', error);
            return { success: false, message: 'Código inválido ou expirado.' };
        }

        if (!data.user) {
            return { success: false, message: 'Erro ao verificar código.' };
        }

        if (password) {
            var { error: pwdError } = await client.auth.updateUser({ password: password });

            if (pwdError) {
                console.error('Erro ao definir senha:', pwdError);
                return {
                    success: true,
                    user: data.user,
                    warning: 'Conta criada, mas senha não foi definida. Use "Forgot Password".'
                };
            }
        }

        await saveUserToDatabase(data.user);

        localStorage.setItem('auloo_user', JSON.stringify(data.user));
        localStorage.setItem('auloo_saved_email', email);

        return { success: true, user: data.user };

    } catch (error) {
        console.error('Erro na verificação:', error);
        return { success: false, message: 'Erro ao verificar código.' };
    }
}

// ===== LOGIN =====
async function loginUser(email, password) {
    var client = getSupabaseClient();
    if (!client) return { success: false, message: 'Erro de configuração.' };

    try {
        var { data, error } = await client.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            if (error.message.includes('Invalid login credentials')) {
                return { success: false, message: 'E-mail ou senha incorretos.' };
            }
            return { success: false, message: error.message };
        }

        if (data.user) {
            await saveUserToDatabase(data.user);
            localStorage.setItem('auloo_user', JSON.stringify(data.user));
            localStorage.setItem('auloo_saved_email', email);
            return { success: true, user: data.user };
        }

        return { success: false, message: 'Erro ao fazer login.' };
    } catch (error) {
        return { success: false, message: 'Erro inesperado.' };
    }
}

// ===== CRIAR USUÁRIO =====
async function createUserWithPassword(email, password, name) {
    var client = getSupabaseClient();
    if (!client) return { success: false, message: 'Erro de configuração.' };

    try {
        var { data, error } = await client.auth.signUp({
            email: email,
            password: password,
            options: {
                data: { full_name: name || email.split('@')[0] },
                emailRedirectTo: window.location.origin + '/dashboard.html'
            }
        });

        if (error) {
            if (error.message.includes('already registered')) {
                return { success: false, message: 'Este e-mail já está cadastrado.' };
            }
            return { success: false, message: error.message };
        }

        if (data.user) {
            await saveUserToDatabase(data.user);
            if (data.session) {
                localStorage.setItem('auloo_user', JSON.stringify(data.user));
                localStorage.setItem('auloo_saved_email', email);
            }
            return { success: true, user: data.user, session: data.session };
        }

        return { success: false, message: 'Erro ao criar conta.' };
    } catch (error) {
        return { success: false, message: 'Erro inesperado.' };
    }
}

// ===== SALVAR USUÁRIO NO BANCO =====
async function saveUserToDatabase(user) {
    var client = getSupabaseClient();
    if (!client || !user || !user.id) return;

    try {
        var fullName = user.user_metadata?.full_name ||
                        user.user_metadata?.name ||
                        user.email?.split('@')[0] ||
                        'Usuário';

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
        console.error('Erro ao salvar usuário:', error);
    }
}

// ===== RECUPERAR SENHA =====
async function recoverPassword(email) {
    var client = getSupabaseClient();
    if (!client) return { success: false, message: 'Erro de configuração.' };

    try {
        var { error } = await client.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/index.html'
        });

        if (error) throw error;
        return { success: true, message: 'Link de recuperação enviado!' };
    } catch (error) {
        return { success: false, message: 'Erro ao enviar link.' };
    }
}

// ===== ATUALIZAR SENHA =====
async function updatePassword(newPassword) {
    var client = getSupabaseClient();
    if (!client) return { success: false, message: 'Erro de configuração.' };

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
    if (!client) return { success: false, message: 'Erro de configuração.' };

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
        localStorage.removeItem('auloo_user');
        localStorage.removeItem('auloo_saved_email');
        window.location.href = 'index.html';
    } catch (error) {
        localStorage.removeItem('auloo_user');
        localStorage.removeItem('auloo_saved_email');
        window.location.href = 'index.html';
    }
}

// ===== SANITIZAÇÃO =====
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
    sendVerificationCode,
    sendSignupCode,
    verifyCodeWithSupabase,
    verifySignupCode,
    verifyCodeAndSetPassword,
    loginUser,
    createUserWithPassword,
    saveUserToDatabase,
    recoverPassword,
    updatePassword,
    verifyCurrentPassword,
    logoutUser
};

console.log('✅ Auth.js carregado!');