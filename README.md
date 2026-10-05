# crmdojordao-posts

Artes aprovadas e o publicador do Instagram **@crmdojordao**.

- `midia/` · artes e legendas aprovadas no visualizador, servidas pelo GitHub Pages (a Meta baixa daqui).
- `fila.json` · o que sai e quando (horário UTC). Só entra o que foi aprovado.
- `publicar.mjs` · publica pela API oficial da Meta o que venceu. Nunca repete (`publicados.json`).
- `.github/workflows/publicar.yml` · roda a cada 10 min.

Pra parar tudo na hora: criar o arquivo `PAUSAR` na raiz.
O token fica em secret do repositório, nunca no código.

## Trava anti-repetição
1. **A fonte da verdade é o Instagram:** antes de publicar, o publicador lê os últimos 100 posts do perfil e compara a legenda. Se já existe, marca como publicado e não posta de novo, mesmo que o `publicados.json` tenha se perdido.
2. A mesma pasta nunca sai duas vezes, mesmo com outro id na fila.
3. Item com erro só é tentado de novo depois da checagem do perfil, e no máximo 3 vezes.
4. Story que caiu no meio da publicação não é repetido sozinho: aparece no `dry` pra decisão humana.
5. Intervalo mínimo de 2 min entre posts de feed, lido do próprio Instagram.
6. No máximo 2 publicações por rodada, e item vencido há mais de 45 min não sai sozinho.
