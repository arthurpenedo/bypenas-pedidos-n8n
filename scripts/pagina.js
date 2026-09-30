// Página da demo: a conversa simulada (mensagem → resposta do workflow) e o resumo de produção do dia.
//
//   node scripts/pagina.js simulacao.json site/index.html

const fs = require("node:fs");
const path = require("node:path");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const brl = (v) => `R$ ${Number(v).toFixed(2).replace(".", ",")}`;
const ROTULO = { confirmado: "confirmado", sem_capacidade: "sem capacidade", atendimento: "vai para atendimento" };

const CSS = `
:root{--bg:#f7f3ef;--card:#fff;--fg:#2b1d16;--muted:#7a6a60;--line:#eadfd6;--accent:#8a5a3c;--cliente:#fff;--bot:#e7f6e9;
--ok:#1f8a4c;--warn:#b7791f;--bad:#c2372e}
@media (prefers-color-scheme:dark){:root{--bg:#17120f;--card:#211a16;--fg:#f1e8e1;--muted:#b3a298;--line:#3a2f28;--accent:#e0a47c;
--cliente:#2a211c;--bot:#1d3325;--ok:#4cc38a;--warn:#e0a84a;--bad:#ff6b61}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:980px;margin:0 auto;padding:32px 16px 64px}h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 12px}
a{color:var(--accent)}.muted{color:var(--muted)}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.grade{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:20px;align-items:start}
@media (max-width:760px){.grade{grid-template-columns:1fr}}
.troca{margin-bottom:14px}.msg{padding:9px 12px;border-radius:12px;max-width:88%;white-space:pre-wrap;overflow-wrap:anywhere;
box-shadow:0 1px 0 var(--line)}.cliente{background:var(--cliente);border:1px solid var(--line);border-top-left-radius:2px}
.bot{background:var(--bot);margin:6px 0 0 auto;border-top-right-radius:2px}.quem{font-size:12px;color:var(--muted);margin-bottom:3px}
.status{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;text-align:right;margin-top:3px}
.confirmado{color:var(--ok)}.sem_capacidade{color:var(--warn)}.atendimento{color:var(--bad)}
.kpis{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}.kpi b{display:block;font-size:22px;font-variant-numeric:tabular-nums}
.barra{height:10px;border-radius:5px;background:var(--line);overflow:hidden;margin:6px 0}.barra span{display:block;height:100%;background:var(--accent)}
table{width:100%;border-collapse:collapse}td{padding:6px 2px;border-bottom:1px solid var(--line)}td.n{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
footer{margin-top:40px;font-size:13px}`;

function render({ gerado_em, trocas, resumo }) {
  const conversa = trocas.map((t) => `<div class="troca"><div class="quem">${esc(t.cliente)}</div>
<div class="msg cliente">${esc(t.mensagem)}</div><div class="msg bot">${esc(t.resposta)}</div>
<div class="status ${esc(t.status)}">${esc(ROTULO[t.status] || t.status)}</div></div>`).join("\n");
  const producao = Object.entries(resumo.producao).filter(([, q]) => q)
    .map(([sabor, q]) => `<tr><td>${esc(sabor)}</td><td class="n">${esc(q)}</td></tr>`).join("");
  const entregas = Object.entries(resumo.entregas)
    .map(([bairro, lista]) => `<tr><td>🛵 ${esc(bairro)}</td><td>${esc(lista.map((p) => p.cliente).join(", "))}</td></tr>`).join("");
  const retiradas = resumo.retiradas.length
    ? `<tr><td>🛍️ Retirada</td><td>${esc(resumo.retiradas.map((p) => p.cliente).join(", "))}</td></tr>` : "";
  const uso = Math.round(resumo.capacidade_usada * 100);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pedidos By.penas · n8n</title><style>${CSS}</style></head><body><main>
<h1>Pedidos da By.penas no piloto automático</h1>
<p class="muted">Dois workflows do <strong>n8n</strong>: um recebe a mensagem do cliente, entende sabores, quantidade, data e entrega,
confere a capacidade de produção do dia e responde; o outro monta a lista de produção da manhã. Esta página é gerada pelo CI a partir de
uma simulação real contra o n8n rodando (clientes fictícios, preços de exemplo). Gerada em
${esc(new Date(gerado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }))}.</p>
<div class="grade"><section><h2>As mensagens e as respostas do workflow</h2>${conversa}</section>
<section><h2>Resumo de produção · ${esc(resumo.data.split("-").reverse().join("/"))}</h2><div class="card">
<div class="kpis"><div class="kpi"><span class="muted">Pedidos</span><b>${esc(resumo.pedidos)}</b></div>
<div class="kpi"><span class="muted">Faturamento</span><b>${esc(brl(resumo.faturamento))}</b></div></div>
<div class="muted">Capacidade usada: ${esc(resumo.unidades)} de ${esc(Math.round(resumo.unidades / (resumo.capacidade_usada || 1)))} unidades (${uso}%)</div>
<div class="barra"><span style="width:${Math.min(uso, 100)}%"></span></div>
<h3 style="font-size:15px;margin:16px 0 4px">Produzir</h3><table>${producao}</table>
<h3 style="font-size:15px;margin:16px 0 4px">Entregas e retiradas</h3><table>${retiradas}${entregas}</table>
<p class="muted" style="font-size:13px;margin:14px 0 0">Às 7h este resumo vai para o Telegram de quem produz.</p></div></section></div>
<footer class="muted">Código e workflows: <a href="https://github.com/arthurpenedo/bypenas-pedidos-n8n">github.com/arthurpenedo/bypenas-pedidos-n8n</a> ·
Feito por <a href="https://github.com/arthurpenedo">Arthur Penedo</a> para a By.penas.</footer></main></body></html>`;
}

if (require.main === module) {
  const [entrada, saida] = process.argv.slice(2);
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  fs.writeFileSync(saida, render(JSON.parse(fs.readFileSync(entrada, "utf8"))));
  console.log(`página: ${saida}`);
}

module.exports = { render };
