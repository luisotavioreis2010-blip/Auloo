(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    let db = null;
    let usuarioLogado = null;
    let atelieAtual = null;
    let fileAvatar = null;
    let fileCapa = null;
    let fileImgEditor = null;
    let arquivoCapaEditor = null;

    let posX = 50, posY = 50;
    let zoom = 1;
    let isDragging = false;
    let startX, startY;
    let bgImageTemp = null;
    let pinchInicial = 0;

    const isDesktop = () => window.matchMedia('(min-width: 1367px)').matches;

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
        configurarAbas();
        configurarEditorEmbutido();
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
            $('atelie-abas').hidden = true;
            $('btn-criar-atelie').addEventListener('click', () => $('modal-criar-atelie').hidden = false);
        } else {
            $('atelie-vazio').hidden = true;
            $('atelie-conteudo').hidden = false;
            $('atelie-abas').hidden = false;
            atelieAtual = atelie;
            renderizarAtelie(atelie);
            if (isDesktop()) preencherPainel(atelie);
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
    }

    function preencherPainel(atelie) {
        $('input-config-nome').value = atelie.name;
        $('input-config-bio').value = atelie.description || '';
        const arrastavel = $('capa-preview-arrastavel');
        const container = $('capa-preview-container');
        if (atelie.cover_url) {
            arrastavel.style.backgroundImage = `url('${atelie.cover_url}')`;
            container.style.display = 'block';
        } else {
            container.style.display = 'none';
        }
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
                    owner_id: usuarioLogado.id, name: nome, handle: handleGerado, description: bio, cover_position: '50% 50%', cover_zoom: 1
                }]).select().single();
                if (error) throw error;
                modalCriar.hidden = true;
                $('atelie-vazio').hidden = true;
                $('atelie-conteudo').hidden = false;
                $('atelie-abas').hidden = false;
                atelieAtual = data;
                renderizarAtelie(data);
                if (isDesktop()) preencherPainel(data);
            } catch (err) {
                console.error(err);
                alert('Erro ao abrir o Ateliê.');
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
            gaveta.classList.add('ativa'); overlay.classList.add('ativa');
            document.body.classList.add('atelie-gaveta-aberta');
            if (atelieAtual.cover_url) {
                arrastavel.style.backgroundImage = `url('${atelieAtual.cover_url}')`;
                container.style.display = 'block';
            } else { container.style.display = 'none'; }
            atualizarTransformacao();
        }

        function fecharGaveta() {
            if (isDesktop()) return; 
            gaveta.classList.remove('ativa'); overlay.classList.remove('ativa');
            document.body.classList.remove('atelie-gaveta-aberta');
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
            if (!f) { fileAvatar = null; btnUploadAvatar.textContent = 'Escolher Imagem de Perfil'; return; }
            fileAvatar = f; btnUploadAvatar.textContent = 'Avatar Selecionado ✓';
        });

        function atualizarTransformacao() {
            arrastavel.style.backgroundPosition = `${posX}% ${posY}%`;
            arrastavel.style.transform = `scale(${zoom})`;
        }

        container.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'touch' && e.isPrimary === false) return;
            if (e.touches && e.touches.length === 2) return;
            isDragging = true; container.setPointerCapture(e.pointerId);
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
            btn.disabled = true; btn.textContent = 'Salvando...';
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
                    name: nome, description: bio, avatar_url: newAvatarUrl, cover_url: newCoverUrl, cover_position: cPos, cover_zoom: zoom
                }).eq('id', atelieAtual.id).select().single();

                if (error) throw error;
                atelieAtual = data; renderizarAtelie(data);
                fileAvatar = null; fileCapa = null; btnUploadAvatar.textContent = 'Escolher Imagem de Perfil';
                fecharGaveta();
                if (isDesktop()) preencherPainel(data);
            } catch (err) {
                console.error(err); alert('Erro ao salvar.');
            } finally {
                btn.disabled = false; btn.textContent = 'Salvar Alterações';
            }
        });
    }

    // ==============================================
    // ABAS E EDITOR
    // ==============================================
    function configurarAbas() {
        const botoes = document.querySelectorAll('.aba-btn');
        const main = $('atelie-main');
        
        botoes.forEach(btn => {
            btn.addEventListener('click', () => {
                botoes.forEach(b => b.classList.remove('ativa'));
                btn.classList.add('ativa');
                
                const alvo = btn.getAttribute('data-aba');
                
                // Limpa classes de estado
                main.classList.remove('modo-redacao');
                $('aba-canal').classList.remove('ativa');
                $('aba-redacao').classList.remove('ativa');

                if (alvo === 'canal') {
                    $('aba-canal').classList.add('ativa');
                } else if (alvo === 'redacao') {
                    main.classList.add('modo-redacao'); // Ativa o layout de tela cheia
                    $('aba-redacao').classList.add('ativa');
                    // Reseta a tela de introdução
                    $('redacao-intro').hidden = false;
                    $('redacao-editor').hidden = true;
                }
            });
        });

        // Botão iniciar escrita
        $('btn-iniciar-escrita').addEventListener('click', () => {
            $('redacao-intro').hidden = true;
            $('redacao-editor').hidden = false;
        });

        // Botão cancelar escrita
        $('btn-cancelar-escrita').addEventListener('click', () => {
            if (confirm('Tem certeza que deseja apagar o que escreveu?')) {
                $('input-titulo').value = '';
                $('input-conteudo').innerHTML = '<p>Comece a escrever sua história...</p>';
                $('redacao-editor').hidden = true;
                $('redacao-intro').hidden = false;
                
                // Volta para a aba principal
                document.querySelector('[data-aba="canal"]').click();
            }
        });
    }

    function configurarEditorEmbutido() {
        const botoes = document.querySelectorAll('.editor-toolbar button[data-cmd]');
        const editor = $('input-conteudo');

        botoes.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const cmd = btn.getAttribute('data-cmd');
                const value = btn.getAttribute('data-value') || null;
                document.execCommand(cmd, false, value);
                editor.focus();
            });
        });

        const btnImg = $('btn-inserir-img');
        const inputImg = $('input-img');

        btnImg.addEventListener('click', (e) => {
            e.preventDefault();
            inputImg.click();
        });

        inputImg.addEventListener('change', async () => {
            const file = inputImg.files[0];
            inputImg.value = '';
            if (!file) return;

            btnImg.disabled = true;
            const txtOriginal = btnImg.textContent;
            btnImg.textContent = '⏳';

            try {
                const path = usuarioLogado.id + '/img_' + Date.now() + '.' + (file.type.split('/')[1] || 'jpg');
                const up = await db.storage.from('avatars').upload(path, file);
                if (up.error) throw up.error;
                const url = db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
                document.execCommand('insertImage', false, url);
            } catch (err) {
                console.error(err);
                alert('Erro ao inserir imagem.');
            } finally {
                btnImg.disabled = false;
                btnImg.textContent = txtOriginal;
            }
        });

        // Capa do editor
        const capaEl = $('editor-capa');
        const inputCapa = document.createElement('input');
        inputCapa.type = 'file'; inputCapa.accept = 'image/*';
        capaEl.addEventListener('click', () => inputCapa.click());
        inputCapa.addEventListener('change', () => {
            const file = inputCapa.files[0];
            if (!file) return;
            arquivoCapaEditor = file;
            const reader = new FileReader();
            reader.onload = (e) => {
                capaEl.style.backgroundImage = `url('${e.target.result}')`;
                capaEl.innerHTML = '';
            };
            reader.readAsDataURL(file);
        });

        // Limpar placeholder
        editor.addEventListener('focus', () => {
            if (editor.textContent.trim() === 'Comece a escrever sua história...') {
                editor.innerHTML = '';
            }
        }, { once: true });

        // Publicar
        $('btn-publicar-atelie').addEventListener('click', async () => {
            const btn = $('btn-publicar-atelie');
            const titulo = $('input-titulo').value.trim();
            const htmlCru = editor.innerHTML;
            const categoria = $('input-categoria').value;

            if (!titulo) return alert('Adicione um título ao seu conteúdo.');
            if (!htmlCru || htmlCru === '<p>Comece a escrever sua história...</p>' || editor.textContent.trim() === '') {
                return alert('Escreva algo antes de publicar!');
            }

            btn.disabled = true; btn.textContent = 'Publicando...';

            try {
                let capaUrl = null;
                if (arquivoCapaEditor) {
                    const path = usuarioLogado.id + '/capa_post_' + Date.now() + '.jpg';
                    const up = await db.storage.from('avatars').upload(path, arquivoCapaEditor);
                    if (!up.error) capaUrl = db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
                }

                const { error } = await db.from('posts').insert([{
                    author_id: usuarioLogado.id,
                    title: titulo,
                    content: htmlCru,
                    cover_url: capaUrl,
                    category: categoria
                }]);

                if (error) throw error;

                alert('Conteúdo publicado com sucesso no seu canal!');
                $('input-titulo').value = '';
                editor.innerHTML = '<p>Comece a escrever sua história...</p>';
                capaEl.style.backgroundImage = '';
                capaEl.innerHTML = '<span>Adicionar Capa</span>';
                arquivoCapaEditor = null;
                $('redacao-editor').hidden = true;
                $('redacao-intro').hidden = false;
                
                // Volta para o canal
                document.querySelector('[data-aba="canal"]').click();

            } catch (err) {
                console.error(err);
                alert('Erro ao publicar.');
            } finally {
                btn.disabled = false; btn.textContent = 'Publicar';
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();