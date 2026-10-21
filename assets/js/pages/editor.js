(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    let db = null;
    let usuarioLogado = null;
    let arquivoCapa = null;

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

        configurarToolbar();
        configurarCapa();
        configurarPublicacao();
    }

    function configurarToolbar() {
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
            if (!file) return;
            
            const path = usuarioLogado.id + '/img_' + Date.now() + '_' + file.name;
            const { error } = await db.storage.from('avatars').upload(path, file);
            
            if (!error) {
                const url = db.storage.from('avatars').getPublicUrl(path).data.publicUrl;
                document.execCommand('insertImage', false, url);
            }
            inputImg.value = '';
        });
    }

    function configurarCapa() {
        const capaEl = $('editor-capa');
        const inputCapa = document.createElement('input');
        inputCapa.type = 'file';
        inputCapa.accept = 'image/*';

        capaEl.addEventListener('click', () => inputCapa.click());

        inputCapa.addEventListener('change', () => {
            const file = inputCapa.files[0];
            if (!file) return;
            arquivoCapa = file;

            const reader = new FileReader();
            reader.onload = (e) => {
                capaEl.style.backgroundImage = `url('${e.target.result}')`;
                capaEl.innerHTML = '';
            };
            reader.readAsDataURL(file);
        });
    }

    function configurarPublicacao() {
        const btn = $('btn-publicar');
        const tituloEl = $('input-titulo');
        const conteudoEl = $('input-conteudo');

        [tituloEl, conteudoEl].forEach(el => {
            el.addEventListener('input', () => {
                $('editor-status').textContent = 'Rascunho não salvo';
                $('editor-status').style.color = 'var(--erro)';
            });
        });

        btn.addEventListener('click', async () => {
            const titulo = tituloEl.value.trim();
            const conteudo = conteudoEl.innerHTML;
            const categoria = $('input-categoria').value;

            if (!titulo) return alert('Adicione um título!');
            if (!conteudo || conteudo === '<p>Comece a escrever sua história...</p>') return alert('Escreva algo no conteúdo!');

            btn.disabled = true;
            btn.textContent = 'Publicando...';
            $('editor-status').textContent = 'Salvando...';

            try {
                let capaUrl = null;

                if (arquivoCapa) {
                    const pathCapa = usuarioLogado.id + '/capa_' + Date.now() + '.jpg';
                    const { error: errCapa } = await db.storage.from('avatars').upload(pathCapa, arquivoCapa);
                    if (!errCapa) {
                        capaUrl = db.storage.from('avatars').getPublicUrl(pathCapa).data.publicUrl;
                    }
                }

                const { error } = await db.from('posts').insert([{
                    author_id: usuarioLogado.id,
                    title: titulo,
                    content: conteudo,
                    cover_url: capaUrl,
                    category: categoria
                }]);

                if (error) throw error;

                $('editor-status').textContent = 'Publicado com sucesso!';
                $('editor-status').style.color = 'var(--sucesso)';
                
                setTimeout(() => {
                    window.location.href = 'comunidade.html';
                }, 1000);

            } catch (err) {
                console.error(err);
                alert('Erro ao publicar. Tente novamente.');
                btn.disabled = false;
                btn.textContent = 'Publicar';
                $('editor-status').textContent = 'Rascunho não salvo';
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();