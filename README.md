# Player Local

Servidor caseiro de streaming de filmes e séries. Você deixa os vídeos no PC e assiste na TV, no celular ou no navegador de qualquer aparelho da rede de casa, com legenda em português, progresso salvo e um app para Android TV e celular.

- **Sem dependências:** Node.js puro e ffmpeg. Não precisa de `npm install`.
- **Toca qualquer MKV/MP4 no navegador:** o vídeo é convertido em tempo real (H.264 é copiado sem recompressão).
- **Legenda PT-BR automática:** usa a embutida ou a externa e, se não houver nenhuma, busca online no OpenSubtitles e no Subdl.
- **Continua de onde parou:** em qualquer aparelho, com sugestão do próximo episódio.
- **Feito para controle remoto:** navegação pelas setas, botão Voltar e teclas de mídia. No celular, toque duplo para avançar ou voltar.

## Índice
- [Requisitos](#requisitos)
- [Instalação e uso](#instalação-e-uso)
- [Configuração (.env)](#configuração-env)
- [Organização das pastas](#organização-das-pastas)
- [Legendas](#legendas)
- [Recursos do player](#recursos-do-player)
- [App para Android TV e celular](#app-para-android-tv-e-celular)
- [Como funciona](#como-funciona)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Problemas comuns](#problemas-comuns)

## Requisitos
- **Node.js 18+**
- **ffmpeg e ffprobe** no PATH. No Windows: `winget install Gyan.FFmpeg`. Também dá para apontar os executáveis com `FFMPEG_PATH`/`FFPROBE_PATH` no `.env`.
- Para compilar o app Android (opcional): Android SDK com `platforms;android-34` e JDK 17.

## Instalação e uso
```bash
git clone https://github.com/SEU_USUARIO/player-local.git
cd player-local
cp .env.example .env      # ajuste as pastas de vídeos
npm start                 # ou dois cliques em iniciar.bat no Windows
```

O console mostra os endereços e as pastas lidas:
```
  Player Local rodando!
  Neste PC:  http://localhost:8765
  Na rede:   http://192.168.0.15:8765   (Wi-Fi)
  Pastas:
    Filmes:
      C:\...\player-local\filmes
    Séries:
      C:\...\player-local\series
```

Abra o endereço **"Na rede"** no navegador da TV ou do celular. O aparelho precisa estar na mesma rede do PC. Na primeira execução o Windows pode pedir para liberar o Node no firewall: marque **Redes privadas**.

Se a porta 8765 estiver ocupada, o servidor tenta as seguintes sozinho.

## Configuração (.env)
Copie `.env.example` para `.env` e reinicie o servidor sempre que alterar. Vídeos novos dentro das pastas aparecem sozinhos, em até 15 segundos.

```ini
# Pastas de vídeos por categoria (cada uma vira uma seção na tela inicial, na ordem do arquivo)
PASTA_VIDEOS_FILMES=filmes
PASTA_VIDEOS_SERIES=series;D:\Series
PASTA_VIDEOS_OUTROS=C:\Users\SEU_USUARIO\Videos

# Busca de legendas online (opcional, basta uma das fontes)
OPENSUBTITLES_API_KEY=sua_chave
OPENSUBTITLES_USUARIO=seu_usuario     # opcional: 20 downloads/dia em vez de 5
OPENSUBTITLES_SENHA=sua_senha
SUBDL_API_KEY=sua_chave
```

| Variável | Padrão | Descrição |
|---|---|---|
| `PASTA_VIDEOS_<CATEGORIA>` | — | Pastas da categoria, separadas por `;` ou `,`. O nome é livre (`ANIMES`, `DOCUMENTARIOS`…). Caminhos relativos partem da pasta do projeto. |
| `PASTA_VIDEOS` | `./videos` | Pastas sem categoria (seção "Biblioteca"). Sem nenhuma pasta configurada, lê `videos/`. |
| `OPENSUBTITLES_API_KEY` | — | Chave da API do [OpenSubtitles](https://www.opensubtitles.com/consumers). |
| `OPENSUBTITLES_USUARIO` / `OPENSUBTITLES_SENHA` | — | Login da conta gratuita (aumenta o limite diário). |
| `SUBDL_API_KEY` | — | Chave da API do [Subdl](https://subdl.com). |
| `PORTA` / `PORT` | `8765` | Porta HTTP. |
| `HOST` | `0.0.0.0` | Interface de rede. |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | Caminho dos executáveis. |

**Regras das categorias**
- **Categorias normais:** cada subpasta vira uma série/coleção (com todos os vídeos dentro dela, inclusive em subpastas). Cada vídeo solto vira um filme. Pasta com um único vídeo abre direto no player.
- **`OUTROS`:** todo vídeo da pasta e de qualquer subpasta aparece como item separado, sem agrupar e sem legendas. Os vídeos aparecem em ordem alfabética, e o player ganha os botões Anterior/Próximo seguindo essa ordem.
- Categorias sem nenhum vídeo não aparecem na tela inicial. Pastas inexistentes são ignoradas, com aviso no console.

## Organização das pastas
```
series/
  Minha Série/                      ← série (pasta com vários vídeos)
    Minha.Serie.S01E01.1080p.mkv
    Minha.Serie.S01E02.1080p.mkv
    subtitles/                      ← legendas externas (subtitles, subs ou legendas)
      Minha.Serie.S01E01.pt-BR.srt
    poster.jpg                      ← capa opcional (poster/folder/cover .jpg/.png)
filmes/
  Algum Filme (2020) [1080p]/       ← pasta com 1 vídeo: abre direto no player
    filme.mkv
  Outro.Filme.2019.1080p.mkv        ← arquivo solto também vira um filme
```

- Os episódios são ordenados por `S01E03` (ou `1x03`). Sem esse padrão, a ordem é alfabética.
- Os nomes são limpos para exibição: `Possession.1981.1080p.BRRip.x264` aparece como **Possession (1981)**. Tags entre colchetes e prefixos de sites são removidos.
- Sem `poster.jpg`, a capa é um quadro do próprio vídeo.

## Legendas
**Escolha automática.** O player abre com legenda PT-BR quando existe uma, embutida no MKV ou em arquivo externo. Se houver mais de uma PT-BR equivalente, ele pergunta qual usar e lembra a escolha para os próximos episódios. Faixas `por` só são tratadas como PT-PT quando o arquivo também tem uma faixa marcada como Brasil.

**Arquivos externos.** São associados ao episódio pelo `SxxEyy` ou pelo nome do vídeo. O idioma é detectado pelo nome (`pt-BR`, `ptbr`, `pob`, `brazil`, `portuguese`…). Formatos aceitos: `.srt`, `.vtt`, `.ass`, `.ssa`, em UTF-8 ou Windows-1252.

**Busca online.** No menu *Legendas* do player, **Buscar legenda online…** consulta o OpenSubtitles e o Subdl ao mesmo tempo. A lista mostra PT-BR primeiro, depois PT-PT e inglês.
- **✔ "sincronizada com este arquivo"** significa que a legenda bateu pelo hash do vídeo, no OpenSubtitles. **✔ "mesma versão do arquivo"** significa que o release tem o mesmo nome. Nos dois casos a legenda costuma vir com o tempo certo.
- **Ao baixar,** a legenda é salva em `subtitles/` dentro da pasta do título e passa a valer como legenda local.
- **Pacotes de temporada** do Subdl são abertos, e só o episódio certo é extraído.
- **Limite diário:** quando o do OpenSubtitles acaba, os resultados dele aparecem esmaecidos e os do Subdl continuam disponíveis.
- **Privacidade:** a busca envia aos sites apenas o nome do arquivo e, ao OpenSubtitles, o hash do vídeo.

**Ajustes.** No menu *Legendas* também dá para trocar de legenda a qualquer momento e ajustar a sincronia em passos de ±0,5s. Legendas em imagem (PGS/VobSub) não são suportadas.

## Recursos do player
- **Progresso** salvo no servidor (`data/state.json`) a cada 10s, ao pausar e ao sair. Vale para qualquer aparelho, e ao reabrir o player pergunta se quer continuar de onde parou. Acima de 92% o vídeo conta como assistido, e a seção "Continuar assistindo" sugere o próximo episódio.
- **Próximo episódio** com contagem de 10s ao terminar. Os botões Anterior/Próximo aparecem em séries e em "Outros".
- **Faixas de áudio:** escolha entre as faixas do arquivo. A escolha fica salva por vídeo.
- **Tela cheia** automática no navegador, que só permite isso depois de um clique ou tecla.

| Controle remoto / teclado | Ação |
|---|---|
| ← / → (controles ocultos) | volta/avança 10s |
| OK / Enter / Espaço | play/pause |
| ↑ / ↓ | mostra os controles e navega |
| Voltar / Esc / Backspace | fecha o menu, oculta os controles ou sai do player |
| F | tela cheia |
| Teclas de mídia | play/pause, avançar/voltar 30s, faixa anterior/próxima |

| Toque (celular) | Ação |
|---|---|
| Toque simples | mostra/oculta os controles (no centro: play/pause) |
| Toque duplo à direita / à esquerda | avança / volta 10s (toques seguidos somam) |
| Barra de progresso | toque para pular para o ponto |

## App para Android TV e celular
Em `android/` há um app leve que abre o Player Local em tela cheia, com ícone na tela inicial. O mesmo APK serve para TV e celular:
- **Na TV,** a tela fica sempre deitada e o botão Voltar do controle funciona em todas as telas. A tecla **Menu** abre a tela para digitar o endereço do servidor.
- **No celular,** a navegação segue a posição do aparelho. Ao abrir um vídeo, a tela gira para deitado e as barras do sistema somem.
- **O app encontra o PC sozinho:** primeiro tenta o último endereço usado, depois um broadcast UDP na porta 8765 e, por fim, uma varredura da rede local.
- **As telas vêm do servidor.** Mudanças em `public/` aparecem nos aparelhos sem reinstalar o app.

**Compilar** (sem Gradle, só com Android SDK e JDK 17):
```bash
bash android/build.sh        # gera android/build/PlayerLocal.apk
```
Na primeira compilação é criado `android/player-local.keystore`, a chave de assinatura. Ele fica fora do Git. Guarde esse arquivo: para atualizar o app sem desinstalar, os próximos APKs precisam ser assinados com a mesma chave.

**Instalar pelo navegador do aparelho:** com o servidor rodando, abra `http://IP_DO_PC:8765/app.apk`. É preciso permitir "instalar apps desconhecidos" para o navegador.

**Instalar via ADB:**
```bash
# TV (Depuração por Wi-Fi nas opções do desenvolvedor)
adb pair IP_DA_TV:PORTA_DE_PAREAMENTO        # digite o código mostrado na TV
adb connect IP_DA_TV:PORTA_DE_CONEXÃO
adb install -r android/build/PlayerLocal.apk

# Celular via USB (depuração USB ativa; na Xiaomi ative também "Instalar via USB")
adb install -r android/build/PlayerLocal.apk
```

## Como funciona
- **Streaming:** o ffmpeg converte o vídeo em tempo real para MP4 fragmentado, enviado direto para o navegador.
  - Vídeo H.264 é copiado sem recompressão, com CPU quase zero.
  - HEVC/10-bit é recodificado para H.264, o que usa bastante CPU.
  - O áudio (E-AC3, DTS…) vira AAC estéreo, que toca em qualquer navegador.
- **Avançar e voltar:** o stream é reiniciado no keyframe mais próximo do ponto pedido. Dentro do trecho já carregado, o salto é instantâneo.
- **Legendas embutidas:** são extraídas uma vez para `.cache/subs`. A primeira vez leva uns 15s por episódio, porque o MKV precisa ser lido inteiro; depois é instantâneo.
- **Miniaturas:** são geradas pelo ffmpeg e guardadas em `.cache/thumbs`.

**API HTTP** (usada pela interface):

| Rota | Descrição |
|---|---|
| `GET /api/home` | seções da tela inicial e "Continuar assistindo" |
| `GET /api/title/:id` | episódios de uma série/coleção |
| `GET /api/video/:id` | informações do vídeo (duração, áudios, legendas, progresso) |
| `GET /api/stream/:id?t=&a=` | stream MP4 a partir de `t` segundos, com a faixa de áudio `a` |
| `GET /api/seek/:id?t=` | keyframe mais próximo antes de `t` |
| `GET /api/sub/:id?key=` | texto da legenda |
| `GET /api/subsearch/:id` | busca de legendas online |
| `POST /api/subdownload/:id` | baixa uma legenda online `{src, ref, lang}` |
| `POST /api/progress/:id` | salva a posição `{position, duration, audio}` |
| `POST /api/subpref/:id` | salva a legenda escolhida `{key}` |
| `POST /api/watched/:id` | marca como assistido ou não `{watched}` |
| `GET /api/thumb/:id`, `/api/poster/:id` | miniatura do vídeo e capa do título |
| `GET /app.apk` | APK do app Android |

## Estrutura do projeto
```
server.js              servidor HTTP, biblioteca, ffmpeg, legendas, busca online
public/                interface web (SPA sem frameworks)
  index.html
  app.js               rotas, navegação por controle remoto, player
  style.css
android/               app Android TV/celular (WebView), compilado sem Gradle
  build.sh
  AndroidManifest.xml
  src/…/MainActivity.java
  assets/setup.html    tela de busca e configuração do servidor
.env.example           modelo de configuração
iniciar.bat            atalho para iniciar no Windows
```
Gerados em tempo de execução e fora do Git: `.env`, `data/` (progresso), `.cache/` (legendas extraídas e miniaturas), `android/build/`, `android/*.keystore` e as pastas de vídeos.

## Problemas comuns
- **A TV ou o celular não abre o endereço:** confira se estão na mesma rede do PC e se o Node foi liberado no firewall em *Redes privadas*. No Windows, a rede precisa estar marcada como **Privada**.
- **`EACCES`/`EADDRINUSE` ao iniciar:** a porta está em uso por outro programa. O servidor tenta as próximas sozinho, ou defina `PORTA` no `.env`.
- **Vídeo HEVC travando:** a recodificação exige CPU. Prefira arquivos H.264 ou um PC mais forte.
- **Legenda fora de sincronia:** use o ajuste de ±0,5s no menu *Legendas* ou baixe uma marcada com ✔.
- **"Limite diário do OpenSubtitles atingido":** configure o login no `.env`, que dá 20 downloads por dia, ou use os resultados do Subdl.
