(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    let db = null;
    let usuarioLogado = null;
    let atelieAtual = null;
    let fileAvatar = null;
    let fileCapa = null;
    let arquivoCapaEditor = null;

    let posX = 50, posY = 50;
    let zoom = 1;
    let isDragging = false;
    let startX, startY;
    let bgImageTemp = null;
    let pinchInicial = 0;

    const ICONE_CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px"><path d="M20 6 9 17l-5-5"/></svg>';
    const TEXTO_BTN_AVATAR = 'Escolher Imagem de Perfil';

    const isDesktop = () => window.matchMedia('(min-width: 1367px)').matches;
    const isNotebook = () => window.matchMedia('(min-width: 1025px) and (max-width: 1366px)').matches;
    const isMobile = () => window.matchMedia('(max-width: 1024px)').matches;

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
            preencherPainel(atelie);
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
        const inputNome = $('input-config-nome');
        const inputBio = $('input-config-bio');
        const arrastavel = $('capa-preview-arrastavel');
        const container = $('capa-preview-container');

        if (inputNome) inputNome.value = atelie.name || '';
        if (inputBio) inputBio.value = atelie.description || '';

        if (atelie.cover_url && arrastavel && container) {
            arrastavel.style.backgroundImage = `url('${atelie.cover_url}')`;
            container.style.display = 'block';
        } else if (container) {
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
                preencherPainel(data);
            } catch (err) {
                console.error(err);
                alert('Erro ao abrir o Ateliê.');
                btn.disabled = false;
                btn.textContent = 'Criar Ateliê';
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

        const capaArtigoPreview = $('capa-artigo-preview');
        const capaArtigoArrastavel = $('capa-artigo-arrastavel');
        const inputCapaArtigo = $('input-capa-artigo');
        const btnUploadCapaArtigo = $('btn-upload-capa-artigo');
        const btnDescartar = $('btn-descartar-rascunho');

        function abrirGaveta() {
            gaveta.classList.add('ativa'); overlay.classList.add('ativa');
            document.body.classList.add('atelie-gaveta-aberta');
        }

        function fecharGaveta() {
            if (!isMobile()) return;
            gaveta.classList.remove('ativa'); overlay.classList.remove('ativa');
            document.body.classList.remove('atelie-gaveta-aberta');
        }

        // Botões de abrir
        $('btn-configurar-atelie').addEventListener('click', abrirGaveta);
        const btnOpcoesMobile = $('btn-opcoes-mobile');
        if (btnOpcoesMobile) btnOpcoesMobile.addEventListener('click', abrirGaveta);

        // Botões de fechar
        $('btn-fechar-config').addEventListener('click', fecharGaveta);
        $('btn-fechar-config-redacao').addEventListener('click', fecharGaveta);
        overlay.addEventListener('click', fecharGaveta);

        // Controles da Capa do Ateliê
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
            if (!f) { fileAvatar = null; btnUploadAvatar.textContent = TEXTO_BTN_AVATAR; return; }
            fileAvatar = f;
            btnUploadAvatar.innerHTML = ICONE_CHECK + 'Avatar selecionado';
        });

        function atualizarTransformacao() {
            arrastavel.style.backgroundPosition = `${posX}% ${posY}%`;
            arrastavel.style.transform = `scale(${zoom})`;
        }

        // Controles da Capa do Artigo
        btnUploadCapaArtigo.addEventListener('click', () => inputCapaArtigo.click());
        inputCapaArtigo.addEventListener('change', () => {
            const file = inputCapaArtigo.files[0];
            if (!file) return;
            arquivoCapaEditor = file;
            const reader = new FileReader();
            reader.onload = (e) => {
                capaArtigoArrastavel.style.backgroundImage = `url('${e.target.result}')`;
                capaArtigoPreview.style.display = 'block';
            };
            reader.readAsDataURL(file);
            inputCapaArtigo.value = '';
        });

        btnDescartar.addEventListener('click', () => {
            if (confirm('Tem certeza que deseja descartar este rascunho?')) {
                if (window.__resetarEditorAtelie) window.__resetarEditorAtelie();
                document.querySelector('[data-aba="canal"]').click();
                fecharGaveta();
            }
        });

        // Drag & Zoom do Ateliê
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
                fileAvatar = null; fileCapa = null; btnUploadAvatar.textContent = TEXTO_BTN_AVATAR;
                fecharGaveta();
                preencherPainel(data);
            } catch (err) {
                console.error(err); alert('Erro ao salvar.');
            } finally {
                btn.disabled = false; btn.textContent = 'Salvar Alterações';
            }
        });
    }

    // ==============================================
    // ABAS & CONFIG DINÂMICA
    // ==============================================
    function configurarAbas() {
        const botoes = document.querySelectorAll('.aba-btn');
        const main = $('atelie-main');
        
        const painelCanal = $('config-canal');
        const painelRedacao = $('config-redacao');

        botoes.forEach(btn => {
            btn.addEventListener('click', () => {
                botoes.forEach(b => b.classList.remove('ativa'));
                btn.classList.add('ativa');
                const alvo = btn.getAttribute('data-aba');

                main.classList.remove('modo-redacao');
                document.body.classList.remove('atelie-modo-redacao');
                $('aba-canal').classList.remove('ativa');
                $('aba-redacao').classList.remove('ativa');

                painelCanal.classList.remove('ativo');
                painelRedacao.classList.remove('ativo');
                painelCanal.hidden = true;
                painelRedacao.hidden = true;

                if (alvo === 'canal') {
                    $('aba-canal').classList.add('ativa');
                    painelCanal.hidden = false;
                    painelCanal.classList.add('ativo');
                } else if (alvo === 'redacao') {
                    main.classList.add('modo-redacao');
                    document.body.classList.add('atelie-modo-redacao');
                    $('aba-redacao').classList.add('ativa');
                    painelRedacao.hidden = false;
                    painelRedacao.classList.add('ativo');
                    
                    $('redacao-intro').hidden = true;
                    $('redacao-editor').hidden = false;
                }
            });
        });

        $('btn-iniciar-escrita').addEventListener('click', () => {
            $('redacao-intro').hidden = true;
            $('redacao-editor').hidden = false;
            $('input-titulo').focus();
        });

        $('btn-cancelar-escrita').addEventListener('click', () => {
            const editor = $('input-conteudo');
            const temConteudo = $('input-titulo').value.trim() || editor.textContent.trim() || editor.querySelector('img');
            if (!temConteudo || confirm('Tem certeza que deseja apagar o que escreveu?')) {
                if (window.__resetarEditorAtelie) window.__resetarEditorAtelie();
                document.querySelector('[data-aba="canal"]').click();
            }
        });
    }

    // ==============================================
    // EDITOR DE REDAÇÃO
    // ==============================================
    function configurarEditorEmbutido() {
        const editor = $('input-conteudo');
        const folha = $('editor-folha');
        const barraImg = $('img-flutuante');
        const capaEl = $('editor-capa');
        const capaHtmlOriginal = capaEl ? capaEl.innerHTML : '';
        const TAMANHO_PADRAO = 'm';
        const MAX_MB = 5;
        let figuraSelecionada = null;
        let rangeSalvo = null;

        document.execCommand('defaultParagraphSeparator', false, 'p');

        function atualizarVazio() {
            const texto = editor.textContent.trim();
            const vazio = texto === '' && !editor.querySelector('img');
            editor.dataset.vazio = vazio ? 'true' : 'false';

            const palavras = texto ? texto.split(/\s+/).length : 0;
            const minutos = palavras === 0 ? 0 : Math.max(1, Math.round(palavras / 200));
            $('contador-palavras').textContent = palavras + (palavras === 1 ? ' palavra' : ' palavras');
            $('tempo-leitura').textContent = minutos + ' min de leitura';
        }
        editor.addEventListener('input', atualizarVazio);
        atualizarVazio();

        document.addEventListener('selectionchange', () => {
            const sel = window.getSelection();
            if (sel.rangeCount && editor.contains(sel.anchorNode)) rangeSalvo = sel.getRangeAt(0).cloneRange();
        });

        document.querySelectorAll('.editor-toolbar button[data-cmd]').forEach(btn => {
            btn.addEventListener('mousedown', (e) => e.preventDefault());
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const cmd = btn.getAttribute('data-cmd');
                let value = btn.getAttribute('data-value') || null;
                if (cmd === 'formatBlock' && document.queryCommandValue('formatBlock').toLowerCase() === value) value = 'p';
                editor.focus();
                document.execCommand(cmd, false, value);
                atualizarVazio();
            });
        });

        editor.addEventListener('paste', (e) => {
            e.preventDefault();
            const texto = (e.clipboardData || window.clipboardData).getData('text/plain');
            document.execCommand('insertText', false, texto);
        });

        function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }

        function inserirFigura(url) {
            const html =
                '<figure class="img-bloco" data-size="' + TAMANHO_PADRAO + '" contenteditable="false">' +
                    '<img src="' + escapeAttr(url) + '" alt="" loading="lazy">' +
                    '<figcaption contenteditable="true" data-ph="Adicionar legenda (opcional)"></figcaption>' +
                '</figure><p><br></p>';

            editor.focus();
            const sel = window.getSelection();
            sel.removeAllRanges();
            if (rangeSalvo) {
                sel.addRange(rangeSalvo);
            } else {
                const r = document.createRange();
                r.selectNodeContents(editor); r.collapse(false);
                sel.addRange(r);
            }
            document.execCommand('insertHTML', false, html);
            atualizarVazio();
        }

        const btnImg = $('btn-inserir-img');
        const inputImg = $('input-img');

        btnImg.addEventListener('mousedown', (e) => e.preventDefault());
        btnImg.addEventListener('click', (e) => { e.preventDefault(); inputImg.click(); });

        inputImg.addEventListener('change', async () => {
            const file = inputImg.files[0];
            inputImg.value = '';
            if (!file) return;
            if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return alert('Use uma imagem JPG, PNG, WEBP ou GIF.');
            if (file.size > MAX_MB * 1024 * 1024) return alert('A imagem deve ter no máximo ' + MAX_MB + ' MB.');

            btnImg.classList.add('carregando');
            btnImg.disabled = true;
            try {
                const ext = file.type.split('/')[1] || 'jpg';
                const path = usuarioLogado.id + '/img_' + Date.now() + '.' + ext;
                const up = await db.storage.from('avatars').upload(path, file);
                if (up.error) throw up.error;
                const url = db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
                inserirFigura(url);
            } catch (err) {
                console.error(err);
                alert('Erro ao inserir imagem.');
            } finally {
                btnImg.classList.remove('carregando');
                btnImg.disabled = false;
            }
        });

        function posicionarBarra() {
            if (!figuraSelecionada) return;
            const f = figuraSelecionada.getBoundingClientRect();
            const p = folha.getBoundingClientRect();
            barraImg.style.left = (f.left - p.left + f.width / 2) + 'px';
            barraImg.style.top = (f.top - p.top - 46) + 'px';
        }

        function selecionarFigura(fig) {
            if (figuraSelecionada) figuraSelecionada.classList.remove('selecionada');
            figuraSelecionada = fig;
            if (!fig) { barraImg.classList.remove('ativa'); return; }
            fig.classList.add('selecionada');
            barraImg.querySelectorAll('[data-tam]').forEach(b =>
                b.classList.toggle('ativo', b.getAttribute('data-tam') === fig.getAttribute('data-size')));
            barraImg.classList.add('ativa');
            posicionarBarra();
        }

        editor.addEventListener('click', (e) => {
            selecionarFigura(e.target.closest('figure.img-bloco'));
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#input-conteudo') && !e.target.closest('#img-flutuante')) selecionarFigura(null);
        });
        window.addEventListener('resize', posicionarBarra);
        window.addEventListener('scroll', posicionarBarra, true);

        barraImg.addEventListener('mousedown', (e) => e.preventDefault());
        barraImg.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn || !figuraSelecionada) return;
            if (btn.dataset.tam) {
                figuraSelecionada.setAttribute('data-size', btn.dataset.tam);
                selecionarFigura(figuraSelecionada);
            } else if (btn.dataset.acao === 'remover') {
                figuraSelecionada.remove();
                selecionarFigura(null);
                atualizarVazio();
            }
        });

        function resetarEditor() {
            $('input-titulo').value = '';
            editor.innerHTML = '';
            selecionarFigura(null);
            if (capaEl) {
                capaEl.style.backgroundImage = '';
                capaEl.style.borderStyle = '';
                capaEl.innerHTML = capaHtmlOriginal;
            }
            arquivoCapaEditor = null;
            rangeSalvo = null;
            atualizarVazio();
            
            const capaArtigoPreview = $('capa-artigo-preview');
            const capaArtigoArrastavel = $('capa-artigo-arrastavel');
            if (capaArtigoPreview) capaArtigoPreview.style.display = 'none';
            if (capaArtigoArrastavel) capaArtigoArrastavel.style.backgroundImage = '';
        }
        window.__resetarEditorAtelie = resetarEditor;

        function htmlParaPublicar() {
            const clone = editor.cloneNode(true);
            clone.querySelectorAll('.selecionada').forEach(el => el.classList.remove('selecionada'));
            clone.querySelectorAll('figcaption').forEach(fc => {
                if (!fc.textContent.trim()) fc.remove();
                else { fc.removeAttribute('contenteditable'); fc.removeAttribute('data-ph'); }
            });
            clone.querySelectorAll('figure').forEach(f => f.removeAttribute('contenteditable'));
            return clone.innerHTML.trim();
        }

        $('btn-publicar-atelie').addEventListener('click', async () => {
            const btn = $('btn-publicar-atelie');
            const titulo = $('input-titulo').value.trim();
            const categoria = $('input-categoria-artigo').value;

            if (!titulo) return alert('Adicione um título ao seu conteúdo.');
            if (editor.textContent.trim() === '' && !editor.querySelector('img')) return alert('Escreva algo antes de publicar!');

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
                    content: htmlParaPublicar(),
                    cover_url: capaUrl,
                    category: categoria
                }]);
                if (error) throw error;

                alert('Conteúdo publicado com sucesso no seu canal!');
                resetarEditor();
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