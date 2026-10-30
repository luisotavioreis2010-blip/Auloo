/* ==============================================================
   ATELIE.JS — v604 (Complete, Skeleton Loader & Marca Texto)
   ============================================================== */
(function () {
    'use strict';

    var U = window.utils;
    if (!U) { console.error('atelie.js: utils ausente'); return; }

    var BUCKET = 'avatars';
    var MAX_MB = 5;
    var ZOOM_MIN = 1, ZOOM_MAX = 3, ZOOM_INICIAL = 1;
    var TAMANHOS_IMG = { p: 30, m: 55, g: 100 };
    var TAMANHO_IMG_PADRAO = 'm';
    var EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
    var REGEX_IMG = /^image\/(jpeg|png|webp|gif)$/;
    var MOBILE_MAX = 768;
    
    // FONTE: Padrão Word (máximo 28)
    var FONTE_MIN = 8, FONTE_MAX = 28, FONTE_PADRAO = 16;
    var TAMANHOS_WORD = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28];

    var $ = U.$;
    var escapar = U.escapar;
    var formatarData = U.formatarData;
    var limitar = function (v, min, max) { return Math.max(min, Math.min(max, v)); };

    function lerPosicao(t) {
        var p = String(t || '50% 50%').split(' ');
        return [limitar(parseFloat(p[0]) || 50, 0, 100), limitar(parseFloat(p[1]) || 50, 0, 100)];
    }
    function extensaoDe(a) { return EXT[a.type] || 'jpg'; }
    function avisar(m, t) { U.toast(m, t === 'erro'); }
    function validarImagem(a, re) {
        if (!a) return false;
        if (!(re || /^image\//).test(a.type)) { avisar('Formato não suportado.', 'erro'); return false; }
        if (a.size > MAX_MB * 1024 * 1024) { avisar('Máximo ' + MAX_MB + ' MB.', 'erro'); return false; }
        return true;
    }
    function estadoBotao(b, ocupado, texto) {
        if (!b) return;
        var alvo = b.querySelector('.btn-rotulo') || b;
        if (!b.dataset.rotulo) b.dataset.rotulo = alvo.textContent;
        b.disabled = ocupado;
        b.classList.toggle('carregando', ocupado);
        alvo.textContent = ocupado ? texto : b.dataset.rotulo;
    }

    var estado = {
        db: null, usuario: null, atelies: [], atelieAtivo: null,
        canalToken: 0, postEditandoId: null,
        avatar: { arquivo: null, url: null, blobUrl: null, editado: false },
        capa: { arquivo: null, blobUrl: null },
        capaArtigo: { arquivo: null, url: null }
    };
    var enquadradores = { avatar: null, capa: null };
    var ganchos = { resetarEditor: function () {}, limparCapaArtigo: function () {} };
    var editor = null;

    function revogarBlobs() {
        if (estado.avatar.blobUrl) { URL.revokeObjectURL(estado.avatar.blobUrl); estado.avatar.blobUrl = null; }
        if (estado.capa.blobUrl) { URL.revokeObjectURL(estado.capa.blobUrl); estado.capa.blobUrl = null; }
    }

    var Rolagem = {
        el: function () { return document.body.classList.contains('atelie-modo-redacao') ? $('editor-corpo') : $('atelie-main'); },
        topo: function () { var e = $('editor-corpo'); if (e) e.scrollTo({ top: 0 }); var m = $('atelie-main'); if (m) m.scrollTo({ top: 0 }); },
        por: function (dy) { var a = this.el(); if (a) a.scrollBy(0, dy); },
        area: function () { var a = this.el(); return a ? a.getBoundingClientRect() : { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; }
    };

    /* ===== SCROLLBAR CUSTOM ===== */
    function inicializarScrollbar() {
        var corpo = $('editor-corpo');
        var scrollbar = $('editor-scrollbar');
        var thumb = $('editor-scrollbar-thumb');
        if (!corpo || !scrollbar || !thumb) return;

        function atualizar() {
            var visivel = corpo.scrollHeight > corpo.clientHeight + 2;
            scrollbar.classList.toggle('visivel', visivel);
            if (!visivel) return;
            var trackH = scrollbar.clientHeight;
            var ratio = corpo.clientHeight / corpo.scrollHeight;
            var thumbH = Math.max(30, trackH * ratio);
            var maxScroll = corpo.scrollHeight - corpo.clientHeight;
            var scrollRatio = maxScroll > 0 ? corpo.scrollTop / maxScroll : 0;
            var thumbTop = scrollRatio * (trackH - thumbH);
            thumb.style.height = thumbH + 'px';
            thumb.style.transform = 'translateY(' + thumbTop + 'px)';
        }

        corpo.addEventListener('scroll', atualizar, { passive: true });
        window.addEventListener('resize', atualizar);
        if ('ResizeObserver' in window) new ResizeObserver(atualizar).observe(corpo);
        if ('MutationObserver' in window) {
            new MutationObserver(atualizar).observe(corpo, { childList: true, subtree: true, characterData: true });
        }
        atualizar();
        window.__atelieAtualizarScrollbar = atualizar;
    }

    /* ===== MODAIS ===== */
    function mostrarConfirmacao(titulo, mensagem, textoOk, tipo) {
        return new Promise(function (resolve) {
            var ov = document.createElement('div');
            ov.className = 'modal-overlay modal-confirmacao';
            var cls = tipo === 'perigo' ? 'btn-gaveta--perigo' : 'btn-gaveta--primario';
            ov.innerHTML =
                '<div class="modal-conteudo" style="max-width:420px;padding:2.5rem 2rem 2rem;">' +
                    '<header class="modal-header" style="margin-bottom:1rem;">' +
                        '<h2 style="font-size:1.5rem;">' + escapar(titulo) + '</h2>' +
                        '<button type="button" class="modal-fechar" aria-label="Fechar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>' +
                    '</header>' +
                    '<p class="modal-confirmar-texto">' + escapar(mensagem) + '</p>' +
                    '<div class="modal-excluir-acoes" style="margin-top:0;">' +
                        '<button type="button" class="btn-cancelar" data-acao="cancelar">Cancelar</button>' +
                        '<button type="button" class="btn-gaveta ' + cls + '" data-acao="confirmar" style="min-height:48px;font-size:0.75rem;">' + escapar(textoOk) + '</button>' +
                    '</div>' +
                '</div>';
            function fechar(r) { ov.remove(); resolve(r); }
            ov.querySelector('[data-acao="cancelar"]').addEventListener('click', function () { fechar(false); });
            ov.querySelector('.modal-fechar').addEventListener('click', function () { fechar(false); });
            ov.querySelector('[data-acao="confirmar"]').addEventListener('click', function () { fechar(true); });
            ov.addEventListener('click', function (e) { if (e.target === ov) fechar(false); });
            document.body.appendChild(ov);
        });
    }

    /* ===== LEITURA INLINE ===== */
    function abrirLeitura(id) {
        var container = $('leitura-inline');
        var alvo = $('leitura-inline-conteudo');
        if (!container || !alvo) return;

        // SKELETON LOADER
        alvo.innerHTML = `
            <div class="leitura-skeleton">
                <div class="leitura-sk-capa"></div>
                <div class="leitura-sk-titulo"></div>
                <div class="leitura-sk-meta"></div>
                <div class="leitura-sk-paragrafo"></div>
                <div class="leitura-sk-paragrafo"></div>
                <div class="leitura-sk-paragrafo" style="width: 70%;"></div>
            </div>
        `;

        document.body.classList.add('atelie-modo-leitura');
        document.body.classList.remove('atelie-modo-redacao');
        container.hidden = false;

        var btnVoltar = $('btn-voltar-redacao');
        if (btnVoltar) btnVoltar.hidden = false;

        var main = $('atelie-main');
        if (main) main.scrollTop = 0;
        window.scrollTo(0, 0);

        estado.db.from('posts').select('*').eq('id', id).single().then(function (r) {
            if (r.error || !r.data) {
                alvo.innerHTML = '<div style="text-align:center;padding:4rem;font-family:var(--fonte-display);font-style:italic;color:var(--tinta-clara);">Erro ao carregar artigo.</div>';
                return;
            }
            var p = r.data;
            var html = '';
            if (p.cover_url) html += '<img class="leitura-capa" src="' + escapar(p.cover_url) + '" alt="Capa" referrerpolicy="no-referrer">';
            html += '<h1 class="leitura-titulo">' + escapar(p.title || 'Sem título') + '</h1>';
            html += '<div class="leitura-meta"><span>' + escapar(p.category || 'Geral') + '</span><span>' + escapar(formatarData(p.created_at)) + '</span></div>';
            html += '<div class="leitura-corpo">' + U.sanitizarHtml(p.content || '') + '</div>';
            alvo.innerHTML = html;
            container.scrollTop = 0;
        });
    }

    function fecharLeitura() {
        var container = $('leitura-inline');
        if (container) container.hidden = true;
        document.body.classList.remove('atelie-modo-leitura');
    }

    /* ===== GAVETA ===== */
    var Gaveta = (function () {
        function permanente() { return window.matchMedia('(min-width: 1367px)').matches; }
        function fecharPerfil() {
            var p = document.getElementById('sidebar-perfil');
            var o = document.getElementById('gaveta-overlay');
            if (p && (p.classList.contains('aberta') || p.classList.contains('ativa'))) p.classList.remove('aberta', 'ativa');
            if (o && o.classList.contains('ativo')) o.classList.remove('ativo');
            document.body.classList.remove('ficha-aberta');
        }
        function abrir() {
            if (permanente()) return;
            fecharPerfil();
            var g = $('gaveta-config'); var o = $('overlay-config');
            if (g) g.classList.add('ativa'); if (o) o.classList.add('ativa');
            document.body.classList.add('gaveta-aberta');
        }
        function fechar() {
            if (permanente()) return;
            revogarBlobs();
            var g = $('gaveta-config'); var o = $('overlay-config');
            if (g) g.classList.remove('ativa'); if (o) o.classList.remove('ativa');
            document.body.classList.remove('gaveta-aberta');
        }
        function mostrarPainel(nome) {
            ['canal', 'redacao'].forEach(function (k) {
                var p = $('config-' + k);
                if (p) { p.classList.toggle('ativo', k === nome); p.scrollTop = 0; }
            });
        }
        function iniciar() {
            ['btn-configurar-atelie', 'btn-opcoes-mobile'].forEach(function (id) { var e = $(id); if (e) e.addEventListener('click', abrir); });
            ['btn-fechar-config', 'btn-fechar-config-redacao', 'overlay-config'].forEach(function (id) { var e = $(id); if (e) e.addEventListener('click', fechar); });
            document.addEventListener('keydown', function (e) { if (e.key !== 'Escape') return; var g = $('gaveta-config'); if (g && g.classList.contains('ativa')) fechar(); });
        }
        return { permanente: permanente, abrir: abrir, fechar: fechar, mostrarPainel: mostrarPainel, iniciar: iniciar };
    })();

    /* ===== ENQUADRADOR ===== */
    function criarEnquadrador(cfg) {
        var container = cfg.container, camada = cfg.camada, controles = cfg.controles, slider = cfg.slider, aoImagem = cfg.aoImagem, aoMudar = cfg.aoMudar;
        var est = { x: 50, y: 50, zoom: ZOOM_INICIAL, nw: 0, nh: 0 };
        var pts = new Map(), ancora = null, pinca = null, token = 0;

        function geom() {
            var cw = container.clientWidth, ch = container.clientHeight;
            if (!est.nw || !est.nh || !cw || !ch) return { s: 1, lx: 0, ly: 0 };
            var s = Math.max(cw / est.nw, ch / est.nh);
            return { s: s, lx: Math.max(0, est.nw - cw / (est.zoom * s)), ly: Math.max(0, est.nh - ch / (est.zoom * s)) };
        }
        function aplicar() {
            est.x = limitar(est.x, 0, 100); est.y = limitar(est.y, 0, 100); est.zoom = limitar(est.zoom, ZOOM_MIN, ZOOM_MAX);
            camada.style.backgroundPosition = est.x + '% ' + est.y + '%';
            camada.style.transformOrigin = est.x + '% ' + est.y + '%';
            camada.style.transform = 'scale(' + est.zoom + ')';
            if (slider) slider.value = est.zoom;
        }
        function definirZoom(v, notif) {
            var n = limitar(v, ZOOM_MIN, ZOOM_MAX);
            if (Math.abs(n - est.zoom) < 0.0001) return;
            est.zoom = n; aplicar(); if (notif && aoMudar) aoMudar();
        }
        function arrastar(dx, dy) {
            if (!ancora) return;
            var g = geom();
            if (g.lx > 0.5) est.x = limitar(ancora.px - (dx / (est.zoom * g.s)) / g.lx * 100, 0, 100);
            if (g.ly > 0.5) est.y = limitar(ancora.py - (dy / (est.zoom * g.s)) / g.ly * 100, 0, 100);
            aplicar(); if (aoMudar) aoMudar();
        }
        function dist() { var a = Array.from(pts.values()); return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); }
        function reset() {
            ancora = null; pinca = null;
            if (pts.size === 1) { var p = Array.from(pts.values())[0]; ancora = { x: p.x, y: p.y, px: est.x, py: est.y }; }
            else if (pts.size === 2) { pinca = { dist: dist(), zoom: est.zoom }; }
        }

        container.addEventListener('pointerdown', function (e) {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            if (e.pointerType === 'touch') e.preventDefault();
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            try { container.setPointerCapture(e.pointerId); } catch (_) {}
            reset();
        });
        container.addEventListener('pointermove', function (e) {
            if (!pts.has(e.pointerId)) return;
            if (e.pointerType === 'touch') e.preventDefault();
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pinca && pts.size === 2) { if (pinca.dist > 0) definirZoom(pinca.zoom * (dist() / pinca.dist), true); }
            else if (ancora) arrastar(e.clientX - ancora.x, e.clientY - ancora.y);
        });
        container.addEventListener('pointerup', function (e) { if (pts.delete(e.pointerId)) reset(); });
        container.addEventListener('pointercancel', function (e) { if (pts.delete(e.pointerId)) reset(); });
        container.addEventListener('wheel', function (e) {
            if (!(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            definirZoom(est.zoom + (e.deltaY < 0 ? 0.1 : -0.1), true);
        }, { passive: false });
        if (slider) slider.addEventListener('input', function () { definirZoom(parseFloat(slider.value), true); });

        return {
            carregar: function (url, ini) {
                var meu = ++token; est.nw = 0; est.nh = 0;
                est.x = ini && ini.x != null ? Number(ini.x) : 50;
                est.y = ini && ini.y != null ? Number(ini.y) : 50;
                est.zoom = ini && ini.zoom ? limitar(Number(ini.zoom), ZOOM_MIN, ZOOM_MAX) : ZOOM_INICIAL;
                pts.clear(); reset();
                camada.style.backgroundImage = 'url("' + String(url).replace(/"/g, '%22') + '")';
                aplicar();
                if (controles) controles.hidden = false;
                if (aoImagem) aoImagem(true);
                var im = new Image();
                im.onload = function () { if (meu !== token) return; est.nw = im.naturalWidth || 0; est.nh = im.naturalHeight || 0; aplicar(); };
                im.src = url;
            },
            limpar: function () {
                token++; est.nw = 0; est.nh = 0; est.x = 50; est.y = 50; est.zoom = ZOOM_INICIAL;
                pts.clear(); reset(); camada.style.backgroundImage = ''; aplicar();
                if (controles) controles.hidden = true; if (aoImagem) aoImagem(false);
            },
            estado: function () { return { x: est.x, y: est.y, zoom: est.zoom }; }
        };
    }

    /* ===== SUPABASE ===== */
    function aguardarSupabase() {
        var i = 0;
        return new Promise(function (res) {
            (function loop() { if (window.supabaseClient) return res(window.supabaseClient); if (++i >= 30) return res(null); setTimeout(loop, 200); })();
        });
    }
    function enviarArquivo(prefixo, corpo, ext, ct) {
        var path = estado.usuario.id + '/' + prefixo + '-' + Date.now() + '.' + ext;
        var opt = ct ? { contentType: ct } : undefined;
        return estado.db.storage.from(BUCKET).upload(path, corpo, opt).then(function (r) {
            if (r.error) throw r.error;
            return estado.db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        });
    }

    function renderizarCabecalho() {
        var a = estado.atelieAtivo; if (!a) return;
        var en = $('atelie-nome'); if (en) en.textContent = a.name || 'Ateliê';
        var eh = $('atelie-handle'); if (eh) eh.textContent = '@' + (a.handle || 'atelie');
        var eb = $('atelie-bio'); if (eb) eb.textContent = a.description || '';
        var ca = $('atelie-avatar');
        if (ca) {
            var fp = document.querySelector('#perfil-usuario img.foto-perfil');
            var ua = a.avatar_url || (fp ? fp.src : null);
            ca.textContent = '';
            if (ua) {
                var img = document.createElement('img');
                img.src = ua; img.alt = 'Avatar'; img.referrerPolicy = 'no-referrer';
                if (a.avatar_position) img.style.objectPosition = a.avatar_position;
                if (a.avatar_zoom) img.style.transform = 'scale(' + a.avatar_zoom + ')';
                img.onerror = function () { ca.textContent = ''; var s = document.createElement('span'); s.className = 'avatar-iniciais'; s.textContent = U.iniciais(a.name); ca.appendChild(s); };
                ca.appendChild(img);
            } else {
                var s2 = document.createElement('span'); s2.className = 'avatar-iniciais'; s2.textContent = U.iniciais(a.name); ca.appendChild(s2);
            }
        }
        var ic = $('atelie-capa-img');
        if (ic) {
            if (a.cover_url) {
                var pos = lerPosicao(a.cover_position); var z = parseFloat(a.cover_zoom) || 1;
                ic.style.display = 'block'; ic.src = a.cover_url;
                ic.style.objectPosition = pos[0] + '% ' + pos[1] + '%';
                ic.style.transformOrigin = pos[0] + '% ' + pos[1] + '%';
                ic.style.transform = 'scale(' + z + ')';
            } else {
                ic.style.display = 'none'; ic.removeAttribute('src');
                var w = ic.parentNode; if (w) w.style.background = 'var(--vinho)';
            }
        }
    }

    function preencherPainel(a) {
        revogarBlobs();
        var n = $('input-config-nome'); if (n) n.value = a.name || '';
        var b = $('input-config-bio'); if (b) b.value = a.description || '';
        var ua = a.avatar_original_url || a.avatar_url || null;
        var ap = lerPosicao(a.avatar_position); var az = parseFloat(a.avatar_zoom) || ZOOM_INICIAL;
        estado.avatar = { arquivo: null, url: ua, blobUrl: null, editado: false };
        estado.capa = { arquivo: null, blobUrl: null };
        if (enquadradores.avatar) {
            if (ua) enquadradores.avatar.carregar(ua + (ua.indexOf('?') === -1 ? '?' : '&') + 'v=' + Date.now(), { x: ap[0], y: ap[1], zoom: az });
            else enquadradores.avatar.limpar();
        }
        if (enquadradores.capa) {
            if (a.cover_url) { var p = lerPosicao(a.cover_position); enquadradores.capa.carregar(a.cover_url, { x: p[0], y: p[1], zoom: parseFloat(a.cover_zoom) || 1 }); }
            else enquadradores.capa.limpar();
        }
    }

    function salvarConfiguracao(e) {
        e.preventDefault(); if (!estado.atelieAtivo) return;
        var ni = $('input-config-nome'); var novo = ni ? ni.value.trim() : '';
        if (!novo) { avisar('Nome não pode ser vazio.', 'erro'); if (ni) ni.focus(); return; }
        if (novo.length > 60) { avisar('Nome muito longo.', 'erro'); return; }
        var btn = $('btn-salvar-config'); estadoBotao(btn, true, 'Salvando...');
        var au = estado.atelieAtivo.avatar_url, ao = estado.atelieAtivo.avatar_original_url, cu = estado.atelieAtivo.cover_url;
        var t = Promise.resolve();
        if (estado.avatar.editado && estado.avatar.arquivo) {
            t = t.then(function () { return enviarArquivo('atelie-avatar-orig', estado.avatar.arquivo, extensaoDe(estado.avatar.arquivo), estado.avatar.arquivo.type).then(function (u) { if (u) { ao = u; au = u; } }); });
        }
        if (estado.capa.arquivo) {
            t = t.then(function () { return enviarArquivo('atelie-capa', estado.capa.arquivo, extensaoDe(estado.capa.arquivo), estado.capa.arquivo.type).then(function (u) { cu = u; }); });
        }
        t.then(function () {
            var c = enquadradores.capa ? enquadradores.capa.estado() : { x: 50, y: 50, zoom: 1 };
            var a = enquadradores.avatar ? enquadradores.avatar.estado() : { x: 50, y: 50, zoom: ZOOM_INICIAL };
            return estado.db.from('ateliers').update({
                name: novo, description: ($('input-config-bio') || {}).value || '',
                avatar_url: au, avatar_original_url: ao,
                avatar_position: a.x.toFixed(1) + '% ' + a.y.toFixed(1) + '%', avatar_zoom: Number(a.zoom.toFixed(2)),
                cover_url: cu, cover_position: c.x.toFixed(1) + '% ' + c.y.toFixed(1) + '%', cover_zoom: Number(c.zoom.toFixed(2))
            }).eq('id', estado.atelieAtivo.id).select().single();
        }).then(function (r) {
            if (r.error) throw r.error;
            estado.atelieAtivo = r.data;
            var i = estado.atelies.findIndex(function (x) { return x.id === r.data.id; });
            if (i !== -1) estado.atelies[i] = r.data;
            renderizarCabecalho(); preencherPainel(r.data);
            if (window.utils && window.utils.renderizarCardsAtelies) window.utils.renderizarCardsAtelies();
            Gaveta.fechar(); avisar('Ateliê atualizado.');
        }).catch(function (err) { console.error(err); avisar('Erro ao salvar.', 'erro'); }).then(function () { estadoBotao(btn, false); });
    }

    function configurarPainelCanal() {
        var pa = $('avatar-preview-arrastavel'); var ca = $('avatar-preview-container'); if (!pa || !ca) return;
        var ph = pa.innerHTML;
        enquadradores.avatar = criarEnquadrador({
            container: ca, camada: pa, controles: $('avatar-ajuste'), slider: $('avatar-zoom'),
            aoImagem: function (tem) { var c = $('avatar-preview-arrastavel'); if (!c) return; c.classList.toggle('tem-imagem', tem); c.innerHTML = tem ? '' : ph; },
            aoMudar: function () { estado.avatar.editado = true; }
        });
        var cc = $('capa-preview-container'); var ccap = $('capa-preview-arrastavel');
        if (cc && ccap) {
            enquadradores.capa = criarEnquadrador({
                container: cc, camada: ccap, controles: $('capa-ajuste'), slider: $('capa-zoom'),
                aoImagem: function (tem) { cc.hidden = !tem; var v = $('capa-vazia'); if (v) v.hidden = tem; }
            });
        }
        var ia = $('input-config-avatar'), ba = $('btn-upload-avatar');
        if (ba && ia) {
            ba.addEventListener('click', function () { ia.click(); });
            ia.addEventListener('change', function () {
                var f = ia.files[0]; ia.value = '';
                if (!validarImagem(f)) return;
                if (estado.avatar.blobUrl) URL.revokeObjectURL(estado.avatar.blobUrl);
                estado.avatar.arquivo = f; estado.avatar.blobUrl = URL.createObjectURL(f);
                enquadradores.avatar.carregar(estado.avatar.blobUrl);
                estado.avatar.editado = true;
            });
        }
        var ic = $('input-config-capa'), bc = $('btn-upload-capa');
        if (bc && ic) {
            bc.addEventListener('click', function () { ic.click(); });
            ic.addEventListener('change', function () {
                var f = ic.files[0]; ic.value = '';
                if (!validarImagem(f)) return;
                if (estado.capa.blobUrl) URL.revokeObjectURL(estado.capa.blobUrl);
                estado.capa.arquivo = f; estado.capa.blobUrl = URL.createObjectURL(f);
                if (enquadradores.capa) enquadradores.capa.carregar(estado.capa.blobUrl);
            });
        }
        var form = $('form-config-atelie'); if (form) form.addEventListener('submit', salvarConfiguracao);
    }

    function configurarPainelRedacao() {
        var pv = $('capa-artigo-preview'), cm = $('capa-artigo-arrastavel'), inp = $('input-capa-artigo'),
            bu = $('btn-upload-capa-artigo'), br = $('btn-remover-capa-artigo'), bd = $('btn-descartar-rascunho');
        if (!pv || !cm || !inp || !bu || !br || !bd) return;
        function limpar() { estado.capaArtigo.arquivo = null; estado.capaArtigo.url = null; cm.style.backgroundImage = ''; pv.hidden = true; }
        ganchos.limparCapaArtigo = limpar;
        bu.addEventListener('click', function () { inp.click(); });
        inp.addEventListener('change', function () {
            var f = inp.files[0]; inp.value = '';
            if (!validarImagem(f)) return;
            estado.capaArtigo.arquivo = f; estado.capaArtigo.url = null;
            var l = new FileReader();
            l.onload = function (e) { cm.style.backgroundImage = 'url("' + e.target.result + '")'; pv.hidden = false; };
            l.readAsDataURL(f);
        });
        br.addEventListener('click', limpar);
        bd.addEventListener('click', function () {
            mostrarConfirmacao('Descartar Rascunho', 'Tem certeza que deseja descartar?', 'Descartar', 'perigo').then(function (ok) {
                if (!ok) return;
                estado.postEditandoId = null; ganchos.resetarEditor(); selecionarAba('canal');
            });
        });
    }

    /* ===== CRIAÇÃO / EXCLUSÃO ===== */
    function abrirModalCriacao() { var m = $('modal-criar-atelie'); if (!m) return; m.hidden = false; var i = $('input-nome-atelie'); if (i) i.focus(); }
    function configurarCriacao() {
        var m = $('modal-criar-atelie'); if (!m) return;
        window.abrirModalCriarAtelie = abrirModalCriacao;
        function fechar() { m.hidden = true; }
        var bp = $('btn-criar-primeiro-atelie'); if (bp) bp.addEventListener('click', abrirModalCriacao);
        var bf = $('btn-fechar-modal'); if (bf) bf.addEventListener('click', fechar);
        m.addEventListener('click', function (e) { if (e.target === m) fechar(); });
        var form = $('form-criar-atelie'); if (!form) return;
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var btn = $('btn-salvar-atelie'), ne = $('input-nome-atelie'), nome = ne ? ne.value.trim() : '';
            if (!nome) { avisar('Nome obrigatório.', 'erro'); return; }
            estadoBotao(btn, true, 'Criando...');
            estado.db.rpc('gerar_handle_unico').then(function (r) {
                if (r.error) throw r.error;
                return estado.db.from('ateliers').insert([{ owner_id: estado.usuario.id, name: nome, handle: r.data, description: '', cover_position: '50% 50%', cover_zoom: 1 }]).select().single();
            }).then(function (r) {
                if (r.error) throw r.error;
                fechar(); form.reset(); window.location.href = 'atelie.html?id=' + r.data.id;
            }).catch(function (err) { console.error(err); avisar('Erro ao criar.', 'erro'); }).then(function () { estadoBotao(btn, false, 'Criar Ateliê'); });
        });
    }

    function configurarExclusao() {
        var be = $('btn-excluir-atelie'), m = $('modal-excluir-atelie'), ne = $('modal-excluir-nome'),
            bf = $('btn-fechar-modal-excluir'), bc = $('btn-cancelar-excluir'), bcf = $('btn-confirmar-excluir');
        var txt = bcf ? bcf.querySelector('.btn-excluir-texto') : null;
        if (!be || !m || !bcf) return;
        var timer = null, restante = 0, exec = false;
        function reset() { if (timer) { clearInterval(timer); timer = null; } restante = 0; exec = false; bcf.disabled = false; bcf.classList.remove('contando'); if (txt) txt.textContent = 'Excluir permanentemente'; }
        function fechar() { reset(); m.hidden = true; }
        function abrir() { if (!estado.atelieAtivo) { avisar('Nenhum ateliê ativo.', 'erro'); return; } reset(); if (ne) ne.textContent = estado.atelieAtivo.name || 'este ateliê'; m.hidden = false; }
        function executar() {
            if (exec || !estado.atelieAtivo) return;
            exec = true; var id = estado.atelieAtivo.id, db = estado.db;
            if (txt) txt.textContent = 'Excluindo...';
            db.from('posts').delete().eq('atelier_id', id)
                .then(function () { return db.from('videos').delete().eq('atelier_id', id); })
                .then(function () { return db.from('ateliers').delete().eq('id', id); })
                .then(function (r) { if (r && r.error) throw r.error; localStorage.removeItem('auloo:atelieAtivo'); avisar('Ateliê excluído.'); setTimeout(function () { window.location.href = 'atelie.html'; }, 700); })
                .catch(function (err) { console.error(err); avisar('Erro ao excluir.', 'erro'); reset(); });
        }
        function iniciar() {
            if (exec || timer) return;
            restante = 10; bcf.disabled = true; bcf.classList.remove('contando'); void bcf.offsetWidth; bcf.classList.add('contando');
            function att() { if (txt) txt.textContent = 'Excluindo em ' + restante + 's...'; }
            att();
            timer = setInterval(function () { restante--; if (restante <= 0) { clearInterval(timer); timer = null; executar(); return; } att(); }, 1000);
        }
        be.addEventListener('click', abrir);
        if (bf) bf.addEventListener('click', fechar);
        if (bc) bc.addEventListener('click', fechar);
        bcf.addEventListener('click', function () { if (bcf.disabled) return; iniciar(); });
        m.addEventListener('click', function (e) { if (e.target === m) fechar(); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !m.hidden) fechar(); });
    }

    function carregarAtelies() {
        return estado.db.from('ateliers').select('*').eq('owner_id', estado.usuario.id).order('created_at', { ascending: true }).then(function (r) {
            if (r.error) { console.error(r.error); return; }
            if (!r.data || r.data.length === 0) {
                var v = $('atelie-vazio'); if (v) v.hidden = false;
                var c = $('atelie-conteudo'); if (c) c.hidden = true;
                var a = $('atelie-abas'); if (a) a.hidden = true;
                return;
            }
            estado.atelies = r.data;
            var up = new URLSearchParams(window.location.search), idu = up.get('id'), ids = localStorage.getItem('auloo:atelieAtivo'), escolhido = null;
            if (idu) escolhido = estado.atelies.find(function (x) { return x.id === idu; });
            if (!escolhido && ids) escolhido = estado.atelies.find(function (x) { return x.id === ids; });
            estado.atelieAtivo = escolhido || estado.atelies[0];
            localStorage.setItem('auloo:atelieAtivo', estado.atelieAtivo.id);
            var v2 = $('atelie-vazio'); if (v2) v2.hidden = true;
            var c2 = $('atelie-conteudo'); if (c2) c2.hidden = false;
            var a2 = $('atelie-abas'); if (a2) a2.hidden = false;
            renderizarCabecalho(); preencherPainel(estado.atelieAtivo);
            carregarCanal(); carregarVideos();
            if (window.utils && window.utils.renderizarCardsAtelies) window.utils.renderizarCardsAtelies();
        });
    }

    function montarCardPost(post) {
        var doc = new DOMParser().parseFromString(post.content || '', 'text/html');
        doc.querySelectorAll('figure, img, figcaption, style, script').forEach(function (el) { el.remove(); });
        var texto = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
        var trecho = texto.length > 220 ? texto.slice(0, 220).trim() + '…' : texto;
        var id = escapar(post.id);
        var card = document.createElement('article');
        card.className = 'canal-post';
        card.innerHTML =
            (post.cover_url ? '<div class="canal-post-capa"><img src="' + escapar(post.cover_url) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></div>' : '') +
                        '<div class="canal-post-corpo"><div class="canal-post-meta">' +
                (post.category ? '<span class="canal-post-categoria">' + escapar(post.category) + '</span>' : '') +
                '<span>' + escapar(formatarData(post.created_at)) + '</span>' +
            '</div>' +
            '<h2 class="canal-post-titulo">' + escapar(post.title || 'Sem título') + '</h2>' +
            '<div class="canal-post-trecho">' + escapar(trecho) + '</div>' +
            '<div class="canal-post-rodape">' +
                '<button type="button" class="canal-post-ler" data-ler="' + id + '">Ler artigo' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>' +
                '</button>' +
                '<div class="canal-post-acoes">' +
                    '<button type="button" data-editar="' + id + '" title="Editar" aria-label="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>' +
                    '<button type="button" class="perigo" data-excluir="' + id + '" title="Excluir" aria-label="Excluir"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg></button>' +
                '</div>' +
            '</div></div>';
        return card;
    }

    function carregarCanal() {
        if (!estado.atelieAtivo) return;
        var lista = $('canal-lista'), vazio = $('canal-vazio');
        if (!lista || !vazio) return;
        var meu = ++estado.canalToken;
        vazio.hidden = true;
        lista.innerHTML = '<div class="canal-carregando"><div class="canal-skeleton"></div><div class="canal-skeleton"></div></div>';
        estado.db.from('posts').select('id, title, content, cover_url, category, created_at').eq('atelier_id', estado.atelieAtivo.id).order('created_at', { ascending: false }).then(function (r) {
            if (meu !== estado.canalToken) return;
            lista.innerHTML = '';
            if (r.error || !r.data || r.data.length === 0) { vazio.hidden = false; return; }
            var frag = document.createDocumentFragment();
            r.data.forEach(function (p) { frag.appendChild(montarCardPost(p)); });
            lista.appendChild(frag);
        });
    }

    function configurarCanal() {
        var lista = $('canal-lista'); if (!lista) return;
        lista.addEventListener('click', function (e) {
            var ler = e.target.closest('.canal-post-ler');
            if (ler) { e.preventDefault(); abrirLeitura(ler.dataset.ler); return; }
            var editar = e.target.closest('[data-editar]');
            if (editar) {
                var id = editar.dataset.editar;
                estado.db.from('posts').select('*').eq('id', id).single().then(function (r) {
                    if (r.error || !r.data) { avisar('Erro ao carregar.', 'erro'); return; }
                    var p = r.data;
                    estado.postEditandoId = p.id;
                    selecionarAba('redacao');
                    if ($('input-titulo')) $('input-titulo').value = p.title || '';
                    if ($('input-conteudo')) $('input-conteudo').innerHTML = p.content || '';
                    var cat = $('input-categoria-artigo'); if (cat) cat.value = p.category || 'Matemática';
                    var dv = document.querySelector('#dropdown-categoria .dropdown-valor'); if (dv) dv.textContent = cat ? cat.value : 'Matemática';
                    document.querySelectorAll('#dropdown-categoria [role="option"]').forEach(function (i) {
                        i.setAttribute('aria-selected', i.dataset.valor === (cat ? cat.value : 'Matemática') ? 'true' : 'false');
                    });
                    if (p.cover_url) {
                        estado.capaArtigo.url = p.cover_url;
                        var pv = $('capa-artigo-preview'), cm = $('capa-artigo-arrastavel');
                        if (pv && cm) { cm.style.backgroundImage = 'url("' + p.cover_url + '")'; pv.hidden = false; }
                    } else if (ganchos.limparCapaArtigo) ganchos.limparCapaArtigo();
                    if ($('input-conteudo')) $('input-conteudo').dispatchEvent(new Event('input'));
                    avisar('Editando: ' + p.title);
                });
                return;
            }
            var ex = e.target.closest('[data-excluir]');
            if (!ex) return;
            mostrarConfirmacao('Excluir Publicação', 'Excluir esta publicação?', 'Excluir', 'perigo').then(function (ok) {
                if (!ok) return;
                estado.db.from('posts').delete().eq('id', ex.dataset.excluir).then(function (r) {
                    if (r.error) return avisar('Erro ao excluir.', 'erro');
                    avisar('Publicação excluída.');
                    carregarCanal();
                });
            });
        });
    }

    function extrairYoutubeID(url) {
        var m = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/);
        return (m && m[2].length === 11) ? m[2] : null;
    }
    function carregarVideos() {
        if (!estado.atelieAtivo) return;
        var lista = $('video-lista'), vazio = $('videos-vazio');
        if (!lista || !vazio) return;
        lista.innerHTML = '<div class="canal-skeleton" style="height:200px"></div><div class="canal-skeleton" style="height:200px"></div>';
        vazio.hidden = true;
        estado.db.from('videos').select('*').eq('atelier_id', estado.atelieAtivo.id).order('created_at', { ascending: false }).then(function (r) {
            lista.innerHTML = '';
            if (r.error || !r.data || r.data.length === 0) { vazio.hidden = false; return; }
            r.data.forEach(function (v) {
                var card = document.createElement('article');
                card.className = 'video-card';
                card.innerHTML =
                    '<div class="video-thumb" data-url="https://youtube.com/watch?v=' + escapar(v.video_id) + '">' +
                        '<img src="https://img.youtube.com/vi/' + escapar(v.video_id) + '/hqdefault.jpg" alt="' + escapar(v.title) + '" loading="lazy">' +
                        '<div class="video-play-icon"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>' +
                    '</div>' +
                    '<div class="video-info"><div>' +
                        '<h3 class="video-title">' + escapar(v.title) + '</h3>' +
                        '<span class="video-meta">Vídeo Auloo</span>' +
                    '</div><button class="video-delete" data-id="' + escapar(v.id) + '" title="Excluir"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg></button></div>';
                lista.appendChild(card);
            });
        });
    }
    function configurarVideos() {
        var m = $('modal-video'), form = $('form-video');
        if (!m || !form) return;
        var ba = $('btn-add-video');
        if (ba) ba.addEventListener('click', function () {
            var l = $('lista-video-campos');
            if (l) l.innerHTML = '<div class="campo video-campo"><label for="video-titulo-0">Título do Vídeo</label><input type="text" id="video-titulo-0" placeholder="Título" maxlength="80" class="video-titulo"><label for="video-url-0">Link do vídeo</label><input type="url" id="video-url-0" placeholder="Cole aqui o link do vídeo (YouTube, Vimeo, etc.)" class="video-url"></div>';
            m.hidden = false;
        });
        var bf = $('btn-fechar-modal-video');
        if (bf) bf.addEventListener('click', function () { m.hidden = true; });
        m.addEventListener('click', function (e) { if (e.target === m) m.hidden = true; });
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var btn = $('btn-salvar-video');
            var cp = form.querySelector('.video-campo');
            if (!cp) return;
            var tit = cp.querySelector('.video-titulo').value.trim();
            var url = cp.querySelector('.video-url').value.trim();
            var vid = extrairYoutubeID(url);
            if (!vid) { avisar('Link inválido.', 'erro'); return; }
            if (!tit) { avisar('Título obrigatório.', 'erro'); return; }
            estadoBotao(btn, true, 'Salvando...');
            estado.db.from('videos').insert([{ atelier_id: estado.atelieAtivo.id, title: tit, video_id: vid }])
                .then(function (r) { if (r.error) throw r.error; avisar('Vídeo adicionado!'); m.hidden = true; form.reset(); carregarVideos(); })
                .catch(function (err) { console.error(err); avisar('Erro ao salvar.', 'erro'); })
                .then(function () { estadoBotao(btn, false); });
        });
        var lv = $('video-lista');
        if (lv) lv.addEventListener('click', function (e) {
            var t = e.target.closest('.video-thumb');
            if (t) { window.open(t.dataset.url, '_blank'); return; }
            var ex = e.target.closest('.video-delete');
            if (ex) mostrarConfirmacao('Excluir Vídeo', 'Excluir este vídeo?', 'Excluir', 'perigo').then(function (ok) {
                if (!ok) return;
                estado.db.from('videos').delete().eq('id', ex.dataset.id).then(function (r) {
                    if (r.error) return avisar('Erro.', 'erro');
                    avisar('Vídeo excluído.'); carregarVideos();
                });
            });
        });
    }

    function configurarDropdown() {
        var raiz = $('dropdown-categoria'); if (!raiz) return;
        var g = raiz.querySelector('.dropdown-gatilho'), v = raiz.querySelector('.dropdown-valor'), c = $('input-categoria-artigo');
        var itens = Array.prototype.slice.call(raiz.querySelectorAll('[role="option"]'));
        if (!g || !v || !c) return;
        function abrir() { raiz.classList.add('aberto'); g.setAttribute('aria-expanded', 'true'); var s = itens.filter(function (i) { return i.getAttribute('aria-selected') === 'true'; })[0] || itens[0]; if (s) s.focus(); }
        function fechar(foco) { raiz.classList.remove('aberto'); g.setAttribute('aria-expanded', 'false'); if (foco) g.focus(); }
        function escolher(item) { itens.forEach(function (i) { i.setAttribute('aria-selected', i === item ? 'true' : 'false'); }); c.value = item.dataset.valor; v.textContent = item.dataset.valor; fechar(true); }
        g.addEventListener('click', function () { raiz.classList.contains('aberto') ? fechar() : abrir(); });
        itens.forEach(function (i) { i.addEventListener('click', function () { escolher(i); }); });
        document.addEventListener('pointerdown', function (e) { if (!raiz.contains(e.target)) fechar(); });
    }

    function selecionarAba(nome) {
        var red = nome === 'redacao', vid = nome === 'videos';
        fecharLeitura();
        if (!Gaveta.permanente()) Gaveta.fechar();
        Rolagem.topo();
        document.body.classList.toggle('atelie-modo-redacao', red);
        document.querySelectorAll('.aba-btn').forEach(function (b) { b.classList.toggle('ativa', b.dataset.aba === nome); });
        var main = $('atelie-main'); if (main) main.classList.toggle('modo-redacao', red);
        var wc = $('wrapper-canal'); if (wc) wc.hidden = red;
        var av = $('aba-videos'); if (av) av.classList.toggle('ativa', vid);
        var ac = $('aba-canal'); if (ac) ac.classList.toggle('ativa', nome === 'canal');
        var re = $('redacao-editor'); if (re) re.hidden = !red;
        var te = $('editor-topo-custom'); if (te) te.hidden = !red;
        var bv = $('btn-voltar-redacao'); if (bv) bv.hidden = !red;
        Gaveta.mostrarPainel(red ? 'redacao' : 'canal');
        
        if (red && !estado.postEditandoId && editor) {
            editor.resetar();
        }

        if (nome === 'canal') carregarCanal();
        if (nome === 'videos') carregarVideos();
        if (red) {
            requestAnimationFrame(function () {
                if (typeof window.__atelieAtualizarPaginacao === 'function') window.__atelieAtualizarPaginacao();
                if (typeof window.__atelieAtualizarScrollbar === 'function') window.__atelieAtualizarScrollbar();
            });
        }
    }
    function configurarAbas() { document.querySelectorAll('.aba-btn').forEach(function (b) { b.addEventListener('click', function () { selecionarAba(b.dataset.aba); }); }); }

    function configurarVoltarRedacao() {
        var b = $('btn-voltar-redacao'); if (!b) return;
        b.addEventListener('click', function () {
            if (document.body.classList.contains('atelie-modo-leitura')) {
                fecharLeitura();
                var bv = $('btn-voltar-redacao'); if (bv) bv.hidden = true;
                return;
            }
            var tc = editor && editor.temConteudo && editor.temConteudo();
            if (!tc) { if (editor) editor.resetar(); estado.postEditandoId = null; selecionarAba('canal'); return; }
            mostrarConfirmacao('Sair da redação', 'Há alterações não salvas. Sair mesmo assim?', 'Sair', 'perigo').then(function (ok) {
                if (!ok) return;
                if (editor) editor.resetar(); estado.postEditandoId = null; selecionarAba('canal');
            });
        });
    }

    /* ==============================================
       EDITOR (COM MARCA TEXTO)
       ============================================== */
    function criarEditor() {
        var conteudo = $('input-conteudo');
        if (!conteudo) return null;

        var folha = $('editor-folha'), barra = $('img-flutuante'), selecao = $('img-selecao'),
            rotuloSel = $('img-selecao-rotulo'), indicador = $('img-indicador'), menu = $('img-menu');
        var BLOCOS = new Set(['P', 'H2', 'H3', 'BLOCKQUOTE', 'UL', 'OL', 'FIGURE', 'DIV', 'PRE']);
        var figura = null, rangeSalvo = null, arraste = null, fantasma = null, ignorarClique = false, quadroPend = false, bloqueioSel = false;
        var btnCor = $('btn-cor-texto'), inputCor = $('input-cor-texto'), painelCores = $('painel-cores');
        var btnMarca = $('btn-marca-texto'), inputMarca = $('input-cor-marca'), painelMarca = $('painel-marca');
        var btnAum = $('btn-aumentar-fonte'), btnDim = $('btn-diminuir-fonte');

        try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (_) {}

        /* ---------- SELEÇÃO ---------- */
        function capturarSelecao() {
            var s = window.getSelection();
            if (s.rangeCount && conteudo.contains(s.anchorNode)) rangeSalvo = s.getRangeAt(0).cloneRange();
        }
        function restaurarSelecao() {
            if (!rangeSalvo) return;
            bloqueioSel = true;
            try {
                var s = window.getSelection();
                s.removeAllRanges();
                s.addRange(rangeSalvo);
            } finally { setTimeout(function () { bloqueioSel = false; }, 80); }
        }
        conteudo.addEventListener('blur', capturarSelecao);
        document.addEventListener('selectionchange', function () {
            if (bloqueioSel) return;
            if (document.activeElement !== conteudo) return;
            capturarSelecao();
            atualizarBarra();
        });

        /* ---------- FONTE (Padrão Word) ---------- */
        function getTamanhoBase() {
            var fs = parseFloat(getComputedStyle(conteudo).fontSize);
            if (isNaN(fs)) return FONTE_PADRAO;
            return limitar(Math.round(fs), FONTE_MIN, FONTE_MAX);
        }

        function getTamanhoAtual() {
            try {
                var sel = window.getSelection();
                if (!sel || !sel.rangeCount) return getTamanhoBase();
                var node = sel.getRangeAt(0).startContainer;
                if (node.nodeType === 3) node = node.parentNode;
                if (!node || !conteudo.contains(node)) return getTamanhoBase();
                var el = node;
                while (el && el !== conteudo) {
                    if (el.dataset && el.dataset.fonte) {
                        var px = parseFloat(el.dataset.fonte);
                        if (!isNaN(px)) return limitar(Math.round(px), FONTE_MIN, FONTE_MAX);
                    }
                    el = el.parentNode;
                }
                return getTamanhoBase();
            } catch (e) { return getTamanhoBase(); }
        }

        function atualizarLabelFonte() {
            var l = $('fonte-label');
            if (l) l.textContent = getTamanhoAtual() + 'px';
        }

        function aplicarFonte(px) {
            px = limitar(Math.round(px), FONTE_MIN, FONTE_MAX);
            conteudo.focus();
            restaurarSelecao();

            var sel = window.getSelection();
            if (!sel || !sel.rangeCount) return;
            var range = sel.getRangeAt(0);

            if (range.collapsed) {
                var span = document.createElement('span');
                span.dataset.fonte = px;
                span.style.fontSize = px + 'px';
                span.textContent = '\u200B';
                range.insertNode(span);
                var r2 = document.createRange();
                r2.setStart(span.firstChild, 1);
                r2.collapse(true);
                sel.removeAllRanges();
                sel.addRange(r2);
            } else {
                var frag = range.extractContents();
                var span2 = document.createElement('span');
                span2.dataset.fonte = px;
                span2.style.fontSize = px + 'px';
                span2.appendChild(frag);
                range.insertNode(span2);
                span2.querySelectorAll('span[data-fonte]').forEach(function (s) {
                    if (s.dataset.fonte === String(px)) {
                        while (s.firstChild) s.parentNode.insertBefore(s.firstChild, s);
                        s.remove();
                    }
                });
                var r3 = document.createRange();
                r3.selectNodeContents(span2);
                sel.removeAllRanges();
                sel.addRange(r3);
            }

            capturarSelecao();
            atualizarLabelFonte();
            atualizarContadores();
        }

        /* ---------- CONTADORES ---------- */
        function atualizarContadores() {
            var txt = conteudo.textContent.trim();
            var vazio = txt === '' && !conteudo.querySelector('img');
            conteudo.dataset.vazio = vazio ? 'true' : 'false';
            var palavras = txt ? txt.split(/\s+/).length : 0;
            var minutos = palavras === 0 ? 0 : Math.max(1, Math.round(palavras / 200));
            var cp = $('contador-palavras');
            var cm = $('tempo-leitura');
            if (cp) cp.textContent = palavras + (palavras === 1 ? ' palavra' : ' palavras');
            if (cm) cm.textContent = minutos + ' min de leitura';
            if (typeof window.__atelieAtualizarScrollbar === 'function') window.__atelieAtualizarScrollbar();
        }
        
        function temConteudo() {
            var t = $('input-titulo');
            if (t && t.value.trim()) return true;
            
            var txt = conteudo.textContent.replace(/[\u200B\u00A0\s]/g, '').trim();
            
            if (txt.length > 0) return true;
            if (conteudo.querySelector('img, figure')) return true;
            return false;
        }
        
        function agendarPosicao() {
            if (quadroPend) return;
            quadroPend = true;
            requestAnimationFrame(function () { quadroPend = false; posicionar(); });
        }
        conteudo.addEventListener('input', function () {
            atualizarContadores();
            agendarPosicao();
        });

        /* ---------- FORMATAR ---------- */
        document.querySelectorAll('.editor-toolbar button[data-cmd]').forEach(function (b) {
            b.addEventListener('mousedown', function (e) { e.preventDefault(); });
            b.addEventListener('click', function (e) {
                e.preventDefault();
                var cmd = b.dataset.cmd;
                var val = b.dataset.value || null;
                if (cmd === 'formatBlock' && document.queryCommandValue('formatBlock').toLowerCase() === val) val = 'p';
                conteudo.focus();
                restaurarSelecao();
                document.execCommand(cmd, false, val);
                capturarSelecao();
                atualizarContadores();
                atualizarBarra();
            });
        });

        /* ---------- FONTE +/- (Padrão Word) ---------- */
        function passoFonte(delta) {
            var atual = getTamanhoAtual();
            var idx = TAMANHOS_WORD.indexOf(atual);
            
            if (idx === -1) {
                idx = TAMANHOS_WORD.findIndex(function(s) { return s >= atual; });
                if (idx === -1) idx = TAMANHOS_WORD.length - 1;
            }
            
            var novoIdx = limitar(idx + delta, 0, TAMANHOS_WORD.length - 1);
            var novo = TAMANHOS_WORD[novoIdx];
            
            if (novo !== atual) aplicarFonte(novo);
        }
        if (btnAum) {
            btnAum.addEventListener('mousedown', function (e) { e.preventDefault(); });
            btnAum.addEventListener('click', function (e) { e.preventDefault(); passoFonte(1); });
        }
        if (btnDim) {
            btnDim.addEventListener('mousedown', function (e) { e.preventDefault(); });
            btnDim.addEventListener('click', function (e) { e.preventDefault(); passoFonte(-1); });
        }

        /* ---------- ATUALIZAR BARRA ---------- */
        function atualizarBarra() {
            document.querySelectorAll('.editor-toolbar button[data-cmd]').forEach(function (b) {
                var cmd = b.dataset.cmd;
                if (cmd === 'formatBlock') b.classList.toggle('ativo', document.queryCommandValue('formatBlock').toLowerCase() === b.dataset.value);
                else b.classList.toggle('ativo', document.queryCommandState(cmd));
            });
            if (btnCor) btnCor.classList.toggle('ativo', document.queryCommandState('foreColor'));
            atualizarLabelFonte();
        }

        /* ---------- COR DO TEXTO ---------- */
        if (btnCor && painelCores) {
            btnCor.addEventListener('mousedown', function (e) { e.preventDefault(); });
            btnCor.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (painelMarca) painelMarca.hidden = true;
                var vaiAbrir = painelCores.hidden;
                painelCores.hidden = !vaiAbrir;
                btnCor.classList.toggle('ativo', vaiAbrir);
                if (btnMarca) btnMarca.classList.remove('ativo');
            });
            painelCores.addEventListener('mousedown', function (e) { e.stopPropagation(); });
            painelCores.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
            painelCores.querySelectorAll('.item-color').forEach(function (b) {
                b.addEventListener('mousedown', function (e) { e.preventDefault(); });
                b.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    conteudo.focus();
                    restaurarSelecao();
                    document.execCommand('foreColor', false, b.dataset.cor);
                    capturarSelecao();
                    btnCor.classList.add('ativo');
                    painelCores.hidden = true;
                });
            });
            document.addEventListener('pointerdown', function (e) {
                if (painelCores.hidden) return;
                if (btnCor.contains(e.target) || painelCores.contains(e.target)) return;
                painelCores.hidden = true;
                btnCor.classList.remove('ativo');
            });
        }
        if (inputCor) {
            inputCor.addEventListener('input', function (e) {
                conteudo.focus();
                restaurarSelecao();
                document.execCommand('foreColor', false, e.target.value);
                capturarSelecao();
                if (btnCor) btnCor.classList.add('ativo');
            });
        }

        /* ---------- MARCA-TEXTO ---------- */
        function aplicarMarca(cor) {
            conteudo.focus();
            restaurarSelecao();
            var sel = window.getSelection();
            if (!sel || !sel.rangeCount) return;
            var range = sel.getRangeAt(0);

            if (cor === 'remover') {
                document.execCommand('hiliteColor', false, 'transparent');
                document.execCommand('backColor', false, 'transparent');
                conteudo.querySelectorAll('span[data-marca], span[style*="background-color"]').forEach(function (s) {
                    s.style.backgroundColor = '';
                    s.style.removeProperty('background-color');
                    if (!s.getAttribute('style')) s.removeAttribute('style');
                    if (!s.getAttribute('data-marca')) { if (!s.attributes.length) { while (s.firstChild) s.parentNode.insertBefore(s.firstChild, s); s.remove(); } }
                });
            } else {
                if (range.collapsed) {
                    var span = document.createElement('span');
                    span.dataset.marca = cor;
                    span.style.backgroundColor = cor;
                    span.textContent = '\u200B';
                    range.insertNode(span);
                    var r2 = document.createRange();
                    r2.setStart(span.firstChild, 1);
                    r2.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(r2);
                } else {
                    var frag = range.extractContents();
                    var span2 = document.createElement('span');
                    span2.dataset.marca = cor;
                    span2.style.backgroundColor = cor;
                    span2.appendChild(frag);
                    range.insertNode(span2);
                    var r3 = document.createRange();
                    r3.selectNodeContents(span2);
                    sel.removeAllRanges();
                    sel.addRange(r3);
                }
            }
            capturarSelecao();
            atualizarContadores();
        }

        if (btnMarca && painelMarca) {
            btnMarca.addEventListener('mousedown', function (e) { e.preventDefault(); });
            btnMarca.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (painelCores) painelCores.hidden = true;
                var vaiAbrir = painelMarca.hidden;
                painelMarca.hidden = !vaiAbrir;
                btnMarca.classList.toggle('ativo', vaiAbrir);
                if (btnCor) btnCor.classList.remove('ativo');
            });
            painelMarca.addEventListener('mousedown', function (e) { e.stopPropagation(); });
            painelMarca.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
            painelMarca.querySelectorAll('.item-color').forEach(function (b) {
                b.addEventListener('mousedown', function (e) { e.preventDefault(); });
                b.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    aplicarMarca(b.dataset.cor);
                    btnMarca.classList.add('ativo');
                    painelMarca.hidden = true;
                });
            });
            document.addEventListener('pointerdown', function (e) {
                if (painelMarca.hidden) return;
                if (btnMarca.contains(e.target) || painelMarca.contains(e.target)) return;
                painelMarca.hidden = true;
                btnMarca.classList.remove('ativo');
            });
        }
        if (inputMarca) {
            inputMarca.addEventListener('input', function (e) { aplicarMarca(e.target.value); });
        }

        /* ---------- PASTE / DRAGSTART ---------- */
        conteudo.addEventListener('paste', function (e) {
            e.preventDefault();
            var t = (e.clipboardData || window.clipboardData).getData('text/plain');
            document.execCommand('insertText', false, t);
        });
        conteudo.addEventListener('dragstart', function (e) {
            if (e.target.tagName === 'IMG') e.preventDefault();
        });

        /* ---------- BLOCOS ---------- */
        function normalizarBlocos() {
            var atual = null;
            Array.prototype.slice.call(conteudo.childNodes).forEach(function (n) {
                if (n.nodeType === 1 && BLOCOS.has(n.tagName)) { atual = null; return; }
                if (n.nodeType === 3 && n.textContent === '' && !atual) { n.remove(); return; }
                if (!atual) { atual = document.createElement('p'); n.before(atual); }
                atual.appendChild(n);
            });
        }
        function blocoTopo(n) { while (n && n.parentNode !== conteudo) n = n.parentNode; return n && n.nodeType === 1 ? n : null; }
        function garantirParagrafo() {
            var u = conteudo.lastElementChild;
            if (!u || u.tagName === 'FIGURE') {
                var p = document.createElement('p');
                p.innerHTML = '<br>';
                conteudo.appendChild(p);
                return p;
            }
            return null;
        }
        function colocarCursor(el) {
            var r = document.createRange();
            r.selectNodeContents(el);
            r.collapse(true);
            var s = window.getSelection();
            s.removeAllRanges();
            s.addRange(r);
        }

        /* ---------- FIGURAS ---------- */
        function criarFigura(url) {
            var f = document.createElement('figure');
            f.className = 'img-bloco';
            f.dataset.size = TAMANHO_IMG_PADRAO;
            f.dataset.align = 'center';
            f.style.width = TAMANHOS_IMG[TAMANHO_IMG_PADRAO] + '%';
            f.contentEditable = 'false';
            var i = document.createElement('img');
            i.src = url; i.alt = ''; i.loading = 'lazy'; i.draggable = false;
            i.addEventListener('load', agendarPosicao);
            var cap = document.createElement('figcaption');
            cap.contentEditable = 'true';
            cap.dataset.ph = 'Adicionar legenda (opcional)';
            f.appendChild(i); f.appendChild(cap);
            return f;
        }
        function inserirFigura(fig) {
            var no = null, off = 0;
            if (rangeSalvo && conteudo.contains(rangeSalvo.startContainer)) { no = rangeSalvo.startContainer; off = rangeSalvo.startOffset; }
            normalizarBlocos();
            var topo = no && conteudo.contains(no) ? blocoTopo(no) : null;
            if (topo && topo.tagName === 'P') {
                var vazio = !topo.textContent.trim() && !topo.querySelector('img');
                if (vazio) topo.replaceWith(fig);
                else {
                    var r = document.createRange();
                    r.setStart(no, off);
                    r.setEndAfter(topo.lastChild);
                    var resto = r.extractContents();
                    var depois = document.createElement('p');
                    depois.appendChild(resto);
                    if (!depois.textContent.trim()) depois.innerHTML = '<br>';
                    topo.after(fig);
                    fig.after(depois);
                    if (!topo.textContent.trim()) topo.remove();
                }
            } else if (topo) topo.after(fig);
            else conteudo.appendChild(fig);
            var criado = garantirParagrafo();
            conteudo.focus({ preventScroll: true });
            if (criado) colocarCursor(criado);
            else if (fig.nextElementSibling) colocarCursor(fig.nextElementSibling);
            atualizarContadores();
            selecionarFigura(fig);
            fig.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }

        var bi = $('btn-inserir-img'), ii = $('input-img');
        if (bi && ii) {
            bi.addEventListener('mousedown', function (e) { e.preventDefault(); });
            bi.addEventListener('click', function (e) { e.preventDefault(); ii.click(); });
            ii.addEventListener('change', function () {
                var f = ii.files[0]; ii.value = '';
                if (!validarImagem(f, REGEX_IMG)) return;
                bi.disabled = true;
                enviarArquivo('img', f, extensaoDe(f))
                    .then(function (url) { inserirFigura(criarFigura(url)); })
                    .catch(function (err) { console.error(err); avisar('Erro ao inserir.', 'erro'); })
                    .then(function () { bi.disabled = false; });
            });
        }

        function definirTamanho(fig, k) {
            fig.dataset.size = k;
            fig.style.width = TAMANHOS_IMG[k] + '%';
            if (k === 'g') fig.dataset.align = 'center';
        }
        function definirLargura(fig, pct) {
            var k = Object.keys(TAMANHOS_IMG).filter(function (x) { return Math.abs(TAMANHOS_IMG[x] - pct) < 1.5; })[0];
            fig.dataset.size = k || 'c';
            fig.style.width = (k ? TAMANHOS_IMG[k] : pct).toFixed(1) + '%';
            if (pct >= 99) fig.dataset.align = 'center';
        }
        function definirAlinhamento(fig, al) {
            if (al !== 'center' && parseFloat(fig.style.width) > 85) definirTamanho(fig, 'm');
            fig.dataset.align = al;
        }

        function atualizarEstados() {
            if (!figura) return;
            [barra, menu].forEach(function (c) {
                if (!c) return;
                c.querySelectorAll('[data-tam]').forEach(function (b) { b.classList.toggle('ativo', b.dataset.tam === figura.dataset.size); });
                c.querySelectorAll('[data-alin]').forEach(function (b) { b.classList.toggle('ativo', b.dataset.alin === figura.dataset.align); });
            });
            if (selecao) selecao.dataset.align = figura.dataset.align;
        }

        function posicionar() {
            if (!figura || !folha || !barra || !selecao) return;
            var img = figura.querySelector('img'); if (!img) return;
            var f = img.getBoundingClientRect();
            var cr = conteudo.getBoundingClientRect();
            if (f.bottom < cr.top || f.top > cr.bottom) { selecao.classList.remove('ativa'); barra.classList.remove('ativa'); return; }
            var p = folha.getBoundingClientRect();
            var ox = p.left + folha.clientLeft, oy = p.top + folha.clientTop;
            selecao.style.left = (f.left - ox) + 'px';
            selecao.style.top = (f.top - oy) + 'px';
            selecao.style.width = f.width + 'px';
            selecao.style.height = f.height + 'px';
            var meia = barra.offsetWidth / 2;
            var cx = limitar(f.left - ox + f.width / 2, meia + 8, folha.clientWidth - meia - 8);
            var altura = barra.offsetHeight || 44;
            var tp = f.top - oy - altura - 6;
            if (tp < 4) { var abaixo = f.bottom - oy + 10; var maxT = folha.clientHeight - altura - 4; tp = Math.min(abaixo, maxT); if (tp < 4) tp = 4; }
            barra.style.left = cx + 'px';
            barra.style.top = tp + 'px';
        }

        function selecionarFigura(fig) {
            if (figura && figura !== fig) figura.classList.remove('selecionada');
            figura = fig || null;
            if (!figura) { if (barra) barra.classList.remove('ativa'); if (selecao) selecao.classList.remove('ativa'); fecharMenu(); return; }
            figura.classList.add('selecionada');
            if (barra) barra.classList.add('ativa');
            if (selecao) selecao.classList.add('ativa');
            atualizarEstados();
            posicionar();
        }

        conteudo.addEventListener('click', function (e) {
            if (ignorarClique) return;
            var f = e.target.closest('figure.img-bloco');
            selecionarFigura(f);
            if (f && !e.target.closest('figcaption')) window.getSelection().removeAllRanges();
        });
        document.addEventListener('click', function (e) {
            if (ignorarClique) return;
            if (!e.target.closest('#input-conteudo, #img-flutuante, #img-selecao, #img-menu')) selecionarFigura(null);
        });

        window.addEventListener('resize', agendarPosicao);
        var mEl = $('atelie-main'); if (mEl) mEl.addEventListener('scroll', agendarPosicao, { passive: true });
        var cEl = $('editor-corpo'); if (cEl) cEl.addEventListener('scroll', agendarPosicao, { passive: true });
        window.addEventListener('scroll', function () { if (menu && !menu.hidden) fecharMenu(); agendarPosicao(); }, { passive: true, capture: true });
        if ('ResizeObserver' in window) new ResizeObserver(agendarPosicao).observe(conteudo);

        function removerFigura() { if (!figura) return; var a = figura; selecionarFigura(null); a.remove(); atualizarContadores(); }
        function moverPos(d) {
            if (!figura) return;
            var v = d < 0 ? figura.previousElementSibling : figura.nextElementSibling;
            if (!v) return;
            if (d < 0) v.before(figura); else v.after(figura);
            garantirParagrafo();
            figura.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        function executar(b) {
            if (!figura) return;
            var d = b.dataset;
            if (d.tam) definirTamanho(figura, d.tam);
            else if (d.alin) definirAlinhamento(figura, d.alin);
            else if (d.acao === 'remover') { removerFigura(); return; }
            else if (d.acao === 'subir') moverPos(-1);
            else if (d.acao === 'descer') moverPos(1);
            else if (d.acao === 'legenda') { var l = figura.querySelector('figcaption'); if (l) { l.focus(); colocarCursor(l); } }
            atualizarEstados();
            posicionar();
        }

        if (barra) {
            barra.addEventListener('mousedown', function (e) { if (!e.target.closest('.grip')) e.preventDefault(); });
            barra.addEventListener('click', function (e) {
                var b = e.target.closest('button');
                if (b && b.dataset.acao !== 'mover') executar(b);
            });
        }

        function abrirMenu(x, y) {
            if (!menu) return;
            atualizarEstados();
            menu.hidden = false;
            if (window.innerWidth <= MOBILE_MAX) { menu.style.left = ''; menu.style.top = ''; }
            else {
                var l = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8));
                var t = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8));
                menu.style.left = l + 'px';
                menu.style.top = t + 'px';
            }
        }
        function fecharMenu() { if (menu) menu.hidden = true; }

        conteudo.addEventListener('contextmenu', function (e) {
            var f = e.target.closest('figure.img-bloco');
            if (!f || e.target.closest('figcaption')) return;
            e.preventDefault();
            selecionarFigura(f);
            abrirMenu(e.clientX, e.clientY);
        });
        if (menu) {
            menu.addEventListener('mousedown', function (e) { e.preventDefault(); });
            menu.addEventListener('contextmenu', function (e) { e.preventDefault(); });
            menu.addEventListener('click', function (e) {
                var b = e.target.closest('button');
                if (!b) return;
                executar(b);
                fecharMenu();
            });
            document.addEventListener('pointerdown', function (e) {
                if (!menu.hidden && !menu.contains(e.target)) fecharMenu();
            });
        }

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                if (menu && !menu.hidden) fecharMenu();
                else if (arraste && arraste.ativo) cancelarArraste();
                else if (figura) selecionarFigura(null);
                return;
            }
            if (!figura || (e.key !== 'Backspace' && e.key !== 'Delete')) return;
            var a = e.target;
            if (a.closest && (a.closest('figcaption') || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
            e.preventDefault();
            removerFigura();
        });

        if (selecao) {
            selecao.querySelectorAll('.img-handle').forEach(function (h) {
                h.addEventListener('pointerdown', function (e) {
                    if (!figura) return;
                    e.preventDefault();
                    e.stopPropagation();
                    try { h.setPointerCapture(e.pointerId); } catch (_) {}
                    var fig = figura;
                    var lado = h.dataset.h.indexOf('e') !== -1 ? 1 : -1;
                    var fator = fig.dataset.align === 'center' ? 2 : 1;
                    var larg0 = fig.getBoundingClientRect().width;
                    var base = conteudo.clientWidth;
                    var x0 = e.clientX;
                    selecao.classList.add('redimensionando');
                    function mover(ev) {
                        ev.preventDefault();
                        var nova = larg0 + (ev.clientX - x0) * lado * fator;
                        var pct = limitar(nova / base * 100, 12, 100);
                        if (pct > 96) pct = 100;
                        definirLargura(fig, pct);
                        if (rotuloSel) rotuloSel.textContent = Math.round(pct) + '%';
                        atualizarEstados();
                        posicionar();
                    }
                    function fim() {
                        h.removeEventListener('pointermove', mover);
                        h.removeEventListener('pointerup', fim);
                        h.removeEventListener('pointercancel', fim);
                        selecao.classList.remove('redimensionando');
                    }
                    h.addEventListener('pointermove', mover);
                    h.addEventListener('pointerup', fim);
                    h.addEventListener('pointercancel', fim);
                });
            });
        }

        function alvoSoltura(x, y) {
            var area = conteudo.getBoundingClientRect();
            var filhos = Array.prototype.slice.call(conteudo.children).filter(function (c) { return !arraste || c !== arraste.fig; });
            var alvo = null, depois = false;
            filhos.forEach(function (f) {
                if (alvo) return;
                var r = f.getBoundingClientRect();
                if (y >= r.top && y <= r.bottom) { alvo = f; depois = y > r.top + r.height / 2; }
            });
            if (!alvo && filhos.length) {
                if (y < filhos[0].getBoundingClientRect().top) { alvo = filhos[0]; depois = false; }
                else { alvo = filhos[filhos.length - 1]; depois = true; }
            }
            var zona = x < area.left + area.width * 0.33 ? 'left' : x > area.left + area.width * 0.67 ? 'right' : 'center';
            return { alvo: alvo, depois: depois, zona: zona };
        }
        function atualizarIndicador(x, y) {
            if (!arraste || !indicador) return;
            var info = alvoSoltura(x, y);
            arraste.info = info;
            if (!info.alvo) { indicador.hidden = true; return; }
            var r = info.alvo.getBoundingClientRect();
            var area = conteudo.getBoundingClientRect();
            var p = folha.getBoundingClientRect();
            var ox = p.left + folha.clientLeft, oy = p.top + folha.clientTop;
            var larg = info.zona === 'center' ? area.width : area.width * 0.42;
            var esq = info.zona === 'right' ? area.right - larg : area.left;
            indicador.style.top = ((info.depois ? r.bottom : r.top) - oy) + 'px';
            indicador.style.left = (esq - ox) + 'px';
            indicador.style.width = larg + 'px';
            indicador.querySelector('span').textContent = info.zona === 'left' ? 'Esquerda · texto ao redor' : info.zona === 'right' ? 'Direita · texto ao redor' : 'Centralizada';
            indicador.hidden = false;
        }
        function iniciarArraste() {
            arraste.ativo = true;
            ignorarClique = true;
            document.body.classList.add('img-arrastando');
            arraste.fig.classList.add('arrastando');
            fantasma = document.createElement('div');
            fantasma.className = 'img-fantasma';
            var ii = arraste.fig.querySelector('img');
            var mi = document.createElement('img');
            mi.src = ii ? ii.src : '';
            fantasma.appendChild(mi);
            document.body.appendChild(fantasma);
        }
        function encerrarArraste() {
            document.body.classList.remove('img-arrastando');
            if (fantasma) { fantasma.remove(); fantasma = null; }
            if (indicador) indicador.hidden = true;
            if (arraste) arraste.fig.classList.remove('arrastando');
            setTimeout(function () { ignorarClique = false; }, 0);
        }
        function cancelarArraste() { if (!arraste) return; encerrarArraste(); arraste = null; }

        if (barra) {
            barra.addEventListener('pointerdown', function (e) {
                if (!e.target.closest('.grip') || !figura) return;
                e.preventDefault();
                e.stopPropagation();
                try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
                arraste = { fig: figura, x: e.clientX, y: e.clientY, ativo: false, info: null };
            });
        }

        window.addEventListener('pointermove', function (e) {
            if (!arraste) return;
            if (!arraste.ativo) {
                if (Math.hypot(e.clientX - arraste.x, e.clientY - arraste.y) < 6) return;
                iniciarArraste();
            }
            e.preventDefault();
            if (fantasma) { fantasma.style.left = e.clientX + 'px'; fantasma.style.top = e.clientY + 'px'; }
            var v = Rolagem.area();
            if (e.clientY < v.top + 130) Rolagem.por(-14);
            else if (e.clientY > v.bottom - 90) Rolagem.por(14);
            atualizarIndicador(e.clientX, e.clientY);
        }, { passive: false });

        function soltarArraste() {
            if (!arraste) return;
            var a = arraste;
            arraste = null;
            if (!a.ativo) { encerrarArraste(); return; }
            encerrarArraste();
            if (a.info && a.info.alvo) {
                if (a.info.depois) a.info.alvo.after(a.fig);
                else a.info.alvo.before(a.fig);
                definirAlinhamento(a.fig, a.info.zona);
                garantirParagrafo();
            }
            selecionarFigura(a.fig);
        }
        window.addEventListener('pointerup', soltarArraste);
        window.addEventListener('pointercancel', cancelarArraste);
        window.addEventListener('blur', cancelarArraste);

        function resetar() {
            var t = $('input-titulo'); if (t) t.value = '';
            conteudo.innerHTML = '';
            selecionarFigura(null);
            rangeSalvo = null;
            ganchos.limparCapaArtigo();
            atualizarContadores();
            atualizarLabelFonte();
            if (typeof window.__atelieAtualizarScrollbar === 'function') window.__atelieAtualizarScrollbar();
        }

        function htmlParaPublicar() {
            var clone = conteudo.cloneNode(true);
            clone.querySelectorAll('.selecionada, .arrastando').forEach(function (el) { el.classList.remove('selecionada', 'arrastando'); });
            clone.querySelectorAll('span[data-fonte]').forEach(function (s) {
                if (s.textContent === '\u200B' && s.children.length === 0) { s.remove(); return; }
                s.removeAttribute('data-fonte');
            });
            clone.querySelectorAll('span[data-marca]').forEach(function (s) {
                if (s.textContent === '\u200B' && s.children.length === 0) { s.remove(); return; }
                s.removeAttribute('data-marca');
            });
            clone.querySelectorAll('figcaption').forEach(function (l) {
                if (!l.textContent.trim()) l.remove();
                else { l.removeAttribute('contenteditable'); l.removeAttribute('data-ph'); }
            });
            var flut = false;
            clone.querySelectorAll('figure.img-bloco').forEach(function (f) {
                f.removeAttribute('contenteditable');
                f.removeAttribute('draggable');
                var w = f.style.width || '55%';
                var al = f.dataset.align || 'center';
                var st = 'box-sizing:border-box;width:' + w + ';max-width:100%;';
                if (al === 'left') { st += 'float:left;margin:1.2rem 1.6rem 1rem 0;'; flut = true; }
                else if (al === 'right') { st += 'float:right;margin:1.2rem 0 1rem 1.6rem;'; flut = true; }
                else st += 'clear:both;margin:1.2rem auto;';
                f.setAttribute('style', st);
                var i = f.querySelector('img');
                if (i) { i.removeAttribute('draggable'); i.setAttribute('style', 'display:block;width:100%;height:auto;border-radius:6px;'); }
                f.removeAttribute('data-align'); f.removeAttribute('data-size');
            });
            while (clone.lastElementChild && clone.lastElementChild.tagName === 'P' && !clone.lastElementChild.textContent.trim() && !clone.lastElementChild.querySelector('img,figure')) clone.lastElementChild.remove();
            if (flut) clone.insertAdjacentHTML('beforeend', '<div style="clear:both"></div>');
            return U.sanitizarHtml(clone.innerHTML.trim());
        }

        atualizarContadores();
        atualizarLabelFonte();
        return {
            resetar: resetar,
            temConteudo: temConteudo,
            htmlParaPublicar: htmlParaPublicar,
            estaVazio: function () { return conteudo.textContent.trim() === '' && !conteudo.querySelector('img'); }
        };
    }

    /* ===== PAGINAÇÃO TOOLBAR ===== */
    function iniciarPaginacaoToolbar() {
        var topo = $('editor-topo-custom'), cont = $('editor-toolbar-container'), bp = $('btn-toolbar-prev'), bn = $('btn-toolbar-next');
        if (!topo || !cont || !bp || !bn) return;
        var els = Array.from(cont.children);
        var btns = els.filter(function (e) { return e.tagName === 'BUTTON' || e.classList.contains('controle-fonte'); });
        var p = 0;
        function atualizar() {
            if (window.innerWidth > 768) {
                els.forEach(function (e) { e.style.display = ''; });
                topo.classList.remove('tem-overflow');
                cont.style.justifyContent = 'center';
                cont.style.overflowX = 'auto';
                return;
            }
            cont.style.overflowX = 'hidden';
            var total = Math.ceil(btns.length / 5);
            if (total <= 1) {
                topo.classList.remove('tem-overflow');
                els.forEach(function (e) { e.style.display = ''; });
                cont.style.justifyContent = 'center';
                return;
            }
            topo.classList.add('tem-overflow');
            cont.style.justifyContent = 'center';
            if (p >= total) p = total - 1;
            if (p < 0) p = 0;
            var ini = p * 5, fim = ini + 5, c = 0;
            els.forEach(function (e) {
                if (e.tagName === 'BUTTON' || e.classList.contains('controle-fonte')) {
                    e.style.display = (c >= ini && c < fim) ? '' : 'none';
                    c++;
                } else e.style.display = 'none';
            });
            bp.disabled = p === 0;
            bn.disabled = p === total - 1;
        }
        bp.addEventListener('click', function () { p--; atualizar(); });
        bn.addEventListener('click', function () { p++; atualizar(); });
        window.addEventListener('resize', atualizar);
        requestAnimationFrame(atualizar);
        setTimeout(atualizar, 100);
        setTimeout(atualizar, 500);
        window.__atelieAtualizarPaginacao = atualizar;
    }

    /* ===== PUBLICAÇÃO ===== */
    function configurarPublicacao() {
        var b = $('btn-publicar-atelie'); if (!b) return;
        b.addEventListener('click', function () {
            if (!estado.atelieAtivo) return;
            var te = $('input-titulo'), tit = te ? te.value.trim() : '';
            if (!tit) { avisar('Adicione um título.', 'erro'); return; }
            if (!editor || editor.estaVazio()) { avisar('Escreva algo antes de publicar.', 'erro'); return; }
            estadoBotao(b, true, estado.postEditandoId ? 'Atualizando...' : 'Publicando...');
            var cu = estado.capaArtigo.url, t = Promise.resolve();
            if (estado.capaArtigo.arquivo) {
                var a = estado.capaArtigo.arquivo;
                t = enviarArquivo('capa-post', a, extensaoDe(a), a.type).then(function (u) { cu = u; }).catch(function () { cu = null; });
            }
            t.then(function () {
                var ci = $('input-categoria-artigo');
                var dados = { title: tit, content: editor.htmlParaPublicar(), category: ci ? ci.value : 'Geral' };
                if (cu) dados.cover_url = cu;
                if (estado.postEditandoId) return estado.db.from('posts').update(dados).eq('id', estado.postEditandoId);
                dados.author_id = estado.usuario.id;
                dados.atelier_id = estado.atelieAtivo.id;
                return estado.db.from('posts').insert([dados]);
            }).then(function (r) {
                if (r.error) throw r.error;
                avisar(estado.postEditandoId ? 'Artigo atualizado!' : 'Publicado!');
                estado.postEditandoId = null;
                if (editor) editor.resetar();
                selecionarAba('canal');
            }).catch(function (err) { console.error(err); avisar('Erro ao salvar.', 'erro'); })
                .then(function () { estadoBotao(b, false); });
        });
    }

    /* ===== TECLADO ===== */
    function configurarTeclado() {
        document.addEventListener('focusin', function (e) {
            var a = e.target;
            if (!a || !a.matches) return;
            if (!a.matches('input, textarea, [contenteditable="true"]')) return;
            setTimeout(function () { try { a.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {} }, 300);
        });
    }

    /* ===== TROCA ATELIÊ ===== */
    window.trocarAtelie = function (id) {
        if (!estado.atelies || !estado.atelies.length) return;
        var a = estado.atelies.find(function (x) { return x.id === id; });
        if (!a) return;
        if (estado.atelieAtivo && estado.atelieAtivo.id === a.id) return;
        estado.atelieAtivo = a;
        localStorage.setItem('auloo:atelieAtivo', a.id);
        renderizarCabecalho();
        preencherPainel(a);
        carregarCanal();
        carregarVideos();
        if (editor) editor.resetar();
        estado.postEditandoId = null;
        selecionarAba('canal');
    };

    /* ===== INIT ===== */
    function iniciar() {
        aguardarSupabase().then(function (db) {
            if (!db) { console.error('Supabase ausente.'); return null; }
            estado.db = db;
            return db.auth.getSession();
        }).then(function (r) {
            if (!r || !r.data.session) { window.location.href = 'login.html'; return null; }
            estado.usuario = r.data.session.user;

            [
                ['Gaveta', Gaveta.iniciar],
                ['PainelCanal', configurarPainelCanal],
                ['PainelRedacao', configurarPainelRedacao],
                ['Dropdown', configurarDropdown],
                ['Criacao', configurarCriacao],
                ['Exclusao', configurarExclusao],
                ['Canal', configurarCanal],
                ['Abas', configurarAbas],
                ['Teclado', configurarTeclado],
                ['VoltarRedacao', configurarVoltarRedacao],
                ['Paginacao', iniciarPaginacaoToolbar],
                ['Videos', configurarVideos],
                ['Scrollbar', inicializarScrollbar]
            ].forEach(function (par) { try { par[1](); } catch (e) { console.error(par[0] + ':', e); } });

            try {
                editor = criarEditor();
                if (editor) { ganchos.resetarEditor = editor.resetar; configurarPublicacao(); }
            } catch (e) { console.error('Editor:', e); }

            return carregarAtelies();
        }).then(function () {
            var up = new URLSearchParams(window.location.search);
            if (up.get('novo') === 'true') {
                setTimeout(function () {
                    if (typeof window.abrirModalCriarAtelie === 'function') window.abrirModalCriarAtelie();
                    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
                }, 500);
            }
        }).catch(function (e) { console.error('Init:', e); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
    else iniciar();
})();