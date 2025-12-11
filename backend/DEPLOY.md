# 🚀 Guia de Deploy - Coolify

## 📋 Pré-requisitos

### Variáveis de Ambiente Necessárias

Configure estas variáveis no Coolify antes do deploy:

```env
# Database
DATABASE_URL=postgresql://user:password@postgres:5432/vend

# JWT
JWT_SECRET=seu-secret-key-super-seguro-aqui
JWT_EXPIRES_IN=7d

# Application
NODE_ENV=production
PORT=3000
APP_URL=https://seu-dominio.com

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# PostgreSQL (se usando serviço separado)
POSTGRES_USER=postgres
POSTGRES_PASSWORD=sua-senha-segura
POSTGRES_DB=vend
```

---

## 🐳 Deploy com Docker (Coolify)

### Método 1: Docker Compose (Recomendado)

1. **No Coolify, adicione um novo serviço:**
   - Tipo: Docker Compose
   - Repository: Seu repositório Git
   - Branch: main (ou a branch que deseja)

2. **Configure as variáveis de ambiente:**
   - Vá em Settings → Environment Variables
   - Adicione todas as variáveis acima

3. **Deploy:**
   - Clique em "Deploy"
   - Aguarde o build e deploy

### Método 2: Dockerfile Simples

Se preferir não usar docker-compose, use apenas o Dockerfile:

1. **No Coolify:**
   - Tipo: Dockerfile
   - Build Pack: Dockerfile
   - Port: 3000

2. **Importante:** Configure serviços externos separados:
   - PostgreSQL (banco de dados)
   - Redis (filas e cache)

---

## 🔧 Configuração Pós-Deploy

### 1. Executar Migrations

Após o primeiro deploy, execute as migrations:

```bash
npx prisma migrate deploy
```

### 2. Executar Seed (Dados Iniciais)

Para popular o banco com dados iniciais:

```bash
npm run prisma:seed
```

Isso criará:
- ✅ 1 Segmento padrão
- ✅ 3 Tabulações
- ✅ 3 Usuários (Admin, Supervisor, Operador)
- ✅ 1 Evolution de exemplo

**Usuários criados:**
```
Admin:      admin@vend.com       | admin123
Supervisor: supervisor@vend.com  | supervisor123
Operador:   operator@vend.com    | operator123
```

⚠️ **IMPORTANTE:** Mude as senhas após o primeiro login!

---

## 🔍 Verificar Deploy

### Health Check

Acesse: `https://seu-dominio.com/health`

Resposta esperada:
```json
{
  "status": "ok",
  "timestamp": "2025-12-11T10:00:00.000Z",
  "uptime": 123.45,
  "database": "connected"
}
```

### Endpoints para Testar

1. **API está respondendo:**
   ```bash
   curl https://seu-dominio.com/health
   ```

2. **Login funciona:**
   ```bash
   curl -X POST https://seu-dominio.com/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@vend.com","password":"admin123"}'
   ```

---

## 🐛 Troubleshooting

### Erro: "Cannot find module '/app/dist/main'"

**Causa:** O build não foi executado ou falhou.

**Solução:**
1. Verifique os logs do build no Coolify
2. Certifique-se que o Dockerfile está correto
3. Force um rebuild: Delete o container e recrie

### Erro: "Database connection failed"

**Causa:** `DATABASE_URL` incorreta ou PostgreSQL não acessível.

**Solução:**
1. Verifique a `DATABASE_URL`:
   ```
   postgresql://user:password@host:5432/database
   ```
2. Se estiver usando docker-compose, use: `postgres` como host
3. Se for serviço externo, use o host/IP correto

### Erro: "Redis connection failed"

**Causa:** Redis não acessível.

**Solução:**
1. Verifique `REDIS_HOST` e `REDIS_PORT`
2. Se usando docker-compose: `REDIS_HOST=redis`
3. Teste conexão: `redis-cli ping` (deve retornar "PONG")

### Aplicação não inicia

**Logs para verificar:**
```bash
# Ver logs no Coolify ou:
docker logs vend-backend

# Ver últimas 100 linhas:
docker logs --tail 100 vend-backend

# Seguir logs em tempo real:
docker logs -f vend-backend
```

---

## 🔐 Segurança

### Após Deploy:

1. ✅ **Mudar senhas padrão** dos usuários seed
2. ✅ **Gerar JWT_SECRET forte:**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
3. ✅ **Configurar HTTPS** (Coolify faz automaticamente)
4. ✅ **Configurar CORS** para aceitar apenas seu domínio frontend
5. ✅ **Limitar taxa de requisições** (rate limiting)

### Variáveis Sensíveis

**NUNCA commite ao Git:**
- `JWT_SECRET`
- `DATABASE_URL` (com senha)
- Chaves da Evolution API
- Senhas do PostgreSQL

---

## 📊 Monitoramento

### Logs

No Coolify:
- Vá em Logs para ver output em tempo real
- Configure alertas para erros críticos

### Métricas

Endpoints úteis:
- `/health` - Status geral da aplicação
- PostgreSQL metrics (se configurado)
- Redis metrics (se configurado)

---

## 🔄 Updates

### Deploy de Nova Versão

1. **Push para o repositório Git**
2. **No Coolify:** Clique em "Redeploy"
3. **Verifique health check** após deploy

### Migrations

Se houver novas migrations:
```bash
npx prisma migrate deploy
```

**Dica:** Configure para rodar automaticamente no startup (já está no docker-compose)

---

## 📞 Suporte

### Problemas Comuns

| Erro | Solução |
|------|---------|
| Port já em uso | Mude a `PORT` nas env vars |
| Out of memory | Aumente recursos no Coolify |
| Build timeout | Aumente timeout de build |
| Prisma não gera client | Execute `npx prisma generate` manualmente |

### Comandos Úteis

```bash
# Acessar container
docker exec -it vend-backend sh

# Verificar variáveis de ambiente
docker exec vend-backend env

# Testar conexão com banco
docker exec vend-backend npx prisma db pull

# Ver processos rodando
docker exec vend-backend ps aux

# Reiniciar aplicação
docker restart vend-backend
```

---

## ✅ Checklist Final

Antes de considerar o deploy completo:

- [ ] Health check retorna "ok"
- [ ] Login funciona com usuários seed
- [ ] Migrations executadas
- [ ] Seed executado (dados iniciais criados)
- [ ] Senhas padrão alteradas
- [ ] CORS configurado para frontend
- [ ] SSL/HTTPS funcionando
- [ ] Logs sem erros críticos
- [ ] Redis conectado (filas funcionando)
- [ ] PostgreSQL conectado
- [ ] Webhooks configurados (se aplicável)
- [ ] Variáveis de ambiente todas configuradas
- [ ] Backup do banco configurado

---

🎉 **Deploy Completo!** Sua aplicação está rodando em produção.

