# crmdojordao-posts

Artes aprovadas e o publicador do Instagram **@crmdojordao**.

- `midia/` · artes e legendas aprovadas no visualizador, servidas pelo GitHub Pages (a Meta baixa daqui).
- `fila.json` · o que sai e quando (horário UTC). Só entra o que foi aprovado.
- `publicar.mjs` · publica pela API oficial da Meta o que venceu. Nunca repete (`publicados.json`).
- `.github/workflows/publicar.yml` · roda a cada 10 min.

Pra parar tudo na hora: criar o arquivo `PAUSAR` na raiz.
O token fica em secret do repositório, nunca no código.
