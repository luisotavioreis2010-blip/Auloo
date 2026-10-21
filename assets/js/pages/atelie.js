(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    let db = null;
    let usuarioLogado = null;
    let atelieAtual = null;
    let fileAvatar = null;
    let fileCapa = null;

    let posX = 50, posY = 50;
    let zoom = 1;
    let isDragging = false;
    let startX, startY;
    let bgImageTemp = null;
    let pinchInicial = 0;

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
        configurarCriacao();
        configurarGavetaConfig();
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

    function iniciais(nome) {
        const p = String(nome || '?').trim().split(/\s+/);
        const a = (p[0] || '?').charAt(0).toUpperCase();
        const b = p.length > 1 ? (p[p.length - 1] || '').charAt(0).toUpperCase() : '';
        return a + b;
    }

    function renderizarAtelie(atelie) {
        $('atelie-nome').textContent = atelie.name;
        $('atelie-handle').textContent = '@' + atelie.handle;
        $('atelie-bio').textContent = atelie.description || 'Nenhuma descrição adicionada.';

        const avatarContainer = $('atelie-avatar');
        const fotoDoPerfil = document.querySelector('#perfil-usuario img.foto-perfil');
        const urlAvatar = atelie.avatar_url || (fotoDoPerfil ? fotoDoPerfil.src : null);

        /* FIX: sem innerHTML — usa DOM */
        avatarContainer.textContent = '';
        if (urlAvatar) {
            const img = document.createElement('img');
            img.src = urlAvatar;
            img.alt = 'Avatar do ateliê';
            img.referrerPolicy = 'no-referrer';
            img.onerror = function () {
                img.remove();
                const span = document.createElement('span');
                span.className = 'avatar-iniciais';
                span.textContent = iniciais(atelie.name);
                avatarContainer.appendChild(span);
            };
            avatarContainer.appendChild(img);
        } else {
            const span = document.createElement('span');
            span.className = 'avatar-iniciais';
            span.textContent = iniciais(atelie.name);
            avatarContainer.appendChild(span);
        }

        if (atelie.cover_url) {
            const capaImg = $('atelie-capa-img');
            capaImg.src = atelie.cover_url;

            const cPos = atelie.cover_position || '50% 50%';
            const cZoom = atelie.cover_zoom || 1;

            capaImg.style.objectPosition = cPos;
            capaImg.style.transform = `scale(${cZoom})`;

            posX = parseFloat(cPos.split(' ')[0]) || 50;
            posY = parseFloat(cPos.split(' ')[1]) || 50;
            zoom = parseFloat(cZoom);
            bgImageTemp = atelie.cover_url;
        }

        $('input-config-nome').value = atelie.name;
        $('input-config-bio').value = atelie.description || '';
    }

    function configurarCriacao() {
        const modalCriar = $('modal-criar-atelie');
        if (!modalCriar) return;

        $('btn-fechar-modal').addEventListener('click', () => modalCriar.hidden = true);
        modalCriar.addEventListener('click', (e) => { if (e.target === modalCriar) modalCriar.hidden = true; });

        $('form-criar-atelie').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = $('btn-salvar-atelie');
            const nome = $('input-nome-atelie').value.trim();
            const bio = $('input-bio-atelie').value.trim();

            if (!nome) return alert('O Nome do Ateliê é obrigatório.');

            btn.disabled = true;
            btn.textContent = 'Abrindo...';

            try {
                const { data: handleGerado, error: errHandle } = await db.rpc('gerar_handle_unico');
                if (errHandle) throw errHandle;

                const { data, error } = await db.from('ateliers').insert([{
                    owner_id: usuarioLogado.id,
                    name: nome,
                    handle: handleGerado,
                    description: bio,
                    cover_position: '50% 50%',
                    cover_zoom: 1
                }]).select().single();

                if (error) throw error;

                modalCriar.hidden = true;
                $('atelie-vazio').hidden = true;
                $('atelie-conteudo').hidden = false;
                atelieAtual = data;
                renderizarAtelie(data);

            } catch (err) {
                console.error(err);
                /* FIX: mensagem mais específica se for conflito de handle */
                const msg = (err && err.code === '23505')
                    ? 'Já existe um ateliê com esse nome. Tente outro.'
                    : 'Erro ao abrir o Ateliê. Tente novamente.';
                alert(msg);
                btn.disabled = false;
                btn.textContent = 'Abrir Ateliê';
            }
        });
    }

    function configurarGavetaConfig() {
        const gaveta = $('gaveta-config');
        const overlay = $('overlay-config');
        const container = $('capa-preview-container');
        const arrastavel = $('capa-preview-arrastavel');
        const inputCapa = $('input-config-capa');
        const btnUploadCapa = $('btn-upload-capa');

        function abrirGaveta() {
            gaveta.classList.add('ativa');
            overlay.classList.add('ativa');

            if (atelieAtual.cover_url) {
                arrastavel.style.backgroundImage = `url('${atelieAtual.cover_url}')`;
                container.style.display = 'block';
            } else {
                container.style.display = 'none';
            }
            atualizarTransformacao();
        }

        function fecharGaveta() {
            gaveta.classList.remove('ativa');
            overlay.classList.remove('ativa');
        }

        $('btn-configurar-atelie').addEventListener('click', abrirGaveta);
        $('btn-fechar-config').addEventListener('click', fecharGaveta);
        overlay.addEventListener('click', fecharGaveta);

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
                posX = 50; posY = 50; zoom = 1;
                atualizarTransformacao();
            };
            reader.readAsDataURL(file);
            inputCapa.value = '';
        });

        const btnUploadAvatar = $('btn-upload-avatar');
        const inputAvatar = $('input-config-avatar');
        btnUploadAvatar.addEventListener('click', () => inputAvatar.click());
        inputAvatar.addEventListener('change', () => {
            const f = inputAvatar.files[0];
            /* FIX: se cancelar, reseta fileAvatar */
            if (!f) {
                fileAvatar = null;
                btnUploadAvatar.textContent = 'Escolher Imagem de Perfil';
                return;
            }
            fileAvatar = f;
            btnUploadAvatar.textContent = 'Avatar Selecionado ✓';
        });

        function atualizarTransformacao() {
            arrastavel.style.backgroundPosition = `${posX}% ${posY}%`;
            arrastavel.style.transform = `scale(${zoom})`;
        }

        /* FIX: unifica mouse + toque com pointer events */
        container.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'touch' && e.isPrimary === false) return;
            if (e.touches && e.touches.length === 2) return;

            isDragging = true;
            container.setPointerCapture(e.pointerId);
            startX = e.clientX - (posX * container.offsetWidth / 100);
            startY = e.clientY - (posY * container.offsetHeight / 100);
        });

        container.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            if (e.pointerType === 'touch' && e.touches && e.touches.length === 2) return;
            e.preventDefault();
            posX = Math.max(0, Math.min(100, (e.clientX - startX) / container.offsetWidth * 100));
            posY = Math.max(0, Math.min(100, (e.clientY - startY) / container.offsetHeight * 100));
            atualizarTransformacao();
        });

        container.addEventListener('pointerup', () => { isDragging = false; });
        container.addEventListener('pointercancel', () => { isDragging = false; });

        /* Pinch to zoom (dois dedos) */
        container.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                isDragging = false;
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                pinchInicial = Math.hypot(dx, dy);
            }
        }, { passive: true });

        container.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2 && pinchInicial > 0) {
                e.preventDefault();
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.hypot(dx, dy);
                const fator = dist / pinchInicial;
                pinchInicial = dist;
                zoom = Math.max(1, Math.min(3, zoom * fator));
                atualizarTransformacao();
            }
        }, { passive: false });

        container.addEventListener('touchend', () => { pinchInicial = 0; });

        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY < 0) zoom += 0.1; else zoom -= 0.1;
            zoom = Math.max(1, Math.min(3, zoom));
            atualizarTransformacao();
        }, { passive: false });

        $('form-config-atelie').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = $('btn-salvar-config');
            btn.disabled = true;
            btn.textContent = 'Salvando...';

            const nome = $('input-config-nome').value.trim();
            const bio = $('input-config-bio').value.trim();

            let newAvatarUrl = atelieAtual.avatar_url;
            let newCoverUrl = atelieAtual.cover_url;

            try {
                if (fileAvatar) {
                    const path = usuarioLogado.id + '/atelie-avatar-' + Date.now() + '.jpg';
                    const up = await db.storage.from('avatars').upload(path, fileAvatar);
                    if (up.error) throw up.error;
                    newAvatarUrl = db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
                }

                if (fileCapa) {
                    const path = usuarioLogado.id + '/atelie-capa-' + Date.now() + '.jpg';
                    const up = await db.storage.from('avatars').upload(path, fileCapa);
                    if (up.error) throw up.error;
                    newCoverUrl = db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
                }

                const cPos = `${posX.toFixed(0)}% ${posY.toFixed(0)}%`;

                const { data, error } = await db.from('ateliers').update({
                    name: nome,
                    description: bio,
                    avatar_url: newAvatarUrl,
                    cover_url: newCoverUrl,
                    cover_position: cPos,
                    cover_zoom: zoom
                }).eq('id', atelieAtual.id).select().single();

                if (error) throw error;

                atelieAtual = data;
                renderizarAtelie(data);

                /* FIX: reseta os arquivos após salvar */
                fileAvatar = null;
                fileCapa = null;
                btnUploadAvatar.textContent = 'Escolher Imagem de Perfil';

                fecharGaveta();

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