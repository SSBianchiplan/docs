# GPlanSiS|DOCS — conversor PDF (Gotenberg) com versão fixa e as fontes IBM Plex embutidas.
# As fontes vêm do repositório (google/fonts @ 45e3d52, licença OFL em fonts/OFL.txt): o Chromium do
# Gotenberg roda sem saída para a internet, então o <link> do Google Fonts no HTML não carrega.
FROM gotenberg/gotenberg:8.38.1
USER root
COPY fonts/ /usr/local/share/fonts/ibm-plex/
RUN chmod -R a+rX /usr/local/share/fonts/ibm-plex && fc-cache -f
USER gotenberg
