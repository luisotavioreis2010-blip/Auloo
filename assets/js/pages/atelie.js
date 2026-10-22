(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    let db = null;
    let usuarioLogado = null;
    let atelieAtual = null;

    let fileAvatar = null;
    let fileCapa = null;
    let arquivoCapaEditor = null;
    let avatarImageUrl = null;
    let avatarEditado = false;

    let avatarFr = null;
    let capaFr = null;

    const MAX_MB = 5;
    const NAVBAR_H = () => {
        const nav = document.querySelector('.navbar');
        return (nav && nav.offsetHeight) || 68;
    };

    const gavetaPermanente = () =>
        window.matchMedia('(min-width: 1367px)').matches;

    // ============================================================
    // CONTROLE DE SCROLL — lock via position:fixed + top:-scrollY
    // (única técnica confiável no iOS Safari)
    // ============================================================
    let scrollYGuardado = 0;
    let gavetaAberta = false;

    function abrirGaveta() {
        if (gavetaPermanente() || gavetaAberta) return;
        gavetaAberta = true;
        scrollYGuardado = window.scrollY || window.pageYOffset || 0;
        document.documentElement.style.setProperty(
            '--atelie-scroll-lock-top', `-${scrollYGuardado}px`
        );
        document.body.classList.add('atelie-travado');
        $('gaveta-config').classList.add('ativa');
        $('overlay-config').classList.add('ativa');
        document.body.classList.add('atelie-gaveta-aberta');
    }

    function fecharGaveta(forcar) {
        if (forcar !== true && gavetaPermanente()) return;
        if (!gavetaAberta) return;
        gavetaAberta = false;
        $('gaveta-config').classList.remove('ativa');
        $('overlay-config').classList.remove('ativa');
        document.body.classList.remove('atelie-gaveta-aberta');
        document.body.classList.remove('atelie-travado');
        document.documentElement.style.removeProperty('--atelie-scroll-lock-top');
        // Restaura a posição de scroll exata
        window.scrollTo(0, scrollYGuardado);
    }

    // Limpa estado zumbi da gaveta (blobs não commitados)
    function limparEstadoGavetaNaoSalvo() {
        if (avatarImageUrl && avatarImageUrl.indexOf('blob:') === 0) {
            URL.revokeObjectURL(avatarImageUrl);
        }
        avatarImageUrl = null;
        fileAvatar = null;
        fileCapa = null;
        avatarEditado = false;
    }

    // ============================================================
    // UTILITÁRIOS
    // ============================================================
    async function aguardarSupabase() {
        for (let i = 0; i < 30; i++) {
            if (window.supabaseClient) return window.supabaseClient;
            await new Promise(r => setTimeout(r, 200));
        }
        return null;
    }

    function iniciais(nome) {
        const p = String(nome || '?').trim().split(/\s+/);
        const a = (p[0] || '?').charAt(0).toUpperCase();
        const b = p.length > 1 ? (p[p.length - 1] || '').charAt(0).toUpperCase() : '';
        return a + b;
    }

    function parsePos(str) {
        const p = String(str || '50% 50%').split(' ');
        const x = parseFloat(p[0]);
        const y = parseFloat(p[1]);
        return [isNaN(x) ? 50 : x, isNaN(y) ? 50 : y];
    }

    function avisar(msg, tipo) {
        const el = document.createElement('div');
        el.className = 'atelie-toast' + (tipo === 'erro' ? ' erro' : '');
        el.setAttribute('role', 'status');
        el.textContent = msg;
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('visivel'));
        setTimeout(() => {
            el.classList.remove('visivel');
            setTimeout(() => el.remove(), 350);
        }, 3200);
    }

    // Modal próprio de confirmação (substitui confirm() nativo)
    function confirmar(mensagem, opcoes) {
        return new Promise((resolve) => {
            const opts = Object.assign({
                titulo: 'Confirmar',
                confirmar: 'Confirmar',
                cancelar: 'Cancelar',
                perigo: false,
            }, opcoes || {});
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.innerHTML =
                '<div class="modal-conteudo" style="max-width:420px;">' +
                    '<header class="modal-header">' +
                        '<h2>' + opts.titulo + '</h2>' +
                    '</header>' +
                    '<p style="font-family:var(--fonte-display);font-size:1.1rem;' +
                       'color:var(--tinta-suave);margin-bottom:1.5rem;line-height:1.5;">' +
                       mensagem +
                    '</p>' +
                    '<div style="display:flex;gap:0.75rem;justify-content:flex-end;flex-wrap:wrap;">' +
                        '<button type="button" class="btn-primario" data-cancelar ' +
                            'style="background:transparent;color:var(--tinta-suave);border-color:var(--papel-sombra);">' +
                            opts.cancelar + '</button>' +
                        '<button type="button" class="btn-primario" data-confirmar' +
                            (opts.perigo ? ' style="background:var(--erro,#a63a3a);border-color:var(--erro,#a63a3a);"' : '') +
                            '>' + opts.confirmar + '</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(overlay);
            const fechar = (valor) => {
                overlay.remove();
                document.removeEventListener('keydown', onKey);
                resolve(valor);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') fechar(false);
                if (e.key === 'Enter') fechar(true);
            };
            overlay.querySelector('[data-confirmar]').addEventListener('click', () => fechar(true));
            overlay.querySelector('[data-cancelar]').addEventListener('click', () => fechar(false));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(false); });
            document.addEventListener('keydown', onKey);
            setTimeout(() => overlay.querySelector('[data-confirmar]').focus(), 50);
        });
    }

    function estadoBotao(btn, ocupado, textoOcupado) {
        const alvo = btn.querySelector('.btn-rotulo') || btn;
        if (!btn.dataset.rotulo) btn.dataset.rotulo = alvo.textContent;
        btn.disabled = ocupado;
        btn.classList.toggle('carregando', ocupado);
        alvo.textContent = ocupado ? textoOcupado : btn.dataset.rotulo;
    }

    function validarImagem(file) {
        if (!file) return false;
        if (!/^image\//.test(file.type)) { avisar('Escolha um arquivo de imagem.', 'erro'); return false; }
        if (file.size > MAX_MB * 1024 * 1024) { avisar('A imagem deve ter no máximo ' + MAX_MB + ' MB.', 'erro'); return false; }
        return true;
    }

    function escaparHtml(str) {
        return String(str || '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function formatarData(iso) {
        if (!iso) return '';
        try {
            return new Date(iso).toLocaleDateString('pt-BR', {
                day: '2-digit', month: 'short', year: 'numeric'
            });
        } catch { return ''; }
    }

    // ============================================================
    // ENQUADRADOR (avatar/capa)
    // ============================================================
    function criarEnquadrador({ container, camada, slider, linhaZoom, aoImagem, aoMudar }) {
        const est = { x: 50, y: 50, zoom: 1, nw: 0, nh: 0, pronto: false };
        const ponteiros = new Map();
        let ix = 0, iy = 0, x0 = 50, y0 = 50, dist0 = 0, zoom0 = 1;
        let arrastando = false;
        const limitar = (v, a, b) => Math.max(a, Math.min(b, v));

        function aplicar() {
            camada.style.backgroundPosition = est.x + '% ' + est.y + '%';
            camada.style.transformOrigin = est.x + '% ' + est.y + '%';
            camada.style.transform = 'scale(' + est.zoom + ')';
            if (slider) slider.value = est.zoom;
        }
        function medidas() {
            const cw = container.clientWidth, ch = container.clientHeight;
            const s = Math.max(cw / est.nw, ch / est.nh);
            return {
                s,
                livreX: Math.max(0, est.nw - cw / (est.zoom * s)),
                livreY: Math.max(0, est.nh - ch / (est.zoom * s))
            };
        }
        function mudou() { if (aoMudar) aoMudar(); }
        function definirZoom(z) { est.zoom = limitar(z, 1, 3); aplicar(); mudou(); }
        function mover(dx, dy) {
            const m = medidas();
            if (m.livreX > 0.5) est.x = limitar(x0 - (dx / (est.zoom * m.s)) / m.livreX * 100, 0, 100);
            if (m.livreY > 0.5) est.y = limitar(y0 - (dy / (est.zoom * m.s)) / m.livreY * 100, 0, 100);
            aplicar(); mudou();
        }
        const distancia = () => {
            const [a, b] = [...ponteiros.values()];
            return Math.hypot(a.x - b.x, a.y - b.y);
        };

        container.addEventListener('pointerdown', (e) => {
            if (!est.pronto) return;
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
            container.setPointerCapture(e.pointerId);
            if (ponteiros.size === 1) {
                arrastando = true; ix = e.clientX; iy = e.clientY; x0 = est.x; y0 = est.y;
            } else if (ponteiros.size === 2) {
                arrastando = false; dist0 = distancia(); zoom0 = est.zoom;
            }
        });
        container.addEventListener('pointermove', (e) => {
            if (!ponteiros.has(e.pointerId)) return;
            ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
            e.preventDefault();
            if (ponteiros.size === 2 && dist0 > 0) definirZoom(zoom0 * (distancia() / dist0));
            else if (arrastando) mover(e.clientX - ix, e.clientY - iy);
        });
        const soltar = (e) => {
            ponteiros.delete(e.pointerId); dist0 = 0;
            if (ponteiros.size === 1) {
                const [p] = [...ponteiros.values()];
                arrastando = true; ix = p.x; iy = p.y; x0 = est.x; y0 = est.y;
            } else arrastando = false;
        };
        container.addEventListener('pointerup', soltar);
        container.addEventListener('pointercancel', soltar);
        container.addEventListener('wheel', (e) => {
            if (!est.pronto || !(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            definirZoom(est.zoom + (e.deltaY < 0 ? 0.1 : -0.1));
        }, { passive: false });
        if (slider) slider.addEventListener('input', () => definirZoom(parseFloat(slider.value)));

        return {
            carregar(url, ini) {
                est.pronto = false;
                est.x = ini?.x ?? 50;
                est.y = ini?.y ?? 50;
                est.zoom = ini?.zoom ?? 1;
                camada.style.backgroundImage = 'url("' + String(url).replace(/"/g, '%22') + '")';
                aplicar();
                if (linhaZoom) linhaZoom.hidden = false;
                if (aoImagem) aoImagem(true);
                const im = new Image();
                im.onload = () => { est.nw = im.naturalWidth; est.nh = im.naturalHeight; est.pronto = true; };
                im.src = url;
            },
            limpar() {
                est.pronto = false; est.x = 50; est.y = 50; est.zoom = 1;
                camada.style.backgroundImage = '';
                aplicar();
                if (linhaZoom) linhaZoom.hidden = true;
                if (aoImagem) aoImagem(false);
            },
            estado: () => ({ x: est.x, y: est.y, zoom: est.zoom }),
            temImagem: () => est.pronto
        };
    }

    // ============================================================
    // INÍCIO
    // ============================================================
    async function iniciar() {
        try {
            db = await aguardarSupabase();
            if (!db) { console.error('Supabase não carregado.'); return; }
            const { data: { session } } = await db.auth.getSession();
            if (!session) return (window.location.href = 'login.html');
            usuarioLogado = session.user;

            configurarGavetaConfig();
            configurarDropdown();
            await verificarAtelie();
            configurarCriacao();
            configurarAbas();
            configurarEditorEmbutido();
        } catch (err) {
            console.error('Erro ao iniciar ateliê:', err);
            avisar('Não foi possível carregar o ateliê. Recarregue a página.', 'erro');
        }
    }

    async function verificarAtelie() {
        const { data: atelie, error } = await db.from('ateliers')
            .select('*').eq('owner_id', usuarioLogado.id).maybeSingle();
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
            await carregarCanal();
        }
    }

    // ============================================================
    // CANAL
    // ============================================================
    async function carregarCanal() {
        const lista = $('canal-lista'), vazio = $('canal-vazio');
        if (!lista) return;
        lista.innerHTML = '<div class="canal-carregando"><div class="canal-skeleton"></div><div class="canal-skeleton"></div></div>';
        vazio.hidden = true;

        const { data: posts, error } = await db.from('posts')
            .select('id, title, content, cover_url, category, created_at')
            .eq('author_id', usuarioLogado.id)
            .order('created_at', { ascending: false });

        lista.innerHTML = '';
        if (error || !posts || posts.length === 0) { vazio.hidden = false; return; }

        posts.forEach(post => {
            const card = document.createElement('article');
            card.className = 'canal-post';
            card.dataset.id = post.id;
            const capa = post.cover_url
                ? '<div class="canal-post-capa"><img src="' + escaparHtml(post.cover_url) + '" loading="lazy" referrerpolicy="no-referrer"></div>'
                : '';
            // Extrai trecho com DOMParser (mais seguro que innerHTML)
            const doc = new DOMParser().parseFromString(post.content || '', 'text/html');
            doc.querySelectorAll('figure, img, figcaption, style, script').forEach(el => el.remove());
            const texto = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
            const trecho = texto.length > 220 ? texto.slice(0, 220).trim() + '…' : texto;

            card.innerHTML = capa +
                '<div class="canal-post-corpo">' +
                    '<div class="canal-post-meta">' +
                        (post.category ? '<span class="canal-post-categoria">' + escaparHtml(post.category) + '</span>' : '') +
                        '<span>' + escaparHtml(formatarData(post.created_at)) + '</span>' +
                    '</div>' +
                    '<h2 class="canal-post-titulo">' + escaparHtml(post.title || 'Sem título') + '</h2>' +
                    '<div class="canal-post-trecho">' + escaparHtml(trecho) + '</div>' +
                    '<div class="canal-post-rodape">' +
                        '<button type="button" class="canal-post-ler" data-ler="' + post.id + '">Ler artigo' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>' +
                        '</button>' +
                        '<div class="canal-post-acoes">' +
                            '<button type="button" class="perigo" data-excluir="' + post.id + '" title="Excluir">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>' +
                            '</button>' +
                        '</div>' +
                    '</div>' +
                '</div>';
            lista.appendChild(card);
        });

        lista.querySelectorAll('[data-excluir]').forEach(btn => btn.addEventListener('click', async () => {
            const ok = await confirmar('Excluir esta publicação? Esta ação não pode ser desfeita.', {
                titulo: 'Excluir publicação', confirmar: 'Excluir', perigo: true
            });
            if (!ok) return;
            const { error } = await db.from('posts').delete().eq('id', btn.dataset.excluir);
            if (error) return avisar('Não foi possível excluir.', 'erro');
            avisar('Publicação excluída.');
            carregarCanal();
        }));
        lista.querySelectorAll('[data-ler]').forEach(btn => btn.addEventListener('click', () => {
            window.location.href = 'post.html?id=' + encodeURIComponent(btn.dataset.ler);
        }));
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
            img.alt = 'Avatar';
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
            const img = $('atelie-capa-img');
            const [cx, cy] = parsePos(atelie.cover_position);
            const cz = parseFloat(atelie.cover_zoom) || 1;
            img.src = atelie.cover_url;
            img.style.objectPosition = cx + '% ' + cy + '%';
            img.style.transformOrigin = cx + '% ' + cy + '%';
            img.style.transform = 'scale(' + cz + ')';
        }
    }

    function preencherPainel(atelie) {
        $('input-config-nome').value = atelie.name || '';
        $('input-config-bio').value = atelie.description || '';

        if (capaFr) {
            if (atelie.cover_url) {
                const [x, y] = parsePos(atelie.cover_position);
                capaFr.carregar(atelie.cover_url, { x, y, zoom: parseFloat(atelie.cover_zoom) || 1 });
            } else capaFr.limpar();
        }
        if (avatarFr) {
            if (atelie.avatar_url) {
                avatarImageUrl = atelie.avatar_url;
                avatarFr.carregar(atelie.avatar_url);
            } else {
                avatarImageUrl = null;
                avatarFr.limpar();
            }
        }
        avatarEditado = false;
    }

    // ============================================================
    // CRIAÇÃO
    // ============================================================
    function configurarCriacao() {
        const modal = $('modal-criar-atelie');
        if (!modal) return;
        $('btn-fechar-modal').addEventListener('click', () => modal.hidden = true);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });

        $('form-criar-atelie').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = $('btn-salvar-atelie');
            const nome = $('input-nome-atelie').value.trim();
            const bio = $('input-bio-atelie').value.trim();
            if (!nome) return avisar('O Nome do Ateliê é obrigatório.', 'erro');
            btn.disabled = true; btn.textContent = 'Abrindo...';
            try {
                const { data: handleGerado, error: errHandle } = await db.rpc('gerar_handle_unico');
                if (errHandle) throw errHandle;
                const { data, error } = await db.from('ateliers').insert([{
                    owner_id: usuarioLogado.id, name: nome, handle: handleGerado,
                    description: bio, cover_position: '50% 50%', cover_zoom: 1
                }]).select().single();
                if (error) throw error;
                modal.hidden = true;
                $('atelie-vazio').hidden = true;
                $('atelie-conteudo').hidden = false;
                $('atelie-abas').hidden = false;
                atelieAtual = data;
                renderizarAtelie(data);
                preencherPainel(data);
                await carregarCanal();
            } catch (err) {
                console.error(err);
                avisar('Erro ao abrir o Ateliê.', 'erro');
                btn.disabled = false; btn.textContent = 'Criar Ateliê';
            }
        });
    }

    // ============================================================
    // GAVETA DE CONFIGURAÇÃO
    // ============================================================
    function configurarGavetaConfig() {
        avatarFr = criarEnquadrador({
            container: $('avatar-preview-container'),
            camada: $('avatar-preview-arrastavel'),
            slider: $('avatar-zoom'),
            linhaZoom: $('avatar-zoom-linha'),
            aoImagem: (tem) => {
                const cam = $('avatar-preview-arrastavel');
                cam.classList.toggle('tem-imagem', tem);
                if (tem) { const svg = cam.querySelector('svg'); if (svg) svg.remove(); }
            },
            aoMudar: () => { avatarEditado = true; }
        });
        capaFr = criarEnquadrador({
            container: $('capa-preview-container'),
            camada: $('capa-preview-arrastavel'),
            slider: $('capa-zoom'),
            linhaZoom: $('capa-zoom-linha'),
            aoImagem: (tem) => {
                $('capa-preview-container').hidden = !tem;
                $('capa-vazia').hidden = tem;
            }
        });

        $('btn-configurar-atelie').addEventListener('click', () => abrirGaveta());
        const btnOpcoesMobile = $('btn-opcoes-mobile');
        if (btnOpcoesMobile) btnOpcoesMobile.addEventListener('click', () => abrirGaveta());
        $('btn-fechar-config').addEventListener('click', () => { limparEstadoGavetaNaoSalvo(); fecharGaveta(); });
        $('btn-fechar-config-redacao').addEventListener('click', () => fecharGaveta());
        $('overlay-config').addEventListener('click', () => { limparEstadoGavetaNaoSalvo(); fecharGaveta(); });

        // Em ≥1367px a gaveta é sticky no fluxo (não é drawer)
        // Apenas fechamos se sair do breakpoint para evitar estado inconsistente
        window.addEventListener('resize', () => {
            if (gavetaPermanente() && gavetaAberta) fecharGaveta(true);
        });

        const inputAvatar = $('input-config-avatar');
        $('btn-upload-avatar').addEventListener('click', () => inputAvatar.click());
        inputAvatar.addEventListener('change', () => {
            const file = inputAvatar.files[0];
            inputAvatar.value = '';
            if (!validarImagem(file)) return;
            if (avatarImageUrl && avatarImageUrl.indexOf('blob:') === 0) {
                URL.revokeObjectURL(avatarImageUrl);
            }
            fileAvatar = file;
            avatarImageUrl = URL.createObjectURL(file);
            avatarFr.carregar(avatarImageUrl);
            avatarEditado = true;
        });

        const inputCapa = $('input-config-capa');
        $('btn-upload-capa').addEventListener('click', () => inputCapa.click());
        inputCapa.addEventListener('change', () => {
            const file = inputCapa.files[0];
            inputCapa.value = '';
            if (!validarImagem(file)) return;
            fileCapa = file;
            capaFr.carregar(URL.createObjectURL(file));
        });

        const capaArtigoPreview = $('capa-artigo-preview');
        const capaArtigoArrastavel = $('capa-artigo-arrastavel');
        const inputCapaArtigo = $('input-capa-artigo');
        $('btn-upload-capa-artigo').addEventListener('click', () => inputCapaArtigo.click());
        inputCapaArtigo.addEventListener('change', () => {
            const file = inputCapaArtigo.files[0];
            inputCapaArtigo.value = '';
            if (!validarImagem(file)) return;
            arquivoCapaEditor = file;
            const reader = new FileReader();
            reader.onload = (e) => {
                capaArtigoArrastavel.style.backgroundImage = 'url("' + e.target.result + '")';
                capaArtigoPreview.hidden = false;
            };
            reader.readAsDataURL(file);
        });
        $('btn-remover-capa-artigo').addEventListener('click', () => {
            arquivoCapaEditor = null;
            capaArtigoArrastavel.style.backgroundImage = '';
            capaArtigoPreview.hidden = true;
        });

        $('btn-descartar-rascunho').addEventListener('click', async () => {
            const ok = await confirmar('Tem certeza que deseja descartar este rascunho?', {
                titulo: 'Descartar rascunho', confirmar: 'Descartar', perigo: true
            });
            if (!ok) return;
            if (window.__resetarEditorAtelie) window.__resetarEditorAtelie();
            document.querySelector('[data-aba="canal"]').click();
            fecharGaveta();
        });

        async function gerarAvatarRecortado() {
            const src = fileAvatar ? URL.createObjectURL(fileAvatar) : avatarImageUrl;
            if (!src) return null;
            const img = await new Promise((ok, falha) => {
                const im = new Image();
                if (!fileAvatar) im.crossOrigin = 'anonymous';
                im.onload = () => ok(im);
                im.onerror = falha;
                im.src = src;
            });
            if (fileAvatar) URL.revokeObjectURL(src);

            const est = avatarFr.estado();
            const cs = $('avatar-preview-container').clientWidth || 88;
            const s = Math.max(cs / img.naturalWidth, cs / img.naturalHeight);
            const lado = cs / (est.zoom * s);
            const sx = est.x / 100 * Math.max(0, img.naturalWidth - lado);
            const sy = est.y / 100 * Math.max(0, img.naturalHeight - lado);

            const SAIDA = 512;
            const canvas = document.createElement('canvas');
            canvas.width = SAIDA; canvas.height = SAIDA;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, SAIDA, SAIDA);
            ctx.drawImage(img, sx, sy, lado, lado, 0, 0, SAIDA, SAIDA);
            return new Promise((ok) => canvas.toBlob((b) => ok(b), 'image/jpeg', 0.92));
        }

        $('form-config-atelie').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = $('btn-salvar-config');
            estadoBotao(btn, true, 'Salvando...');
            const nome = $('input-config-nome').value.trim();
            const bio = $('input-config-bio').value.trim();
            if (!nome) { estadoBotao(btn, false); return avisar('O nome do ateliê é obrigatório.', 'erro'); }
            let newAvatarUrl = atelieAtual.avatar_url;
            let newCoverUrl = atelieAtual.cover_url;
            try {
                if (avatarEditado && avatarFr.temImagem()) {
                    let blob = null;
                    try { blob = await gerarAvatarRecortado(); } catch (_) { blob = null; }
                    const corpo = blob || fileAvatar;
                    if (corpo) {
                        const path = usuarioLogado.id + '/atelie-avatar-' + Date.now() + '.jpg';
                        const up = await db.storage.from('avatars').upload(path, corpo, { contentType: blob ? 'image/jpeg' : corpo.type });
                        if (up.error) throw up.error;
                        newAvatarUrl = db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
                    }
                }
                if (fileCapa) {
                    const path = usuarioLogado.id + '/atelie-capa-' + Date.now() + '.jpg';
                    const up = await db.storage.from('avatars').upload(path, fileCapa, { contentType: fileCapa.type });
                    if (up.error) throw up.error;
                    newCoverUrl = db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
                }
                const c = capaFr.estado();
                const { data, error } = await db.from('ateliers').update({
                    name: nome, description: bio,
                    avatar_url: newAvatarUrl, cover_url: newCoverUrl,
                    cover_position: c.x.toFixed(1) + '% ' + c.y.toFixed(1) + '%',
                    cover_zoom: Number(c.zoom.toFixed(2))
                }).eq('id', atelieAtual.id).select().single();
                if (error) throw error;
                atelieAtual = data;
                fileAvatar = null; fileCapa = null;
                renderizarAtelie(data);
                preencherPainel(data);
                fecharGaveta();
                avisar('Ateliê atualizado com sucesso.');
            } catch (err) {
                console.error(err);
                avisar('Não foi possível salvar. Tente novamente.', 'erro');
            } finally {
                estadoBotao(btn, false);
            }
        });
    }

    // ============================================================
    // DROPDOWN
    // ============================================================
    function configurarDropdown() {
        const raiz = $('dropdown-categoria');
        if (!raiz) return;
        const gatilho = raiz.querySelector('.dropdown-gatilho');
        const lista = raiz.querySelector('.dropdown-lista');
        const valorEl = raiz.querySelector('.dropdown-valor');
        const iconeEl = gatilho.querySelector('.dropdown-icone');
        const campo = $('input-categoria-artigo');
        const itens = [...lista.querySelectorAll('[role="option"]')];

        function abrir() {
            raiz.classList.add('aberto');
            gatilho.setAttribute('aria-expanded', 'true');
            const sel = itens.find(i => i.getAttribute('aria-selected') === 'true') || itens[0];
            sel.focus();
        }
        function fechar(devolverFoco) {
            raiz.classList.remove('aberto');
            gatilho.setAttribute('aria-expanded', 'false');
            if (devolverFoco) gatilho.focus();
        }
        function escolher(li) {
            itens.forEach(i => i.setAttribute('aria-selected', i === li ? 'true' : 'false'));
            campo.value = li.dataset.valor;
            valorEl.textContent = li.dataset.valor;
            iconeEl.innerHTML = li.querySelector('.dropdown-icone').innerHTML;
            fechar(true);
        }
        gatilho.addEventListener('click', () => raiz.classList.contains('aberto') ? fechar() : abrir());
        gatilho.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); abrir(); }
        });
        itens.forEach((li, idx) => {
            li.addEventListener('click', () => escolher(li));
            li.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); escolher(li); }
                else if (e.key === 'Escape') { e.preventDefault(); fechar(true); }
                else if (e.key === 'ArrowDown') { e.preventDefault(); itens[(idx + 1) % itens.length].focus(); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); itens[(idx - 1 + itens.length) % itens.length].focus(); }
                else if (e.key === 'Home') { e.preventDefault(); itens[0].focus(); }
                else if (e.key === 'End') { e.preventDefault(); itens[itens.length - 1].focus(); }
                else if (e.key === 'Tab') fechar();
            });
        });
        document.addEventListener('pointerdown', (e) => { if (!raiz.contains(e.target)) fechar(); });
    }

    // ============================================================
    // ABAS
    // ============================================================
    function configurarAbas() {
        const botoes = document.querySelectorAll('.aba-btn');
        const main = $('atelie-main');
        const painelCanal = $('config-canal');
        const painelRedacao = $('config-redacao');

        botoes.forEach(btn => {
            btn.addEventListener('click', () => {
                fecharGaveta(true);
                // Ao trocar de aba, limpa seleção de imagem e menus abertos
                if (window.__limparSelecaoEditor) window.__limparSelecaoEditor();
                window.scrollTo({ top: 0 });
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
                    carregarCanal();
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

        $('btn-cancelar-escrita').addEventListener('click', async () => {
            const editor = $('input-conteudo');
            const temConteudo = $('input-titulo').value.trim() ||
                editor.textContent.trim() || editor.querySelector('img');
            if (temConteudo) {
                const ok = await confirmar('Tem certeza que deseja apagar o que escreveu?', {
                    titulo: 'Descartar escrita', confirmar: 'Descartar', perigo: true
                });
                if (!ok) return;
            }
            if (window.__resetarEditorAtelie) window.__resetarEditorAtelie();
            document.querySelector('[data-aba="canal"]').click();
        });
    }

    // ============================================================
    // EDITOR DE REDAÇÃO
    // ============================================================
    function configurarEditorEmbutido() {
        const editor = $('input-conteudo');
        const folha = $('editor-folha');
        const barra = $('img-flutuante');
        const selecao = $('img-selecao');
        const rotuloSel = $('img-selecao-rotulo');
        const indicador = $('img-indicador');
        const menu = $('img-menu');

        const TAMANHOS = { p: 30, m: 55, g: 100 };
        const TAMANHO_PADRAO = 'm';
        const BLOCOS = new Set(['P', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'UL', 'OL', 'FIGURE', 'DIV', 'PRE']);

        let figura = null;
        let rangeSalvo = null;
        let arraste = null;
        let fantasma = null;
        let ignorarClique = false;
        let longPressTimer = null;
        let longPressIniciado = false;

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
        editor.addEventListener('input', () => { atualizarVazio(); posicionar(); });
        atualizarVazio();

        document.addEventListener('selectionchange', () => {
            const sel = window.getSelection();
            if (sel.rangeCount && editor.contains(sel.anchorNode)) {
                rangeSalvo = sel.getRangeAt(0).cloneRange();
            }
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
        editor.addEventListener('dragstart', (e) => { if (e.target.tagName === 'IMG') e.preventDefault(); });

        function normalizarBlocos() {
            let atual = null;
            [...editor.childNodes].forEach(n => {
                if (n.nodeType === 1 && BLOCOS.has(n.tagName)) { atual = null; return; }
                if (n.nodeType === 3 && !n.textContent.trim() && !atual) { n.remove(); return; }
                if (!atual) { atual = document.createElement('p'); n.before(atual); }
                atual.appendChild(n);
            });
        }
        function blocoTopo(no) {
            while (no && no.parentNode !== editor) no = no.parentNode;
            return no && no.nodeType === 1 ? no : null;
        }
        function garantirParagrafoFinal() {
            const ult = editor.lastElementChild;
            if (!ult || ult.tagName === 'FIGURE') {
                const p = document.createElement('p');
                p.innerHTML = '<br>';
                editor.appendChild(p);
            }
        }
        function colocarCursor(el) {
            const r = document.createRange();
            r.selectNodeContents(el);
            r.collapse(true);
            const s = window.getSelection();
            s.removeAllRanges();
            s.addRange(r);
        }
        function criarFigura(url) {
            const fig = document.createElement('figure');
            fig.className = 'img-bloco';
            fig.dataset.size = TAMANHO_PADRAO;
            fig.dataset.align = 'center';
            fig.style.width = TAMANHOS[TAMANHO_PADRAO] + '%';
            fig.contentEditable = 'false';
            const img = document.createElement('img');
            img.src = url; img.alt = ''; img.loading = 'lazy'; img.draggable = false;
            img.addEventListener('load', posicionar);
            const cap = document.createElement('figcaption');
            cap.contentEditable = 'true';
            cap.dataset.ph = 'Adicionar legenda (opcional)';
            fig.appendChild(img);
            fig.appendChild(cap);
            return fig;
        }
        function inserirBloco(fig) {
            let no = null, off = 0;
            if (rangeSalvo && editor.contains(rangeSalvo.startContainer)) {
                // Valida se o range ainda é coerente com o DOM atual
                try {
                    no = rangeSalvo.startContainer; off = rangeSalvo.startOffset;
                    if (no.nodeType === 3 && !no.parentNode) { no = null; off = 0; }
                } catch (_) { no = null; off = 0; }
            }
            normalizarBlocos();
            const topo = no && editor.contains(no) ? blocoTopo(no) : null;
            if (topo && topo.tagName === 'P') {
                const vazio = !topo.textContent.trim() && !topo.querySelector('img');
                if (vazio) { topo.replaceWith(fig); }
                else {
                    const r = document.createRange();
                    r.setStart(no, off);
                    r.setEndAfter(topo.lastChild);
                    const resto = r.extractContents();
                    const p2 = document.createElement('p');
                    p2.appendChild(resto);
                    if (!p2.textContent.trim()) p2.innerHTML = '<br>';
                    topo.after(fig);
                    fig.after(p2);
                    if (!topo.textContent.trim()) topo.remove();
                }
            } else if (topo) { topo.after(fig); }
            else { editor.appendChild(fig); }
            garantirParagrafoFinal();
            const prox = fig.nextElementSibling;
            editor.focus({ preventScroll: true });
            if (prox) colocarCursor(prox);
            atualizarVazio();
            selecionarFigura(fig);
            fig.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }

        const btnImg = $('btn-inserir-img');
        const inputImg = $('input-img');
        let uploadEmAndamento = false;
        btnImg.addEventListener('mousedown', (e) => e.preventDefault());
        btnImg.addEventListener('click', (e) => {
            e.preventDefault();
            if (uploadEmAndamento) return;
            inputImg.click();
        });
        inputImg.addEventListener('change', async () => {
            if (uploadEmAndamento) return;
            const file = inputImg.files[0];
            inputImg.value = '';
            if (!file) return;
            if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return avisar('Use uma imagem JPG, PNG, WEBP ou GIF.', 'erro');
            if (file.size > MAX_MB * 1024 * 1024) return avisar('A imagem deve ter no máximo ' + MAX_MB + ' MB.', 'erro');
            uploadEmAndamento = true;
            btnImg.classList.add('carregando'); btnImg.disabled = true;
            try {
                const ext = file.type.split('/')[1] || 'jpg';
                const path = usuarioLogado.id + '/img_' + Date.now() + '.' + ext;
                const up = await db.storage.from('avatars').upload(path, file);
                if (up.error) throw up.error;
                const url = db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
                inserirBloco(criarFigura(url));
            } catch (err) {
                console.error(err);
                avisar('Erro ao inserir imagem.', 'erro');
            } finally {
                uploadEmAndamento = false;
                btnImg.classList.remove('carregando');
                btnImg.disabled = false;
            }
        });

        function definirTamanho(fig, chave) {
            fig.dataset.size = chave;
            fig.style.width = TAMANHOS[chave] + '%';
            if (chave === 'g') fig.dataset.align = 'center';
        }
        function definirLarguraLivre(fig, pct) {
            const preset = Object.keys(TAMANHOS).find(k => Math.abs(TAMANHOS[k] - pct) < 1.5);
            fig.dataset.size = preset || 'c';
            fig.style.width = (preset ? TAMANHOS[preset] : pct).toFixed(1) + '%';
            if (pct >= 99) fig.dataset.align = 'center';
        }
        function definirAlinhamento(fig, al) {
            fig.dataset.align = al;
            if (al !== 'center' && parseFloat(fig.style.width) > 85) definirTamanho(fig, 'm');
            fig.dataset.align = al;
        }
        function atualizarEstados() {
            if (!figura) return;
            [barra, menu].forEach(c => {
                c.querySelectorAll('[data-tam]').forEach(b => b.classList.toggle('ativo', b.dataset.tam === figura.dataset.size));
                c.querySelectorAll('[data-alin]').forEach(b => b.classList.toggle('ativo', b.dataset.alin === figura.dataset.align));
            });
            selecao.dataset.align = figura.dataset.align;
        }
        function posicionar() {
            if (!figura) return;
            const img = figura.querySelector('img');
            if (!img) return;
            const f = img.getBoundingClientRect();
            const p = folha.getBoundingClientRect();
            const ox = p.left + folha.clientLeft;
            const oy = p.top + folha.clientTop;
            selecao.style.left = (f.left - ox) + 'px';
            selecao.style.top = (f.top - oy) + 'px';
            selecao.style.width = f.width + 'px';
            selecao.style.height = f.height + 'px';
            const metade = barra.offsetWidth / 2;
            let cx = f.left - ox + f.width / 2;
            cx = Math.max(metade + 8, Math.min(folha.clientWidth - metade - 8, cx));
            let topo = f.top - oy - 50;
            if (topo < 4) topo = f.bottom - oy + 10;
            barra.style.left = cx + 'px';
            barra.style.top = topo + 'px';
        }
        function selecionarFigura(fig) {
            if (figura && figura !== fig) figura.classList.remove('selecionada');
            figura = fig || null;
            if (!figura) {
                barra.classList.remove('ativa');
                selecao.classList.remove('ativa');
                fecharMenu();
                return;
            }
            figura.classList.add('selecionada');
            atualizarEstados();
            barra.classList.add('ativa');
            selecao.classList.add('ativa');
            posicionar();
        }
        // API pública para limpar seleção ao trocar de aba
        window.__limparSelecaoEditor = () => selecionarFigura(null);

        editor.addEventListener('click', (e) => {
            if (ignorarClique) return;
            const fig = e.target.closest('figure.img-bloco');
            selecionarFigura(fig);
            if (fig && !e.target.closest('figcaption')) window.getSelection().removeAllRanges();
        });
        document.addEventListener('click', (e) => {
            if (ignorarClique) return;
            if (!e.target.closest('#input-conteudo') && !e.target.closest('#img-flutuante') &&
                !e.target.closest('#img-selecao') && !e.target.closest('#img-menu')) selecionarFigura(null);
        });
        window.addEventListener('resize', posicionar);
        window.addEventListener('scroll', () => { posicionar(); fecharMenu(); }, true);
        if ('ResizeObserver' in window) new ResizeObserver(() => posicionar()).observe(editor);

        function removerFigura() {
            if (!figura) return;
            const f = figura; selecionarFigura(null); f.remove(); atualizarVazio();
        }
        function moverPosicao(dir) {
            if (!figura) return;
            const alvo = dir < 0 ? figura.previousElementSibling : figura.nextElementSibling;
            if (!alvo) return;
            if (dir < 0) alvo.before(figura); else alvo.after(figura);
            garantirParagrafoFinal();
            figura.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        function executar(btn) {
            if (!figura) return;
            if (btn.dataset.tam) definirTamanho(figura, btn.dataset.tam);
            else if (btn.dataset.alin) definirAlinhamento(figura, btn.dataset.alin);
            else if (btn.dataset.acao === 'remover') { removerFigura(); return; }
            else if (btn.dataset.acao === 'subir') moverPosicao(-1);
            else if (btn.dataset.acao === 'descer') moverPosicao(1);
            else if (btn.dataset.acao === 'legenda') {
                const cap = figura.querySelector('figcaption');
                if (cap) { cap.focus(); colocarCursor(cap); }
            }
            atualizarEstados(); posicionar();
        }

        barra.addEventListener('mousedown', (e) => { if (!e.target.closest('.grip')) e.preventDefault(); });
        barra.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn || btn.dataset.acao === 'mover') return;
            executar(btn);
        });

        function abrirMenu(x, y) {
            atualizarEstados();
            menu.hidden = false;
            const w = menu.offsetWidth, h = menu.offsetHeight;
            menu.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
            menu.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
        }
        function fecharMenu() { menu.hidden = true; }

        editor.addEventListener('contextmenu', (e) => {
            const fig = e.target.closest('figure.img-bloco');
            if (!fig || e.target.closest('figcaption')) return;
            e.preventDefault();
            selecionarFigura(fig);
            abrirMenu(e.clientX, e.clientY);
        });
        menu.addEventListener('mousedown', (e) => e.preventDefault());
        menu.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            executar(btn); fecharMenu();
        });
        menu.addEventListener('contextmenu', (e) => e.preventDefault());
        document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target)) fecharMenu(); });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (!menu.hidden) { fecharMenu(); return; }
                if (arraste && arraste.ativo) { cancelarArraste(); return; }
                if (figura) selecionarFigura(null);
                return;
            }
            if (!figura) return;
            if (e.key !== 'Backspace' && e.key !== 'Delete') return;
            const t = e.target;
            if (t.closest && (t.closest('figcaption') || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
            e.preventDefault();
            removerFigura();
        });

        selecao.querySelectorAll('.img-handle').forEach(h => {
            h.addEventListener('pointerdown', (e) => {
                if (!figura) return;
                e.preventDefault(); e.stopPropagation();
                h.setPointerCapture(e.pointerId);
                const fig = figura;
                const lado = h.dataset.h.indexOf('e') !== -1 ? 1 : -1;
                const fator = fig.dataset.align === 'center' ? 2 : 1;
                const largIni = fig.getBoundingClientRect().width;
                const base = editor.clientWidth;
                const x0 = e.clientX;
                selecao.classList.add('redimensionando');
                const mover = (ev) => {
                    const nova = largIni + (ev.clientX - x0) * lado * fator;
                    let pct = Math.max(12, Math.min(100, nova / base * 100));
                    if (pct > 96) pct = 100;
                    definirLarguraLivre(fig, pct);
                    rotuloSel.textContent = Math.round(pct) + '%';
                    atualizarEstados(); posicionar();
                };
                const fim = () => {
                    h.removeEventListener('pointermove', mover);
                    h.removeEventListener('pointerup', fim);
                    h.removeEventListener('pointercancel', fim);
                    selecao.classList.remove('redimensionando');
                    atualizarEstados();
                };
                h.addEventListener('pointermove', mover);
                h.addEventListener('pointerup', fim);
                h.addEventListener('pointercancel', fim);
            });
        });

        function alvoDeSoltura(x, y) {
            const rect = editor.getBoundingClientRect();
            const filhos = [...editor.children].filter(c => c !== arraste.fig);
            let alvo = null, depois = false;
            for (const c of filhos) {
                const r = c.getBoundingClientRect();
                if (y >= r.top && y <= r.bottom) { alvo = c; depois = y > r.top + r.height / 2; break; }
            }
            if (!alvo && filhos.length) {
                if (y < filhos[0].getBoundingClientRect().top) { alvo = filhos[0]; depois = false; }
                else { alvo = filhos[filhos.length - 1]; depois = true; }
            }
            const zona = x < rect.left + rect.width * 0.33 ? 'left'
                       : x > rect.left + rect.width * 0.67 ? 'right' : 'center';
            return { alvo, depois, zona };
        }

        function atualizarIndicador(x, y) {
            const info = alvoDeSoltura(x, y);
            arraste.info = info;
            if (!info.alvo) { indicador.hidden = true; return; }
            const r = info.alvo.getBoundingClientRect();
            const er = editor.getBoundingClientRect();
            const p = folha.getBoundingClientRect();
            const ox = p.left + folha.clientLeft;
            const oy = p.top + folha.clientTop;
            const topo = (info.depois ? r.bottom : r.top) - oy;
            const larg = info.zona === 'center' ? er.width : er.width * 0.42;
            const esq = info.zona === 'right' ? er.right - larg : er.left;
            indicador.style.top = topo + 'px';
            indicador.style.left = (esq - ox) + 'px';
            indicador.style.width = larg + 'px';
            indicador.querySelector('span').textContent =
                info.zona === 'left' ? 'Esquerda · texto ao redor'
              : info.zona === 'right' ? 'Direita · texto ao redor' : 'Centralizada';
            indicador.hidden = false;
        }

        function iniciarArraste() {
            arraste.ativo = true;
            ignorarClique = true;
            document.body.classList.add('img-arrastando');
            arraste.fig.classList.add('arrastando');
            fantasma = document.createElement('div');
            fantasma.className = 'img-fantasma';
            const im = document.createElement('img');
            im.src = arraste.fig.querySelector('img').src;
            fantasma.appendChild(im);
            document.body.appendChild(fantasma);
        }
        function encerrarArraste() {
            document.body.classList.remove('img-arrastando');
            if (fantasma) { fantasma.remove(); fantasma = null; }
            indicador.hidden = true;
            if (arraste) arraste.fig.classList.remove('arrastando');
            setTimeout(() => { ignorarClique = false; }, 0);
        }
        function cancelarArraste() {
            if (!arraste) return;
            encerrarArraste();
            arraste = null;
        }

        // Mouse: arraste direto pela imagem
        editor.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            const img = e.target.closest('figure.img-bloco > img');
            if (!img) return;
            if (e.pointerType === 'mouse') {
                arraste = { fig: img.parentElement, x: e.clientX, y: e.clientY, ativo: false, info: null };
            } else {
                // Touch: exige long-press (500ms) para iniciar arraste
                longPressIniciado = false;
                const fig = img.parentElement;
                longPressTimer = setTimeout(() => {
                    longPressIniciado = true;
                    arraste = { fig, x: e.clientX, y: e.clientY, ativo: false, info: null };
                    iniciarArraste();
                    if (fantasma) { fantasma.style.left = e.clientX + 'px'; fantasma.style.top = e.clientY + 'px'; }
                    atualizarIndicador(e.clientX, e.clientY);
                    if (navigator.vibrate) navigator.vibrate(15);
                }, 500);
            }
        });
        const cancelarLongPress = () => {
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        };
        editor.addEventListener('pointermove', cancelarLongPress);
        editor.addEventListener('pointerup', cancelarLongPress);
        editor.addEventListener('pointercancel', cancelarLongPress);

        barra.addEventListener('pointerdown', (e) => {
            const grip = e.target.closest('.grip');
            if (!grip || !figura) return;
            e.preventDefault();
            arraste = { fig: figura, x: e.clientX, y: e.clientY, ativo: false, info: null };
            iniciarArraste();
            if (fantasma) { fantasma.style.left = e.clientX + 'px'; fantasma.style.top = e.clientY + 'px'; }
            atualizarIndicador(e.clientX, e.clientY);
        });
        document.addEventListener('pointermove', (e) => {
            if (!arraste) return;
            if (!arraste.ativo) {
                if (Math.hypot(e.clientX - arraste.x, e.clientY - arraste.y) < 6) return;
                iniciarArraste();
            }
            if (fantasma) { fantasma.style.left = e.clientX + 'px'; fantasma.style.top = e.clientY + 'px'; }
            const navH = NAVBAR_H();
            if (e.clientY < navH + 130) window.scrollBy(0, -14);
            else if (e.clientY > window.innerHeight - 90) window.scrollBy(0, 14);
            atualizarIndicador(e.clientX, e.clientY);
        });
        function soltarArraste() {
            if (!arraste) return;
            const a = arraste;
            arraste = null;
            if (!a.ativo) return;
            encerrarArraste();
            const info = a.info;
            if (info && info.alvo) {
                if (info.depois) info.alvo.after(a.fig); else info.alvo.before(a.fig);
                definirAlinhamento(a.fig, info.zona);
                garantirParagrafoFinal();
            }
            selecionarFigura(a.fig);
        }
        document.addEventListener('pointerup', soltarArraste);
        document.addEventListener('pointercancel', cancelarArraste);

        function resetarEditor() {
            $('input-titulo').value = '';
            editor.innerHTML = '';
            selecionarFigura(null);
            arquivoCapaEditor = null;
            rangeSalvo = null;
            atualizarVazio();
            const prev = $('capa-artigo-preview');
            const arr = $('capa-artigo-arrastavel');
            if (prev) prev.hidden = true;
            if (arr) arr.style.backgroundImage = '';
        }
        window.__resetarEditorAtelie = resetarEditor;

        function htmlParaPublicar() {
            const clone = editor.cloneNode(true);
            clone.querySelectorAll('.selecionada, .arrastando').forEach(el => el.classList.remove('selecionada', 'arrastando'));
            clone.querySelectorAll('figcaption').forEach(fc => {
                if (!fc.textContent.trim()) fc.remove();
                else { fc.removeAttribute('contenteditable'); fc.removeAttribute('data-ph'); }
            });
            let temFlutuante = false;
            clone.querySelectorAll('figure.img-bloco').forEach(f => {
                f.removeAttribute('contenteditable');
                f.removeAttribute('draggable');
                const larg = f.style.width || '55%';
                const al = f.dataset.align || 'center';
                let estilo = 'box-sizing:border-box;width:' + larg + ';max-width:100%;';
                if (al === 'left') { estilo += 'float:left;margin:0.4rem 1.6rem 1rem 0;'; temFlutuante = true; }
                else if (al === 'right') { estilo += 'float:right;margin:0.4rem 0 1rem 1.6rem;'; temFlutuante = true; }
                else estilo += 'clear:both;margin:2rem auto;';
                f.setAttribute('style', estilo);
                const img = f.querySelector('img');
                if (img) { img.removeAttribute('draggable'); img.setAttribute('style', 'display:block;width:100%;height:auto;border-radius:6px;'); }
            });
            while (clone.lastElementChild && clone.lastElementChild.tagName === 'P' &&
                   !clone.lastElementChild.textContent.trim() &&
                   !clone.lastElementChild.querySelector('img,figure')) {
                clone.lastElementChild.remove();
            }
            if (temFlutuante) clone.insertAdjacentHTML('beforeend', '<div style="clear:both"></div>');
            return clone.innerHTML.trim();
        }

        $('btn-publicar-atelie').addEventListener('click', async () => {
            const btn = $('btn-publicar-atelie');
            const titulo = $('input-titulo').value.trim();
            const categoria = $('input-categoria-artigo').value;
            if (!titulo) return avisar('Adicione um título ao seu conteúdo.', 'erro');
            if (editor.textContent.trim() === '' && !editor.querySelector('img')) return avisar('Escreva algo antes de publicar!', 'erro');
            if (btn.disabled) return;
            btn.disabled = true; btn.textContent = 'Publicando...';
            try {
                let capaUrl = null;
                if (arquivoCapaEditor) {
                    const path = usuarioLogado.id + '/capa_post_' + Date.now() + '.jpg';
                    const up = await db.storage.from('avatars').upload(path, arquivoCapaEditor, { contentType: arquivoCapaEditor.type });
                    if (!up.error) capaUrl = db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
                }
                const { error } = await db.from('posts').insert([{
                    author_id: usuarioLogado.id, title: titulo,
                    content: htmlParaPublicar(), cover_url: capaUrl, category: categoria
                }]);
                if (error) throw error;
                avisar('Conteúdo publicado com sucesso no seu canal!');
                resetarEditor();
                document.querySelector('[data-aba="canal"]').click();
                await carregarCanal();
            } catch (err) {
                console.error(err);
                avisar('Erro ao publicar.', 'erro');
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