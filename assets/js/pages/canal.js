(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    let db = null;
    let usuarioLogado = null;

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

        const { data: { session } } = await db.auth.getSession();
        if (!session) {
            window.location.href = 'login.html';
            return;
        }
        usuarioLogado = session.user;

        await verificarCanal();
        configurarModal();
    }

    async function verificarCanal() {
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
            $('canal-vazio').hidden = false;
            $('canal-conteudo').hidden = true;
            
            $('btn-criar-canal').addEventListener('click', () => {
                $('modal-criar-canal').hidden = false;
            });
        } else {
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

    function configurarModal() {
        const modal = $('modal-criar-canal');
        const btnFechar = $('btn-fechar-modal');
        const form = $('form-criar-canal');

        if (!modal) return;

        btnFechar.addEventListener('click', () => modal.hidden = true);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.hidden = true;
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = $('btn-salvar-canal');
            const nome = $('input-nome-canal').value.trim();
            const handle = $('input-handle-canal').value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            const bio = $('input-bio-canal').value.trim();

            if (!nome || !handle) return alert('Nome e @usuario são obrigatórios.');

            btn.disabled = true;
            btn.textContent = 'Criando...';

            const { data, error } = await db.from('channels').insert([{
                owner_id: usuarioLogado.id,
                name: nome,
                handle: handle,
                description: bio
            }]).select().single();

            if (error) {
                btn.disabled = false;
                btn.textContent = 'Criar Canal';
                alert('Erro: O @usuario já pode estar em uso ou houve um erro no servidor.');
                console.error(error);
            } else {
                modal.hidden = true;
                $('canal-vazio').hidden = true;
                $('canal-conteudo').hidden = false;
                renderizarCanal(data);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();