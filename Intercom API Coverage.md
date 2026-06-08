# Intercom API Coverage Analysis

> Data: 2026-06-08 | API Version: 2.11 | Rate Limit: 1,000 req/min (private app)
> Base URL: `https://api.intercom.io`

---

## 1. Conversations API

### `POST /conversations/search` — Search conversations

**Documented searchable fields** (from Intercom Search API v2.4):

| Field | Type | Nós usamos? | Onde |
|-------|------|------------|------|
| `id` | String | ✅ | `lib/intercom.ts` |
| `created_at` | Date (unix) | ✅ | `toSweepConversation()` |
| `updated_at` | Date (unix) | ✅ | `toSweepConversation()` |
| `open` | Boolean | ✅ | Filtro `open = true` |
| `state` | String | ✅ | `intercomState` |
| `admin_assignee_id` | Integer | ✅ | `adminAssigneeId` |
| `source.type` | String | ❌ | **Não usado** |
| `source.id` | String | ❌ | **Não usado** |
| `source.delivered_as` | String | ❌ | **Não usado** |
| `source.subject` | String | ✅ | `subject` |
| `source.body` | String | ❌ | Fallback de subject |
| `source.url` | String | ❌ | **Não usado** — link original da conversa |
| `source.author.*` | String | ✅ | `customerName` fallback |
| `contact_ids` | String | ❌ | **Não usado** |
| `teammate_ids` | String | ❌ | **Não usado** |
| `team_assignee_id` | Integer | ❌ | **Não usado** — time, não agente |
| `channel_initiated` | String | ❌ | **Não usado** |
| `read` | Boolean | ❌ | **Não usado** |
| `waiting_since` | Date | ❌ | **Não usado** — timestamps de espera |
| `snoozed_until` | Date | ❌ | **Não usado** |
| `tag_ids` | String | ❌ | Usamos `tags.name`, não IDs |
| `priority` | String | ✅ | `priority` |
| `conversation_rating.*` | vários | ❌ | **Não usado** — CSAT |

#### `statistics.*` — campos NÃO USADOS (potencial goldmine)

| Campo | Tipo | KPI que permite |
|-------|------|----------------|
| `statistics.time_to_assignment` | Integer (segundos) | Tempo até ser atribuído a um admin |
| `statistics.time_to_admin_reply` | Integer (segundos) | ⭐ **First Response Time (FRT)** |
| `statistics.time_to_first_close` | Integer (segundos) | ⭐ **Time to Resolution** |
| `statistics.time_to_last_close` | Integer (segundos) | Tempo total até fechamento final |
| `statistics.median_time_to_reply` | Integer (segundos) | ⭐ **Mediana de resposta** |
| `statistics.first_contact_reply_at` | Date | Timestamp do primeiro reply do contato |
| `statistics.first_assignment_at` | Date | Timestamp da primeira assignment |
| `statistics.first_admin_reply_at` | Date | ⭐ **Timestamp do FRT** |
| `statistics.first_close_at` | Date | Timestamp do primeiro fechamento |
| `statistics.last_assignment_at` | Date | Timestamp da última assignment |
| `statistics.last_assignment_admin_reply_at` | Date | Timestamp do último reply do admin na assignment |
| `statistics.last_contact_reply_at` | Date | Timestamp do último reply do contato |
| `statistics.last_admin_reply_at` | Date | Timestamp do último reply do admin |
| `statistics.last_close_at` | Date | Timestamp do último fechamento |
| `statistics.last_closed_by_id` | String | Quem fechou |
| `statistics.count_reopens` | Integer | Nº de reopenings |
| `statistics.count_assignments` | Integer | ⭐ **Nº de reassignments** |
| `statistics.count_conversation_parts` | Integer | Nº de mensagens na conversa |

#### `conversation_rating.*` — NÃO USADO

| Campo | KPI que permite |
|-------|----------------|
| `conversation_rating.score` | CSAT score (1-5) |
| `conversation_rating.remark` | Comentário do CSAT |
| `conversation_rating.replied_at` | Quando respondeu |
| `conversation_rating.contact_id` | Quem avaliou |

---

### `GET /conversations/{id}` — Full conversation detail

| Funcionalidade | Nós usamos? | Onde |
|---------------|------------|------|
| Full conversation parts | ✅ | `getConversationDetail()` |
| Tags with names | ✅ | `tags.tags[].name` |
| Conversation rating | ❌ | **Não extraído** |
| Attachments | ❌ | **Não extraído** |
| Custom attributes | ❌ | **Não extraído** |

---

## 2. Admins API

### `GET /admins` — List all admins

| Campo | Nós usamos? | Onde |
|-------|------------|------|
| `admins[].id` | ✅ | `listIntercomAdmins()` |
| `admins[].name` | ✅ | Dropdown teammate |
| `admins[].email` | ✅ | Dropdown teammate |
| `admins[].role` | ❌ | **Não usado** — "admin" ou "teammate" |

