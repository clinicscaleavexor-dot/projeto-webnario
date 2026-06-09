# Projeto Webnário — Plataforma de Webinário Simulado ("Live Evergreen")

Sistema para rodar **webinários que parecem ao vivo**, mas são um vídeo gravado
tocando de forma **sincronizada pelo horário do servidor**. Se a live foi
agendada para 10:00 e a pessoa entra 10:20, o vídeo já está no minuto 20 tocando
sozinho — com chat fake, contador de espectadores subindo, banners e CTA.

- **Painel ADM** (login interno): cria webinários, sobe vídeo, agenda horário,
  programa comentários/respostas fake, CTA, banners e contador de espectadores.
- **Página pública** (`watch.html?w=slug`): a "live" que o público assiste.
- **Backend:** Supabase (Auth + Postgres + Storage + Edge Functions).
- **Frontend:** HTML/CSS/JS puro (sem build). Roda no Live Server do VS Code.

---

## 1. Criar o projeto no Supabase

1. Acesse https://supabase.com e crie um projeto (plano free serve para começar).
2. Em **Project Settings → API**, copie:
   - **Project URL**
   - **anon public** key
3. Cole esses dois valores em [`public/config.js`](public/config.js).

> ⚠️ **Atenção a custos:** o plano free tem ~1 GB de Storage e ~5 GB de
> egress/mês. Vídeos de 1h podem passar de 1 GB cada. Para escalar, comprima os
> vídeos (720p/H.264) ou troque o Storage por Bunny Stream/Cloudflare R2 depois
> (basta colar a URL externa do vídeo no campo "URL do vídeo" do editor).

## 2. Criar o banco e o storage

No Supabase, abra **SQL Editor → New query** e rode, **na ordem**:

1. Todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
2. Todo o conteúdo de [`supabase/storage.sql`](supabase/storage.sql) → **Run**.

## 3. Desligar cadastro público (importante)

Em **Authentication → Sign In / Providers → Email**, **desative "Allow new users
to sign up"**. Assim, só o ADM cria usuários (pela Edge Function).

## 4. Criar o primeiro administrador

1. Em **Authentication → Users → Add user**: crie seu usuário (e-mail + senha,
   marque *Auto Confirm User*).
2. Volte ao **SQL Editor** e rode (troque pelo seu e-mail):

   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'seu@email.com');
   ```

## 5. Publicar a Edge Function (criar usuários pelo painel)

Necessário apenas se quiser criar usuários pela tela **Usuários** do painel.
Requer a [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
# instale a CLI (uma vez) — ex. via npm:
npm install -g supabase

supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase functions deploy admin-create-user
```

> A function recebe automaticamente `SUPABASE_URL`,
> `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_ANON_KEY` do ambiente do projeto —
> não precisa configurar segredos manualmente.
>
> **Alternativa sem CLI:** você pode criar usuários direto pelo painel do
> Supabase (Authentication → Add user) e definir o papel via o SQL do passo 4.

## 6. Rodar localmente

1. Abra a pasta `Projeto Webnario` no VS Code.
2. Instale a extensão **Live Server** (Ritwick Dey), se ainda não tiver.
3. Clique com o botão direito em [`public/index.html`](public/index.html) →
   **Open with Live Server**.
4. Faça login com o admin criado no passo 4.

> Não abra o `index.html` com duplo-clique (`file://`) — os módulos ES e o
> Supabase exigem um servidor `http://`. Use o Live Server.

---

## Como usar

1. **Dashboard** → *+ Novo webinário*.
2. **Aba Vídeo:** suba o MP4 (a duração é detectada sozinha) ou cole uma URL.
3. **Aba Agenda:** defina data/hora de início.
4. **Aba Comentários:** adicione comentários fake e respostas de "ADM", cada um
   com o minuto em que aparece (ex.: `34:00`).
5. **Aba CTA:** botão que surge num minuto, com opção de "postar no chat".
6. **Aba Banner:** suba imagens clicáveis (topo, lateral ou abaixo do vídeo).
7. **Aba Espectadores:** base, pico e variação do contador.
8. Clique em **Salvar** e depois em **Publicar**.
9. Use **Copiar link** e compartilhe o `watch.html?w=...`.

### Teste rápido (recomendado)
Suba um vídeo curto (2–3 min), agende para **daqui a ~1 minuto**, adicione um
comentário no segundo `0:20`, uma resposta de ADM no `0:30` e um CTA no `0:40`
com "postar no chat". Abra o link público numa aba anônima e acompanhe:
contagem regressiva → vídeo inicia sozinho → comentários e CTA aparecem nos
tempos certos → contador sobe. Entre de novo "atrasado" e veja a live já em
andamento.

---

## Estrutura

```
Projeto Webnario/
  README.md
  supabase/
    schema.sql                  # tabelas, RLS, RPCs (get_public_webinar, server_now)
    storage.sql                 # buckets e políticas de Storage
    functions/admin-create-user # Edge Function (criação de usuário pelo ADM)
  public/
    config.js                   # >>> PREENCHA com URL + anon key <<<
    index.html                  # login
    watch.html / watch.js / watch.css   # página pública da "live"
    admin/                      # dashboard, editor e usuários
    assets/                     # css e js compartilhados
```

## Deploy do link público (depois de validar localmente)

A pasta `public/` é 100% estática. Para gerar o link público de verdade, suba
`public/` em qualquer host estático grátis (Netlify, Vercel, Cloudflare Pages).
O `config.js` continua o mesmo (a anon key é pública por design).

## Fora do escopo desta versão
- Streaming ao vivo real (câmera/RTMP) — aqui é sempre vídeo gravado simulado.
- Webinários recorrentes automáticos, replay sob demanda e relatórios.
