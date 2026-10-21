(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    let db = null;
    let usuarioLogado = null;
    let atelieAtual = null;
    let fileAvatar = null;
    let fileCapa = null;

    // Variáveis de controle do Editor de Capa
    let posX = 50, posY = 50; // Posição em %
    let zoom = 1; // Escala
    let isDragging = false;
    let startX, startY;
    let bgImageTemp = null; // Imagem em Base64 para preview antes de salvar

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
        configurarEditorDeCapa();
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

        // Avatar
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

        // Capa (Carrega com a Posição e Zoom salvos no banco)
        if (atelie.cover_url) {
            const capaImg = $('atelie-capa-img');
            capaImg.src = atelie.cover_url;
            // Pega a posição e zoom do banco, ou usa o padrão
            const cPos = atelie.cover_position || 'center center';
            const cZoom = atelie.cover_zoom || 1;
            
            capaImg.style.objectPosition = cPos;
            capaImg.style.transform = `scale(${cZoom})`;
            
            // Preenche as variáveis para o editor
            posX = parseFloat(cPos.split(' ')[0]) || 50;
            posY = parseFloat(cPos.split(' ')[1]) || 50;
            zoom = parseFloat(cZoom);
            bgImageTemp = atelie.cover_url;
        }

        // Preenche o Modal
        $('input-config-nome').value = atelie.name;
        $('input-config-handle').value = atelie.handle;
        $('input-config-bio').value = atelie.description || '';
    }

    // --- O EDITOR DE CAPA (Arrastar e Zoom) ---
    function configurarEditorDeCapa() {
        const container = $('capa-preview-container');
        const arrastavel = $('capa-preview-arrastavel');
        const inputCapa = $('input-config-capa');
        const btnUploadCapa = $('btn-upload-capa');

        // Abre o seletor de arquivos
        btnUploadCapa.addEventListener('click', () => inputCapa.click());

        // Carrega a imagem nova em base64 para o preview
        inputCapa.addEventListener('change', () => {
            const file = inputCapa.files[0];
            if (!file) return;
            fileCapa = file;

            const reader = new FileReader();
            reader.onload = (e) => {
                bgImageTemp = e.target.result;
                arrastavel.style.backgroundImage = `url('${bgImageTemp}')`;
                container.style.display = 'block';
                atualizarTransformacao();
            };
            reader.readAsDataURL(file);
            inputCapa.value = '';
        });

        // Função para aplicar o zoom e a posição
        function atualizarTransformacao() {
            arrastavel.style.backgroundPosition = `${posX}% ${posY}%`;
            arrastavel.style.transform = `scale(${zoom})`;
        }

        // Lógica de arrastar (Mouse)
        container.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX - (posX * container.offsetWidth / 100);
            startY = e.clientY - (posY * container.offsetHeight / 100);
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            const novoX = (e.clientX - startX) / container.offsetWidth * 100;
            const novoY = (e.clientY - startY) / container.offsetHeight * 100;
            posX = Math.max(0, Math.min(100, novoX));
            posY = Math.max(0, Math.min(100, novoY));
            atualizarTransformacao();
        });

        window.addEventListener('mouseup', () => { isDragging = false; });

        // Lógica de arrastar (Touch - Celular)
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
            const novoX = (touch.clientX - startX) / container.offsetWidth * 100;
            const novoY = (touch.clientY - startY) / container.offsetHeight * 100;
            posX = Math.max(0, Math.min(100, novoX));
            posY = Math.max(0, Math.min(100, novoY));
            atualizarTransformacao();
        }, { passive: false });

        container.addEventListener('touchend', () => { isDragging = false; });

        // Lógica de Zoom (Roda do Mouse)
        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY < 0) zoom += 0.1;
            else zoom -= 0.1;
            zoom = Math.max(1, Math.min(3, zoom)); // Limita o zoom entre 1x e 3x
            atualizarTransformacao();
        }, { passive: false });

        // Lógica de Zoom (Pinça no celular)
        let initialDistance = 0;
        container.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                initialDistance = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                );
            }
        }, { passive: true });

        container.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const distance = Math.hypot(
                    e.touches[0].pageX - e.touches[1].pageX,
                    e.touches[0].pageY - e.touches[1].pageY
                );
                if (initialDistance > 0) {
                    const factor = distance / initialDistance;
                    zoom = Math.max(1, Math.min(3, zoom * factor));
                    atualizarTransformacao();
                    initialDistance = distance;
                }
            }
        }, { passive: false });

        container.addEventListener('touchend', () => { initialDistance = 0; });
        
        // --- CONFIGURAÇÃO DO MODAL DE SALVAR ---
        const modalConfig = $('modal-config-atelie');
        $('btn-configurar-atelie').addEventListener('click', () => {
            modalConfig.hidden = false;
            if (atelieAtual.cover_url) {
                arrastavel.style.backgroundImage = `url('${atelieAtual.cover_url}')`;
                container.style.display = 'block';
            }
            atualizarTransformacao();
        });

        $('btn-fechar-config').addEventListener('click', () => modalConfig.hidden = true);
        modalConfig.addEventListener('click', (e) => { if (e.target === modalConfig) modalConfig.hidden = true; });

        // --- SALVAR CONFIGURAÇÕES ---
        const form = $('form-config-atelie');
        form.addEventListener('submit', async (e) => {
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

                // Salva as posições da capa
                const cPos = `${posX.toFixed(0)}% ${posY.toFixed(0)}%`;

                const { data, error } = await db.from('ateliers').update({
                    name: nome,
                    handle: handle,
                    description: bio,
                    avatar_url: newAvatarUrl,
                    cover_url: newCoverUrl,
                    cover_position: cPos, // Salva no banco
                    cover_zoom: zoom      // Salva no banco
                }).eq('id', atelieAtual.id).select().single();

                if (error) throw error;

                atelieAtual = data;
                renderizarAtelie(data);
                modalConfig.hidden = true;
                btn.textContent = 'Salvar Alterações';
                
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