### `GET /admins/{id}/conversation_counts`

| Funcionalidade | Nós usamos? | Onde |
|---------------|------------|------|
| Contagem de conversas atribuídas | ❌ | **Não usado** |

---

## 3. Contacts API

### `GET /contacts/{id}` — Individual contact

| Funcionalidade | Nós usamos? | Onde |
|---------------|------------|------|
| Contact name/email | ✅ | `customerName` via search |
| `custom_attributes` | ❌ | **Removido** — sempre vazio em leads |
| `role` ("lead" vs "user") | ❌ | **Não usado** |
| `companies` | ❌ | **Não usado** |
| `social_profiles` | ❌ | **Não usado** |

### `POST /contacts/search` — Search contacts

| Funcionalidade | Nós usamos? | Onde |
|---------------|------------|------|
| Search por email | ❌ | **Não usado** |
| Search por custom_attributes | ❌ | **Não usado** |
| `scroll_param` para bulk | ❌ | **Não usado** |

---

## 4. Tags API

### `GET /tags` — List all tags

| Campo | Nós usamos? | Onde |
|-------|------------|------|
| `tags[].id` | ✅ | `/api/tags` endpoint |
| `tags[].name` | ✅ | TagPicker UI |

**Nota:** O `GET /tags` retorna apenas `id` e `name`. **Não há** contagem de uso por tag nesta API.
Para contagem de tags, seria necessário usar `POST /conversations/search` com filtro de tag + `per_page=0`.

---

## 5. Teams API

### `GET /teams` — List teams

| Funcionalidade | Nós usamos? | Onde |
|---------------|------------|------|
| `teams[].id` | ❌ | **Não usado** |
| `teams[].name` | ❌ | **Não usado** |
| `teams[].admin_ids` | ❌ | **Não usado** |

---

## 6. Data Export API (enterprise)

### `POST /export/content/data` — Export data to S3/GCS

| Funcionalidade | Nós usamos? | Onde |
|---------------|------------|------|
| Export de conversas + contacts | ❌ | **Não usado** |
| Export de tickets | ❌ | **Não usado** |

> Requer assinatura Enterprise. Exporta JSON para bucket S3/GCS.

---

## 7. Data Attributes API

### `GET /data_attributes` — List custom data attributes

| Funcionalidade | Nós usamos? | Onde |
|---------------|------------|------|
| Listar custom attributes definidos | ❌ | **Não usado** |
| Ver modelos de dados dos contacts | ❌ | **Não usado** |

---

## 8. Rate Limiting

| Característica | Valor |
|---------------|-------|
| Requests/min (private app) | **1,000** |
| Burst (window) | 10 segundos |
| Header `X-RateLimit-Limit` | ✅ Respeitado |
| Header `X-RateLimit-Remaining` | ✅ Observável |
| Errors retornam `429 Too Many Requests` | Tratado como throw |

---

## 9. KPIs que PODEMOS extrair HOJE

### Do Search API (sem custo extra — já paginamos)

| KPI | Campos | Cálculo | Precisa de query extra? |
|-----|--------|---------|------------------------|
| **Volume aberto** | `open = true` | `total_count` | Não (já temos) |
| **Volume por agente** | `admin_assignee_id` | Group by | Sim, 1 query por agente ou aggregations |
| **Volume por tag** | `tag_ids` + `IN` operator | Group by | Sim |
| **Volume por período** | `created_at` range + `open` | Count | Sim |

### Do Search API com `statistics.*` (novos)

| KPI | Campo `statistics.*` | Cálculo |
|-----|---------------------|---------|
| **First Response Time (FRT)** | `time_to_admin_reply` | Média/mediana em segundos |
| **Time to Resolution** | `time_to_first_close` | Média/mediana em segundos |
| **Reassignment rate** | `count_assignments` | Média por conversa |
| **Reopen rate** | `count_reopens` | % de conversas com > 0 |
| **MTTR (Mean Time to Resolve)** | `time_to_last_close` | Média em segundos |
| **Median Reply Time** | `median_time_to_reply` | Valor já calculado pelo Intercom |
| **SLA: assignment** | `time_to_assignment` | Minutos até atribuição |
| **SLA: first reply** | `first_admin_reply_at` | Timestamp para cálculos custom |

### Do Conversation Detail API (novos)

| KPI | Campo | Cálculo |
|-----|-------|---------|
| **CSAT médio** | `conversation_rating.score` | Média das avaliações |
| **CSAT response rate** | `conversation_rating.replied_at` não-nulo | % respondido |
| **Respostas por conversa** | `conversation_parts.total_count` | Média |

---

## 10. Comparação: copilot vs Intercom Reports

