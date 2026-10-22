/* ==============================================
   MURAL.JS — v3 (Feed + filtros pelas categorias novas)
   ============================================== */
(function () {
    'use strict';

    var db = null;
    var postsCarregados = [];
    var filtroAtual = 'Todos';
    var termoBusca = '';

    function getDb() {
        return window.supabaseClient || (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
    }

    async function aguardarDb() {
        for (var i = 0; i < 30; i++) {
            var d = getDb();
            if (d) return d;
            await new Promise(function (r) { setTimeout(r, 200); });
        }
        return null;
    }

    function sanitizarHtml(html) {
        if (!html) return '';
        var doc = new DOMParser().parseFromString('<div id="__root">' + html + '</div>', 'text/html');
        var root = doc.getElementById('__root');
        if (!root) return '';
        var PROIBIDAS = ['script', 'iframe', 'object', 'embed', 'form', 'input', 'style', 'link', 'meta'];
        PROIBIDAS.forEach(function (tag) {
            Array.prototype.forEach.call(root.querySelectorAll(tag), function (el) { el.remove(); });
        });
        Array.prototype.forEach.call(root.querySelectorAll('*'), function (el) {
            Array.prototype.slice.call(el.attributes).forEach(function (attr) {
                var nome = attr.name.toLowerCase();
                if (nome.indexOf('on') === 0) el.removeAttribute(attr.name);
                if (nome === 'href' || nome === 'src' || nome === 'xlink:href') {
                    var v = String(attr.value || '').trim().toLowerCase();
                    if (v.indexOf('javascript:') === 0 || v.indexOf('data:text/html') === 0) {
                        el.removeAttribute(attr.name);
                    }
                }
            });
        });
        return root.innerHTML;
    }

    function escapar(texto) {
        var d = document.createElement('div');
        d.textContent = texto == null ? '' : String(texto);
        return d.innerHTML;
    }

    function iniciais(nome) {
        var p = String(nome || '?').trim().split(/\s+/);
        var a = (p[0] || '?').charAt(0).toUpperCase();
        var b = p.length > 1 ? (p[p.length - 1] || '').charAt(0).toUpperCase() : '';
        return a + b;
    }

    function tempoRelativo(data) {
        if (!data) return '';
        var d = new Date(data);
        var s = Math.floor((Date.now() - d.getTime()) / 1000);
        if (s < 60) return 'agora';
        if (s < 3600) return Math.floor(s / 60) + 'min atrás';
        if (s < 86400) return Math.floor(s / 3600) + 'h atrás';
        if (s < 604800) return Math.floor(s / 86400) + 'd atrás';
        return d.toLocaleDateString('pt-BR');
    }

    function extrairTexto(html, limite) {
        var div = document.createElement('div');
        div.innerHTML = sanitizarHtml(html || '');
        var texto = (div.textContent || '').replace(/\s+/g, ' ').trim();
        if (limite && texto.length > limite) texto = texto.slice(0, limite) + '…';
        return texto;
    }

    function parsePos(str) {
        var p = String(str || '50% 50%').split(' ');
        var x = parseFloat(p[0]); var y = parseFloat(p[1]);
        return [isNaN(x) ? 50 : x, isNaN(y) ? 50 : y];
    }

    function criarAvatar(author, nome) {
        var wrap = document.createElement('span');
        wrap.className = 'post-avatar';
        wrap.style.cssText =
            'display:inline-flex;align-items:center;justify-content:center;' +
            'width:42px;height:42px;border-radius:50%;overflow:hidden;' +
            'background:var(--vinho);color:var(--papel-claro);' +
            'font-family:var(--fonte-display);font-style:italic;font-size:0.85rem;' +
            'flex-shrink:0;border:2px solid var(--dourado);';
        var url = author && (author.avatar_url || author.picture);
        if (url) {
            var img = document.createElement('img');
            img.src = url;
            img.alt = '';
            img.referrerPolicy = 'no-referrer';
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
            img.onerror = function () { img.remove(); wrap.textContent = iniciais(nome); };
            wrap.appendChild(img);
        } else {
            wrap.textContent = iniciais(nome);
        }
        return wrap;
    }

    function criarPost(post) {
        var autor = post.profiles || post.author || {};
        var nome = autor.full_name || autor.name || 'Anônimo';
        var artigo = document.createElement('article');
        artigo.className = 'post';
        artigo.dataset.categoria = post.category || '';

        var header = document.createElement('div');
        header.className = 'post-header';

        var info = document.createElement('div');
        info.className = 'author-info';
        info.style.cssText = 'display:flex;align-items:center;gap:0.8rem;';

        info.appendChild(criarAvatar(autor, nome));

        var meta = document.createElement('div');
        meta.style.cssText = 'display:flex;flex-direction:column;gap:0.1rem;';

        var nomeEl = document.createElement('span');
        nomeEl.className = 'author-name';
        nomeEl.textContent = nome;
        meta.appendChild(nomeEl);

        var tempo = document.createElement('span');
        tempo.className = 'post-time';
        tempo.textContent = tempoRelativo(post.created_at);
        meta.appendChild(tempo);

        info.appendChild(meta);
        header.appendChild(info);

        if (post.category) {
            var cat = document.createElement('span');
            cat.className = 'post-categoria';
            cat.textContent = post.category;
            cat.style.cssText =
                'font-family:var(--fonte-corpo);font-size:0.65rem;font-weight:600;' +
                'text-transform:uppercase;letter-spacing:1.5px;color:var(--dourado);';
            header.appendChild(cat);
        }

        artigo.appendChild(header);

        if (post.cover_url) {
            var capa = document.createElement('img');
            capa.src = post.cover_url;
            capa.alt = '';
            capa.loading = 'lazy';
            capa.referrerPolicy = 'no-referrer';
            var [cx, cy] = parsePos(post.cover_position);
            var cz = parseFloat(post.cover_zoom) || 1;
            capa.style.cssText =
                'width:100%;max-height:340px;object-fit:cover;border-radius:4px;' +
                'margin-bottom:1.5rem;border:1px solid var(--dourado-fraco);' +
                'object-position:' + cx + '% ' + cy + '%;' +
                'transform-origin:' + cx + '% ' + cy + '%;' +
                'transform:scale(' + cz + ');';
            artigo.appendChild(capa);
        }

        if (post.title) {
            var titulo = document.createElement('h2');
            titulo.textContent = post.title;
            titulo.style.cssText =
                'font-family:var(--fonte-titulo);font-size:1.6rem;font-style:italic;' +
                'color:var(--vinho);margin-bottom:1rem;line-height:1.2;';
            artigo.appendChild(titulo);
        }

        var conteudo = document.createElement('div');
        conteudo.className = 'post-content';

        var texto = document.createElement('div');
        texto.className = 'texto-capitular';
        texto.innerHTML = sanitizarHtml(post.content || '');
        conteudo.appendChild(texto);

        var textoPlano = extrairTexto(post.content, 0);
        if (textoPlano.length > 280) {
            var btnLer = document.createElement('button');
            btnLer.type = 'button';
            btnLer.className = 'btn-leia-mais';
            btnLer.textContent = 'Continuar lendo';
            btnLer.addEventListener('click', function () {
                texto.classList.add('expandido');
                btnLer.remove();
            });
            conteudo.appendChild(btnLer);
        }

        artigo.appendChild(conteudo);

        var acoes = document.createElement('div');
        acoes.className = 'post-actions';

        var btnCurtir = document.createElement('button');
        btnCurtir.type = 'button';
        btnCurtir.className = 'btn-acao';
        btnCurtir.textContent = '♡ Curtir';
        btnCurtir.addEventListener('click', function () {
            btnCurtir.textContent = btnCurtir.textContent.indexOf('♥') === 0 ? '♡ Curtir' : '♥ Curtido';
        });
        acoes.appendChild(btnCurtir);

        artigo.appendChild(acoes);
        return artigo;
    }

    function renderizarFeed(lista) {
        var feed = document.querySelector('.feed');
        if (!feed) return;
        feed.innerHTML = '';

        if (!lista.length) {
            var vazio = document.createElement('div');
            vazio.className = 'mural-vazio';
            vazio.style.cssText = 'text-align:center;padding:4rem 0;color:var(--tinta-clara);';
            var p1 = document.createElement('p');
            p1.style.cssText = 'font-family:var(--fonte-display);font-size:1.5rem;font-style:italic;';
            p1.textContent = termoBusca ? 'Nada encontrado para "' + termoBusca + '".' : 'O Mural está em silêncio...';
            vazio.appendChild(p1);
            feed.appendChild(vazio);
            return;
        }

        var frag = document.createDocumentFragment();
        lista.forEach(function (p) { frag.appendChild(criarPost(p)); });
        feed.appendChild(frag);
    }

    function aplicarFiltros() {
        return postsCarregados.filter(function (p) {
            if (filtroAtual && filtroAtual !== 'Todos' && p.category !== filtroAtual) return false;
            if (!termoBusca) return true;
            var hay = ((p.title || '') + ' ' + extrairTexto(p.content, 0) + ' ' +
                ((p.profiles && p.profiles.full_name) || '')).toLowerCase();
            return hay.indexOf(termoBusca.toLowerCase()) !== -1;
        });
    }

    function atualizar() { renderizarFeed(aplicarFiltros()); }

    async function carregarPosts() {
        var feed = document.querySelector('.feed');
        if (!feed) return;
        feed.innerHTML = '<div style="text-align:center;padding:3rem 0;font-family:var(--fonte-display);font-style:italic;color:var(--tinta-clara);">Carregando o mural…</div>';

        var resultado = await db
            .from('posts')
            .select('id, title, content, cover_url, cover_position, cover_zoom, category, created_at, author_id, profiles:author_id(full_name, avatar_url)')
            .order('created_at', { ascending: false })
            .limit(50);

        if (resultado.error) {
            console.error('Erro ao carregar posts:', resultado.error);
            var alt = await db
                .from('posts')
                .select('id, title, content, cover_url, category, created_at, author_id')
                .order('created_at', { ascending: false })
                .limit(50);
            if (alt.error) {
                feed.innerHTML = '<div style="text-align:center;padding:3rem 0;color:var(--erro, #B23A2E);">Não foi possível carregar o mural.</div>';
                return;
            }
            postsCarregados = alt.data || [];
        } else {
            postsCarregados = resultado.data || [];
        }
        atualizar();
    }

    function ligarControles() {
        var filtros = document.querySelectorAll('.mural-filtros button');
        Array.prototype.forEach.call(filtros, function (btn) {
            btn.addEventListener('click', function () {
                Array.prototype.forEach.call(filtros, function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                filtroAtual = btn.textContent.trim();
                atualizar();
            });
        });

        var busca = document.querySelector('.busca-wrapper input');
        if (busca) {
            var t = null;
            busca.addEventListener('input', function () {
                clearTimeout(t);
                t = setTimeout(function () {
                    termoBusca = busca.value.trim();
                    atualizar();
                }, 250);
            });
        }
    }

    window.expandirTexto = function (idTexto, botao) {
        var el = document.getElementById(idTexto);
        if (el) { el.classList.add('expandido'); if (botao) botao.style.display = 'none'; }
    };

    async function iniciar() {
        if (!document.querySelector('.feed')) return;
        db = await aguardarDb();
        if (!db) { console.error('mural.js: Supabase não carregado.'); return; }

        // Ajusta os filtros do mural para as categorias novas
        var filtros = document.querySelectorAll('.mural-filtros button');
        var categorias = ['Todos', 'Matemática', 'Ciências', 'Redação & Literatura', 'História & Geografia', 'Dicas de Estudo'];
        if (filtros.length) {
            // Remove os botões antigos (Leituras/Dúvidas/Vídeos)
            Array.prototype.forEach.call(filtros, function (b) { b.remove(); });
            var container = document.querySelector('.mural-filtros');
            categorias.forEach(function (c) {
                var b = document.createElement('button');
                b.type = 'button';
                b.textContent = c;
                if (c === 'Todos') b.classList.add('active');
                container.appendChild(b);
            });
        }

        ligarControles();
        await carregarPosts();

        window.addEventListener('pageshow', function (e) { if (e.persisted) carregarPosts(); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();