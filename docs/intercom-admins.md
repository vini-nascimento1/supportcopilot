# Intercom Admin IDs — Fanvue Support Team

> Última atualização: 2026-06-28  
> Descobertos via inspeção de conversas no Intercom

## Admins (Agentes Humanos)

| Admin ID | Nome no Intercom | Email | Observação |
|----------|-----------------|-------|------------|
| 7528721 | Antonella - Head Of Support | antonella@fanvue.com | Head of Support |
| 7536267 | (desconhecido) | — | Inativo em junho (0 tickets) |
| 7670418 | Sofia | maia@fanvue.com | |
| 7718386 | Ken Legg | oliverj@fanvue.com | |
| 7986323 | Charlotte | viktoriia.buchynska@fanvue.com | |
| 7986377 | Noelle | dmytro.obukhivskyi@fanvue.com | |
| 8555917 | Daniel Phillips | daniel.phillips@fanvue.com | Assina como "Charlie" |
| 8659487 | Bertie | berta.fandino@fanvue.com | |
| 8838802 | Maya Cole | sumaya.jacobs@fanvue.com | |
| 8846036 | Kwojo | kwanda.mthembu@fanvue.com | |
| 9104107 | Alex | wesley@fanvue.com | |
| 9317682 | Dee | didi.ntlabati@fanvue.com | |
| 9661079 | Elisabeth Kamenska | elisabeth.kamenska@fanvue.com | |
| 9662451 | Michele Farina | michele.farina@fanvue.com | |
| 10325344 | James | jake.yewdell@fanvue.com | |
| 10325350 | Vincenzo | vinicius.nascimento@fanvue.com | **Você** |
| 10325359 | Logan | james.bolton@fanvue.com | |
| 10325360 | Amethyst | saddie.taylor@fanvue.com | |
| 10325369 | Bubu Starr | judith.amaran@fanvue.com | |
| 10325389 | Bridgette | dorinn.chin@fanvue.com | |

## Bots / Automações

| Admin ID | Nome no Intercom | Email | Observação |
|----------|-----------------|-------|------------|
| 6510758 | Fin | operator+yzo8ff0f@intercom.io | Bot de IA (Fin AI) |
| 6522884 | Layla Frost | support@fanvue.com | Automação de workflows |

---

## Queries Intercom — Contagem de Tickets Resolvidos

### Calcular timestamps BRT (UTC-3)

Dia alvo em BRT → início em UTC = dia alvo 03:00 UTC  
Dia seguinte em BRT → fim em UTC = dia seguinte 02:59:59 UTC

```
Fórmula:
  start_unix = {data_alvo}T00:00:00 BRT → {data_alvo}T03:00:00 UTC em unix
  end_unix   = {data_alvo}T23:59:59 BRT → {data_alvo+1}T02:59:59 UTC em unix

Exemplo 28/06/2026:
  start = 1782615600  (2026-06-28 03:00:00 UTC)
  end   = 1782701999  (2026-06-29 02:59:59 UTC)
```

### Query: Tickets fechados por um agente específico hoje (BRT)

```
search_conversations(
  statistics_last_closed_by_id = {ADMIN_ID},
  statistics_last_close_at = { operator: ">=", value: {start_unix} },
  state = "closed",
  per_page = 150
)
→ resultado: total_count
```

> **Nota:** `statistics_last_closed_by_id` filtra pelo agente que realizou o ÚLTIMO fechamento da conversa.  
> Se a conversa foi reaberta e fechada por outro agente, conta para o agente do último fechamento.

### Exemplos de queries usadas em 28/06/2026

**Vincenzo (ID 10325350) — 28/06/2026 BRT:**
```
search_conversations(
  statistics_last_closed_by_id = 10325350,
  statistics_last_close_at = { operator: ">=", value: 1782615600 },
  state = "closed",
  per_page = 150
)
→ total_count: 64
```

**James (ID 10325344) — 28/06/2026 BRT:**
```
search_conversations(
  statistics_last_closed_by_id = 10325344,
  statistics_last_close_at = { operator: ">=", value: 1782615600 },
  state = "closed",
  per_page = 150
)
→ total_count: 90
```

### Query: Total de tickets fechados no dia (todos os agentes)

```
search_conversations(
  statistics_last_close_at = { operator: ">=", value: {start_unix} },
  state = "closed",
  per_page = 150
)
→ paginar com starting_after se total_count > 150
```

Exemplo 28/06/2026: total_count = 603 (5 páginas de 150)

---

## Leaderboard de Junho 2026 (tickets fechados, mês até 29/jun, BRT)

| # | Agente | Admin ID | Tickets |
|---|--------|----------|---------|
| 1 | Ken Legg | 7718386 | 1.217 |
| 2 | James | 10325344 | 1.109 |
| 3 | Vincenzo | 10325350 | 926 |
| 4 | Amethyst | 10325360 | 925 |
| 5 | Maya Cole | 8838802 | 912 |
| 6 | Michele Farina | 9662451 | 780 |
| 7 | Kwojo | 8846036 | 774 |
| 8 | Alex | 9104107 | 709 |
| 9 | Logan | 10325359 | 633 |
| 10 | Daniel Phillips | 8555917 | 600 |
| 11 | Ellie Norwood | 7075817 | 550 |
| 12 | Elisabeth | 9661079 | 463 |
| 13 | Dee | 9317682 | 454 |
| 14 | Bridgette | 10325389 | 402 |
| 15 | Bubu Starr | 10325369 | 149 |
| 16 | Charlotte | 7986323 | 107 |
| 17 | Sofia | 7670418 | 96 |
| 18 | Bertie | 8659487 | 83 |
| 19 | Noelle | 7986377 | 77 |
| 20 | Antonella | 7528721 | 3 |

Total da equipe humana: ~10.969 tickets.

> Para descobrir todos os agentes ativos num período, faça `search_conversations` paginando
> `statistics_last_close_at <= {timestamp}` em janelas semanais e colete os `last_closed_by_id` distintos.
> Brute-force de IDs sequenciais NÃO funciona (IDs não são contíguos).

## Como descobrir o Admin ID de um agente

Os admins **não aparecem** na API de contacts — são entidades separadas.  
Para descobrir o ID de um admin, busque uma conversa onde ele respondeu e inspecione o campo `author` nos `conversation_parts` com `type === "admin"`:

```
get_conversation({id: "{conversation_id}"})
→ conversation_parts.conversation_parts[N].author.id
→ conversation_parts.conversation_parts[N].author.name
→ conversation_parts.conversation_parts[N].author.email
```
