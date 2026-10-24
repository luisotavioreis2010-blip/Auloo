/* ==============================================================
   ATELIE.JS — v96 (Refatorado, sem bugs, paginação fixa de 5 itens)
   ============================================================== */
(function () {
    'use strict';

    var U = window.utils;
    if (!U) { console.error('atelie.js: window.utils não carregado.'); return; }

    var BUCKET = 'avatars';
    var MAX_MB = 5;
    var ZOOM_MIN = 1;
    var ZOOM_MAX = 3;
    var TAMANHOS_IMG = { p: 30, m: 55, g: 100 };
    var TAMANHO_IMG_PADRAO = 'm';
    var EXTENSOES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
    var REGEX_IMG_POST = /^image\/(jpeg|png|webp|gif)$/;

    var $ = U.$;
    var limitar = function (v, min, max) { return Math.max(min, Math.min(max, v)); };
    var escapar = U.escapar;
    var formatarData = U.formatarData;

    function lerPosicao(texto) {
        var p = String(texto || '50% 50%').split(' ');
        var x = parseFloat(p[0]);
        var y = parseFloat(p[1]);
        return [isNaN(x) ? 50 : x, isNaN(y) ? 50 : y];
    }
    function extensaoDe(arquivo) { return EXTENSOES[arquivo.type] || 'jpg'; }
    function avisar(mensagem, tipo) { U.toast(mensagem, tipo === 'erro'); }

    function estadoBotao(botao, ocupado, textoOcupado) {
        var alvo = botao.querySelector('.btn-rotulo') || botao;
        if (!botao.dataset.rotulo) botao.dataset.rotulo = alvo.textContent;
        botao.disabled = ocupado;
        botao.classList.toggle('carregando', ocupado);
        alvo.textContent = ocupado ? textoOcupado : botao.dataset.rotulo;
    }
    function validarImagem(arquivo, regexTipo) {
        if (!arquivo) return false;
        if (!(regexTipo || /^image\//).test(arquivo.type)) { avisar('Formato de imagem não suportado.', 'erro'); return false; }
        if (arquivo.size > MAX_MB * 1024 * 1024) { avisar('A imagem deve ter no máximo ' + MAX_MB + ' MB.', 'erro'); return false; }
        return true;
    }
    function carregarImagem(src, cors) {
        return new Promise(function (ok, falha) {
            var im = new Image(); if (cors) im.crossOrigin = 'anonymous';
            im.onload = function () { ok(im); }; im.onerror = falha; im.src = src;
        });
    }

    var estado = {
        db: null, usuario: null, atelie: null, canalToken: 0,
        avatar: { arquivo: null, url: null, blobUrl: null, editado: false },
        capa: { arquivo: null, blobUrl: null }, capaArtigo: { arquivo: null }
    };

    var enquadradores = { avatar: null, capa: null };
    var ganchos = { resetarEditor: function () {}, limparCapaArtigo: function () {} };
    var editor = null;

    var Rolagem = {
        el: function () { return $('atelie-main'); },
        topo: function () { var el = this.el(); if (el) el.scrollTo({ top: 0 }); },
        por: function (dy) { var el = this.el(); if (el) el.scrollBy(0, dy); },
        areaVisivel: function () { var el = this.el(); return el ? el.getBoundingClientRect() : { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; }
    };

    // ==========================================
    // GAVETA
    // ==========================================
    var Gaveta = (function () {
        function permanente() { return getComputedStyle(document.body).getPropertyValue('--gaveta-modo').trim() === 'permanente'; }
        function fecharPerfil() {
            var perfil = document.getElementById('sidebar-perfil');
            var overlayPerfil = document.getElementById('gaveta-overlay');
            if (perfil && (perfil.classList.contains('aberta') || perfil.classList.contains('ativa'))) perfil.classList.remove('aberta', 'ativa');
            if (overlayPerfil && overlayPerfil.classList.contains('ativo')) overlayPerfil.classList.remove('ativo');
        }
        function limparBlobsPendentes() {
            if (estado.avatar.blobUrl) { URL.revokeObjectURL(estado.avatar.blobUrl); estado.avatar.blobUrl = null; }
            if (estado.capa.blobUrl) { URL.revokeObjectURL(estado.capa.blobUrl); estado.capa.blobUrl = null; }
        }
        function abrir() {
            if (permanente()) return; fecharPerfil();
            var gaveta = $('gaveta-config'); var overlay = $('overlay-config');
            if (gaveta) gaveta.classList.add('ativa'); if (overlay) overlay.classList.add('ativa');
        }
        function fechar() {
            limparBlobsPendentes(); var gaveta = $('gaveta-config'); var overlay = $('overlay-config');
            if (gaveta) gaveta.classList.remove('ativa'); if (overlay) overlay.classList.remove('ativa');
        }
        function mostrarPainel(nome) {
            ['canal', 'redacao'].forEach(function (chave) {
                var painel = $('config-' + chave);
                if (painel) { painel.classList.toggle('ativo', chave === nome); painel.scrollTop = 0; }
            });
        }
        function iniciar() {
            ['btn-configurar-atelie', 'btn-opcoes-mobile'].forEach(function (id) {
                var el = $(id); if (el) el.addEventListener('click', abrir);
            });
            ['btn-fechar-config', 'btn-fechar-config-redacao', 'overlay-config'].forEach(function (id) {
                var el = $(id); if (el) el.addEventListener('click', fechar);
            });
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') { var gaveta = $('gaveta-config'); if (gaveta && gaveta.classList.contains('ativa')) fechar(); }
            });
            window.addEventListener('resize', function () { if (permanente()) fechar(); });
            window.addEventListener('pageshow', function (e) { if (e.persisted) fechar(); });
        }
        return { permanente: permanente, abrir: abrir, fechar: fechar, mostrarPainel: mostrarPainel, iniciar: iniciar };
    })();

    // ==========================================
    // ENQUADRADOR (Corrigido para Touch)
    // ==========================================
    function criarEnquadrador(cfg) {
        var container = cfg.container; var camada = cfg.camada; var controles = cfg.controles;
        var slider = cfg.slider; var botaoAjuste = cfg.botaoAjuste; var aoImagem = cfg.aoImagem; var aoMudar = cfg.aoMudar;

        var est = { x: 50, y: 50, zoom: 1, nw: 0, nh: 0, pronto: false };
        var ponteiros = new Map(); var ancora = null; var pinca = null; var token = 0; var destroyado = false;

        function aplicar() {
            camada.style.backgroundPosition = est.x + '% ' + est.y + '%';
            camada.style.transformOrigin = est.x + '% ' + est.y + '%';
            camada.style.transform = 'scale(' + est.zoom + ')';
            if (slider) slider.value = est.zoom;
        }
        function geometria() {
            var cw = container.clientWidth; var ch = container.clientHeight; var s = Math.max(cw / est.nw, ch / est.nh);
            return { s: s, livreX: Math.max(0, est.nw - cw / (est.zoom * s)), livreY: Math.max(0, est.nh - ch / (est.zoom * s)) };
        }
        function notificar() { if (aoMudar) aoMudar(); }
        function definirZoom(valor, doUsuario) { est.zoom = limitar(valor, ZOOM_MIN, ZOOM_MAX); aplicar(); if (doUsuario) notificar(); }
        function arrastar(dx, dy) {
            if (!ancora) return; var g = geometria();
            if (g.livreX > 0.5) est.x = limitar(ancora.px - (dx / (est.zoom * g.s)) / g.livreX * 100, 0, 100);
            if (g.livreY > 0.5) est.y = limitar(ancora.py - (dy / (est.zoom * g.s)) / g.livreY * 100, 0, 100);
            aplicar(); notificar();
        }
        function distancia() { var arr = Array.from(ponteiros.values()); return Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y); }
        function reiniciarGesto() {
            ancora = null; pinca = null;
            if (ponteiros.size === 1) { var p = Array.from(ponteiros.values())[0]; ancora = { x: p.x, y: p.y, px: est.x, py: est.y }; }
            else if (ponteiros.size === 2) { pinca = { dist: distancia(), zoom: est.zoom }; }
        }
        function definirAjuste(ativo) {
            container.classList.toggle('ajustando', ativo);
            if (!botaoAjuste) return;
            botaoAjuste.setAttribute('aria-pressed', ativo ? 'true' : 'false');
            var rotulo = botaoAjuste.querySelector('.btn-rotulo');
            if (rotulo) rotulo.textContent = ativo ? 'Concluir ajuste' : 'Ajustar posição';
        }
        
        function onPointerDown(e) {
            if (destroyado || !est.pronto) return;
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            if (e.pointerType === 'touch') e.preventDefault(); // Impede o scroll no touch
            
            ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
            try { container.setPointerCapture(e.pointerId); } catch (_) {}
            reiniciarGesto();
        }
        function onPointerMove(e) {
            if (destroyado || !ponteiros.has(e.pointerId)) return;
            if (e.pointerType === 'touch') e.preventDefault();
            
            ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pinca && ponteiros.size === 2) { if (pinca.dist > 0) definirZoom(pinca.zoom * (distancia() / pinca.dist), true); }
            else if (ancora) { arrastar(e.clientX - ancora.x, e.clientY - ancora.y); }
        }
        function onPointerUp(e) { if (ponteiros.delete(e.pointerId)) reiniciarGesto(); }
        function onWheel(e) { if (destroyado || !est.pronto || !(e.ctrlKey || e.metaKey)) return; e.preventDefault(); definirZoom(est.zoom + (e.deltaY < 0 ? 0.1 : -0.1), true); }
        function onSliderInput() { definirZoom(parseFloat(slider.value), true); }
        function onBotaoAjuste() { definirAjuste(!container.classList.contains('ajustando')); }

        container.addEventListener('pointerdown', onPointerDown); container.addEventListener('pointermove', onPointerMove);
        container.addEventListener('pointerup', onPointerUp); container.addEventListener('pointercancel', onPointerUp);
        container.addEventListener('wheel', onWheel, { passive: false });
        if (slider) slider.addEventListener('input', onSliderInput); if (botaoAjuste) botaoAjuste.addEventListener('click', onBotaoAjuste);

        return {
            carregar: function (url, inicial) {
                if (destroyado) return; var meu = ++token;
                est.pronto = false; est.x = inicial && inicial.x != null ? inicial.x : 50; est.y = inicial && inicial.y != null ? inicial.y : 50;
                est.zoom = inicial && inicial.zoom ? limitar(inicial.zoom, ZOOM_MIN, ZOOM_MAX) : 1;
                ponteiros.clear(); reiniciarGesto(); definirAjuste(false);
                camada.style.backgroundImage = 'url("' + String(url).replace(/"/g, '%22') + '")';
                aplicar(); if (controles) controles.hidden = false; if (aoImagem) aoImagem(true);
                var im = new Image(); im.onload = function () { if (meu !== token) return; est.nw = im.naturalWidth; est.nh = im.naturalHeight; est.pronto = true; aplicar(); }; im.src = url;
            },
            limpar: function () {
                if (destroyado) return; token++; est.pronto = false; est.x = 50; est.y = 50; est.zoom = 1;
                ponteiros.clear(); reiniciarGesto(); definirAjuste(false); camada.style.backgroundImage = ''; aplicar();
                if (controles) controles.hidden = true; if (aoImagem) aoImagem(false);
            },
            estado: function () { return { x: est.x, y: est.y, zoom: est.zoom }; },
            temImagem: function () { return est.pronto; }
        };
    }

    // ==========================================
    // DADOS E API
    // ==========================================
    function aguardarSupabase() {
        var i = 0; return new Promise(function (resolve) { (function loop() { if (window.supabaseClient) return resolve(window.supabaseClient); if (++i >= 30) return resolve(null); setTimeout(loop, 200); })(); });
    }
    function enviarArquivo(prefixo, corpo, extensao, contentType) {
        var caminho = estado.usuario.id + '/' + prefixo + '-' + Date.now() + '.' + extensao;
        var opcoes = contentType ? { contentType: contentType } : undefined;
        return estado.db.storage.from(BUCKET).upload(caminho, corpo, opcoes).then(function (r) {
            if (r.error) throw r.error; return estado.db.storage.from(BUCKET).getPublicUrl(caminho).data.publicUrl;
        });
    }

    function mostrarAtelie(existe) { $('atelie-vazio').hidden = existe; $('atelie-conteudo').hidden = !existe; $('atelie-abas').hidden = !existe; }
    function renderizarAtelie(atelie) {
        $('atelie-nome').textContent = atelie.name; $('atelie-handle').textContent = '@' + atelie.handle;
        $('atelie-bio').textContent = atelie.description || 'Nenhuma descrição adicionada.';
        var caixaAvatar = $('atelie-avatar'); var fotoPerfil = document.querySelector('#perfil-usuario img.foto-perfil');
        var urlAvatar = atelie.avatar_url || (fotoPerfil ? fotoPerfil.src : null);
        var mostrarIniciais = function () { caixaAvatar.textContent = ''; var span = document.createElement('span'); span.className = 'avatar-iniciais'; span.textContent = U.iniciais(atelie.name); caixaAvatar.appendChild(span); };
        caixaAvatar.textContent = ''; if (urlAvatar) { var img = document.createElement('img'); img.src = urlAvatar; img.alt = 'Avatar'; img.referrerPolicy = 'no-referrer'; img.onerror = mostrarIniciais; caixaAvatar.appendChild(img); } else mostrarIniciais();
        if (atelie.cover_url) {
            var imgCapa = $('atelie-capa-img'); var pos = lerPosicao(atelie.cover_position); var zoom = parseFloat(atelie.cover_zoom) || 1;
            imgCapa.src = atelie.cover_url; imgCapa.style.objectPosition = pos[0] + '% ' + pos[1] + '%';
            imgCapa.style.transformOrigin = pos[0] + '% ' + pos[1] + '%'; imgCapa.style.transform = 'scale(' + zoom + ')';
        }
    }

    function preencherPainel(atelie) {
        $('input-config-nome').value = atelie.name || ''; $('input-config-bio').value = atelie.description || '';
        estado.avatar = { arquivo: null, url: atelie.avatar_url || null, blobUrl: null, editado: false }; estado.capa = { arquivo: null, blobUrl: null };
        if (atelie.avatar_url) enquadradores.avatar.carregar(atelie.avatar_url); else enquadradores.avatar.limpar();
        if (atelie.cover_url) { var pos = lerPosicao(atelie.cover_position); enquadradores.capa.carregar(atelie.cover_url, { x: pos[0], y: pos[1], zoom: parseFloat(atelie.cover_zoom) || 1 }); } else enquadradores.capa.limpar();
    }

    function gerarAvatarRecortado() {
        var fonte = estado.avatar.arquivo ? estado.avatar.blobUrl : estado.avatar.url;
        if (!fonte) return Promise.resolve(null);
        return carregarImagem(fonte, !estado.avatar.arquivo).then(function (img) {
            var est = enquadradores.avatar.estado(); var lado0 = $('avatar-preview-container').clientWidth || 88;
            var s = Math.max(lado0 / img.naturalWidth, lado0 / img.naturalHeight); var lado = lado0 / (est.zoom * s);
            var sx = est.x / 100 * Math.max(0, img.naturalWidth - lado); var sy = est.y / 100 * Math.max(0, img.naturalHeight - lado);
            var SAIDA = 512; var canvas = document.createElement('canvas'); canvas.width = SAIDA; canvas.height = SAIDA;
            var ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, SAIDA, SAIDA);
            ctx.drawImage(img, sx, sy, lado, lado, 0, 0, SAIDA, SAIDA);
            return new Promise(function (ok) { canvas.toBlob(function (b) { ok(b); }, 'image/jpeg', 0.92); });
        }).catch(function () { return null; });
    }

    function salvarConfiguracao(e) {
        e.preventDefault(); if (!estado.atelie) return;
        var botao = $('btn-salvar-config'); estadoBotao(botao, true, 'Salvando...');
        var avatarUrl = estado.atelie.avatar_url; var capaUrl = estado.atelie.cover_url; var tarefas = Promise.resolve();
        if (estado.avatar.editado && enquadradores.avatar.temImagem()) {
            tarefas = tarefas.then(function () { return gerarAvatarRecortado().then(function (blob) {
                if (blob) return enviarArquivo('atelie-avatar', blob, 'jpg', 'image/jpeg');
                if (estado.avatar.arquivo) return enviarArquivo('atelie-avatar', estado.avatar.arquivo, extensaoDe(estado.avatar.arquivo), estado.avatar.arquivo.type);
                return null;
            }).then(function (url) { if (url) avatarUrl = url; }); });
        }
        if (estado.capa.arquivo) {
            tarefas = tarefas.then(function () { return enviarArquivo('atelie-capa', estado.capa.arquivo, extensaoDe(estado.capa.arquivo), estado.capa.arquivo.type).then(function (url) { capaUrl = url; }); });
        }
        tarefas.then(function () {
            var c = enquadradores.capa.estado();
            return estado.db.from('ateliers').update({ name: $('input-config-nome').value.trim(), description: $('input-config-bio').value.trim(), avatar_url: avatarUrl, cover_url: capaUrl, cover_position: c.x.toFixed(1) + '% ' + c.y.toFixed(1) + '%', cover_zoom: Number(c.zoom.toFixed(2)) }).eq('id', estado.atelie.id).select().single();
        }).then(function (r) {
            if (r.error) throw r.error; estado.atelie = r.data; renderizarAtelie(r.data); preencherPainel(r.data); Gaveta.fechar(); avisar('Ateliê atualizado com sucesso.');
        }).catch(function (err) { console.error(err); avisar('Não foi possível salvar. Tente novamente.', 'erro'); }).then(function () { estadoBotao(botao, false); });
    }

    function configurarPainelCanal() {
        var placeholderAvatar = $('avatar-preview-arrastavel').innerHTML;
        enquadradores.avatar = criarEnquadrador({
            container: $('avatar-preview-container'), camada: $('avatar-preview-arrastavel'), controles: $('avatar-ajuste'), slider: $('avatar-zoom'), botaoAjuste: $('avatar-btn-ajuste'),
            aoImagem: function (tem) { var camada = $('avatar-preview-arrastavel'); camada.classList.toggle('tem-imagem', tem); camada.innerHTML = tem ? '' : placeholderAvatar; },
            aoMudar: function () { estado.avatar.editado = true; }
        });
        enquadradores.capa = criarEnquadrador({
            container: $('capa-preview-container'), camada: $('capa-preview-arrastavel'), controles: $('capa-ajuste'), slider: $('capa-zoom'), botaoAjuste: $('capa-btn-ajuste'),
            aoImagem: function (tem) { $('capa-preview-container').hidden = !tem; $('capa-vazia').hidden = tem; }
        });
        var inputAvatar = $('input-config-avatar');
        $('btn-upload-avatar').addEventListener('click', function () { inputAvatar.click(); });
        inputAvatar.addEventListener('change', function () {
            var arquivo = inputAvatar.files[0]; inputAvatar.value = ''; if (!validarImagem(arquivo)) return;
            if (estado.avatar.blobUrl) URL.revokeObjectURL(estado.avatar.blobUrl); estado.avatar.arquivo = arquivo; estado.avatar.blobUrl = URL.createObjectURL(arquivo); enquadradores.avatar.carregar(estado.avatar.blobUrl); estado.avatar.editado = true;
        });
        var inputCapa = $('input-config-capa');
        $('btn-upload-capa').addEventListener('click', function () { inputCapa.click(); });
        inputCapa.addEventListener('change', function () {
            var arquivo = inputCapa.files[0]; inputCapa.value = ''; if (!validarImagem(arquivo)) return;
            if (estado.capa.blobUrl) URL.revokeObjectURL(estado.capa.blobUrl); estado.capa.arquivo = arquivo; estado.capa.blobUrl = URL.createObjectURL(arquivo); enquadradores.capa.carregar(estado.capa.blobUrl);
        });
        $('form-config-atelie').addEventListener('submit', salvarConfiguracao);
    }

    function configurarPainelRedacao() {
        var preview = $('capa-artigo-preview'); var camada = $('capa-artigo-arrastavel'); var input = $('input-capa-artigo');
        function limpar() { estado.capaArtigo.arquivo = null; camada.style.backgroundImage = ''; preview.hidden = true; }
        ganchos.limparCapaArtigo = limpar;
        $('btn-upload-capa-artigo').addEventListener('click', function () { input.click(); });
        input.addEventListener('change', function () {
            var arquivo = input.files[0]; input.value = ''; if (!validarImagem(arquivo)) return;
            estado.capaArtigo.arquivo = arquivo; var leitor = new FileReader();
            leitor.onload = function (ev) { camada.style.backgroundImage = 'url("' + ev.target.result + '")'; preview.hidden = false; }; leitor.readAsDataURL(arquivo);
        });
        $('btn-remover-capa-artigo').addEventListener('click', limpar);
        $('btn-descartar-rascunho').addEventListener('click', function () {
            if (!confirm('Tem certeza que deseja descartar este rascunho?')) return; ganchos.resetarEditor(); selecionarAba('canal');
        });
    }

    function configurarCriacao() {
        var modal = $('modal-criar-atelie');
        function abrirModal() { modal.hidden = false; $('input-nome-atelie').focus(); } function fecharModal() { modal.hidden = true; }
        $('btn-criar-atelie').addEventListener('click', abrirModal); $('btn-fechar-modal').addEventListener('click', fecharModal); modal.addEventListener('click', function (e) { if (e.target === modal) fecharModal(); });
        $('form-criar-atelie').addEventListener('submit', function (e) {
            e.preventDefault(); var botao = $('btn-salvar-atelie'); var nome = $('input-nome-atelie').value.trim(); var bio = $('input-bio-atelie').value.trim();
            if (!nome) { avisar('O nome do ateliê é obrigatório.', 'erro'); return; } botao.disabled = true; botao.textContent = 'Abrindo...';
            estado.db.rpc('gerar_handle_unico').then(function (r) {
                if (r.error) throw r.error;
                return estado.db.from('ateliers').insert([{ owner_id: estado.usuario.id, name: nome, handle: r.data, description: bio, cover_position: '50% 50%', cover_zoom: 1 }]).select().single();
            }).then(function (r) {
                if (r.error) throw r.error; fecharModal(); estado.atelie = r.data; mostrarAtelie(true); renderizarAtelie(r.data); preencherPainel(r.data); carregarCanal();
            }).catch(function (err) { console.error(err); avisar('Erro ao abrir o ateliê.', 'erro'); }).then(function () { botao.disabled = false; botao.textContent = 'Criar Ateliê'; });
        });
    }

    function carregarAtelie() {
        return estado.db.from('ateliers').select('*').eq('owner_id', estado.usuario.id).maybeSingle().then(function (r) {
            if (r.error) { console.error('Erro ao buscar ateliê:', r.error); return; }
            if (!r.data) { mostrarAtelie(false); return; } estado.atelie = r.data; mostrarAtelie(true); renderizarAtelie(r.data); preencherPainel(r.data); carregarCanal();
        });
    }

    function montarCardPost(post) {
        var doc = new DOMParser().parseFromString(post.content || '', 'text/html'); doc.querySelectorAll('figure, img, figcaption, style, script').forEach(function (el) { el.remove(); });
        var texto = (doc.body.textContent || '').replace(/\s+/g, ' ').trim(); var trecho = texto.length > 220 ? texto.slice(0, 220).trim() + '…' : texto; var id = escapar(post.id);
        var card = document.createElement('article'); card.className = 'canal-post';
        card.innerHTML = (post.cover_url ? '<div class="canal-post-capa"><img src="' + escapar(post.cover_url) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></div>' : '') +
            '<div class="canal-post-corpo"><div class="canal-post-meta">' + (post.category ? '<span class="canal-post-categoria">' + escapar(post.category) + '</span>' : '') + '<span>' + escapar(formatarData(post.created_at)) + '</span></div><h2 class="canal-post-titulo">' + escapar(post.title || 'Sem título') + '</h2>' +
            '<div class="canal-post-trecho">' + escapar(trecho) + '</div><div class="canal-post-rodape"><button type="button" class="canal-post-ler" data-ler="' + id + '">Ler artigo' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></button><div class="canal-post-acoes">' +
            '<button type="button" class="perigo" data-excluir="' + id + '" title="Excluir" aria-label="Excluir publicação"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg></button>' + '</div></div></div>';
        return card;
    }

    function carregarCanal() {
        var lista = $('canal-lista'); var vazio = $('canal-vazio'); var meu = ++estado.canalToken; vazio.hidden = true; lista.innerHTML = '<div class="canal-carregando"><div class="canal-skeleton"></div><div class="canal-skeleton"></div></div>';
        estado.db.from('posts').select('id, title, content, cover_url, category, created_at').eq('author_id', estado.usuario.id).order('created_at', { ascending: false }).then(function (r) {
            if (meu !== estado.canalToken) return; lista.innerHTML = ''; if (r.error || !r.data || r.data.length === 0) { vazio.hidden = false; return; }
            var fragmento = document.createDocumentFragment(); r.data.forEach(function (post) { fragmento.appendChild(montarCardPost(post)); }); lista.appendChild(fragmento);
        });
    }

    function configurarCanal() {
        $('canal-lista').addEventListener('click', function (e) {
            var ler = e.target.closest('[data-ler]'); if (ler) { window.location.href = 'post.html?id=' + encodeURIComponent(ler.dataset.ler); return; }
            var excluir = e.target.closest('[data-excluir]'); if (!excluir) return; if (!confirm('Excluir esta publicação?')) return;
            estado.db.from('posts').delete().eq('id', excluir.dataset.excluir).then(function (r) { if (r.error) return avisar('Não foi possível excluir.', 'erro'); avisar('Publicação excluída.'); carregarCanal(); });
        });
    }

    function configurarDropdown() {
        var raiz = $('dropdown-categoria'); var gatilho = raiz.querySelector('.dropdown-gatilho'); var valorEl = raiz.querySelector('.dropdown-valor');
        var iconeEl = gatilho.querySelector('.dropdown-icone'); var campo = $('input-categoria-artigo'); var itens = Array.prototype.slice.call(raiz.querySelectorAll('[role="option"]'));
        function abrir() { raiz.classList.add('aberto'); gatilho.setAttribute('aria-expanded', 'true'); var selecionado = itens.filter(function (i) { return i.getAttribute('aria-selected') === 'true'; })[0] || itens[0]; if (selecionado) selecionado.focus(); }
        function fechar(devolverFoco) { raiz.classList.remove('aberto'); gatilho.setAttribute('aria-expanded', 'false'); if (devolverFoco) gatilho.focus(); }
        function escolher(item) { itens.forEach(function (i) { i.setAttribute('aria-selected', i === item ? 'true' : 'false'); }); campo.value = item.dataset.valor; valorEl.textContent = item.dataset.valor; iconeEl.innerHTML = item.querySelector('.dropdown-icone').innerHTML; fechar(true); }
        gatilho.addEventListener('click', function () { raiz.classList.contains('aberto') ? fechar() : abrir(); });
        gatilho.addEventListener('keydown', function (e) { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); abrir(); } });
        itens.forEach(function (item, i) {
            item.addEventListener('click', function () { escolher(item); });
            item.addEventListener('keydown', function (e) {
                var mover = function (idx) { e.preventDefault(); itens[(idx + itens.length) % itens.length].focus(); };
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); escolher(item); }
                else if (e.key === 'Escape') { e.preventDefault(); fechar(true); }
                else if (e.key === 'ArrowDown') mover(i + 1); else if (e.key === 'ArrowUp') mover(i - 1);
                else if (e.key === 'Home') mover(0); else if (e.key === 'End') mover(itens.length - 1); else if (e.key === 'Tab') fechar();
            });
        });
        document.addEventListener('pointerdown', function (e) { if (!raiz.contains(e.target)) fechar(); });
    }

    function selecionarAba(nome) {
        var redacao = nome === 'redacao'; Gaveta.fechar(); Rolagem.topo();
        document.body.classList.toggle('atelie-modo-redacao', redacao);
        document.querySelectorAll('.aba-btn').forEach(function (b) { b.classList.toggle('ativa', b.dataset.aba === nome); });
        var main = $('atelie-main'); if (main) main.classList.toggle('modo-redacao', redacao);
        $('wrapper-canal').hidden = redacao; $('redacao-editor').hidden = !redacao; $('editor-topo-custom').hidden = !redacao;
        var btnVoltar = $('btn-voltar-redacao'); if (btnVoltar) btnVoltar.hidden = !redacao;
        Gaveta.mostrarPainel(redacao ? 'redacao' : 'canal');
        if (!redacao && estado.atelie) carregarCanal();
    }

    function configurarAbas() { document.querySelectorAll('.aba-btn').forEach(function (b) { b.addEventListener('click', function () { selecionarAba(b.dataset.aba); }); }); }
    function configurarVoltarRedacao() {
        var botao = $('btn-voltar-redacao'); if (!botao) return;
        botao.addEventListener('click', function () {
            var temConteudo = editor && editor.temConteudo && editor.temConteudo();
            if (!temConteudo || confirm('Tem certeza que deseja apagar o que escreveu?')) { if (editor) editor.resetar(); selecionarAba('canal'); }
        });
    }

    // ==========================================
    // EDITOR
    // ==========================================
    function criarEditor() {
        var conteudo = $('input-conteudo'); var folha = $('editor-folha'); var barra = $('img-flutuante'); var selecao = $('img-selecao');
        var rotuloSelecao = $('img-selecao-rotulo'); var indicador = $('img-indicador'); var menu = $('img-menu');
        var BLOCOS = new Set(['P', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'UL', 'OL', 'FIGURE', 'DIV', 'PRE']);
        var figura = null; var rangeSalvo = null; var arraste = null; var fantasma = null; var ignorarClique = false; var quadroPendente = false;
        var btnCor = $('btn-cor-texto'); var inputCor = $('input-cor-texto'); var painelCores = $('painel-cores');
        document.execCommand('defaultParagraphSeparator', false, 'p');

        function atualizarContadores() {
            var texto = conteudo.textContent.trim(); var vazio = texto === '' && !conteudo.querySelector('img');
            conteudo.dataset.vazio = vazio ? 'true' : 'false';
            var palavras = texto ? texto.split(/\s+/).length : 0; var minutos = palavras === 0 ? 0 : Math.max(1, Math.round(palavras / 200));
            $('contador-palavras').textContent = palavras + (palavras === 1 ? ' palavra' : ' palavras'); $('tempo-leitura').textContent = minutos + ' min de leitura';
        }
        function temConteudo() { return !!(($('input-titulo').value.trim()) || conteudo.textContent.trim() || conteudo.querySelector('img')); }

        conteudo.addEventListener('input', function () { atualizarContadores(); agendarPosicao(); });
        document.addEventListener('selectionchange', function () {
            var sel = window.getSelection();
            if (sel.rangeCount && conteudo.contains(sel.anchorNode)) { rangeSalvo = sel.getRangeAt(0).cloneRange(); atualizarBarra(); }
        });

        document.querySelectorAll('.editor-toolbar button[data-cmd]').forEach(function (botao) {
            botao.addEventListener('mousedown', function (e) { e.preventDefault(); });
            botao.addEventListener('click', function (e) {
                e.preventDefault(); var cmd = botao.dataset.cmd; var valor = botao.dataset.value || null;
                if (cmd === 'formatBlock' && document.queryCommandValue('formatBlock').toLowerCase() === valor) valor = 'p';
                conteudo.focus(); document.execCommand(cmd, false, valor); atualizarContadores(); atualizarBarra();
            });
        });

        function atualizarBarra() {
            document.querySelectorAll('.editor-toolbar button[data-cmd]').forEach(function (botao) {
                var cmd = botao.dataset.cmd;
                if (cmd === 'formatBlock') { botao.classList.toggle('ativo', document.queryCommandValue('formatBlock').toLowerCase() === botao.dataset.value); }
                else { botao.classList.toggle('ativo', document.queryCommandState(cmd)); }
            });
            if (btnCor) btnCor.classList.toggle('ativo', document.queryCommandState('foreColor'));
        }

        if (btnCor && painelCores) {
            btnCor.addEventListener('mousedown', function(e) { e.preventDefault(); });
            btnCor.addEventListener('click', function (e) { e.stopPropagation(); painelCores.hidden = !painelCores.hidden; });
            document.addEventListener('click', function (e) { if (painelCores.hidden) return; if (btnCor.contains(e.target) || painelCores.contains(e.target)) return; painelCores.hidden = true; });
            painelCores.addEventListener('mousedown', function(e) { e.preventDefault(); });
            painelCores.querySelectorAll('.cor-btn').forEach(function (b) {
                b.addEventListener('click', function () { conteudo.focus(); document.execCommand('foreColor', false, b.dataset.cor); btnCor.classList.add('ativo'); });
            });
        }

        if (inputCor) {
            inputCor.addEventListener('input', function (e) { conteudo.focus(); document.execCommand('foreColor', false, e.target.value); btnCor.classList.add('ativo'); atualizarContadores(); });
        }

        conteudo.addEventListener('paste', function (e) { e.preventDefault(); var texto = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, texto); });
        conteudo.addEventListener('dragstart', function (e) { if (e.target.tagName === 'IMG') e.preventDefault(); });

        function normalizarBlocos() {
            var atual = null;
            Array.prototype.slice.call(conteudo.childNodes).forEach(function (no) {
                if (no.nodeType === 1 && BLOCOS.has(no.tagName)) { atual = null; return; }
                if (no.nodeType === 3 && no.textContent === '' && !atual) { no.remove(); return; }
                if (!atual) { atual = document.createElement('p'); no.before(atual); } atual.appendChild(no);
            });
        }
        function blocoTopo(no) { while (no && no.parentNode !== conteudo) no = no.parentNode; return no && no.nodeType === 1 ? no : null; }
        function garantirParagrafoFinal() { var ultimo = conteudo.lastElementChild; if (!ultimo || ultimo.tagName === 'FIGURE') { var p = document.createElement('p'); p.innerHTML = '<br>'; conteudo.appendChild(p); return p; } return null; }
        function colocarCursor(el) { var r = document.createRange(); r.selectNodeContents(el); r.collapse(true); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); }

        function criarFigura(url) {
            var fig = document.createElement('figure'); fig.className = 'img-bloco'; fig.dataset.size = TAMANHO_IMG_PADRAO; fig.dataset.align = 'center'; fig.style.width = TAMANHOS_IMG[TAMANHO_IMG_PADRAO] + '%'; fig.contentEditable = 'false';
            var img = document.createElement('img'); img.src = url; img.alt = ''; img.loading = 'lazy'; img.draggable = false; img.addEventListener('load', agendarPosicao);
            var legenda = document.createElement('figcaption'); legenda.contentEditable = 'true'; legenda.dataset.ph = 'Adicionar legenda (opcional)';
            fig.appendChild(img); fig.appendChild(legenda); return fig;
        }

        function inserirFigura(fig) {
            var no = null; var deslocamento = 0;
            if (rangeSalvo && conteudo.contains(rangeSalvo.startContainer)) { no = rangeSalvo.startContainer; deslocamento = rangeSalvo.startOffset; }
            normalizarBlocos(); var topo = no && conteudo.contains(no) ? blocoTopo(no) : null;
            if (topo && topo.tagName === 'P') {
                var vazio = !topo.textContent.trim() && !topo.querySelector('img');
                if (vazio) { topo.replaceWith(fig); } else {
                    var r = document.createRange(); r.setStart(no, deslocamento); r.setEndAfter(topo.lastChild); var resto = r.extractContents();
                    var depois = document.createElement('p'); depois.appendChild(resto); if (!depois.textContent.trim()) depois.innerHTML = '<br>';
                    topo.after(fig); fig.after(depois); if (!topo.textContent.trim()) topo.remove();
                }
            } else if (topo) { topo.after(fig); } else { conteudo.appendChild(fig); }
            var criado = garantirParagrafoFinal(); conteudo.focus({ preventScroll: true });
            if (criado) colocarCursor(criado); else if (fig.nextElementSibling) colocarCursor(fig.nextElementSibling);
            atualizarContadores(); selecionarFigura(fig); fig.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }

        var botaoImagem = $('btn-inserir-img'); var inputImagem = $('input-img');
        botaoImagem.addEventListener('mousedown', function (e) { e.preventDefault(); }); botaoImagem.addEventListener('click', function (e) { e.preventDefault(); inputImagem.click(); });
        inputImagem.addEventListener('change', function () {
            var arquivo = inputImagem.files[0]; inputImagem.value = ''; if (!validarImagem(arquivo, REGEX_IMG_POST)) return;
            botaoImagem.disabled = true; enviarArquivo('img', arquivo, extensaoDe(arquivo)).then(function (url) { inserirFigura(criarFigura(url)); })
            .catch(function (err) { console.error(err); avisar('Erro ao inserir imagem.', 'erro'); }).then(function () { botaoImagem.disabled = false; });
        });

        function definirTamanho(fig, chave) { fig.dataset.size = chave; fig.style.width = TAMANHOS_IMG[chave] + '%'; if (chave === 'g') fig.dataset.align = 'center'; }
        function definirLarguraLivre(fig, pct) {
            var chave = Object.keys(TAMANHOS_IMG).filter(function (k) { return Math.abs(TAMANHOS_IMG[k] - pct) < 1.5; })[0];
            fig.dataset.size = chave || 'c'; fig.style.width = (chave ? TAMANHOS_IMG[chave] : pct).toFixed(1) + '%'; if (pct >= 99) fig.dataset.align = 'center';
        }
        function definirAlinhamento(fig, alinhamento) { if (alinhamento !== 'center' && parseFloat(fig.style.width) > 85) definirTamanho(fig, 'm'); fig.dataset.align = alinhamento; }

        function atualizarEstados() {
            if (!figura) return;
            [barra, menu].forEach(function (c) { c.querySelectorAll('[data-tam]').forEach(function (b) { b.classList.toggle('ativo', b.dataset.tam === figura.dataset.size); }); c.querySelectorAll('[data-alin]').forEach(function (b) { b.classList.toggle('ativo', b.dataset.alin === figura.dataset.align); }); });
            selecao.dataset.align = figura.dataset.align;
        }
        function posicionar() {
            if (!figura) return; var img = figura.querySelector('img'); if (!img) return;
            var f = img.getBoundingClientRect(); var p = folha.getBoundingClientRect(); var ox = p.left + folha.clientLeft; var oy = p.top + folha.clientTop;
            selecao.style.left = (f.left - ox) + 'px'; selecao.style.top = (f.top - oy) + 'px'; selecao.style.width = f.width + 'px'; selecao.style.height = f.height + 'px';
            var metade = barra.offsetWidth / 2; var cx = limitar(f.left - ox + f.width / 2, metade + 8, folha.clientWidth - metade - 8);
            var topo = f.top - oy - 50; if (topo < 4) topo = f.bottom - oy + 10; barra.style.left = cx + 'px'; barra.style.top = topo + 'px';
        }
        function agendarPosicao() { if (quadroPendente) return; quadroPendente = true; requestAnimationFrame(function () { quadroPendente = false; posicionar(); }); }
        function selecionarFigura(fig) {
            if (figura && figura !== fig) figura.classList.remove('selecionada');
            figura = fig || null; if (!figura) { barra.classList.remove('ativa'); selecao.classList.remove('ativa'); fecharMenu(); return; }
            figura.classList.add('selecionada'); barra.classList.add('ativa'); selecao.classList.add('ativa'); atualizarEstados(); posicionar();
        }

        conteudo.addEventListener('click', function (e) { if (ignorarClique) return; var fig = e.target.closest('figure.img-bloco'); selecionarFigura(fig); if (fig && !e.target.closest('figcaption')) window.getSelection().removeAllRanges(); });
        document.addEventListener('click', function (e) { if (ignorarClique) return; if (!e.target.closest('#input-conteudo, #img-flutuante, #img-selecao, #img-menu')) selecionarFigura(null); });
        window.addEventListener('resize', agendarPosicao);
        var main = $('atelie-main'); if (main) main.addEventListener('scroll', agendarPosicao, { passive: true });
        window.addEventListener('scroll', function () { if (!menu.hidden) fecharMenu(); agendarPosicao(); }, { passive: true, capture: true });
        if ('ResizeObserver' in window) new ResizeObserver(agendarPosicao).observe(conteudo);

        function removerFigura() { if (!figura) return; var alvo = figura; selecionarFigura(null); alvo.remove(); atualizarContadores(); }
        function moverPosicao(direcao) {
            if (!figura) return; var vizinho = direcao < 0 ? figura.previousElementSibling : figura.nextElementSibling; if (!vizinho) return;
            if (direcao < 0) vizinho.before(figura); else vizinho.after(figura); garantirParagrafoFinal(); figura.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        function executar(botao) {
            if (!figura) return; var d = botao.dataset;
            if (d.tam) definirTamanho(figura, d.tam); else if (d.alin) definirAlinhamento(figura, d.alin);
            else if (d.acao === 'remover') { removerFigura(); return; } else if (d.acao === 'subir') moverPosicao(-1); else if (d.acao === 'descer') moverPosicao(1);
            else if (d.acao === 'legenda') { var legenda = figura.querySelector('figcaption'); if (legenda) { legenda.focus(); colocarCursor(legenda); } }
            atualizarEstados(); posicionar();
        }

        barra.addEventListener('mousedown', function (e) { if (!e.target.closest('.grip')) e.preventDefault(); });
        barra.addEventListener('click', function (e) { var botao = e.target.closest('button'); if (botao && botao.dataset.acao !== 'mover') executar(botao); });
        function abrirMenu(x, y) { atualizarEstados(); menu.hidden = false; menu.style.left = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8)) + 'px'; menu.style.top = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8)) + 'px'; }
        function fecharMenu() { menu.hidden = true; }

        conteudo.addEventListener('contextmenu', function (e) { var fig = e.target.closest('figure.img-bloco'); if (!fig || e.target.closest('figcaption')) return; e.preventDefault(); selecionarFigura(fig); abrirMenu(e.clientX, e.clientY); });
        menu.addEventListener('mousedown', function (e) { e.preventDefault(); }); menu.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        menu.addEventListener('click', function (e) { var botao = e.target.closest('button'); if (!botao) return; executar(botao); fecharMenu(); });
        document.addEventListener('pointerdown', function (e) { if (!menu.hidden && !menu.contains(e.target)) fecharMenu(); });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { if (!menu.hidden) fecharMenu(); else if (arraste && arraste.ativo) cancelarArraste(); else if (figura) selecionarFigura(null); return; }
            if (!figura || (e.key !== 'Backspace' && e.key !== 'Delete')) return;
            var alvo = e.target; if (alvo.closest && (alvo.closest('figcaption') || alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA')) return;
            e.preventDefault(); removerFigura();
        });

        selecao.querySelectorAll('.img-handle').forEach(function (alca) {
            alca.addEventListener('pointerdown', function (e) {
                if (!figura) return; e.preventDefault(); e.stopPropagation(); alca.setPointerCapture(e.pointerId);
                var fig = figura; var lado = alca.dataset.h.indexOf('e') !== -1 ? 1 : -1; var fator = fig.dataset.align === 'center' ? 2 : 1;
                var larguraInicial = fig.getBoundingClientRect().width; var base = conteudo.clientWidth; var x0 = e.clientX; selecao.classList.add('redimensionando');
                function mover(ev) { var nova = larguraInicial + (ev.clientX - x0) * lado * fator; var pct = limitar(nova / base * 100, 12, 100); if (pct > 96) pct = 100; definirLarguraLivre(fig, pct); rotuloSelecao.textContent = Math.round(pct) + '%'; atualizarEstados(); posicionar(); }
                function fim() { alca.removeEventListener('pointermove', mover); alca.removeEventListener('pointerup', fim); alca.removeEventListener('pointercancel', fim); selecao.classList.remove('redimensionando'); }
                alca.addEventListener('pointermove', mover); alca.addEventListener('pointerup', fim); alca.addEventListener('pointercancel', fim);
            });
        });

        function alvoDeSoltura(x, y) {
            var area = conteudo.getBoundingClientRect(); var filhos = Array.prototype.slice.call(conteudo.children).filter(function (c) { return c !== arraste.fig; }); var alvo = null; var depois = false;
            filhos.forEach(function (filho) { if (alvo) return; var r = filho.getBoundingClientRect(); if (y >= r.top && y <= r.bottom) { alvo = filho; depois = y > r.top + r.height / 2; } });
            if (!alvo && filhos.length) { if (y < filhos[0].getBoundingClientRect().top) { alvo = filhos[0]; depois = false; } else { alvo = filhos[filhos.length - 1]; depois = true; } }
            var zona = x < area.left + area.width * 0.33 ? 'left' : x > area.left + area.width * 0.67 ? 'right' : 'center'; return { alvo: alvo, depois: depois, zona: zona };
        }
        function atualizarIndicador(x, y) {
            var info = alvoDeSoltura(x, y); arraste.info = info; if (!info.alvo) { indicador.hidden = true; return; }
            var r = info.alvo.getBoundingClientRect(); var area = conteudo.getBoundingClientRect(); var p = folha.getBoundingClientRect(); var ox = p.left + folha.clientLeft; var oy = p.top + folha.clientTop;
            var largura = info.zona === 'center' ? area.width : area.width * 0.42; var esquerda = info.zona === 'right' ? area.right - largura : area.left;
            indicador.style.top = ((info.depois ? r.bottom : r.top) - oy) + 'px'; indicador.style.left = (esquerda - ox) + 'px'; indicador.style.width = largura + 'px';
            indicador.querySelector('span').textContent = info.zona === 'left' ? 'Esquerda · texto ao redor' : info.zona === 'right' ? 'Direita · texto ao redor' : 'Centralizada'; indicador.hidden = false;
        }
        function iniciarArraste() { arraste.ativo = true; ignorarClique = true; document.body.classList.add('img-arrastando'); arraste.fig.classList.add('arrastando'); fantasma = document.createElement('div'); fantasma.className = 'img-fantasma'; var miniatura = document.createElement('img'); miniatura.src = arraste.fig.querySelector('img').src; fantasma.appendChild(miniatura); document.body.appendChild(fantasma); }
        function encerrarArraste() { document.body.classList.remove('img-arrastando'); if (fantasma) { fantasma.remove(); fantasma = null; } indicador.hidden = true; if (arraste) arraste.fig.classList.remove('arrastando'); setTimeout(function () { ignorarClique = false; }, 0); }
        function cancelarArraste() { if (!arraste) return; encerrarArraste(); arraste = null; }

        barra.addEventListener('pointerdown', function (e) { if (!e.target.closest('.grip') || !figura) return; e.preventDefault(); arraste = { fig: figura, x: e.clientX, y: e.clientY, ativo: false, info: null }; iniciarArraste(); fantasma.style.left = e.clientX + 'px'; fantasma.style.top = e.clientY + 'px'; atualizarIndicador(e.clientX, e.clientY); });
        document.addEventListener('pointermove', function (e) {
            if (!arraste) return; if (!arraste.ativo) { if (Math.hypot(e.clientX - arraste.x, e.clientY - arraste.y) < 6) return; iniciarArraste(); }
            fantasma.style.left = e.clientX + 'px'; fantasma.style.top = e.clientY + 'px'; var visivel = Rolagem.areaVisivel();
            if (e.clientY < visivel.top + 130) Rolagem.por(-14); else if (e.clientY > visivel.bottom - 90) Rolagem.por(14);
            atualizarIndicador(e.clientX, e.clientY);
        });
        function soltarArraste() {
            if (!arraste) return; var a = arraste; arraste = null; if (!a.ativo) return; encerrarArraste();
            var info = a.info; if (info && info.alvo) { if (info.depois) info.alvo.after(a.fig); else info.alvo.before(a.fig); definirAlinhamento(a.fig, info.zona); garantirParagrafoFinal(); } selecionarFigura(a.fig);
        }
        document.addEventListener('pointerup', soltarArraste); document.addEventListener('pointercancel', cancelarArraste);

        function resetar() { $('input-titulo').value = ''; conteudo.innerHTML = ''; selecionarFigura(null); rangeSalvo = null; ganchos.limparCapaArtigo(); atualizarContadores(); }
        function htmlParaPublicar() {
            var clone = conteudo.cloneNode(true); clone.querySelectorAll('.selecionada, .arrastando').forEach(function (el) { el.classList.remove('selecionada', 'arrastando'); });
            clone.querySelectorAll('figcaption').forEach(function (legenda) { if (!legenda.textContent.trim()) legenda.remove(); else { legenda.removeAttribute('contenteditable'); legenda.removeAttribute('data-ph'); } });
            var temFlutuante = false;
            clone.querySelectorAll('figure.img-bloco').forEach(function (fig) {
                fig.removeAttribute('contenteditable'); fig.removeAttribute('draggable'); var largura = fig.style.width || '55%'; var alinhamento = fig.dataset.align || 'center'; var estilo = 'box-sizing:border-box;width:' + largura + ';max-width:100%;';
                if (alinhamento === 'left') { estilo += 'float:left;margin:0.4rem 1.6rem 1rem 0;'; temFlutuante = true; } else if (alinhamento === 'right') { estilo += 'float:right;margin:0.4rem 0 1rem 1.6rem;'; temFlutuante = true; } else estilo += 'clear:both;margin:2rem auto;';
                fig.setAttribute('style', estilo); var img = fig.querySelector('img'); if (img) { img.removeAttribute('draggable'); img.setAttribute('style', 'display:block;width:100%;height:auto;border-radius:6px;'); }
            });
            while (clone.lastElementChild && clone.lastElementChild.tagName === 'P' && !clone.lastElementChild.textContent.trim() && !clone.lastElementChild.querySelector('img,figure')) { clone.lastElementChild.remove(); }
            if (temFlutuante) clone.insertAdjacentHTML('beforeend', '<div style="clear:both"></div>'); return U.sanitizarHtml(clone.innerHTML.trim());
        }
        atualizarContadores();

        return { resetar: resetar, temConteudo: temConteudo, htmlParaPublicar: htmlParaPublicar, estaVazio: function () { return conteudo.textContent.trim() === '' && !conteudo.querySelector('img'); } };
    }

    // ==========================================
    // PAGINAÇÃO DA TOOLBAR (FIXO 5 ITENS)
    // ==========================================
    function iniciarPaginacaoToolbar() {
        var container = $('editor-toolbar-container');
        var btnPrev = $('btn-toolbar-prev');
        var btnNext = $('btn-toolbar-next');
        
        if (!container || !btnPrev || !btnNext) return;

        var elementos = Array.prototype.slice.call(container.querySelectorAll('button, .editor-divisor'));
        var paginas = [];
        var paginaAtual = 0;

        function agrupar() {
            paginas = [];
            var pagina = [];
            
            elementos.forEach(function (el) {
                // Ignora divisores ao contar (para não gastar um slot de 5)
                if (!el.classList.contains('editor-divisor')) {
                    pagina.push(el);
                } else {
                    pagina.push(el); // Adiciona o divisor à página atual
                }

                // Conta quantos BOTÕES (ignorando divisores) tem na página
                var qtdBotoes = pagina.filter(function (item) { return !item.classList.contains('editor-divisor'); }).length;

                // Se atingiu 5 botões, fecha a página
                if (qtdBotoes === 5) {
                    paginas.push(pagina);
                    pagina = [];
                }
            });
            
            if (pagina.filter(function (item) { return !item.classList.contains('editor-divisor'); }).length > 0) {
                paginas.push(pagina);
            }
        }

        function calcular() {
            if (window.innerWidth > 768) {
                // Desktop: mostra tudo, esconde setas
                elementos.forEach(function (el) { el.style.display = ''; });
                btnPrev.style.display = 'none';
                btnNext.style.display = 'none';
                return;
            }
            
            // Mobile: exibe setas e faz a paginação
            btnPrev.style.display = 'inline-flex';
            btnNext.style.display = 'inline-flex';

            agrupar();
            
            // Esconde todos
            elementos.forEach(function (el) { el.style.display = 'none'; });
            
            paginaAtual = 0;
            mostrarPagina();
        }

        function mostrarPagina() {
            if (paginas.length === 0) return;
            
            // Esconde todos
            elementos.forEach(function (el) { el.style.display = 'none'; });
            
            // Mostra os da página atual
            paginas[paginaAtual].forEach(function (el) { 
                el.style.display = el.classList.contains('editor-divisor') ? 'block' : 'inline-flex'; 
            });

            btnPrev.disabled = paginaAtual === 0;
            btnNext.disabled = paginaAtual === paginas.length - 1;
        }

        btnPrev.addEventListener('click', function () { if (paginaAtual > 0) { paginaAtual--; mostrarPagina(); } });
        btnNext.addEventListener('click', function () { if (paginaAtual < paginas.length - 1) { paginaAtual++; mostrarPagina(); } });

        var timerResize;
        window.addEventListener('resize', function () {
            clearTimeout(timerResize);
            timerResize = setTimeout(calcular, 250);
        });

        // Inicializa
        setTimeout(calcular, 100);
    }

    // ==========================================
    // INICIALIZAÇÃO
    // ==========================================
    function configurarPublicacao() {
        var botao = $('btn-publicar-atelie');
        botao.addEventListener('click', function () {
            var titulo = $('input-titulo').value.trim(); if (!titulo) { avisar('Adicione um título ao seu conteúdo.', 'erro'); return; }
            if (!editor || editor.estaVazio()) { avisar('Escreva algo antes de publicar!', 'erro'); return; }
            botao.disabled = true; botao.textContent = 'Publicando...'; var capaUrl = null; var tarefa = Promise.resolve();
            if (estado.capaArtigo.arquivo) { var arq = estado.capaArtigo.arquivo; tarefa = enviarArquivo('capa-post', arq, extensaoDe(arq), arq.type).then(function (url) { capaUrl = url; }).catch(function () { capaUrl = null; }); }
            tarefa.then(function () { return estado.db.from('posts').insert([{ author_id: estado.usuario.id, title: titulo, content: editor.htmlParaPublicar(), cover_url: capaUrl, category: $('input-categoria-artigo').value }]); })
            .then(function (r) { if (r.error) throw r.error; avisar('Conteúdo publicado com sucesso no seu canal!'); editor.resetar(); selecionarAba('canal'); })
            .catch(function (err) { console.error(err); avisar('Erro ao publicar.', 'erro'); }).then(function () { botao.disabled = false; botao.textContent = 'Publicar'; });
        });
    }

    function configurarTeclado() {
        document.addEventListener('focusin', function (e) {
            var alvo = e.target; if (!alvo || !alvo.matches) return; if (!alvo.matches('input, textarea')) return;
            setTimeout(function () { try { alvo.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {} }, 300);
        });
    }

    function iniciar() {
        aguardarSupabase().then(function (db) {
            if (!db) { console.error('Supabase não carregado.'); return null; }
            estado.db = db; return db.auth.getSession();
        }).then(function (r) {
            if (!r || !r.data.session) { window.location.href = 'login.html'; return null; }
            estado.usuario = r.data.session.user;
            [['Gaveta', Gaveta.iniciar], ['Painel Canal', configurarPainelCanal], ['Painel Redação', configurarPainelRedacao],
             ['Dropdown', configurarDropdown], ['Criação', configurarCriacao], ['Canal', configurarCanal],
             ['Abas', configurarAbas], ['Teclado', configurarTeclado], ['Voltar Redação', configurarVoltarRedacao],
             ['Paginacao Toolbar', iniciarPaginacaoToolbar]].forEach(function (par) {
                try { par[1](); } catch (e) { console.error(par[0] + ':', e); }
            });
            try { editor = criarEditor(); ganchos.resetarEditor = editor.resetar; configurarPublicacao(); } catch (e) { console.error('Editor:', e); }
            return carregarAtelie();
        }).catch(function (e) { console.error('Inicialização:', e); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();