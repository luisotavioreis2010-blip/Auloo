(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    let db = null;
    let usuarioLogado = null;
    let atelieAtual = null;
    let fileAvatar = null;
    let fileCapa = null;

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
        configurarModais();
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
            atelieAtual = atelie;
            renderizarAtelie(atelie);
        }
    }

    function renderizarAtelie(atelie) {
        $('atelie-nome').textContent = atelie.name;
        $('atelie-handle').textContent = '@' + atelie.handle;
        $('atelie-bio').textContent = atelie.description || 'Nenhuma descrição adicionada.';

        const avatarContainer = $('atelie-avatar');
        const fotoDoPerfil = document.querySelector('#perfil-usuario img.foto-perfil');
        const urlAvatar = atelie.avatar_url || (fotoDoPerfil ? fotoDoPerfil.src : null);

        avatarContainer.style.backgroundImage = 'none';
        avatarContainer.textContent = '';

        if (urlAvatar) {
            const img = document.createElement('img');
            img.src = urlAvatar;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '50%';
            avatarContainer.appendChild(img);
        } else {
            const iniciais = atelie.name.substring(0, 2).toUpperCase();
            avatarContainer.innerHTML = `<span class="avatar-iniciais" style="font-size:2rem;">${iniciais}</span>`;
        }

        if (atelie.cover_url) {
            $('atelie-capa').style.backgroundImage = `url('${atelie.cover_url}')`;
        }

        // Preenche os campos do modal de configuração
        $('input-config-nome').value = atelie.name;
        $('input-config-handle').value = atelie.handle;
        $('input-config-bio').value = atelie.description || '';
    }

    function configurarModais() {
        // --- CRIAÇÃO ---
        const modalCriar = $('modal-criar-atelie');
        $('btn-fechar-modal').addEventListener('click', () => modalCriar.hidden = true);
        modalCriar.addEventListener('click', (e) => { if (e.target === modalCriar) modalCriar.hidden = true; });

        $('form-criar-atelie').addEventListener('submit', async (e) => {
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
                alert('Erro: O @usuario já pode estar em uso.');
            } else {
                modalCriar.hidden = true;
                $('atelie-vazio').hidden = true;
                $('atelie-conteudo').hidden = false;
                atelieAtual = data;
                renderizarAtelie(data);
            }
        });

        // --- CONFIGURAÇÃO ---
        const modalConfig = $('modal-config-atelie');
        $('btn-configurar-atelie').addEventListener('click', () => modalConfig.hidden = false);
        $('btn-fechar-config').addEventListener('click', () => modalConfig.hidden = true);
        modalConfig.addEventListener('click', (e) => { if (e.target === modalConfig) modalConfig.hidden = true; });

        // Upload de imagens no Modal de Configuração
        const inputAvatar = $('input-config-avatar');
        const inputCapa = $('input-config-capa');

        $('btn-upload-avatar').addEventListener('click', () => inputAvatar.click());
        $('btn-upload-capa').addEventListener('click', () => inputCapa.click());

        inputAvatar.addEventListener('change', () => {
            fileAvatar = inputAvatar.files[0];
            if (fileAvatar) $('btn-upload-avatar').textContent = 'Avatar Selecionado ✓';
        });

        inputCapa.addEventListener('change', () => {
            fileCapa = inputCapa.files[0];
            if (fileCapa) $('btn-upload-capa').textContent = 'Capa Selecionada ✓';
        });

        // Salvar Configurações
        $('form-config-atelie').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = $('btn-salvar-config');
            btn.disabled = true;
            btn.textContent = 'Salvando...';

            const nome = $('input-config-nome').value.trim();
            const handle = $('input-config-handle').value.trim().toLowerCase().replace(/\s+/g, '-');
            const bio = $('input-config-bio').value.trim();

            let newAvatarUrl = atelieAtual.avatar_url;
            let newCoverUrl = atelieAtual.cover_url;

            try {
                if (fileAvatar) {
                    const path = usuarioLogado.id + '/atelie-avatar-' + Date.now() + '.jpg';
                    await db.storage.from('avatars').upload(path, fileAvatar);
                    newAvatarUrl = db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
                }

                if (fileCapa) {
                    const path = usuarioLogado.id + '/atelie-capa-' + Date.now() + '.jpg';
                    await db.storage.from('avatars').upload(path, fileCapa);
                    newCoverUrl = db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
                }

                const { data, error } = await db.from('ateliers').update({
                    name: nome,
                    handle: handle,
                    description: bio,
                    avatar_url: newAvatarUrl,
                    cover_url: newCoverUrl
                }).eq('id', atelieAtual.id).select().single();

                if (error) throw error;

                atelieAtual = data;
                renderizarAtelie(data);
                modalConfig.hidden = true;
                $('btn-upload-avatar').textContent = 'Escolher Imagem de Perfil';
                $('btn-upload-capa').textContent = 'Escolher Imagem de Capa';
                
            } catch (err) {
                console.error(err);
                alert('Erro ao salvar as configurações.');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Salvar Alterações';
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();