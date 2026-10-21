(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    let db = null;
    let usuarioLogado = null;
    let atelieAtual = null;
    let fileAvatar = null;
    let fileCapa = null;

    // Variáveis do Editor de Capa
    let posX = 50, posY = 50;
    let zoom = 1;
    let isDragging = false;
    let startX, startY;
    let bgImageTemp = null;

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
        configurarCriacao();      // Inicia o modal de criação (caso não tenha ateliê)
        configurarEditorDeCapa(); // Inicia o editor de configuração (arrastar e zoom)
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

        // --- AVATAR ---
        const avatarContainer = $('atelie-avatar');
        const fotoDoPerfil = document.querySelector('#perfil-usuario img.foto-perfil');
        const urlAvatar = atelie.avatar_url || (fotoDoPerfil ? fotoDoPerfil.src : null);

        avatarContainer.textContent = '';
        if (urlAvatar) {
            const img = document.createElement('img');
            img.src = urlAvatar;
            avatarContainer.appendChild(img);
        } else {
            avatarContainer.innerHTML = `<span class="avatar-iniciais">${atelie.name.substring(0, 2).toUpperCase()}</span>`;
        }

        // --- CAPA (Carrega com posição e zoom) ---
        if (atelie.cover_url) {
            const capaImg = $('atelie-capa-img');
            capaImg.src = atelie.cover_url;
            
            const cPos = atelie.cover_position || '50% 50%';
            const cZoom = atelie.cover_zoom || 1;
            
            capaImg.style.objectPosition = cPos;
            capaImg.style.transform = `scale(${cZoom})`;
            
            // Salva nas variáveis globais para o editor
            posX = parseFloat(cPos.split(' ')[0]) || 50;
            posY = parseFloat(cPos.split(' ')[1]) || 50;
            zoom = parseFloat(cZoom);
            bgImageTemp = atelie.cover_url;
        }

        // Preenche o Modal de Configuração
        $('input-config-nome').value = atelie.name;
        $('input-config-handle').value = atelie.handle;
        $('input-config-bio').value = atelie.description || '';
    }

    // --- MODAL DE CRIAÇÃO DE ATELIÊ ---
    function configurarCriacao() {
        const modalCriar = $('modal-criar-atelie');
        if (!modalCriar) return;

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
                description: bio,
                cover_position: '50% 50%',
                cover_zoom: 1
            }]).select().single();

            if (error) {
                btn.disabled = false;
                btn.textContent = 'Abrir Ateliê';
                alert('Erro: O @usuario já pode estar em uso ou houve um erro no servidor.');
                console.error(error);
            } else {
                modalCriar.hidden = true;
                $('atelie-vazio').hidden = true;
                $('atelie-conteudo').hidden = false;
                atelieAtual = data;
                renderizarAtelie(data);
            }
        });
    }

    // --- MODAL DE CONFIGURAÇÃO (Editar Capa, Zoom, etc) ---
    function configurarEditorDeCapa() {
        const modalConfig = $('modal-config-atelie');
        const container = $('capa-preview-container');
        const arrastavel = $('capa-preview-arrastavel');
        const inputCapa = $('input-config-capa');
        const btnUploadCapa = $('btn-upload-capa');

        if (!modalConfig) return;

        // Abre o modal de configuração
        $('btn-configurar-atelie').addEventListener('click', () => {
            modalConfig.hidden = false;
            if (atelieAtual.cover_url) {
                arrastavel.style.backgroundImage = `url('${atelieAtual.cover_url}')`;
                container.style.display = 'block';
            } else {
                container.style.display = 'none';
            }
            atualizarTransformacao();
        });

        $('btn-fechar-config').addEventListener('click', () => modalConfig.hidden = true);
        modalConfig.addEventListener('click', (e) => { if (e.target === modalConfig) modalConfig.hidden = true; });

        // Upload da capa
        btnUploadCapa.addEventListener('click', () => inputCapa.click());
        inputCapa.addEventListener('change', () => {
            const file = inputCapa.files[0];
            if (!file) return;
            fileCapa = file;

            const reader = new FileReader();
            reader.onload = (e) => {
                bgImageTemp = e.target.result;
                arrastavel.style.backgroundImage = `url('${bgImageTemp}')`;
                container.style.display = 'block';
                posX = 50; posY = 50; zoom = 1; // Reseta o zoom ao subir uma nova imagem
                atualizarTransformacao();
            };
            reader.readAsDataURL(file);
            inputCapa.value = '';
        });

        // Upload do avatar
        const btnUploadAvatar = $('btn-upload-avatar');
        const inputAvatar = $('input-config-avatar');
        btnUploadAvatar.addEventListener('click', () => inputAvatar.click());
        inputAvatar.addEventListener('change', () => {
            fileAvatar = inputAvatar.files[0];
            if (fileAvatar) btnUploadAvatar.textContent = 'Avatar Selecionado ✓';
        });

        function atualizarTransformacao() {
            arrastavel.style.backgroundPosition = `${posX}% ${posY}%`;
            arrastavel.style.transform = `scale(${zoom})`;
        }

        // Mouse (Arrastar)
        container.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX - (posX * container.offsetWidth / 100);
            startY = e.clientY - (posY * container.offsetHeight / 100);
        });
        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            posX = Math.max(0, Math.min(100, (e.clientX - startX) / container.offsetWidth * 100));
            posY = Math.max(0, Math.min(100, (e.clientY - startY) / container.offsetHeight * 100));
            atualizarTransformacao();
        });
        window.addEventListener('mouseup', () => { isDragging = false; });

        // Zoom (Roda do Mouse)
        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY < 0) zoom += 0.1; else zoom -= 0.1;
            zoom = Math.max(1, Math.min(3, zoom));
            atualizarTransformacao();
        }, { passive: false });

        // Touch (Arrastar no celular)
        container.addEventListener('touchstart', (e) => {
            isDragging = true;
            const touch = e.touches[0];
            startX = touch.clientX - (posX * container.offsetWidth / 100);
            startY = touch.clientY - (posY * container.offsetHeight / 100);
        }, { passive: true });

        container.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            const touch = e.touches[0];
            posX = Math.max(0, Math.min(100, (touch.clientX - startX) / container.offsetWidth * 100));
            posY = Math.max(0, Math.min(100, (touch.clientY - startY) / container.offsetHeight * 100));
            atualizarTransformacao();
        }, { passive: false });
        container.addEventListener('touchend', () => { isDragging = false; });

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

                const cPos = `${posX.toFixed(0)}% ${posY.toFixed(0)}%`;

                const { data, error } = await db.from('ateliers').update({
                    name: nome,
                    handle: handle,
                    description: bio,
                    avatar_url: newAvatarUrl,
                    cover_url: newCoverUrl,
                    cover_position: cPos,
                    cover_zoom: zoom
                }).eq('id', atelieAtual.id).select().single();

                if (error) throw error;

                atelieAtual = data;
                renderizarAtelie(data);
                modalConfig.hidden = true;
                btn.textContent = 'Salvar Alterações';
                btn.disabled = false;
                
            } catch (err) {
                console.error(err);
                alert('Erro ao salvar as configurações.');
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