| KPI | Intercom Reports | Dá pra puxar? | Copilot tem hoje? |
|-----|-----------------|--------------|-------------------|
| Volume de conversas | ✅ Dashboard | ✅ Search API | ✅ Parcial (só abertas) |
| Volume por agente | ✅ Team Reports | ✅ Search + admin_id | ❌ |
| FRT (First Response Time) | ✅ Reports → FRT | ✅ `statistics.time_to_admin_reply` | ❌ |
| Mediana de FRT | ✅ Reports | ✅ `statistics.median_time_to_reply` | ❌ |
| Time to Resolution | ✅ Reports | ✅ `statistics.time_to_first_close` | ❌ |
| CSAT médio | ✅ Reports | ✅ `conversation_rating.score` | ❌ |
| Reassignment rate | ✅ Effectiveness | ✅ `statistics.count_assignments` | ❌ |
| Reopen rate | ✅ Effectiveness | ✅ `statistics.count_reopens` | ❌ |
| Conversas por tag | ✅ Tag report | ✅ Search com `tag_ids` | ❌ |
| SLA breaches | ⚠️ Se configurado | ❓ | ❌ |
| **Match rate de regras** | ❌ Não existe | — | ✅ `automation_runs` |
| **Alertas enviados** | ❌ Não existe | — | ✅ `automation_alerts` |
| **Manual runs** | ❌ Não existe | — | ✅ `automation_runs` |
| **AI drafts prestaged** | ❌ Não existe | — | ✅ `drafts` table |

---

## 11. O que construir (recomendado)

### Fácil (dias) — sem query extra, dados que já temos

| KPI | Fonte | Complexidade |
|-----|-------|-------------|
| Match rate por regra | `automation_runs` | SELECT COUNT + GROUP BY |
| Alertas por regra/período | `automation_alerts` | SELECT COUNT + GROUP BY |
| Volume aberto total | Sweep count | Já calculado |
| FRT nosso (via sweep) | `cases.updated_at - cases.created_at` | Query SQL |

### Médio (1-2 semanas) — Search API com statistics

| KPI | Fonte | Complexidade |
|-----|-------|-------------|
| FRT médio + p95 por agente | `POST /search` com `statistics.time_to_admin_reply` | Query com range de datas |
| Time to Resolution médio | `statistics.time_to_first_close` | Query com range de datas |
| Volume por período | `created_at` no Search | Query com agregação |
| CSAT score | `GET /conversations/{id}` → `conversation_rating` | N+1 (só fechadas) |
| Reassignments por conversa | `statistics.count_assignments` | Query com range |

### Pesado (1+ mês) — Data Export + Analytics

| KPI | Fonte | Complexidade |
|-----|-------|-------------|
| Dashboard histórico | Export S3 + ETL | Arquitetura de dados |
| Trends semanais | S3 + agregador | Pipeline de dados |
| Predição de SLA breach | ML sobre dados históricos | Modelo preditivo |

---

## 12. Endpoints Intercom — resumo completo

| Categoria | Endpoint | Nós temos? |
|-----------|----------|-----------|
| **Conversations** | `POST /conversations/search` | ✅ |
| | `GET /conversations/{id}` | ✅ |
| | `POST /conversations/{id}/reply` | ❌ |
| | `POST /conversations` (create) | ❌ |
| **Admins** | `GET /admins` | ✅ |
| | `GET /admins/{id}/conversation_counts` | ❌ |
| **Contacts** | `GET /contacts/{id}` | ✅ (antes, removido) |
| | `POST /contacts/search` | ❌ |
| | `POST /contacts` (create) | ❌ |
| **Tags** | `GET /tags` | ✅ |
| | `POST /tags` (create) | ❌ |
| **Teams** | `GET /teams` | ❌ |
| **Data Attributes** | `GET /data_attributes` | ❌ |
| **Data Export** | `POST /export/content/data` | ❌ |
| **Rate Limit** | Headers nas responses | ✅ Observado |

---

## 13. Próximos passos sugeridos

1. **Adicionar `statistics.*` ao tipo `IntercomSearchConversation`** — custo zero, já vem no search response
2. **Criar `/api/kpi/frt`** — query que calcula FRT médio por agente nos últimos 7 dias
3. **Criar `/api/kpi/volume`** — volume aberto + por período
4. **Dashboard na home** — cards com FRT, volume, CSAT (puxados do Intercom + nossos dados)
5. **Criar `/api/teams`** — listar teams do Intercom (preparar pra team_assignee_id)

---

## Fontes

- [Intercom REST API Reference](https://developers.intercom.com/docs/references/rest-api/api.intercom.io/)
- [Build your own reports](https://developers.intercom.com/docs/build-an-integration/learn-more/rest-apis/build-your-own-reports)
- [Reporting metrics & attributes](https://www.intercom.com/help/en/articles/7022438-reporting-metrics-attributes)
- [Conversation model](https://developers.intercom.com/docs/references/2.1/rest-api/conversations/conversation-model)
- [Rate Limiting](https://developers.intercom.com/docs/references/rest-api/errors/rate-limiting)
- [Search for conversations](https://developers.intercom.com/docs/references/2.4/rest-api/conversations/search-for-conversations)
