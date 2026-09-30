// Resumo do dia para quem produz: quanto fazer de cada sabor, quem retira, para onde entregar e o faturamento.
// Roda dentro de um nó Code do n8n (o build injeta este arquivo) e nos testes com node --test.

function resumirDia(linhas, data, cfg) {
  const pedidos = linhas.filter((l) => l.data_entrega === data && l.status === "confirmado");
  const producao = Object.fromEntries(Object.keys(cfg.catalogo).map((s) => [s, 0]));
  for (const p of pedidos) {
    for (const item of JSON.parse(p.itens)) producao[item.sabor] = (producao[item.sabor] || 0) + item.qtd;
  }
  const porBairro = {};
  for (const p of pedidos.filter((p) => p.modalidade === "entrega")) {
    (porBairro[p.bairro] = porBairro[p.bairro] || []).push({ cliente: p.cliente, total: p.total });
  }
  const unidades = Object.values(producao).reduce((a, b) => a + b, 0);
  return {
    data,
    pedidos: pedidos.length,
    unidades,
    capacidade_usada: unidades / cfg.capacidade_diaria,
    producao,
    retiradas: pedidos.filter((p) => p.modalidade === "retirada").map((p) => ({ cliente: p.cliente, total: p.total })),
    entregas: porBairro,
    faturamento: pedidos.reduce((s, p) => s + Number(p.total), 0),
    taxas_entrega: pedidos.reduce((s, p) => s + Number(p.taxa_entrega), 0),
  };
}

function textoResumo(r) {
  const brl = (v) => `R$ ${Number(v).toFixed(2).replace(".", ",")}`;
  const linhas = [`📋 Produção de ${r.data}: ${r.pedidos} pedido(s), ${r.unidades} unidade(s) (${Math.round(r.capacidade_usada * 100)}% da capacidade)`];
  for (const [sabor, qtd] of Object.entries(r.producao)) if (qtd) linhas.push(`• ${sabor}: ${qtd}`);
  if (r.retiradas.length) linhas.push(`\n🛍️ Retiradas: ${r.retiradas.map((p) => p.cliente).join(", ")}`);
  for (const [bairro, lista] of Object.entries(r.entregas)) {
    linhas.push(`🛵 ${bairro}: ${lista.map((p) => p.cliente).join(", ")}`);
  }
  linhas.push(`\n💰 Faturamento: ${brl(r.faturamento)} (inclui ${brl(r.taxas_entrega)} de entrega)`);
  return linhas.join("\n");
}

if (typeof module !== "undefined") module.exports = { resumirDia, textoResumo };
