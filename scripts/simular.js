// Simula um dia de pedidos contra o n8n rodando de verdade (webhooks ativos) e guarda o resultado.
//
//   node scripts/simular.js http://localhost:5678 simulacao.json
//
// Os clientes são fictícios. As datas são relativas ("amanhã"), então a simulação vale em qualquer dia.
// Falha (exit 1) se alguma resposta não tiver o status esperado: é o teste de ponta a ponta do CI.

const fs = require("node:fs");
const { dataLocal, somarDias } = require("../src/pedido.js");

const CONVERSA = [
  ["Ana Souza", "Oi! Quero 3 ninho e 2 oreo pra amanhã, eu retiro", "confirmado"],
  ["Bruno Lima", "me manda meia dúzia de tradicional amanhã no Centro", "confirmado"],
  ["Carla Dias", "boa tarde, 10 ninho pra amanhã por favor, vou buscar", "confirmado"],
  ["Diego Ramos", "uma dúzia de oreo com entrega amanhã na Vila Assunção", "confirmado"],
  ["Elisa Prado", "tem de morango?", "atendimento"],
  ["Fábio Nunes", "entrega de 2 ninho amanhã na Mooca", "atendimento"],
  ["Gabi Rocha", "quero 10 oreo amanhã", "sem_capacidade"],
  ["Gabi Rocha", "então 7 oreo amanhã, retiro", "confirmado"],
  ["Hugo Melo", "2 clássicas e 2 ninho pra depois de amanhã, retiro", "confirmado"],
];

// O n8n registra os webhooks alguns segundos depois de subir; até lá responde 404.
async function esperarWebhooks(base) {
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${base}/webhook/resumo`).catch(() => null);
    if (r && r.status !== 404) return;
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  throw new Error("Webhooks não ficaram ativos em 60 s.");
}

async function main(base, saida) {
  await esperarWebhooks(base);
  const trocas = [];
  for (const [cliente, mensagem, esperado] of CONVERSA) {
    const r = await fetch(`${base}/webhook/pedido`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cliente, telefone: "(11) 90000-0000", mensagem }),
    });
    if (!r.ok) throw new Error(`POST /webhook/pedido respondeu ${r.status}: ${await r.text()}`);
    const corpo = await r.json();
    trocas.push({ cliente, mensagem, esperado, status: corpo.status, resposta: corpo.resposta, total: corpo.pedido.total });
    console.log(`${corpo.status === esperado ? "✓" : "✗"} ${cliente}: ${corpo.status}`);
  }
  const amanha = somarDias(dataLocal(new Date(), "America/Sao_Paulo"), 1);
  const r = await fetch(`${base}/webhook/resumo?data=${amanha}`);
  if (!r.ok) throw new Error(`GET /webhook/resumo respondeu ${r.status}: ${await r.text()}`);
  const resumo = await r.json();
  console.log(resumo.texto);
  fs.writeFileSync(saida, JSON.stringify({ gerado_em: new Date().toISOString(), trocas, resumo }, null, 2));

  const erros = trocas.filter((t) => t.status !== t.esperado);
  // Esperado para amanhã: 5+6+10+12+7 = 40 unidades (capacidade cheia), 5 pedidos confirmados.
  if (resumo.unidades !== 40 || resumo.pedidos !== 5) erros.push({ resumo: `${resumo.pedidos} pedidos, ${resumo.unidades} unidades` });
  if (erros.length) {
    console.error("Divergências:", JSON.stringify(erros));
    process.exit(1);
  }
}

main(...process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });
