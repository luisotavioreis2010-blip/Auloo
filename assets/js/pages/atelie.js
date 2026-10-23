/* ==============================================================
   ATELIE.JS — v57
   --------------------------------------------------------------
   Correções estruturais em relação à v55:

   - TRAVA DE SCROLL NO BODY (não mais no HTML). Alinhado com o
     CSS v57, que faz o `body` ser o contêiner de scroll no mobile.
     `abrirGaveta()` → body.classList.add('atelie-travado')
     `fecharGaveta()` → body.classList.remove('atelie-travado')

   - ENQUADRADOR UNIVERSAL:
     * pointerdown / pointermove / pointerup (Pointer Events)
     * touchstart / touchmove / touchend (fallback mobile)
     * mousedown / mousemove / mouseup (fallback desktop antigo)
     * setPointerCapture ANTES de qualquer preventDefault
     * SEM preventDefault no pointerdown (só no pointermove)
     → Funciona em qualquer navegador, mobile ou desktop.

   - URL.revokeObjectURL em avatar e capa (sem vazamento).

   - DOMParser no carregarCanal (não executa HTML do banco).

   - Modal de confirmação próprio (substitui confirm() nativo).

   - execComando() centraliza execCommand.

   - setModoRedacao() sincroniza body + main.

   - aguardarSupabase() com tela de erro visual.

   - Persistência de avatar_position / avatar_zoom.
   ============================================================== */
