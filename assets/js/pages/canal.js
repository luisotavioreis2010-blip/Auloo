/* ==============================================
   CANAL.JS — Lógica da Página do Canal
   ============================================== */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    let db = null;
    let usuarioLogado = null;

    // Aguarda o Supabase carregar (evita erro de null)
    async function aguardarSupabase() {
        for (let i = 0; i < 30; i++) {
            if (window.supabaseClient) return window.supabaseClient;
            await new Promise(r => setTimeout(r, 200));
        }
        return null;
    }

    async function iniciar() {
        db = await aguardarSupabase();
        if (!db) return console.error('Supabase não carregado.');

        // O layout.js já faz a checagem de sessão, mas garantimos aqui também
        const { data: { session } } = await db.auth.getSession();
        if (!session) {
            window.location.href = 'login.html';
            return;
        }
        usuarioLogado = session.user;

        await verificarCanal();
    }

    async function verificarCanal() {
        // Busca se o usuário logado tem um canal no banco
        const { data: canal, error } = await db
            .from('channels')
            .select('*')
            .eq('owner_id', usuarioLogado.id)
            .maybeSingle();

        if (error) {
            console.error('Erro ao buscar canal:', error);
            return;
        }

        if (!canal) {
            // Não tem canal: mostra a tela de criação
            $('canal-vazio').hidden = false;
            $('canal-conteudo').hidden = true;
            
            // O botão que vai abrir o formulário de criação
            $('btn-criar-canal').addEventListener('click', () => {
                // No próximo passo, vamos criar um modal aqui
                alert('Aqui vai abrir o formulário para criar o canal!');
            });
        } else {
            // Tem canal: mostra a estante dele
            $('canal-vazio').hidden = true;
            $('canal-conteudo').hidden = false;
            renderizarCanal(canal);
        }
    }

    function renderizarCanal(canal) {
        $('canal-nome').textContent = canal.name;
        $('canal-handle').textContent = '@' + canal.handle;
        $('canal-bio').textContent = canal.description || 'Nenhuma descrição adicionada.';

        if (canal.avatar_url) {
            $('canal-avatar').style.backgroundImage = `url('${canal.avatar_url}')`;
        } else {
            $('canal-avatar').style.background = 'var(--vinho)';
        }

        if (canal.cover_url) {
            $('canal-capa').style.backgroundImage = `url('${canal.cover_url}')`;
        }

        $('btn-editar-canal').addEventListener('click', () => {
            alert('O formulário de edição será aberto aqui.');
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();