/* ==============================================================
   ATELIE.JS — v55
   --------------------------------------------------------------
   ÍNDICE
    1. Constantes e estado
    2. Utilitários
    3. TravaScroll  (trava o fundo; várias camadas sem conflito)
    4. Gaveta       (abrir / fechar / trocar de painel)
    5. Enquadrador  (arrastar + zoom de avatar e capa)
    6. Dados        (upload e helpers do Supabase)
    7. Ateliê       (card, painel de configuração, criação, salvar)
    8. Canal        (lista de publicações)
    9. Dropdown     (categoria)
   10. Abas
   11. Editor       (texto + imagens)
   12. Publicação
   13. Inicialização
   --------------------------------------------------------------
   PRINCÍPIOS
   - Cada módulo cuida de UMA coisa e não mexe no DOM dos outros.
   - Módulos conversam por funções públicas (Gaveta.fechar(), etc.).
   - O modo da gaveta (permanente/sobreposição) vem do CSS
     (--gaveta-modo). O JS nunca repete breakpoints.
   ============================================================== */
(function () {
    'use strict';

    // ==============================================================
    // 1. CONSTANTES E ESTADO
    // ==============================================================
    const BUCKET = 'avatars';
    const MAX_MB = 5;
    const ZOOM_MIN = 1;
    const ZOOM_MAX = 3;
    const TAMANHOS_IMG = { p: 30, m: 55, g: 100 };
    const TAMANHO_IMG_PADRAO = 'm';
    const EXTENSOES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

    const $ = (id) => document.getElementById(id);

    const estado = {
        db: null,
        usuario: null,
        atelie: null,
        canalToken: 0,
        avatar: { arquivo: null, url: null, blobUrl: null, editado: false },
        capa: { arquivo: null, blobUrl: null },
        capaArtigo: { arquivo: null }
    };

    const enquadradores = { avatar: null, capa: null };

    // Pontes entre módulos (preenchidas na inicialização)
    const ganchos = {
        resetarEditor: () => {},
        limparCapaArtigo: () => {}
    };

    // ==============================================================
    // 2. UTILITÁRIOS
    // ==============================================================
    const limitar = (v, min, max) => Math.max(min, Math.min(max, v));
    const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

    function escaparHtml(texto) {
        return String(texto == null ? '' : texto).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function formatarData(iso) {
        if (!iso) return '';
        try {
            return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
        } catch (_) { return ''; }
    }

    function iniciais(nome) {
        const partes = String(nome || '?').trim().split(/\s+/);
        const a = (partes[0] || '?').charAt(0).toUpperCase();
        const b = partes.length > 1 ? (partes[partes.length - 1] || '').charAt(0).toUpperCase() : '';
        return a + b;
    }

    function lerPosicao(texto) {
        const p = String(texto || '50% 50%').split(' ');
        const x = parseFloat(p[0]);
        const y = parseFloat(p[1]);
        return [isNaN(x) ? 50 : x, isNaN(y) ? 50 : y];
    }

    function extensaoDe(arquivo) {
        return EXTENSOES[arquivo.type] || 'jpg';
    }

    function avisar(mensagem, tipo) {
        const el = document.createElement('div');
        el.className = 'atelie-toast' + (tipo === 'erro' ? ' erro' : '');
        el.setAttribute('role', 'status');
        el.textContent = mensagem;
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('visivel'));
        setTimeout(() => {
            el.classList.remove('visivel');
            setTimeout(() => el.remove(), 350);
        }, 3200);
    }

    // Troca o rótulo do botão sem apagar o ícone
    function estadoBotao(botao, ocupado, textoOcupado) {
        const alvo = botao.querySelector('.btn-rotulo') || botao;
        if (!botao.dataset.rotulo) botao.dataset.rotulo = alvo.textContent;
        botao.disabled = ocupado;
        botao.classList.toggle('carregando', ocupado);
        alvo.textContent = ocupado ? textoOcupado : botao.dataset.rotulo;
    }

    function validarImagem(arquivo, regexTipo) {
        if (!arquivo) return false;
        if (!(regexTipo || /^image\//).test(arquivo.type)) {
            avisar('Formato de imagem não suportado.', 'erro');
            return false;
        }
        if (arquivo.size > MAX_MB * 1024 * 1024) {
            avisar('A imagem deve ter no máximo ' + MAX_MB + ' MB.', 'erro');
            return false;
        }
        return true;
    }

    function carregarImagem(src, cors) {
        return new Promise((ok, falha) => {
            const im = new Image();
            if (cors) im.crossOrigin = 'anonymous';
            im.onload = () => ok(im);
            im.onerror = falha;
            im.src = src;
        });
    }

    // ==============================================================
    // 3. TRAVA DE SCROLL
    // Várias camadas (gaveta, modal) podem travar o fundo ao mesmo
    // tempo; o fundo só destrava quando TODAS soltarem.
    // ==============================================================
    const TravaScroll = (function () {
        const chaves = new Set();
        const raiz = document.documentElement;
        let yGuardado = 0;
        return {
            travar(chave) {
                if (chaves.size === 0) yGuardado = window.scrollY || 0;
                chaves.add(chave);
                raiz.classList.add('atelie-travado');
            },
            destravar(chave) {
                if (!chaves.delete(chave) || chaves.size > 0) return;
                raiz.classList.remove('atelie-travado');
                if (Math.abs((window.scrollY || 0) - yGuardado) > 1) window.scrollTo(0, yGuardado);
            },
            liberarTudo() {
                chaves.clear();
                raiz.classList.remove('atelie-travado');
            }
        };
    })();

    // ==============================================================
    // 4. GAVETA
    // ==============================================================
    const Gaveta = (function () {
        // O CSS decide o modo; aqui só lemos o resultado.
        const permanente = () =>
            getComputedStyle(document.body).getPropertyValue('--gaveta-modo').trim() === 'permanente';

        function abrir() {
            if (permanente()) return;
            $('gaveta-config').classList.add('ativa');
            $('overlay-config').classList.add('ativa');
            TravaScroll.travar('gaveta');
        }

        function fechar() {
            $('gaveta-config').classList.remove('ativa');
            $('overlay-config').classList.remove('ativa');
            TravaScroll.destravar('gaveta');
        }

        function mostrarPainel(nome) {
            ['canal', 'redacao'].forEach((chave) => {
                const painel = $('config-' + chave);
                painel.classList.toggle('ativo', chave === nome);
                painel.scrollTop = 0;
            });
        }

        function iniciar() {
            $('btn-configurar-atelie').addEventListener('click', abrir);
            $('btn-opcoes-mobile').addEventListener('click', abrir);
            $('btn-fechar-config').addEventListener('click', fechar);
            $('btn-fechar-config-redacao').addEventListener('click', fechar);
            $('overlay-config').addEventListener('click', fechar);

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && $('gaveta-config').classList.contains('ativa')) fechar();
            });

            // Se a tela virar "gaveta permanente", libera o fundo
            window.addEventListener('resize', () => { if (permanente()) fechar(); });

            // Voltando pelo cache do navegador: garante estado limpo
            window.addEventListener('pageshow', (e) => {
                if (e.persisted) { fechar(); TravaScroll.liberarTudo(); }
            });
        }

        return { permanente, abrir, fechar, mostrarPainel, iniciar };
    })();

    // ==============================================================
    // 5. ENQUADRADOR (avatar / capa)
    // Modelo: imagem "cover" + posição em % + zoom.
    // - Mouse/caneta: arrasta direto.
    // - Toque: a página rola normalmente. Só arrasta a imagem depois
    //   de tocar em "Ajustar posição" (classe .ajustando).
    // ==============================================================
    function criarEnquadrador(cfg) {
        const { container, camada, controles, slider, botaoAjuste, aoImagem, aoMudar } = cfg;
        const est = { x: 50, y: 50, zoom: 1, nw: 0, nh: 0, pronto: false };
        const ponteiros = new Map();
        let ancora = null;
        let pinca = null;
        let token = 0;

        function aplicar() {
            camada.style.backgroundPosition = est.x + '% ' + est.y + '%';
            camada.style.transformOrigin = est.x + '% ' + est.y + '%';
            camada.style.transform = 'scale(' + est.zoom + ')';
            if (slider) slider.value = est.zoom;
        }

        function geometria() {
            const cw = container.clientWidth;
            const ch = container.clientHeight;
            const s = Math.max(cw / est.nw, ch / est.nh);
            return {
                s: s,
                livreX: Math.max(0, est.nw - cw / (est.zoom * s)),
                livreY: Math.max(0, est.nh - ch / (est.zoom * s))
            };
        }

        function notificar() { if (aoMudar) aoMudar(); }

        function definirZoom(valor) {
            est.zoom = limitar(valor, ZOOM_MIN, ZOOM_MAX);
            aplicar();
            notificar();
        }

        function arrastar(dx, dy) {
            const g = geometria();
            if (g.livreX > 0.5) est.x = limitar(ancora.px - (dx / (est.zoom * g.s)) / g.livreX * 100, 0, 100);
            if (g.livreY > 0.5) est.y = limitar(ancora.py - (dy / (est.zoom * g.s)) / g.livreY * 100, 0, 100);
            aplicar();
            notificar();
        }

        function distancia() {
            const [a, b] = [...ponteiros.values()];
            return Math.hypot(a.x - b.x, a.y - b.y);
        }

        // Recalcula o gesto atual a partir dos dedos/cursores ativos
        function reiniciarGesto() {
            ancora = null;
            pinca = null;
            if (ponteiros.size === 1) {
                const [p] = [...ponteiros.values()];
                ancora = { x: p.x, y: p.y, px: est.x, py: est.y };
            } else if (ponteiros.size === 2) {
                pinca = { dist: distancia(), zoom: est.zoom };
            }
        }

        function definirAjuste(ativo) {
            container.classList.toggle('ajustando', ativo);
            if (!botaoAjuste) return;
            botaoAjuste.setAttribute('aria-pressed', ativo ? 'true' : 'false');
            const rotulo = botaoAjuste.querySelector('.btn-rotulo');
            if (rotulo) rotulo.textContent = ativo ? 'Concluir ajuste' : 'Ajustar posição';
        }

        const podeArrastar = (e) => e.pointerType !== 'touch' || container.classList.contains('ajustando');

        container.addEventListener('pointerdown', (e) => {
            if (!est.pronto || !podeArrastar(e)) return;
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
            container.setPointerCapture(e.pointerId);
            reiniciarGesto();
        });

        container.addEventListener('pointermove', (e) => {
            if (!ponteiros.has(e.pointerId)) return;
            ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pinca && ponteiros.size === 2) {
                if (pinca.dist > 0) definirZoom(pinca.zoom * (distancia() / pinca.dist));
            } else if (ancora) {
                arrastar(e.clientX - ancora.x, e.clientY - ancora.y);
            }
        });

        const soltar = (e) => {
            if (!ponteiros.delete(e.pointerId)) return;
            reiniciarGesto();
        };
        container.addEventListener('pointerup', soltar);
        container.addEventListener('pointercancel', soltar);

        // Zoom pela roda só com Ctrl/⌘; sem isso a roda continua rolando a gaveta
        container.addEventListener('wheel', (e) => {
            if (!est.pronto || !(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            definirZoom(est.zoom + (e.deltaY < 0 ? 0.1 : -0.1));
        }, { passive: false });

        if (slider) slider.addEventListener('input', () => definirZoom(parseFloat(slider.value)));
        if (botaoAjuste) botaoAjuste.addEventListener('click', () => definirAjuste(!container.classList.contains('ajustando')));

        return {
            carregar(url, inicial) {
                const meu = ++token;
                est.pronto = false;
                est.x = inicial && inicial.x != null ? inicial.x : 50;
                est.y = inicial && inicial.y != null ? inicial.y : 50;
                est.zoom = inicial && inicial.zoom ? inicial.zoom : 1;
                ponteiros.clear();
                reiniciarGesto();
                definirAjuste(false);
                camada.style.backgroundImage = 'url("' + String(url).replace(/"/g, '%22') + '")';
                aplicar();
                if (controles) controles.hidden = false;
                if (aoImagem) aoImagem(true);

                const im = new Image();
                im.onload = () => {
                    if (meu !== token) return;
                    est.nw = im.naturalWidth;
                    est.nh = im.naturalHeight;
                    est.pronto = true;
                };
                im.src = url;
            },
            limpar() {
                token++;
                est.pronto = false;
                est.x = 50; est.y = 50; est.zoom = 1;
                ponteiros.clear();
                reiniciarGesto();
                definirAjuste(false);
                camada.style.backgroundImage = '';
                aplicar();
                if (controles) controles.hidden = true;
                if (aoImagem) aoImagem(false);
            },
            estado: () => ({ x: est.x, y: est.y, zoom: est.zoom }),
            temImagem: () => est.pronto
        };
    }

    // ==============================================================
    // 6. DADOS
    // ==============================================================
    async function aguardarSupabase() {
        for (let i = 0; i < 30; i++) {
            if (window.supabaseClient) return window.supabaseClient;
            await esperar(200);
        }
        return null;
    }

    // Envia um arquivo para o storage e devolve a URL pública
    async function enviarArquivo(prefixo, corpo, extensao, contentType) {
        const caminho = estado.usuario.id + '/' + prefixo + '-' + Date.now() + '.' + extensao;
        const opcoes = contentType ? { contentType: contentType } : undefined;
        const { error } = await estado.db.storage.from(BUCKET).upload(caminho, corpo, opcoes);
        if (error) throw error;
        return estado.db.storage.from(BUCKET).getPublicUrl(caminho).data.publicUrl;
    }

    // ==============================================================
    // 7. ATELIÊ
    // ==============================================================
    function mostrarAtelie(existe) {
        $('atelie-vazio').hidden = existe;
        $('atelie-conteudo').hidden = !existe;
        $('atelie-abas').hidden = !existe;
    }

    function renderizarAtelie(atelie) {
        $('atelie-nome').textContent = atelie.name;
        $('atelie-handle').textContent = '@' + atelie.handle;
        $('atelie-bio').textContent = atelie.description || 'Nenhuma descrição adicionada.';

        const caixaAvatar = $('atelie-avatar');
        const fotoPerfil = document.querySelector('#perfil-usuario img.foto-perfil');
        const urlAvatar = atelie.avatar_url || (fotoPerfil ? fotoPerfil.src : null);

        const mostrarIniciais = () => {
            caixaAvatar.textContent = '';
            const span = document.createElement('span');
            span.className = 'avatar-iniciais';
            span.textContent = iniciais(atelie.name);
            caixaAvatar.appendChild(span);
        };

        caixaAvatar.textContent = '';
        if (urlAvatar) {
            const img = document.createElement('img');
            img.src = urlAvatar;
            img.alt = 'Avatar';
            img.referrerPolicy = 'no-referrer';
            img.onerror = mostrarIniciais;
            caixaAvatar.appendChild(img);
        } else {
            mostrarIniciais();
        }

        if (atelie.cover_url) {
            const img = $('atelie-capa-img');
            const [cx, cy] = lerPosicao(atelie.cover_position);
            const zoom = parseFloat(atelie.cover_zoom) || 1;
            img.src = atelie.cover_url;
            img.style.objectPosition = cx + '% ' + cy + '%';
            img.style.transformOrigin = cx + '% ' + cy + '%';
            img.style.transform = 'scale(' + zoom + ')';
        }
    }

    // Sincroniza o painel de configuração com os dados salvos
    function preencherPainel(atelie) {
        $('input-config-nome').value = atelie.name || '';
        $('input-config-bio').value = atelie.description || '';

        // Libera blobs antigos e zera pendências de upload
        [estado.avatar.blobUrl, estado.capa.blobUrl].forEach((u) => { if (u) URL.revokeObjectURL(u); });
        estado.avatar = { arquivo: null, url: atelie.avatar_url || null, blobUrl: null, editado: false };
        estado.capa = { arquivo: null, blobUrl: null };

        if (atelie.avatar_url) enquadradores.avatar.carregar(atelie.avatar_url);
        else enquadradores.avatar.limpar();

        if (atelie.cover_url) {
            const [x, y] = lerPosicao(atelie.cover_position);
            enquadradores.capa.carregar(atelie.cover_url, { x: x, y: y, zoom: parseFloat(atelie.cover_zoom) || 1 });
        } else {
            enquadradores.capa.limpar();
        }
    }

    // Recorta o avatar exatamente como aparece no círculo (512x512)
    async function gerarAvatarRecortado() {
        const fonte = estado.avatar.arquivo ? estado.avatar.blobUrl : estado.avatar.url;
        if (!fonte) return null;

        const img = await carregarImagem(fonte, !estado.avatar.arquivo);
        const est = enquadradores.avatar.estado();
        const lado0 = $('avatar-preview-container').clientWidth || 88;
        const s = Math.max(lado0 / img.naturalWidth, lado0 / img.naturalHeight);
        const lado = lado0 / (est.zoom * s);
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

    async function salvarConfiguracao(e) {
        e.preventDefault();
        if (!estado.atelie) return;

        const botao = $('btn-salvar-config');
        estadoBotao(botao, true, 'Salvando...');

        try {
            let avatarUrl = estado.atelie.avatar_url;
            let capaUrl = estado.atelie.cover_url;

            if (estado.avatar.editado && enquadradores.avatar.temImagem()) {
                const blob = await gerarAvatarRecortado().catch(() => null);
                if (blob) {
                    avatarUrl = await enviarArquivo('atelie-avatar', blob, 'jpg', 'image/jpeg');
                } else if (estado.avatar.arquivo) {
                    avatarUrl = await enviarArquivo('atelie-avatar', estado.avatar.arquivo, extensaoDe(estado.avatar.arquivo), estado.avatar.arquivo.type);
                }
            }

            if (estado.capa.arquivo) {
                capaUrl = await enviarArquivo('atelie-capa', estado.capa.arquivo, extensaoDe(estado.capa.arquivo), estado.capa.arquivo.type);
            }

            const c = enquadradores.capa.estado();
            const { data, error } = await estado.db.from('ateliers').update({
                name: $('input-config-nome').value.trim(),
                description: $('input-config-bio').value.trim(),
                avatar_url: avatarUrl,
                cover_url: capaUrl,
                cover_position: c.x.toFixed(1) + '% ' + c.y.toFixed(1) + '%',
                cover_zoom: Number(c.zoom.toFixed(2))
            }).eq('id', estado.atelie.id).select().single();
            if (error) throw error;

            estado.atelie = data;
            renderizarAtelie(data);
            preencherPainel(data);
            Gaveta.fechar();
            avisar('Ateliê atualizado com sucesso.');
        } catch (err) {
            console.error(err);
            avisar('Não foi possível salvar. Tente novamente.', 'erro');
        } finally {
            estadoBotao(botao, false);
        }
    }

    function configurarPainelCanal() {
        const placeholderAvatar = $('avatar-preview-arrastavel').innerHTML;

        enquadradores.avatar = criarEnquadrador({
            container: $('avatar-preview-container'),
            camada: $('avatar-preview-arrastavel'),
            controles: $('avatar-ajuste'),
            slider: $('avatar-zoom'),
            botaoAjuste: $('avatar-btn-ajuste'),
            aoImagem: (tem) => {
                const camada = $('avatar-preview-arrastavel');
                camada.classList.toggle('tem-imagem', tem);
                camada.innerHTML = tem ? '' : placeholderAvatar;
            },
            aoMudar: () => { estado.avatar.editado = true; }
        });

        enquadradores.capa = criarEnquadrador({
            container: $('capa-preview-container'),
            camada: $('capa-preview-arrastavel'),
            controles: $('capa-ajuste'),
            slider: $('capa-zoom'),
            botaoAjuste: $('capa-btn-ajuste'),
            aoImagem: (tem) => {
                $('capa-preview-container').hidden = !tem;
                $('capa-vazia').hidden = tem;
            }
        });

        // Escolher avatar
        const inputAvatar = $('input-config-avatar');
        $('btn-upload-avatar').addEventListener('click', () => inputAvatar.click());
        inputAvatar.addEventListener('change', () => {
            const arquivo = inputAvatar.files[0];
            inputAvatar.value = '';
            if (!validarImagem(arquivo)) return;
            if (estado.avatar.blobUrl) URL.revokeObjectURL(estado.avatar.blobUrl);
            estado.avatar.arquivo = arquivo;
            estado.avatar.blobUrl = URL.createObjectURL(arquivo);
            enquadradores.avatar.carregar(estado.avatar.blobUrl);
            estado.avatar.editado = true;
        });

        // Escolher capa do ateliê
        const inputCapa = $('input-config-capa');
        $('btn-upload-capa').addEventListener('click', () => inputCapa.click());
        inputCapa.addEventListener('change', () => {
            const arquivo = inputCapa.files[0];
            inputCapa.value = '';
            if (!validarImagem(arquivo)) return;
            if (estado.capa.blobUrl) URL.revokeObjectURL(estado.capa.blobUrl);
            estado.capa.arquivo = arquivo;
            estado.capa.blobUrl = URL.createObjectURL(arquivo);
            enquadradores.capa.carregar(estado.capa.blobUrl);
        });

        $('form-config-atelie').addEventListener('submit', salvarConfiguracao);
    }

    function configurarPainelRedacao() {
        const preview = $('capa-artigo-preview');
        const camada = $('capa-artigo-arrastavel');
        const input = $('input-capa-artigo');

        function limpar() {
            estado.capaArtigo.arquivo = null;
            camada.style.backgroundImage = '';
            preview.hidden = true;
        }
        ganchos.limparCapaArtigo = limpar;

        $('btn-upload-capa-artigo').addEventListener('click', () => input.click());
        input.addEventListener('change', () => {
            const arquivo = input.files[0];
            input.value = '';
            if (!validarImagem(arquivo)) return;
            estado.capaArtigo.arquivo = arquivo;
            const leitor = new FileReader();
            leitor.onload = (ev) => {
                camada.style.backgroundImage = 'url("' + ev.target.result + '")';
                preview.hidden = false;
            };
            leitor.readAsDataURL(arquivo);
        });
        $('btn-remover-capa-artigo').addEventListener('click', limpar);

        $('btn-descartar-rascunho').addEventListener('click', () => {
            if (!confirm('Tem certeza que deseja descartar este rascunho?')) return;
            ganchos.resetarEditor();
            selecionarAba('canal');
        });
    }

    // Criação do ateliê (modal)
    function configurarCriacao() {
        const modal = $('modal-criar-atelie');

        function abrirModal() {
            modal.hidden = false;
            TravaScroll.travar('modal');
            $('input-nome-atelie').focus();
        }
        function fecharModal() {
            modal.hidden = true;
            TravaScroll.destravar('modal');
        }

        $('btn-criar-atelie').addEventListener('click', abrirModal);
        $('btn-fechar-modal').addEventListener('click', fecharModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) fecharModal(); });

        $('form-criar-atelie').addEventListener('submit', async (e) => {
            e.preventDefault();
            const botao = $('btn-salvar-atelie');
            const nome = $('input-nome-atelie').value.trim();
            const bio = $('input-bio-atelie').value.trim();
            if (!nome) return avisar('O nome do ateliê é obrigatório.', 'erro');

            botao.disabled = true;
            botao.textContent = 'Abrindo...';
            try {
                const { data: handle, error: erroHandle } = await estado.db.rpc('gerar_handle_unico');
                if (erroHandle) throw erroHandle;

                const { data, error } = await estado.db.from('ateliers').insert([{
                    owner_id: estado.usuario.id, name: nome, handle: handle,
                    description: bio, cover_position: '50% 50%', cover_zoom: 1
                }]).select().single();
                if (error) throw error;

                fecharModal();
                estado.atelie = data;
                mostrarAtelie(true);
                renderizarAtelie(data);
                preencherPainel(data);
                carregarCanal();
            } catch (err) {
                console.error(err);
                avisar('Erro ao abrir o ateliê.', 'erro');
            } finally {
                botao.disabled = false;
                botao.textContent = 'Criar Ateliê';
            }
        });
    }

    async function carregarAtelie() {
        const { data, error } = await estado.db.from('ateliers').select('*')
            .eq('owner_id', estado.usuario.id).maybeSingle();
        if (error) { console.error('Erro ao buscar ateliê:', error); return; }

        if (!data) { mostrarAtelie(false); return; }
        estado.atelie = data;
        mostrarAtelie(true);
        renderizarAtelie(data);
        preencherPainel(data);
        carregarCanal();
    }

    // ==============================================================
    // 8. CANAL
    // ==============================================================
    function montarCardPost(post) {
        const div = document.createElement('div');
        div.innerHTML = post.content || '';
        div.querySelectorAll('figure, img, figcaption, style, script').forEach((el) => el.remove());
        const texto = (div.textContent || '').replace(/\s+/g, ' ').trim();
        const trecho = texto.length > 220 ? texto.slice(0, 220).trim() + '…' : texto;
        const id = escaparHtml(post.id);

        const card = document.createElement('article');
        card.className = 'canal-post';
        card.innerHTML =
            (post.cover_url
                ? '<div class="canal-post-capa"><img src="' + escaparHtml(post.cover_url) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></div>'
                : '') +
            '<div class="canal-post-corpo">' +
                '<div class="canal-post-meta">' +
                    (post.category ? '<span class="canal-post-categoria">' + escaparHtml(post.category) + '</span>' : '') +
                    '<span>' + escaparHtml(formatarData(post.created_at)) + '</span>' +
                '</div>' +
                '<h2 class="canal-post-titulo">' + escaparHtml(post.title || 'Sem título') + '</h2>' +
                '<div class="canal-post-trecho">' + escaparHtml(trecho) + '</div>' +
                '<div class="canal-post-rodape">' +
                    '<button type="button" class="canal-post-ler" data-ler="' + id + '">Ler artigo' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>' +
                    '</button>' +
                    '<div class="canal-post-acoes">' +
                        '<button type="button" class="perigo" data-excluir="' + id + '" title="Excluir" aria-label="Excluir publicação">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>' +
                        '</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        return card;
    }

    async function carregarCanal() {
        const lista = $('canal-lista');
        const vazio = $('canal-vazio');
        const meu = ++estado.canalToken;     // ignora respostas antigas
        vazio.hidden = true;
        lista.innerHTML = '<div class="canal-carregando"><div class="canal-skeleton"></div><div class="canal-skeleton"></div></div>';

        const { data: posts, error } = await estado.db.from('posts')
            .select('id, title, content, cover_url, category, created_at')
            .eq('author_id', estado.usuario.id)
            .order('created_at', { ascending: false });

        if (meu !== estado.canalToken) return;
        lista.innerHTML = '';
        if (error || !posts || posts.length === 0) { vazio.hidden = false; return; }

        const fragmento = document.createDocumentFragment();
        posts.forEach((post) => fragmento.appendChild(montarCardPost(post)));
        lista.appendChild(fragmento);
    }

    function configurarCanal() {
        // Delegação: um único listener para todos os cards
        $('canal-lista').addEventListener('click', async (e) => {
            const ler = e.target.closest('[data-ler]');
            if (ler) {
                window.location.href = 'post.html?id=' + encodeURIComponent(ler.dataset.ler);
                return;
            }
            const excluir = e.target.closest('[data-excluir]');
            if (!excluir) return;
            if (!confirm('Excluir esta publicação?')) return;
            const { error } = await estado.db.from('posts').delete().eq('id', excluir.dataset.excluir);
            if (error) return avisar('Não foi possível excluir.', 'erro');
            avisar('Publicação excluída.');
            carregarCanal();
        });
    }

    // ==============================================================
    // 9. DROPDOWN (categoria)
    // ==============================================================
    function configurarDropdown() {
        const raiz = $('dropdown-categoria');
        const gatilho = raiz.querySelector('.dropdown-gatilho');
        const valorEl = raiz.querySelector('.dropdown-valor');
        const iconeEl = gatilho.querySelector('.dropdown-icone');
        const campo = $('input-categoria-artigo');
        const itens = [...raiz.querySelectorAll('[role="option"]')];

        function abrir() {
            raiz.classList.add('aberto');
            gatilho.setAttribute('aria-expanded', 'true');
            (itens.find((i) => i.getAttribute('aria-selected') === 'true') || itens[0]).focus();
        }
        function fechar(devolverFoco) {
            raiz.classList.remove('aberto');
            gatilho.setAttribute('aria-expanded', 'false');
            if (devolverFoco) gatilho.focus();
        }
        function escolher(item) {
            itens.forEach((i) => i.setAttribute('aria-selected', i === item ? 'true' : 'false'));
            campo.value = item.dataset.valor;
            valorEl.textContent = item.dataset.valor;
            iconeEl.innerHTML = item.querySelector('.dropdown-icone').innerHTML;
            fechar(true);
        }

        gatilho.addEventListener('click', () => (raiz.classList.contains('aberto') ? fechar() : abrir()));
        gatilho.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); abrir(); }
        });

        itens.forEach((item, i) => {
            item.addEventListener('click', () => escolher(item));
            item.addEventListener('keydown', (e) => {
                const mover = (idx) => { e.preventDefault(); itens[(idx + itens.length) % itens.length].focus(); };
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); escolher(item); }
                else if (e.key === 'Escape') { e.preventDefault(); fechar(true); }
                else if (e.key === 'ArrowDown') mover(i + 1);
                else if (e.key === 'ArrowUp') mover(i - 1);
                else if (e.key === 'Home') mover(0);
                else if (e.key === 'End') mover(itens.length - 1);
                else if (e.key === 'Tab') fechar();
            });
        });

        document.addEventListener('pointerdown', (e) => { if (!raiz.contains(e.target)) fechar(); });
    }

    // ==============================================================
    // 10. ABAS
    // ==============================================================
    function selecionarAba(nome) {
        const redacao = nome === 'redacao';

        Gaveta.fechar();
        window.scrollTo({ top: 0 });

        document.querySelectorAll('.aba-btn').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === nome));
        $('atelie-main').classList.toggle('modo-redacao', redacao);
        document.body.classList.toggle('atelie-modo-redacao', redacao);
        $('aba-canal').classList.toggle('ativa', !redacao);
        $('aba-redacao').classList.toggle('ativa', redacao);
        Gaveta.mostrarPainel(redacao ? 'redacao' : 'canal');

        if (!redacao && estado.atelie) carregarCanal();
    }

    function configurarAbas() {
        document.querySelectorAll('.aba-btn').forEach((b) => {
            b.addEventListener('click', () => selecionarAba(b.dataset.aba));
        });

        $('btn-cancelar-escrita').addEventListener('click', () => {
            if (!editor.temConteudo() || confirm('Tem certeza que deseja apagar o que escreveu?')) {
                ganchos.resetarEditor();
                selecionarAba('canal');
            }
        });
    }

    // ==============================================================
    // 11. EDITOR
    // ==============================================================
    function criarEditor() {
        const conteudo = $('input-conteudo');
        const folha = $('editor-folha');
        const barra = $('img-flutuante');
        const selecao = $('img-selecao');
        const rotuloSelecao = $('img-selecao-rotulo');
        const indicador = $('img-indicador');
        const menu = $('img-menu');
        const BLOCOS = new Set(['P', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'UL', 'OL', 'FIGURE', 'DIV', 'PRE']);

        let figura = null;          // imagem selecionada
        let rangeSalvo = null;      // última posição do cursor no texto
        let arraste = null;         // arrastar-e-soltar em andamento
        let fantasma = null;
        let ignorarClique = false;
        let quadroPendente = false;

        document.execCommand('defaultParagraphSeparator', false, 'p');

        // ---------------- Texto ----------------
        function atualizarContadores() {
            const texto = conteudo.textContent.trim();
            const vazio = texto === '' && !conteudo.querySelector('img');
            conteudo.dataset.vazio = vazio ? 'true' : 'false';
            const palavras = texto ? texto.split(/\s+/).length : 0;
            const minutos = palavras === 0 ? 0 : Math.max(1, Math.round(palavras / 200));
            $('contador-palavras').textContent = palavras + (palavras === 1 ? ' palavra' : ' palavras');
            $('tempo-leitura').textContent = minutos + ' min de leitura';
        }

        const temConteudo = () =>
            !!($('input-titulo').value.trim() || conteudo.textContent.trim() || conteudo.querySelector('img'));

        conteudo.addEventListener('input', () => { atualizarContadores(); agendarPosicao(); });

        document.addEventListener('selectionchange', () => {
            const sel = window.getSelection();
            if (sel.rangeCount && conteudo.contains(sel.anchorNode)) rangeSalvo = sel.getRangeAt(0).cloneRange();
        });

        document.querySelectorAll('.editor-toolbar button[data-cmd]').forEach((botao) => {
            botao.addEventListener('mousedown', (e) => e.preventDefault());
            botao.addEventListener('click', (e) => {
                e.preventDefault();
                const cmd = botao.dataset.cmd;
                let valor = botao.dataset.value || null;
                if (cmd === 'formatBlock' && document.queryCommandValue('formatBlock').toLowerCase() === valor) valor = 'p';
                conteudo.focus();
                document.execCommand(cmd, false, valor);
                atualizarContadores();
            });
        });

        conteudo.addEventListener('paste', (e) => {
            e.preventDefault();
            const texto = (e.clipboardData || window.clipboardData).getData('text/plain');
            document.execCommand('insertText', false, texto);
        });
        conteudo.addEventListener('dragstart', (e) => { if (e.target.tagName === 'IMG') e.preventDefault(); });

        // ---------------- Estrutura de blocos ----------------
        // Garante que todo texto solto dentro do editor esteja em <p>
        function normalizarBlocos() {
            let atual = null;
            [...conteudo.childNodes].forEach((no) => {
                if (no.nodeType === 1 && BLOCOS.has(no.tagName)) { atual = null; return; }
                if (no.nodeType === 3 && !no.textContent.trim() && !atual) { no.remove(); return; }
                if (!atual) { atual = document.createElement('p'); no.before(atual); }
                atual.appendChild(no);
            });
        }

        function blocoTopo(no) {
            while (no && no.parentNode !== conteudo) no = no.parentNode;
            return no && no.nodeType === 1 ? no : null;
        }

        // Sempre deve existir um parágrafo editável depois da última imagem
        function garantirParagrafoFinal() {
            const ultimo = conteudo.lastElementChild;
            if (!ultimo || ultimo.tagName === 'FIGURE') {
                const p = document.createElement('p');
                p.innerHTML = '<br>';
                conteudo.appendChild(p);
            }
        }

        function colocarCursor(el) {
            const r = document.createRange();
            r.selectNodeContents(el);
            r.collapse(true);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(r);
        }

        // ---------------- Criar e inserir imagem ----------------
        function criarFigura(url) {
            const fig = document.createElement('figure');
            fig.className = 'img-bloco';
            fig.dataset.size = TAMANHO_IMG_PADRAO;
            fig.dataset.align = 'center';
            fig.style.width = TAMANHOS_IMG[TAMANHO_IMG_PADRAO] + '%';
            fig.contentEditable = 'false';

            const img = document.createElement('img');
            img.src = url;
            img.alt = '';
            img.loading = 'lazy';
            img.draggable = false;
            img.addEventListener('load', agendarPosicao);

            const legenda = document.createElement('figcaption');
            legenda.contentEditable = 'true';
            legenda.dataset.ph = 'Adicionar legenda (opcional)';

            fig.appendChild(img);
            fig.appendChild(legenda);
            return fig;
        }

        function inserirFigura(fig) {
            let no = null, deslocamento = 0;
            if (rangeSalvo && conteudo.contains(rangeSalvo.startContainer)) {
                no = rangeSalvo.startContainer;
                deslocamento = rangeSalvo.startOffset;
            }
            normalizarBlocos();

            const topo = no && conteudo.contains(no) ? blocoTopo(no) : null;
            if (topo && topo.tagName === 'P') {
                const vazio = !topo.textContent.trim() && !topo.querySelector('img');
                if (vazio) {
                    topo.replaceWith(fig);
                } else {
                    // Divide o parágrafo no cursor: texto antes | imagem | texto depois
                    const r = document.createRange();
                    r.setStart(no, deslocamento);
                    r.setEndAfter(topo.lastChild);
                    const resto = r.extractContents();
                    const depois = document.createElement('p');
                    depois.appendChild(resto);
                    if (!depois.textContent.trim()) depois.innerHTML = '<br>';
                    topo.after(fig);
                    fig.after(depois);
                    if (!topo.textContent.trim()) topo.remove();
                }
            } else if (topo) {
                topo.after(fig);
            } else {
                conteudo.appendChild(fig);
            }

            garantirParagrafoFinal();
            conteudo.focus({ preventScroll: true });
            if (fig.nextElementSibling) colocarCursor(fig.nextElementSibling);
            atualizarContadores();
            selecionarFigura(fig);
            fig.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }

        const botaoImagem = $('btn-inserir-img');
        const inputImagem = $('input-img');
        botaoImagem.addEventListener('mousedown', (e) => e.preventDefault());
        botaoImagem.addEventListener('click', (e) => { e.preventDefault(); inputImagem.click(); });

        inputImagem.addEventListener('change', async () => {
            const arquivo = inputImagem.files[0];
            inputImagem.value = '';
            if (!validarImagem(arquivo, /^image\/(jpeg|png|webp|gif)$/)) return;

            botaoImagem.disabled = true;
            try {
                const url = await enviarArquivo('img', arquivo, extensaoDe(arquivo));
                inserirFigura(criarFigura(url));
            } catch (err) {
                console.error(err);
                avisar('Erro ao inserir imagem.', 'erro');
            } finally {
                botaoImagem.disabled = false;
            }
        });

        // ---------------- Tamanho e alinhamento ----------------
        function definirTamanho(fig, chave) {
            fig.dataset.size = chave;
            fig.style.width = TAMANHOS_IMG[chave] + '%';
            if (chave === 'g') fig.dataset.align = 'center';
        }

        function definirLarguraLivre(fig, pct) {
            const chave = Object.keys(TAMANHOS_IMG).find((k) => Math.abs(TAMANHOS_IMG[k] - pct) < 1.5);
            fig.dataset.size = chave || 'c';
            fig.style.width = (chave ? TAMANHOS_IMG[chave] : pct).toFixed(1) + '%';
            if (pct >= 99) fig.dataset.align = 'center';
        }

        function definirAlinhamento(fig, alinhamento) {
            // Imagem larga demais não pode "flutuar": reduz para tamanho médio
            if (alinhamento !== 'center' && parseFloat(fig.style.width) > 85) definirTamanho(fig, 'm');
            fig.dataset.align = alinhamento;
        }

        // ---------------- Seleção, barra e alças ----------------
        function atualizarEstados() {
            if (!figura) return;
            [barra, menu].forEach((c) => {
                c.querySelectorAll('[data-tam]').forEach((b) => b.classList.toggle('ativo', b.dataset.tam === figura.dataset.size));
                c.querySelectorAll('[data-alin]').forEach((b) => b.classList.toggle('ativo', b.dataset.alin === figura.dataset.align));
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
            const cx = limitar(f.left - ox + f.width / 2, metade + 8, folha.clientWidth - metade - 8);
            let topo = f.top - oy - 50;
            if (topo < 4) topo = f.bottom - oy + 10;
            barra.style.left = cx + 'px';
            barra.style.top = topo + 'px';
        }

        // Várias fontes pedem reposicionamento; agrupa em um único quadro
        function agendarPosicao() {
            if (quadroPendente) return;
            quadroPendente = true;
            requestAnimationFrame(() => { quadroPendente = false; posicionar(); });
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
            barra.classList.add('ativa');
            selecao.classList.add('ativa');
            atualizarEstados();
            posicionar();
        }

        conteudo.addEventListener('click', (e) => {
            if (ignorarClique) return;
            const fig = e.target.closest('figure.img-bloco');
            selecionarFigura(fig);
            if (fig && !e.target.closest('figcaption')) window.getSelection().removeAllRanges();
        });

        document.addEventListener('click', (e) => {
            if (ignorarClique) return;
            if (!e.target.closest('#input-conteudo, #img-flutuante, #img-selecao, #img-menu')) selecionarFigura(null);
        });

        window.addEventListener('resize', agendarPosicao);
        // A barra e a caixa de seleção rolam junto com a folha; só o menu (fixo) precisa fechar
        window.addEventListener('scroll', () => { if (!menu.hidden) fecharMenu(); }, { passive: true, capture: true });
        if ('ResizeObserver' in window) new ResizeObserver(agendarPosicao).observe(conteudo);

        // ---------------- Ações (barra e menu) ----------------
        function removerFigura() {
            if (!figura) return;
            const alvo = figura;
            selecionarFigura(null);
            alvo.remove();
            atualizarContadores();
        }

        function moverPosicao(direcao) {
            if (!figura) return;
            const vizinho = direcao < 0 ? figura.previousElementSibling : figura.nextElementSibling;
            if (!vizinho) return;
            if (direcao < 0) vizinho.before(figura); else vizinho.after(figura);
            garantirParagrafoFinal();
            figura.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }

        function executar(botao) {
            if (!figura) return;
            const d = botao.dataset;
            if (d.tam) definirTamanho(figura, d.tam);
            else if (d.alin) definirAlinhamento(figura, d.alin);
            else if (d.acao === 'remover') { removerFigura(); return; }
            else if (d.acao === 'subir') moverPosicao(-1);
            else if (d.acao === 'descer') moverPosicao(1);
            else if (d.acao === 'legenda') {
                const legenda = figura.querySelector('figcaption');
                if (legenda) { legenda.focus(); colocarCursor(legenda); }
            }
            atualizarEstados();
            posicionar();
        }

        barra.addEventListener('mousedown', (e) => { if (!e.target.closest('.grip')) e.preventDefault(); });
        barra.addEventListener('click', (e) => {
            const botao = e.target.closest('button');
            if (botao && botao.dataset.acao !== 'mover') executar(botao);
        });

        // ---------------- Menu de contexto ----------------
        function abrirMenu(x, y) {
            atualizarEstados();
            menu.hidden = false;
            menu.style.left = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8)) + 'px';
            menu.style.top = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8)) + 'px';
        }
        function fecharMenu() { menu.hidden = true; }

        conteudo.addEventListener('contextmenu', (e) => {
            const fig = e.target.closest('figure.img-bloco');
            if (!fig || e.target.closest('figcaption')) return;
            e.preventDefault();
            selecionarFigura(fig);
            abrirMenu(e.clientX, e.clientY);
        });
        menu.addEventListener('mousedown', (e) => e.preventDefault());
        menu.addEventListener('contextmenu', (e) => e.preventDefault());
        menu.addEventListener('click', (e) => {
            const botao = e.target.closest('button');
            if (!botao) return;
            executar(botao);
            fecharMenu();
        });
        document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target)) fecharMenu(); });

        // ---------------- Teclado ----------------
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (!menu.hidden) fecharMenu();
                else if (arraste && arraste.ativo) cancelarArraste();
                else if (figura) selecionarFigura(null);
                return;
            }
            if (!figura || (e.key !== 'Backspace' && e.key !== 'Delete')) return;
            const alvo = e.target;
            if (alvo.closest && (alvo.closest('figcaption') || alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA')) return;
            e.preventDefault();
            removerFigura();
        });

        // ---------------- Redimensionar pelas alças ----------------
        selecao.querySelectorAll('.img-handle').forEach((alca) => {
            alca.addEventListener('pointerdown', (e) => {
                if (!figura) return;
                e.preventDefault();
                e.stopPropagation();
                alca.setPointerCapture(e.pointerId);

                const fig = figura;
                const lado = alca.dataset.h.indexOf('e') !== -1 ? 1 : -1;
                const fator = fig.dataset.align === 'center' ? 2 : 1;
                const larguraInicial = fig.getBoundingClientRect().width;
                const base = conteudo.clientWidth;
                const x0 = e.clientX;
                selecao.classList.add('redimensionando');

                const mover = (ev) => {
                    const nova = larguraInicial + (ev.clientX - x0) * lado * fator;
                    let pct = limitar(nova / base * 100, 12, 100);
                    if (pct > 96) pct = 100;
                    definirLarguraLivre(fig, pct);
                    rotuloSelecao.textContent = Math.round(pct) + '%';
                    atualizarEstados();
                    posicionar();
                };
                const fim = () => {
                    alca.removeEventListener('pointermove', mover);
                    alca.removeEventListener('pointerup', fim);
                    alca.removeEventListener('pointercancel', fim);
                    selecao.classList.remove('redimensionando');
                };
                alca.addEventListener('pointermove', mover);
                alca.addEventListener('pointerup', fim);
                alca.addEventListener('pointercancel', fim);
            });
        });

        // ---------------- Arrastar e soltar a imagem ----------------
        function alvoDeSoltura(x, y) {
            const area = conteudo.getBoundingClientRect();
            const filhos = [...conteudo.children].filter((c) => c !== arraste.fig);
            let alvo = null, depois = false;

            for (const filho of filhos) {
                const r = filho.getBoundingClientRect();
                if (y >= r.top && y <= r.bottom) { alvo = filho; depois = y > r.top + r.height / 2; break; }
            }
            if (!alvo && filhos.length) {
                if (y < filhos[0].getBoundingClientRect().top) { alvo = filhos[0]; depois = false; }
                else { alvo = filhos[filhos.length - 1]; depois = true; }
            }
            const zona = x < area.left + area.width * 0.33 ? 'left'
                       : x > area.left + area.width * 0.67 ? 'right' : 'center';
            return { alvo: alvo, depois: depois, zona: zona };
        }

        function atualizarIndicador(x, y) {
            const info = alvoDeSoltura(x, y);
            arraste.info = info;
            if (!info.alvo) { indicador.hidden = true; return; }

            const r = info.alvo.getBoundingClientRect();
            const area = conteudo.getBoundingClientRect();
            const p = folha.getBoundingClientRect();
            const ox = p.left + folha.clientLeft;
            const oy = p.top + folha.clientTop;
            const largura = info.zona === 'center' ? area.width : area.width * 0.42;
            const esquerda = info.zona === 'right' ? area.right - largura : area.left;

            indicador.style.top = ((info.depois ? r.bottom : r.top) - oy) + 'px';
            indicador.style.left = (esquerda - ox) + 'px';
            indicador.style.width = largura + 'px';
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
            const miniatura = document.createElement('img');
            miniatura.src = arraste.fig.querySelector('img').src;
            fantasma.appendChild(miniatura);
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

        // Mouse/caneta: arrasta pela própria imagem. Toque: use o ícone de pontinhos da barra.
        conteudo.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || e.pointerType === 'touch') return;
            const img = e.target.closest('figure.img-bloco > img');
            if (img) arraste = { fig: img.parentElement, x: e.clientX, y: e.clientY, ativo: false, info: null };
        });

        barra.addEventListener('pointerdown', (e) => {
            if (!e.target.closest('.grip') || !figura) return;
            e.preventDefault();
            arraste = { fig: figura, x: e.clientX, y: e.clientY, ativo: false, info: null };
            iniciarArraste();
            fantasma.style.left = e.clientX + 'px';
            fantasma.style.top = e.clientY + 'px';
            atualizarIndicador(e.clientX, e.clientY);
        });

        document.addEventListener('pointermove', (e) => {
            if (!arraste) return;
            if (!arraste.ativo) {
                if (Math.hypot(e.clientX - arraste.x, e.clientY - arraste.y) < 6) return;
                iniciarArraste();
            }
            fantasma.style.left = e.clientX + 'px';
            fantasma.style.top = e.clientY + 'px';

            // Rolagem automática perto das bordas (descontando navbar e barra do editor)
            const navbar = document.querySelector('.navbar');
            const alturaNav = navbar ? navbar.offsetHeight : 68;
            if (e.clientY < alturaNav + 130) window.scrollBy(0, -14);
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

        // ---------------- API pública ----------------
        function resetar() {
            $('input-titulo').value = '';
            conteudo.innerHTML = '';
            selecionarFigura(null);
            rangeSalvo = null;
            ganchos.limparCapaArtigo();
            atualizarContadores();
        }

        // HTML limpo para publicar (com estilos inline para o leitor)
        function htmlParaPublicar() {
            const clone = conteudo.cloneNode(true);
            clone.querySelectorAll('.selecionada, .arrastando').forEach((el) => el.classList.remove('selecionada', 'arrastando'));

            clone.querySelectorAll('figcaption').forEach((legenda) => {
                if (!legenda.textContent.trim()) legenda.remove();
                else { legenda.removeAttribute('contenteditable'); legenda.removeAttribute('data-ph'); }
            });

            let temFlutuante = false;
            clone.querySelectorAll('figure.img-bloco').forEach((fig) => {
                fig.removeAttribute('contenteditable');
                fig.removeAttribute('draggable');
                const largura = fig.style.width || '55%';
                const alinhamento = fig.dataset.align || 'center';
                let estilo = 'box-sizing:border-box;width:' + largura + ';max-width:100%;';
                if (alinhamento === 'left') { estilo += 'float:left;margin:0.4rem 1.6rem 1rem 0;'; temFlutuante = true; }
                else if (alinhamento === 'right') { estilo += 'float:right;margin:0.4rem 0 1rem 1.6rem;'; temFlutuante = true; }
                else estilo += 'clear:both;margin:2rem auto;';
                fig.setAttribute('style', estilo);

                const img = fig.querySelector('img');
                if (img) {
                    img.removeAttribute('draggable');
                    img.setAttribute('style', 'display:block;width:100%;height:auto;border-radius:6px;');
                }
            });

            // Remove parágrafos vazios no final
            while (clone.lastElementChild && clone.lastElementChild.tagName === 'P' &&
                   !clone.lastElementChild.textContent.trim() && !clone.lastElementChild.querySelector('img,figure')) {
                clone.lastElementChild.remove();
            }
            if (temFlutuante) clone.insertAdjacentHTML('beforeend', '<div style="clear:both"></div>');
            return clone.innerHTML.trim();
        }

        atualizarContadores();
        return {
            resetar: resetar,
            temConteudo: temConteudo,
            htmlParaPublicar: htmlParaPublicar,
            estaVazio: () => conteudo.textContent.trim() === '' && !conteudo.querySelector('img')
        };
    }

    // Referência criada na inicialização (usada pelas abas)
    let editor = { temConteudo: () => false };

    // ==============================================================
    // 12. PUBLICAÇÃO
    // ==============================================================
    function configurarPublicacao() {
        const botao = $('btn-publicar-atelie');

        botao.addEventListener('click', async () => {
            const titulo = $('input-titulo').value.trim();
            if (!titulo) return avisar('Adicione um título ao seu conteúdo.', 'erro');
            if (editor.estaVazio()) return avisar('Escreva algo antes de publicar!', 'erro');

            botao.disabled = true;
            botao.textContent = 'Publicando...';
            try {
                let capaUrl = null;
                if (estado.capaArtigo.arquivo) {
                    const arq = estado.capaArtigo.arquivo;
                    try { capaUrl = await enviarArquivo('capa-post', arq, extensaoDe(arq), arq.type); }
                    catch (_) { capaUrl = null; }   // a publicação segue sem capa
                }

                const { error } = await estado.db.from('posts').insert([{
                    author_id: estado.usuario.id,
                    title: titulo,
                    content: editor.htmlParaPublicar(),
                    cover_url: capaUrl,
                    category: $('input-categoria-artigo').value
                }]);
                if (error) throw error;

                avisar('Conteúdo publicado com sucesso no seu canal!');
                editor.resetar();
                selecionarAba('canal');       // já recarrega o canal
            } catch (err) {
                console.error(err);
                avisar('Erro ao publicar.', 'erro');
            } finally {
                botao.disabled = false;
                botao.textContent = 'Publicar';
            }
        });
    }

    // ==============================================================
    // 13. INICIALIZAÇÃO
    // ==============================================================
    async function iniciar() {
        estado.db = await aguardarSupabase();
        if (!estado.db) { console.error('Supabase não carregado.'); return; }

        const { data: { session } } = await estado.db.auth.getSession();
        if (!session) { window.location.href = 'login.html'; return; }
        estado.usuario = session.user;

        // Interface (não depende de dados)
        Gaveta.iniciar();
        configurarPainelCanal();
        configurarPainelRedacao();
        configurarDropdown();
        configurarCriacao();
        configurarCanal();
        configurarAbas();

        editor = criarEditor();
        ganchos.resetarEditor = editor.resetar;
        configurarPublicacao();

        // Dados
        await carregarAtelie();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})();