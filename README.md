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
7. Story não tem legenda pra comparar: antes de publicar, o publicador lê os stories no ar. Se existe um story sem registro publicado depois do horário do item, assume que é ele e não repete; aparece no `dry` como "conferir".
8. O registro (`publicados.json`) é gravado mesmo se a publicação der erro, com 3 tentativas de push.

## Onde roda
No servidor do CRM do Jordão, a cada 5 min (cron instalado pelo deploy do repo crm-do-jordao). Lá o repositório é só leitura: o registro do que saiu fica em /opt/ig-crmdojordao/estado (publicados.json e log.txt) e soma o histórico deste repo. Este workflow do GitHub ficou só manual, de reserva (o agendamento do GitHub não disparou em 05/10).
