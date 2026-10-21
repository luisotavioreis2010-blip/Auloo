/* ==============================================
   LAYOUT.JS — v12 (Completo e Funcional)
   ============================================== */
(function () {
    'use strict';

    const PAGINA_LOGIN = 'login.html';
    const mqCompacto = window.matchMedia('(max-width: 1366px)');

    const CHAVES_LOGOUT = ['acervo_user', 'acervo_saved_email'];
    const PREFIXOS_STORAGE_AUTH = ['sb-', 'acervo-auth'];
    const TIMEOUT_SIGNOUT_MS = 3000;
    
    const SUPABASE_TENTATIVAS = 40;
    const SUPABASE_INTERVALO_MS = 200;
    const BUCKET_AVATARES = 'avatars';
    const TAMANHO_MAX_FOTO = 5 * 1024 * 1024;
    const EXTENSOES_FOTO = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

    const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const DIAS_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

    const perfil = { usuario: null, nome: 'Usuário', email: '', avatarUrl: null };
    let saindo = false;

    const $ = (id) => document.getElementById(id);
    const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function getDb() {
        return window.supabaseClient || (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
    }

    async function aguardarDb() {
        for (let i = 0; i < SUPABASE_TENTATIVAS; i++) {
            const db = getDb();
            if (db) return db;
            await esperar(SUPABASE_INTERVALO_MS);
        }
        return null;
    }

    function getPaginaAtual() {
        const path = window.location.pathname;
        return path.substring(path.lastIndexOf('/') + 1) || 'estante.html';
    }

    /* ==============================================
       LÓGICA DE TELA (A Mágica Original Restaurada)
       ============================================== */
    function sincronizarTela() {
        const raiz = document.documentElement;
        
        // Define a altura fixa para o mobile
        raiz.style.setProperty('--viewport-h', window.innerHeight + 'px');
        
        // Se a tela estiver deitada (landscape), define data-layout="row"
        const layout = window.innerWidth > window.innerHeight ? 'row' : 'stacked';
        if (raiz.getAttribute('data-layout') !== layout) {
            raiz.setAttribute('data-layout', layout);
        }
    }

    function setupTela() {
        // Chama ao iniciar
        sincronizarTela();
        
        // Chama ao redimensionar
        window.addEventListener('resize', sincronizarTela);
        
        // Chama ao girar a tela
        window.addEventListener('orientationchange', () => {
            setTimeout(sincronizarTela, 100);
            setTimeout(sincronizarTela, 300);
        });
    }

    /* ==============================================
       INJEÇÃO DE INTERFACE
       ============================================== */
    function injetarInterface() {
        const pagina = getPaginaAtual();
        
        const navbarHTML = `
            <header class="navbar">
                <div class="navbar-left">
                    <button class="btn-hamburger" id="btn-hamburger" type="button" aria-label="Abrir sumário" aria-expanded="false" aria-controls="sidebar">&#9776;</button>
                    <a href="estante.html" class="logo" style="text-decoration: none;" translate="no">Auloo<span class="logo-dot">.</span></a>
                </div>
                <div class="navbar-right">
                    <a href="atelie.html" class="btn-sair" style="text-decoration: none; display: flex; align-items: center; gap: 0.5rem; border-color: var(--dourado); color: var(--dourado);">
                        ❦ Meu Ateliê
                    </a>
                    <button class="btn-sair" id="btn-sair" type="button" aria-label="Sair do sistema">Sair</button>
                    <button class="perfil-botao" id="perfil-botao" type="button" aria-label="Abrir ficha do aluno" aria-expanded="false" aria-controls="sidebar-perfil">
                        <span class="perfil-usuario" id="perfil-usuario"></span>
                    </button>
                </div>
            </header>
            <div class="gaveta-overlay" id="gaveta-overlay" aria-hidden="true"></div>
        `;
        document.body.insertAdjacentHTML('afterbegin', navbarHTML);

        const sidebarHTML = `
            <aside class="sidebar" id="sidebar" aria-label="Sumário">
                <div class="sidebar-secao">
                    <h2 class="sidebar-titulo">Sumário</h2>
                    <div class="sidebar-filete"></div>
                    <nav class="sidebar-menu">
                        <a href="estante.html" class="sidebar-link ${pagina === 'estante.html' ? 'ativo' : ''}">
                            <span class="sidebar-icone"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></span>
                            <span class="sidebar-romano">I</span><span class="sidebar-nome">Início</span>
                        </a>
                        <a href="comunidade.html" class="sidebar-link ${pagina === 'comunidade.html' ? 'ativo' : ''}">
                            <span class="sidebar-icone"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
                            <span class="sidebar-romano">II</span><span class="sidebar-nome">O Mural</span>
                        </a>
                        <a href="#" class="sidebar-link">
                            <span class="sidebar-icone"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
                            <span class="sidebar-romano">III</span><span class="sidebar-nome">Quizzes</span>
                        </a>
                    </nav>
                    <div class="sidebar-selo"><span>&#10022;</span><span class="selo-texto">Auloo Learning</span><span>&#10022;</span></div>
                    <div class="sidebar-volume"><span class="volume-numero">Vol. I</span><span class="volume-ano">MMXXVI</span></div>
                </div>
            </aside>
        `;
        document.body.insertAdjacentHTML('beforeend', sidebarHTML);

        const fichaHTML = `
            <aside class="sidebar-direita" id="sidebar-perfil" aria-label="Ficha do Aluno">
                <div class="ficha-header">
                    <h2 class="ficha-titulo">Ficha do Aluno</h2>
                    <button class="ficha-fechar" id="ficha-fechar" type="button" aria-label="Fechar ficha">&#10005;</button>
                </div>
                <div class="ficha-filete"></div>
                <div class="ficha-perfil">
                    <div class="ficha-foto" id="sidebar-perfil-foto"></div>
                    <div class="ficha-info">
                        <span class="ficha-nome" id="sidebar-perfil-nome">Usuário</span>
                        <span class="ficha-email" id="sidebar-perfil-email">&nbsp;</span>
                    </div>
                </div>
                <div class="ficha-filete"></div>
                <nav class="ficha-menu">
                    <button class="ficha-item" id="btn-editar-foto" type="button">
                        <span class="ficha-romano">&#10070;</span><span class="ficha-texto">Mudar Foto</span>
                    </button>
                    <button class="ficha-item" id="btn-editar-nome" type="button" aria-expanded="false" aria-controls="container-editar-nome">
                        <span class="ficha-romano">&#9998;</span><span class="ficha-texto">Editar Nome</span>
                    </button>
                    <form id="container-editar-nome" class="container-expansivel" hidden novalidate>
                        <label for="input-novo-nome">Nome</label>
                        <input type="text" id="input-novo-nome" autocomplete="off" placeholder="Digite seu novo nome">
                        <button id="btn-salvar-nome" class="btn-container" type="submit">Salvar</button>
                    </form>
                    <button class="ficha-item" id="btn-saiba-mais" type="button" aria-expanded="false" aria-controls="container-saiba-mais">
                        <span class="ficha-romano">&#10022;</span><span class="ficha-texto">Saiba mais</span>
                    </button>
                    <div id="container-saiba-mais" class="container-expansivel" hidden>
                        <a class="ficha-saiba-item" href="/?de=estante">
                            <span class="ficha-saiba-num">I</span><span class="ficha-saiba-corpo"><strong>Conheça o Auloo</strong><small>Visão geral</small></span>
                        </a>
                    </div>
                </nav>
            </aside>
            <input type="file" id="input-foto" accept="image/jpeg,image/png,image/gif,image/webp" hidden aria-label="Upload de foto de perfil">
        `;
        document.body.insertAdjacentHTML('beforeend', fichaHTML);
    }

    /* ==============================================
       LÓGICA DO CALENDÁRIO
       ============================================== */
    function setupCalendario() {
        const titulo = $('calendario-titulo');
        const subtitulo = $('calendario-subtitulo');
        const diasContainer = $('calendario-dias');
        if (!titulo || !diasContainer) return;

        const agora = new Date();
        let mes = agora.getMonth();
        let ano = agora.getFullYear();

        function criarDia(numero, classe) {
            const dia = document.createElement('span');
            if (classe) dia.className = classe;
            dia.textContent = numero;
            return dia;
        }

        function desenhar() {
            const hoje = new Date();
            const primeiroDiaSemana = new Date(ano, mes, 1).getDay();
            const diasNoMes = new Date(ano, mes + 1, 0).getDate();
            const diasMesAnterior = new Date(ano, mes, 0).getDate();
            const fragmento = document.createDocumentFragment();
            let celulas = 0;

            titulo.textContent = MESES[mes] + ' ' + ano;
            if (subtitulo) subtitulo.textContent = DIAS_SEMANA[hoje.getDay()];

            for (let i = primeiroDiaSemana - 1; i >= 0; i--) { fragmento.appendChild(criarDia(diasMesAnterior - i, 'dia-outro-mes')); celulas++; }
            for (let i = 1; i <= diasNoMes; i++) {
                const ehHoje = i === hoje.getDate() && mes === hoje.getMonth() && ano === hoje.getFullYear();
                fragmento.appendChild(criarDia(i, ehHoje ? 'dia-atual' : ''));
                celulas++;
            }
            const faltam = (7 - (celulas % 7)) % 7;
            for (let i = 1; i <= faltam; i++) { fragmento.appendChild(criarDia(i, 'dia-outro-mes')); }

            diasContainer.textContent = '';
            diasContainer.appendChild(fragmento);
        }

        function mudarMes(delta) {
            mes += delta;
            if (mes < 0) { mes = 11; ano--; }
            if (mes > 11) { mes = 0; ano++; }
            desenhar();
        }

        const btnAnterior = $('btn-mes-anterior');
        const btnProximo = $('btn-proximo-mes');
        if (btnAnterior) btnAnterior.addEventListener('click', () => mudarMes(-1));
        if (btnProximo) btnProximo.addEventListener('click', () => mudarMes(1));
        desenhar();
    }

    /* ==============================================
       LÓGICA DO PERFIL E SESSÃO
       ============================================== */
    function criarIniciais(nome) {
        const partes = (nome || 'Usuário').trim().split(/\s+/);
        const inicial = (texto) => (Array.from(texto)[0] || '').toUpperCase();
        const span = document.createElement('span');
        span.className = 'avatar-iniciais';
        span.textContent = inicial(partes[0]) + (partes.length > 1 ? inicial(partes[partes.length - 1]) : '');
        return span;
    }

    function renderizarAvatar(container, avatarUrl, nome) {
        if (!container) return;
        container.textContent = '';
        if (!avatarUrl || avatarUrl === 'null' || avatarUrl === 'undefined' || avatarUrl.trim() === '') { 
            container.appendChild(criarIniciais(nome)); 
            return; 
        }
        const img = document.createElement('img');
        img.className = 'foto-perfil'; 
        img.alt = 'Foto de perfil'; 
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => { 
            container.textContent = '';
            container.appendChild(criarIniciais(nome)); 
        };
        img.src = avatarUrl; 
        container.appendChild(img);
    }

    function renderizarPerfil() {
        renderizarAvatar($('perfil-usuario'), perfil.avatarUrl, perfil.nome);
        renderizarAvatar($('sidebar-perfil-foto'), perfil.avatarUrl, perfil.nome);
        const nome = $('sidebar-perfil-nome'); 
        const email = $('sidebar-perfil-email');
        if (nome) nome.textContent = perfil.nome; 
        if (email) email.textContent = perfil.email;
    }

    async function buscarPerfilNoBanco(usuarioId) {
        const db = getDb();
        if (!db) return;
        
        const { data, error } = await db
            .from('profiles')
            .select('full_name, avatar_url')
            .eq('id', usuarioId)
            .maybeSingle();

        if (!error && data) {
            if (data.full_name) perfil.nome = data.full_name;
            if (data.avatar_url) perfil.avatarUrl = data.avatar_url;
            renderizarPerfil(); 
        }
    }

    async function enviarFoto(arquivo) {
        const extensao = EXTENSOES_FOTO[arquivo.type];
        if (!extensao) return alert('Formato não suportado!');
        if (arquivo.size > TAMANHO_MAX_FOTO) return alert('Imagem muito grande! Máximo 5MB.');

        const db = getDb();
        if (!db || !perfil.usuario) return;

        const btn = $('btn-editar-foto');
        if (btn) btn.disabled = true;

        const usuarioId = perfil.usuario.id;
        const caminho = usuarioId + '/avatar_' + usuarioId + '_' + Date.now() + '.' + extensao;

        const { error: uploadError } = await db.storage
            .from(BUCKET_AVATARES)
            .upload(caminho, arquivo, { cacheControl: '3600', contentType: arquivo.type });

        if (uploadError) {
            console.error(uploadError);
            alert('Erro ao enviar imagem.');
            if (btn) btn.disabled = false;
            return;
        }

        const urlPublica = db.storage.from(BUCKET_AVATARES).getPublicUrl(caminho).data.publicUrl;

        await db.auth.updateUser({ data: { avatar_url: urlPublica } });
        await db.from('profiles').upsert({ id: usuarioId, avatar_url: urlPublica, updated_at: new Date().toISOString() });

        perfil.avatarUrl = urlPublica;
        renderizarPerfil();
        
        if (btn) btn.disabled = false;
    }

    function setupUploadFoto() {
        const btnEditarFoto = $('btn-editar-foto');
        const inputFoto = $('input-foto');

        if (btnEditarFoto && inputFoto) {
            btnEditarFoto.addEventListener('click', () => inputFoto.click());
            inputFoto.addEventListener('change', async () => {
                const arquivo = inputFoto.files[0];
                inputFoto.value = '';
                if (arquivo) await enviarFoto(arquivo);
            });
        }
    }

    function irParaLogin() { window.location.href = PAGINA_LOGIN; }

    function limparArmazenamento() {
        try {
            CHAVES_LOGOUT.forEach((chave) => localStorage.removeItem(chave));
            Object.keys(localStorage).filter((chave) => PREFIXOS_STORAGE_AUTH.some((prefixo) => chave.indexOf(prefixo) === 0)).forEach((chave) => localStorage.removeItem(chave));
            sessionStorage.clear();
        } catch (erro) { }
    }

    async function fazerLogout() {
        saindo = true;
        const db = getDb();
        if (db) {
            let temporizador;
            try { await Promise.race([db.auth.signOut(), new Promise((resolve) => { temporizador = setTimeout(resolve, TIMEOUT_SIGNOUT_MS); })]); }
            catch (erro) { } finally { clearTimeout(temporizador); }
        }
        limparArmazenamento(); 
        irParaLogin();
    }

    async function iniciarSessao() {
        const db = await aguardarDb();
        if (!db) { irParaLogin(); return; }

        db.auth.onAuthStateChange((evento, sessao) => {
            if (evento === 'SIGNED_OUT' && !saindo) irParaLogin();
        });

        const { data: { session } } = await db.auth.getSession();
        if (!session) { irParaLogin(); return; }

        perfil.usuario = session.user;
        perfil.email = session.user.email || '';
        const meta = session.user.user_metadata || {};
        
        perfil.nome = meta.full_name || meta.name || perfil.email.split('@')[0];
        perfil.avatarUrl = meta.avatar_url || meta.picture || null;
        
        renderizarPerfil();
        await buscarPerfilNoBanco(perfil.usuario.id);
    }

    function setupLayout() {
        const sidebar = $('sidebar');
        const ficha = $('sidebar-perfil');
        const overlay = $('gaveta-overlay');
        const perfilBotao = $('perfil-botao');
        const fichaFechar = $('ficha-fechar');
        const btnHamburger = $('btn-hamburger');
        const btnSair = $('btn-sair');

        if (btnSair) btnSair.addEventListener('click', () => { btnSair.disabled = true; fazerLogout(); });

        const sidebarAberta = () => sidebar && sidebar.classList.contains('aberta');
        const fichaAberta = () => ficha && ficha.classList.contains('ativa');

        function atualizarEstado() {
            if (overlay) overlay.classList.toggle('ativa', sidebarAberta() || (mqCompacto.matches && fichaAberta()));
            if (btnHamburger) btnHamburger.setAttribute('aria-expanded', String(sidebarAberta()));
            if (perfilBotao) perfilBotao.setAttribute('aria-expanded', String(fichaAberta()));
        }

        if (btnHamburger) btnHamburger.addEventListener('click', () => { sidebar.classList.toggle('aberta'); atualizarEstado(); });
        if (perfilBotao) perfilBotao.addEventListener('click', () => { ficha.classList.toggle('ativa'); document.body.classList.toggle('ficha-aberta'); atualizarEstado(); });
        if (fichaFechar) fichaFechar.addEventListener('click', () => { ficha.classList.remove('ativa'); document.body.classList.remove('ficha-aberta'); atualizarEstado(); });
        if (overlay) overlay.addEventListener('click', () => { sidebar.classList.remove('aberta'); ficha.classList.remove('ativa'); document.body.classList.remove('ficha-aberta'); atualizarEstado(); });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { sidebar.classList.remove('aberta'); ficha.classList.remove('ativa'); document.body.classList.remove('ficha-aberta'); atualizarEstado(); }
        });
    }

    function iniciar() {
        injetarInterface();
        setupTela(); // Ativa a lógica de tela (row/stacked)
        setupCalendario();
        setupLayout();
        setupUploadFoto();
        iniciarSessao();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();