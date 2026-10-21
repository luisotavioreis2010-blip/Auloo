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
        if (!session) return window.location.href = 'login.html';
        
        usuarioLogado = session.user;
        await verificarAtelie();
        configurarModal();
    }

    async function verificarAtelie() {
        const { data: atelie, error } = await db
            .from('ateliers')
            .select('*')
            .eq('owner_id', usuarioLogado.id)
            .maybeSingle();

        if (error) return console.error('Erro ao buscar ateliê:', error);

        if (!atelie) {
            $('atelie-vazio').hidden = false;
            $('atelie-conteudo').hidden = true;
            $('btn-criar-atelie').addEventListener('click', () => $('modal-criar-atelie').hidden = false);
        } else {
            $('atelie-vazio').hidden = true;
            $('atelie-conteudo').hidden = false;
            renderizarAtelie(atelie);
        }
    }

    function renderizarAtelie(atelie) {
        $('atelie-nome').textContent = atelie.name;
        $('atelie-handle').textContent = '@' + atelie.handle;
        $('atelie-bio').textContent = atelie.description || 'Nenhuma descrição adicionada.';

        if (atelie.avatar_url) $('atelie-avatar').style.backgroundImage = `url('${atelie.avatar_url}')`;
        if (atelie.cover_url) $('atelie-capa').style.backgroundImage = `url('${atelie.cover_url}')`;

        $('btn-configurar-atelie').addEventListener('click', () => {
            alert('A tela de configurações do Ateliê (trocar capa, bio, etc) será aberta aqui.');
        });
    }

    function configurarModal() {
        const modal = $('modal-criar-atelie');
        const btnFechar = $('btn-fechar-modal');
        const form = $('form-criar-atelie');

        if (!modal) return;

        btnFechar.addEventListener('click', () => modal.hidden = true);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = $('btn-salvar-atelie');
            const nome = $('input-nome-atelie').value.trim();
            const handle = $('input-handle-atelie').value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            const bio = $('input-bio-atelie').value.trim();

            if (!nome || !handle) return alert('Nome e @usuario são obrigatórios.');

            btn.disabled = true;
            btn.textContent = 'Abrindo...';

            const { data, error } = await db.from('ateliers').insert([{
                owner_id: usuarioLogado.id,
                name: nome,
                handle: handle,
                description: bio
            }]).select().single();

            if (error) {
                btn.disabled = false;
                btn.textContent = 'Abrir Ateliê';
                alert('Erro: O @usuario já pode estar em uso ou houve um erro no servidor.');
                console.error(error);
            } else {
                modal.hidden = true;
                $('atelie-vazio').hidden = true;
                $('atelie-conteudo').hidden = false;
                renderizarAtelie(data);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();