(function () {
    'use strict';

    // ============================================================
    // ESTADO GLOBAL
    // ============================================================
    const $ = (id) => document.getElementById(id);
    let db = null;
    let usuarioLogado = null;
    let atelieAtual = null;

    let fileAvatar = null;
    let fileCapa = null;
    let arquivoCapaEditor = null;
    let avatarBlobUrl = null;
    let capaBlobUrl = null;
    let avatarEditado = false;

    let avatarFr = null;
    let capaFr = null;

    const MAX_MB = 5;

    // ============================================================
    // UTILITÁRIOS
    // ============================================================
    const gavetaPermanente = () =>
        window.matchMedia('(min-width: 1367px)').matches ||
        (window.matchMedia('(min-width: 1025px)').matches &&
            document.body.classList.contains('atelie-modo-redacao'));

    function aguardarSupabase() {
        return new Promise((resolve) => {
            let tentativas = 0;
            const intervalo = setInterval(() => {
                if (window.supabaseClient) {
                    clearInterval(intervalo);
                    resolve(window.supabaseClient);
                    return;
                }
                if (++tentativas >= 30) {
                    clearInterval(intervalo);
                    resolve(null);
                }
            }, 200);
        });
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

    function estadoBotao(btn, ocupado, textoOcupado) {
        const alvo = btn.querySelector('.btn-rotulo') || btn;
        if (!btn.dataset.rotulo) btn.dataset.rotulo = alvo.textContent;
        btn.disabled = ocupado;
        btn.classList.toggle('carregando', ocupado);
        alvo.textContent = ocupado ? textoOcupado : btn.dataset.rotulo;
    }

    function validarImagem(file) {
        if (!file) return false;
        if (!/^image\//.test(file.type)) {
            avisar('Escolha um arquivo de imagem.', 'erro');
            return false;
        }
        if (file.size > MAX_MB * 1024 * 1024) {
            avisar('A imagem deve ter no máximo ' + MAX_MB + ' MB.', 'erro');
            return false;
        }
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
        } catch (_) { return ''; }
    }

    // Modal de confirmação (substitui confirm())
    function confirmar(titulo, mensagem) {
        return new Promise((resolve) => {
            const modal = $('modal-confirmar');
            $('modal-confirmar-titulo').textContent = titulo;
            $('modal-confirmar-mensagem').textContent = mensagem;
            modal.hidden = false;

            const fechar = (resultado) => {
                modal.hidden = true;
                $('modal-confirmar-ok').removeEventListener('click', onOk);
                $('modal-confirmar-cancelar').removeEventListener('click', onCancelar);
                modal.removeEventListener('click', onOverlay);
                document.removeEventListener('keydown', onTecla);
                resolve(resultado);
            };
            const onOk = () => fechar(true);
            const onCancelar = () => fechar(false);
            const onOverlay = (e) => { if (e.target === modal) fechar(false); };
            const onTecla = (e) => {
                if (e.key === 'Escape') fechar(false);
                else if (e.key === 'Enter') fechar(true);
            };

            $('modal-confirmar-ok').addEventListener('click', onOk);
            $('modal-confirmar-cancelar').addEventListener('click', onCancelar);
            modal.addEventListener('click', onOverlay);
            document.addEventListener('keydown', onTecla);
            $('modal-confirmar-ok').focus();
        });
    }

    // Helper para execCommand
    function execComando(cmd, value) {
        try {
            document.execCommand(cmd, false, value === undefined ? null : value);
        } catch (_) { /* silent */ }
    }

    // Sincroniza body + main no modo redação
    function setModoRedacao(ativo) {
        const main = $('atelie-main');
        if (!main) return;
        main.classList.toggle('modo-redacao', ativo);
        document.body.classList.toggle('atelie-modo-redacao', ativo);
    }

    // ============================================================
    // ENQUADRADOR UNIVERSAL (pointer + touch + mouse)
    // ============================================================
    function criarEnquadrador({ container, camada, slider, linhaZoom, aoImagem, aoMudar }) {
        const est = { x: 50, y: 50, zoom: 1, nw: 0, nh: 0, pronto: false };
        const ponteiros = new Map();
        let arrastando = false;
        let ix = 0, iy = 0, x0 = 50, y0 = 50;
        let dist0 = 0, zoom0 = 1;
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

        function iniciar(x, y) {
            if (!est.pronto) return false;
            ix = x; iy = y;
            x0 = est.x; y0 = est.y;
            arrastando = true;
            return true;
        }
        function continuar(x, y) {
            if (!arrastando) return;
            mover(x - ix, y - iy);
        }
        function finalizar() {
            arrastando = false;
        }

        // ---- POINTER EVENTS (desktop + mobile moderno) ----
        container.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            try { container.setPointerCapture(e.pointerId); } catch (_) {}
            ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (ponteiros.size === 1) iniciar(e.clientX, e.clientY);
            else if (ponteiros.size === 2) {
                arrastando = false;
                const [a, b] = [...ponteiros.values()];
                dist0 = Math.hypot(a.x - b.x, a.y - b.y);
                zoom0 = est.zoom;
            }
        }, { passive: true });

        container.addEventListener('pointermove', (e) => {
            if (!ponteiros.has(e.pointerId)) return;
            ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (ponteiros.size === 2 && dist0 > 0) {
                const [a, b] = [...ponteiros.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                definirZoom(zoom0 * (d / dist0));
                return;
            }
            continuar(e.clientX, e.clientY);
        }, { passive: true });

        const soltar = (e) => {
            ponteiros.delete(e.pointerId);
            if (ponteiros.size === 1) {
                const [p] = [...ponteiros.values()];
                iniciar(p.x, p.y);
            } else if (ponteiros.size === 0) {
                dist0 = 0;
                finalizar();
            }
        };
        container.addEventListener('pointerup', soltar, { passive: true });
        container.addEventListener('pointercancel', soltar, { passive: true });

        // ---- TOUCH EVENTS (fallback universal mobile) ----
        container.addEventListener('touchstart', (e) => {
            if (!est.pronto) return;
            if (e.touches.length === 1) {
                iniciar(e.touches[0].clientX, e.touches[0].clientY);
            } else if (e.touches.length === 2) {
                arrastando = false;
                dist0 = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                zoom0 = est.zoom;
            }
        }, { passive: true });

        container.addEventListener('touchmove', (e) => {
            if (!est.pronto) return;
            if (e.touches.length === 2 && dist0 > 0) {
                const d = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY
                );
                definirZoom(zoom0 * (d / dist0));
                if (e.cancelable) e.preventDefault();
                return;
            }
            if (arrastando && e.touches.length === 1) {
                if (e.cancelable) e.preventDefault();
                continuar(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { passive: false });

        container.addEventListener('touchend', () => {
            if (dist0) { dist0 = 0; return; }
            finalizar();
        }, { passive: true });
        container.addEventListener('touchcancel', () => {
            finalizar();
            dist0 = 0;
        }, { passive: true });

        // ---- MOUSE EVENTS (fallback desktop antigo) ----
        container.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (e.pointerType) return; // se Pointer Events funcionam, ignora
            iniciar(e.clientX, e.clientY);
        });
        document.addEventListener('mousemove', (e) => {
            if (!arrastando) return;
            continuar(e.clientX, e.clientY);
        });
        document.addEventListener('mouseup', () => {
            if (arrastando) finalizar();
        });

        // ---- WHEEL (zoom com Ctrl/⌘) ----
        container.addEventListener('wheel', (e) => {
            if (!est.pronto || !(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            definirZoom(est.zoom + (e.deltaY < 0 ? 0.1 : -0.1));
        }, { passive: false });

        if (slider) slider.addEventListener('input', () => definirZoom(parseFloat(slider.value)));

        return {
            carregar(url, ini) {
                est.pronto = false;
                est.x = ini && ini.x != null ? ini.x : 50;
                est.y = ini && ini.y != null ? ini.y : 50;
                est.zoom = ini && ini.zoom ? ini.zoom : 1;
                camada.style.backgroundImage = 'url("' + String(url).replace(/"/g, '%22') + '")';
                aplicar();
                if (linhaZoom) linhaZoom.hidden = false;
                if (aoImagem) aoImagem(true);
                const im = new Image();
                im.onload = () => {
                    est.nw = im.naturalWidth;
                    est.nh = im.naturalHeight;
                    est.pronto = true;
                };
                im.onerror = () => { est.pronto = false; };
                im.src = url;
            },
            limpar() {
                est.pronto = false;
                est.x = 50;
                est.y = 50;
                est.zoom = 1;
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
    // ABRIR / FECHAR GAVETA — trava de scroll no BODY (v57)
    // ============================================================
    let scrollYGuardado = 0;

    function abrirGaveta() {
        if (gavetaPermanente()) return;
        scrollYGuardado = window.scrollY || window.pageYOffset || 0;
        document.body.classList.add('atelie-travado');
        $('gaveta-config').classList.add('ativa');
        $('overlay-config').classList.add('ativa');
        document.body.classList.add('atelie-gaveta-aberta');
    }

    function fecharGaveta(forcar) {
        if (forcar !== true && gavetaPermanente()) return;
        const estavaTravado = document.body.classList.contains('atelie-travado');
        $('gaveta-config').classList.remove('ativa');
        $('overlay-config').classList.remove('ativa');
        document.body.classList.remove('atelie-gaveta-aberta');
        document.body.classList.remove('atelie-travado');
        // Só restaura a posição se a gaveta realmente estava travando o scroll
        if (estavaTravado && Math.abs((window.scrollY || 0) - scrollYGuardado) > 1) {
            window.scrollTo(0, scrollYGuardado);
        }
    }

    // Se a página voltar do cache do navegador (botão "voltar") com a trava ligada, destrava
    window.addEventListener('pageshow', () => fecharGaveta(true));

    // ============================================================
    // INÍCIO
    // ============================================================
    async function iniciar() {
        db = await aguardarSupabase();
        if (!db) {
            mostrarErroConexao();
            return;
        }
        let session;
        try {
            const res = await db.auth.getSession();
            session = res.data && res.data.session;
        } catch (err) {
            console.error('Erro ao obter sessão:', err);
            mostrarErroConexao();
            return;
        }
        if (!session) {
            window.location.href = 'login.html';
            return;
        }
        usuarioLogado = session.user;

        configurarGavetaConfig();
        configurarDropdown();
        await verificarAtelie();
        configurarCriacao();
        configurarAbas();
        configurarEditorEmbutido();
    }

    function mostrarErroConexao() {
        const div = document.createElement('div');
        div.className = 'atelie-erro-conexao';
        div.innerHTML =
            '<h2>Não foi possível conectar</h2>' +
            '<p>Verifique sua conexão com a internet e recarregue a página.</p>' +
            '<button type="button" class="btn-primario" id="btn-recarregar-erro">Recarregar</button>';
        document.body.appendChild(div);
        const btn = $('btn-recarregar-erro');
        if (btn) btn.addEventListener('click', () => window.location.reload());
    }

    async function verificarAtelie() {
        const { data: atelie, error } = await db
            .from('ateliers')
            .select('*')
            .eq('owner_id', usuarioLogado.id)
            .maybeSingle();

        if (error) {
            console.error('Erro ao buscar ateliê:', error);
            avisar('Erro ao carregar o ateliê.', 'erro');
            return;
        }

        if (!atelie) {
            $('atelie-vazio').hidden = false;
            $('atelie-conteudo').hidden = true;
            $('atelie-abas').hidden = true;
            $('btn-criar-atelie').addEventListener('click', () => {
                $('modal-criar-atelie').hidden = false;
            });
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
    // CANAL (DOMParser — sem executar HTML do banco)
    // ============================================================
    async function carregarCanal() {
        const lista = $('canal-lista');
        const vazio = $('canal-vazio');
        if (!lista) return;
        lista.innerHTML =
            '<div class="canal-carregando">' +
                '<div class="canal-skeleton"></div>' +
                '<div class="canal-skeleton"></div>' +
            '</div>';
        vazio.hidden = true;

        const { data: posts, error } = await db.from('posts')
            .select('id, title, content, cover_url, category, created_at')
            .eq('author_id', usuarioLogado.id)
            .order('created_at', { ascending: false });

        lista.innerHTML = '';
        if (error || !posts || posts.length === 0) {
            vazio.hidden = false;
            return;
        }

        posts.forEach(post => {
            const card = document.createElement('article');
            card.className = 'canal-post';
            card.dataset.id = post.id;
            const capa = post.cover_url
                ? '<div class="canal-post-capa"><img src="' + escaparHtml(post.cover_url) + '" loading="lazy" referrerpolicy="no-referrer"></div>'
                : '';

            // DOMParser: extrai texto SEM executar HTML/onerror do banco
            let texto = '';
            try {
                const doc = new DOMParser().parseFromString(post.content || '', 'text/html');
                doc.querySelectorAll('figure, img, figcaption, style, script, iframe, object, embed')
                    .forEach(el => el.remove());
                texto = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
            } catch (_) { texto = ''; }
            const trecho = texto.length > 220 ? texto.slice(0, 220).trim() + '…' : texto;

            card.innerHTML = capa +
                '<div class="canal-post-corpo">' +
                    '<div class="canal-post-meta">' +
                        (post.category
                            ? '<span class="canal-post-categoria">' + escaparHtml(post.category) + '</span>'
                            : '') +
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

        lista.querySelectorAll('[data-excluir]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const ok = await confirmar(
                    'Excluir publicação',
                    'Essa ação não pode ser desfeita. Deseja continuar?'
                );
                if (!ok) return;
                const { error } = await db.from('posts').delete().eq('id', btn.dataset.excluir);
                if (error) return avisar('Não foi possível excluir.', 'erro');
                avisar('Publicação excluída.');
                carregarCanal();
            });
        });

        lista.querySelectorAll('[data-ler]').forEach(btn => {
            btn.addEventListener('click', () => {
                window.location.href = 'post.html?id=' + encodeURIComponent(btn.dataset.ler);
            });
        });
    }

    // ============================================================
    // RENDERIZAÇÃO DO ATELIÊ
    // ============================================================
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

        // Capa
        if (capaFr) {
            if (atelie.cover_url) {
                const [x, y] = parsePos(atelie.cover_position);
                capaFr.carregar(atelie.cover_url, {
                    x, y,
                    zoom: parseFloat(atelie.cover_zoom) || 1
                });
            } else capaFr.limpar();
        }
        // Avatar
        if (avatarFr) {
            if (atelie.avatar_url) {
                avatarBlobUrl = null;
                const [ax, ay] = parsePos(atelie.avatar_position);
                avatarFr.carregar(atelie.avatar_url, {
                    x: ax, y: ay,
                    zoom: parseFloat(atelie.avatar_zoom) || 1
                });
            } else {
                avatarBlobUrl = null;
                avatarFr.limpar();
            }
        }
        avatarEditado = false;
    }

    // ============================================================
    // CRIAÇÃO DO ATELIÊ
    // ============================================================
    function configurarCriacao() {
        const modal = $('modal-criar-atelie');
        if (!modal) return;
        $('btn-fechar-modal').addEventListener('click', () => modal.hidden = true);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.hidden = true;
        });

        $('form-criar-atelie').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = $('btn-salvar-atelie');
            const nome = $('input-nome-atelie').value.trim();
            const bio = $('input-bio-atelie').value.trim();
            if (!nome) { avisar('O Nome do Ateliê é obrigatório.', 'erro'); return; }
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
                    cover_zoom: 1,
                    avatar_position: '50% 50%',
                    avatar_zoom: 1
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
                btn.disabled = false;
                btn.textContent = 'Criar Ateliê';
            }
        });
    }

    // ============================================================
    // GAVETA DE CONFIGURAÇÃO
    // ============================================================
    function configurarGavetaConfig() {
        // --- Enquadrador do avatar ---
        avatarFr = criarEnquadrador({
            container: $('avatar-preview-container'),
            camada: $('avatar-preview-arrastavel'),
            slider: $('avatar-zoom'),
            linhaZoom: $('avatar-zoom-linha'),
            aoImagem: (tem) => {
                const cam = $('avatar-preview-arrastavel');
                cam.classList.toggle('tem-imagem', tem);
                if (tem) {
                    const svg = cam.querySelector('svg');
                    if (svg) svg.remove();
                }
            },
            aoMudar: () => { avatarEditado = true; }
        });

        // --- Enquadrador da capa ---
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

        // --- Controles de abertura/fechamento ---
        $('btn-configurar-atelie').addEventListener('click', () => abrirGaveta());
        const btnOpcoesMobile = $('btn-opcoes-mobile');
        if (btnOpcoesMobile) btnOpcoesMobile.addEventListener('click', () => abrirGaveta());
        $('btn-fechar-config').addEventListener('click', () => fecharGaveta());
        $('btn-fechar-config-redacao').addEventListener('click', () => fecharGaveta());
        $('overlay-config').addEventListener('click', () => fecharGaveta());
        window.addEventListener('resize', () => {
            if (gavetaPermanente()) fecharGaveta(true);
        });

        // --- Upload de avatar ---
        const inputAvatar = $('input-config-avatar');
        $('btn-upload-avatar').addEventListener('click', () => inputAvatar.click());
        inputAvatar.addEventListener('change', () => {
            const file = inputAvatar.files[0];
            inputAvatar.value = '';
            if (!validarImagem(file)) return;
            if (avatarBlobUrl) {
                URL.revokeObjectURL(avatarBlobUrl);
                avatarBlobUrl = null;
            }
            fileAvatar = file;
            avatarBlobUrl = URL.createObjectURL(file);
            avatarFr.carregar(avatarBlobUrl);
            avatarEditado = true;
        });

        // --- Upload de capa (revoga URL antiga) ---
        const inputCapa = $('input-config-capa');
        $('btn-upload-capa').addEventListener('click', () => inputCapa.click());
        inputCapa.addEventListener('change', () => {
            const file = inputCapa.files[0];
            inputCapa.value = '';
            if (!validarImagem(file)) return;
            if (capaBlobUrl) {
                URL.revokeObjectURL(capaBlobUrl);
                capaBlobUrl = null;
            }
            fileCapa = file;
            capaBlobUrl = URL.createObjectURL(file);
            capaFr.carregar(capaBlobUrl);
        });

        // --- Capa do artigo (redação) ---
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

        // --- Descartar rascunho ---
        $('btn-descartar-rascunho').addEventListener('click', async () => {
            const ok = await confirmar(
                'Descartar rascunho',
                'Tem certeza que deseja descartar este rascunho?'
            );
            if (ok) {
                if (window.__resetarEditorAtelie) window.__resetarEditorAtelie();
                document.querySelector('[data-aba="canal"]').click();
                fecharGaveta();
            }
        });

        // --- Gera avatar recortado via canvas ---
        async function gerarAvatarRecortado() {
            const src = fileAvatar ? avatarBlobUrl : null;
            if (!src) return null;
            const img = await new Promise((ok, falha) => {
                const im = new Image();
                im.onload = () => ok(im);
                im.onerror = falha;
                im.src = src;
            });

            const est = avatarFr.estado();
            const cs = $('avatar-preview-container').clientWidth || 88;
            const s = Math.max(cs / img.naturalWidth, cs / img.naturalHeight);
            const lado = cs / (est.zoom * s);
            const sx = est.x / 100 * Math.max(0, img.naturalWidth - lado);
            const sy = est.y / 100 * Math.max(0, img.naturalHeight - lado);

            const SAIDA = 512;
            const canvas = document.createElement('canvas');
            canvas.width = SAIDA;
            canvas.height = SAIDA;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, SAIDA, SAIDA);
            ctx.drawImage(img, sx, sy, lado, lado, 0, 0, SAIDA, SAIDA);
            return new Promise((ok) => canvas.toBlob((b) => ok(b), 'image/jpeg', 0.92));
        }

        // --- Submit do form de configuração ---
        $('form-config-atelie').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = $('btn-salvar-config');
            estadoBotao(btn, true, 'Salvando...');
            const nome = $('input-config-nome').value.trim();
            const bio = $('input-config-bio').value.trim();
            let newAvatarUrl = atelieAtual.avatar_url;
            let newCoverUrl = atelieAtual.cover_url;
            try {
                // Avatar
                if (avatarEditado && avatarFr.temImagem()) {
                    let blob = null;
                    try { blob = await gerarAvatarRecortado(); } catch (_) { blob = null; }
                    const corpo = blob || fileAvatar;
                    if (corpo) {
                        const path = usuarioLogado.id + '/atelie-avatar-' + Date.now() + '.jpg';
                        const up = await db.storage.from('avatars').upload(path, corpo, {
                            contentType: blob ? 'image/jpeg' : corpo.type
                        });
                        if (up.error) throw up.error;
                        newAvatarUrl = db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
                    }
                }
                // Capa
                if (fileCapa) {
                    const path = usuarioLogado.id + '/atelie-capa-' + Date.now() + '.jpg';
                    const up = await db.storage.from('avatars').upload(path, fileCapa, {
                        contentType: fileCapa.type
                    });
                    if (up.error) throw up.error;
                    newCoverUrl = db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
                }

                const c = capaFr.estado();
                const a = avatarFr.estado();
                const { data, error } = await db.from('ateliers').update({
                    name: nome,
                    description: bio,
                    avatar_url: newAvatarUrl,
                    cover_url: newCoverUrl,
                    cover_position: c.x.toFixed(1) + '% ' + c.y.toFixed(1) + '%',
                    cover_zoom: Number(c.zoom.toFixed(2)),
                    avatar_position: a.x.toFixed(1) + '% ' + a.y.toFixed(1) + '%',
                    avatar_zoom: Number(a.zoom.toFixed(2))
                }).eq('id', atelieAtual.id).select().single();
                if (error) throw error;

                atelieAtual = data;
                fileAvatar = null;
                fileCapa = null;
                if (avatarBlobUrl) { URL.revokeObjectURL(avatarBlobUrl); avatarBlobUrl = null; }
                if (capaBlobUrl) { URL.revokeObjectURL(capaBlobUrl); capaBlobUrl = null; }

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
    // DROPDOWN DE CATEGORIA
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
        gatilho.addEventListener('click', () => {
            if (raiz.classList.contains('aberto')) fechar();
            else abrir();
        });
        gatilho.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                abrir();
            }
        });
        itens.forEach((li, idx) => {
            li.addEventListener('click', () => escolher(li));
            li.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    escolher(li);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    fechar(true);
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    itens[(idx + 1) % itens.length].focus();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    itens[(idx - 1 + itens.length) % itens.length].focus();
                } else if (e.key === 'Home') {
                    e.preventDefault();
                    itens[0].focus();
                } else if (e.key === 'End') {
                    e.preventDefault();
                    itens[itens.length - 1].focus();
                } else if (e.key === 'Tab') {
                    fechar();
                }
            });
        });
        document.addEventListener('pointerdown', (e) => {
            if (!raiz.contains(e.target)) fechar();
        });
    }

    // ============================================================
    // ABAS
    // ============================================================
    function configurarAbas() {
        const botoes = document.querySelectorAll('.aba-btn');
        const painelCanal = $('config-canal');
        const painelRedacao = $('config-redacao');

        botoes.forEach(btn => {
            btn.addEventListener('click', () => {
                fecharGaveta(true);
                window.scrollTo({ top: 0 });
                botoes.forEach(b => b.classList.remove('ativa'));
                btn.classList.add('ativa');
                const alvo = btn.getAttribute('data-aba');

                setModoRedacao(false);
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
                    setModoRedacao(true);
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
                                editor.textContent.trim() ||
                                editor.querySelector('img');
            if (!temConteudo) {
                if (window.__resetarEditorAtelie) window.__resetarEditorAtelie();
                document.querySelector('[data-aba="canal"]').click();
                return;
            }
            const ok = await confirmar(
                'Descartar texto',
                'Tem certeza que deseja apagar o que escreveu?'
            );
            if (ok) {
                if (window.__resetarEditorAtelie) window.__resetarEditorAtelie();
                document.querySelector('[data-aba="canal"]').click();
            }
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

        execComando('defaultParagraphSeparator', 'p');

        function atualizarVazio() {
            const texto = editor.textContent.trim();
            const vazio = texto === '' && !editor.querySelector('img');
            editor.dataset.vazio = vazio ? 'true' : 'false';
            const palavras = texto ? texto.split(/\s+/).length : 0;
            const minutos = palavras === 0 ? 0 : Math.max(1, Math.round(palavras / 200));
            $('contador-palavras').textContent = palavras + (palavras === 1 ? ' palavra' : ' palavras');
            $('tempo-leitura').textContent = minutos + ' min de leitura';
        }
        editor.addEventListener('input', () => {
            atualizarVazio();
            posicionar();
        });
        atualizarVazio();

        document.addEventListener('selectionchange', () => {
            const sel = window.getSelection();
            if (sel.rangeCount && editor.contains(sel.anchorNode)) {
                rangeSalvo = sel.getRangeAt(0).cloneRange();
            }
        });

        // Toolbar
        document.querySelectorAll('.editor-toolbar button[data-cmd]').forEach(btn => {
            btn.addEventListener('mousedown', (e) => e.preventDefault());
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const cmd = btn.getAttribute('data-cmd');
                let value = btn.getAttribute('data-value') || null;
                if (cmd === 'formatBlock' &&
                    document.queryCommandValue('formatBlock').toLowerCase() === value) {
                    value = 'p';
                }
                editor.focus();
                execComando(cmd, value);
                atualizarVazio();
            });
        });

        // Colar apenas texto puro
        editor.addEventListener('paste', (e) => {
            e.preventDefault();
            const texto = (e.clipboardData || window.clipboardData).getData('text/plain');
            execComando('insertText', texto);
        });
        editor.addEventListener('dragstart', (e) => {
            if (e.target.tagName === 'IMG') e.preventDefault();
        });

        function normalizarBlocos() {
            let atual = null;
            [...editor.childNodes].forEach(n => {
                if (n.nodeType === 1 && BLOCOS.has(n.tagName)) {
                    atual = null;
                    return;
                }
                if (n.nodeType === 3 && !n.textContent.trim() && !atual) {
                    n.remove();
                    return;
                }
                if (!atual) {
                    atual = document.createElement('p');
                    n.before(atual);
                }
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
            img.src = url;
            img.alt = '';
            img.loading = 'lazy';
            img.draggable = false;
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
                no = rangeSalvo.startContainer;
                off = rangeSalvo.startOffset;
            }
            normalizarBlocos();
            const topo = no && editor.contains(no) ? blocoTopo(no) : null;
            if (topo && topo.tagName === 'P') {
                const vazio = !topo.textContent.trim() && !topo.querySelector('img');
                if (vazio) {
                    topo.replaceWith(fig);
                } else {
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
            } else if (topo) {
                topo.after(fig);
            } else {
                editor.appendChild(fig);
            }
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
        btnImg.addEventListener('mousedown', (e) => e.preventDefault());
        btnImg.addEventListener('click', (e) => {
            e.preventDefault();
            inputImg.click();
        });
        inputImg.addEventListener('change', async () => {
            const file = inputImg.files[0];
            inputImg.value = '';
            if (!file) return;
            if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
                avisar('Use uma imagem JPG, PNG, WEBP ou GIF.', 'erro');
                return;
            }
            if (file.size > MAX_MB * 1024 * 1024) {
                avisar('A imagem deve ter no máximo ' + MAX_MB + ' MB.', 'erro');
                return;
            }
            btnImg.classList.add('carregando');
            btnImg.disabled = true;
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
            fig.dataset.size = preset || 'custom';
            fig.style.width = (preset ? TAMANHOS[preset] : pct).toFixed(1) + '%';
            if (pct >= 99) fig.dataset.align = 'center';
        }
        function definirAlinhamento(fig, al) {
            fig.dataset.align = al;
            if (al !== 'center' && parseFloat(fig.style.width) > 85) {
                definirTamanho(fig, 'm');
            }
            fig.dataset.align = al;
        }
        function atualizarEstados() {
            if (!figura) return;
            [barra, menu].forEach(c => {
                c.querySelectorAll('[data-tam]').forEach(b => {
                    b.classList.toggle('ativo', b.dataset.tam === figura.dataset.size);
                });
                c.querySelectorAll('[data-alin]').forEach(b => {
                    b.classList.toggle('ativo', b.dataset.alin === figura.dataset.align);
                });
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

        editor.addEventListener('click', (e) => {
            if (ignorarClique) return;
            const fig = e.target.closest('figure.img-bloco');
            selecionarFigura(fig);
            if (fig && !e.target.closest('figcaption')) {
                window.getSelection().removeAllRanges();
            }
        });
        document.addEventListener('click', (e) => {
            if (ignorarClique) return;
            if (!e.target.closest('#input-conteudo') &&
                !e.target.closest('#img-flutuante') &&
                !e.target.closest('#img-selecao') &&
                !e.target.closest('#img-menu')) {
                selecionarFigura(null);
            }
        });
        window.addEventListener('resize', posicionar);
        window.addEventListener('scroll', () => {
            posicionar();
            fecharMenu();
        }, true);
        if ('ResizeObserver' in window) {
            new ResizeObserver(() => posicionar()).observe(editor);
        }

        function removerFigura() {
            if (!figura) return;
            const f = figura;
            selecionarFigura(null);
            f.remove();
            atualizarVazio();
        }
        function moverPosicao(dir) {
            if (!figura) return;
            const alvo = dir < 0 ? figura.previousElementSibling : figura.nextElementSibling;
            if (!alvo) return;
            if (dir < 0) alvo.before(figura);
            else alvo.after(figura);
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
            atualizarEstados();
            posicionar();
        }

        barra.addEventListener('mousedown', (e) => {
            if (!e.target.closest('.grip')) e.preventDefault();
        });
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
            executar(btn);
            fecharMenu();
        });
        menu.addEventListener('contextmenu', (e) => e.preventDefault());
        document.addEventListener('pointerdown', (e) => {
            if (!menu.hidden && !menu.contains(e.target)) fecharMenu();
        });

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

        // Redimensionamento via handles
        selecao.querySelectorAll('.img-handle').forEach(h => {
            h.addEventListener('pointerdown', (e) => {
                if (!figura) return;
                e.preventDefault();
                e.stopPropagation();
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
                    atualizarEstados();
                    posicionar();
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
                if (y >= r.top && y <= r.bottom) {
                    alvo = c;
                    depois = y > r.top + r.height / 2;
                    break;
                }
            }
            if (!alvo && filhos.length) {
                if (y < filhos[0].getBoundingClientRect().top) {
                    alvo = filhos[0];
                    depois = false;
                } else {
                    alvo = filhos[filhos.length - 1];
                    depois = true;
                }
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

        editor.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || e.pointerType === 'touch') return;
            const img = e.target.closest('figure.img-bloco > img');
            if (!img) return;
            arraste = { fig: img.parentElement, x: e.clientX, y: e.clientY, ativo: false, info: null };
        });
        barra.addEventListener('pointerdown', (e) => {
            const grip = e.target.closest('.grip');
            if (!grip || !figura) return;
            e.preventDefault();
            arraste = { fig: figura, x: e.clientX, y: e.clientY, ativo: false, info: null };
            iniciarArraste();
            if (fantasma) {
                fantasma.style.left = e.clientX + 'px';
                fantasma.style.top = e.clientY + 'px';
            }
            atualizarIndicador(e.clientX, e.clientY);
        });
        document.addEventListener('pointermove', (e) => {
            if (!arraste) return;
            if (!arraste.ativo) {
                if (Math.hypot(e.clientX - arraste.x, e.clientY - arraste.y) < 6) return;
                iniciarArraste();
            }
            if (fantasma) {
                fantasma.style.left = e.clientX + 'px';
                fantasma.style.top = e.clientY + 'px';
            }
            const navH = (document.querySelector('.navbar') || {}).offsetHeight || 68;
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
                if (info.depois) info.alvo.after(a.fig);
                else info.alvo.before(a.fig);
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
            clone.querySelectorAll('.selecionada, .arrastando').forEach(el => {
                el.classList.remove('selecionada', 'arrastando');
            });
            clone.querySelectorAll('figcaption').forEach(fc => {
                if (!fc.textContent.trim()) fc.remove();
                else {
                    fc.removeAttribute('contenteditable');
                    fc.removeAttribute('data-ph');
                }
            });
            let temFlutuante = false;
            clone.querySelectorAll('figure.img-bloco').forEach(f => {
                f.removeAttribute('contenteditable');
                f.removeAttribute('draggable');
                const larg = f.style.width || '55%';
                const al = f.dataset.align || 'center';
                let estilo = 'box-sizing:border-box;width:' + larg + ';max-width:100%;';
                if (al === 'left') {
                    estilo += 'float:left;margin:0.4rem 1.6rem 1rem 0;';
                    temFlutuante = true;
                } else if (al === 'right') {
                    estilo += 'float:right;margin:0.4rem 0 1rem 1.6rem;';
                    temFlutuante = true;
                } else {
                    estilo += 'clear:both;margin:2rem auto;';
                }
                f.setAttribute('style', estilo);
                const img = f.querySelector('img');
                if (img) {
                    img.removeAttribute('draggable');
                    img.setAttribute('style', 'display:block;width:100%;height:auto;border-radius:6px;');
                }
            });
            while (clone.lastElementChild &&
                   clone.lastElementChild.tagName === 'P' &&
                   !clone.lastElementChild.textContent.trim() &&
                   !clone.lastElementChild.querySelector('img,figure')) {
                clone.lastElementChild.remove();
            }
            if (temFlutuante) {
                clone.insertAdjacentHTML('beforeend', '<div style="clear:both"></div>');
            }
            return clone.innerHTML.trim();
        }

        $('btn-publicar-atelie').addEventListener('click', async () => {
            const btn = $('btn-publicar-atelie');
            const titulo = $('input-titulo').value.trim();
            const categoria = $('input-categoria-artigo').value;
            if (!titulo) { avisar('Adicione um título ao seu conteúdo.', 'erro'); return; }
            if (editor.textContent.trim() === '' && !editor.querySelector('img')) {
                avisar('Escreva algo antes de publicar!', 'erro');
                return;
            }
            btn.disabled = true;
            btn.textContent = 'Publicando...';
            try {
                let capaUrl = null;
                if (arquivoCapaEditor) {
                    const path = usuarioLogado.id + '/capa_post_' + Date.now() + '.jpg';
                    const up = await db.storage.from('avatars').upload(path, arquivoCapaEditor, {
                        contentType: arquivoCapaEditor.type
                    });
                    if (!up.error) {
                        capaUrl = db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
                    }
                }
                const { error } = await db.from('posts').insert([{
                    author_id: usuarioLogado.id,
                    title: titulo,
                    content: htmlParaPublicar(),
                    cover_url: capaUrl,
                    category: categoria
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
                btn.disabled = false;
                btn.textContent = 'Publicar';
            }
        });
    }

    // ============================================================
    // BOOT
    // ============================================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();