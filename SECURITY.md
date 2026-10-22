# Política de segurança

## Versões suportadas
| Versão | Suporte |
|---|---|
| 0.1.x (em produção em docs.gplansis.com) | ✅ |

## Como relatar uma vulnerabilidade
**Não abra issue pública.** Envie um e-mail para **contato@gplansis.com** com o assunto `[SEGURANÇA] GPlanSiS|DOCS`, contendo:
- descrição do problema e impacto;
- passos para reproduzir (ou prova de conceito);
- versão, navegador e ambiente usados.

Confirmamos o recebimento assim que possível, mantemos você informado sobre a correção e damos crédito na publicação, se desejar.

## Escopo
Autenticação (JWT, troca obrigatória de senha, escopos de token), perfis por projeto, isolamento de documentos entre projetos, armazenamento de arquivos, trava de revisões e invariantes do banco, trilha de auditoria encadeada, integrações com assinatura HMAC (Drawings, Writer, Sheets), SSO entre sistemas e proxy de IA. Testes devem ser feitos numa instância local — **não** teste contra docs.gplansis.com nem acesse documentos de outras pessoas.

## Ao implantar
- Gere `JWT_SECRET`, `CONFIG_SEGREDO` e os segredos de integração com `openssl rand -hex 32`; os valores padrão do código servem só para desenvolvimento.
- Troque a senha do administrador inicial no primeiro acesso (obrigatório).
