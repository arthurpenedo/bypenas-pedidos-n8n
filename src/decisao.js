// Decide o que fazer com o pedido interpretado e escreve a resposta para o cliente.
// Roda dentro de um nó Code do n8n (o build injeta este arquivo) e nos testes com node --test.

const reais = (v) => `R$ ${Number(v).toFixed(2).replace(".", ",")}`;

function dataBr(iso) {
  const [a, m, d] = iso.split("-");
  const semana = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][new Date(`${iso}T12:00:00Z`).getUTCDay()];
  return `${semana}, ${d}/${m}`;
}

// status: "confirmado" | "sem_capacidade" | "atendimento" (a pessoa responde)
function decidir(pedido, jaReservado, cfg) {
  const primeiroNome = pedido.cliente.split(" ")[0] || "tudo bem";
  if (pedido.problemas.length) {
    // Sem sabor reconhecido quase sempre é dúvida ("tem de morango?"): responde com o cardápio.
    const cardapio = pedido.itens.length ? "" : "\nHoje temos: " +
      Object.entries(cfg.catalogo).map(([sabor, info]) => `${sabor} (${reais(info.preco)})`).join(", ") + ".";
    return {
      status: "atendimento",
      resposta: `Oi, ${primeiroNome}! Recebi sua mensagem, mas ${pedido.problemas.join("; ")}.${cardapio}\n` +
        "Já te respondo por aqui para acertarmos os detalhes. 😊",
    };
  }
  const livre = cfg.capacidade_diaria - jaReservado;
  if (pedido.unidades > livre) {
    return {
      status: "sem_capacidade",
      resposta: `Oi, ${primeiroNome}! Para ${dataBr(pedido.data_entrega)} só consigo produzir mais ${Math.max(livre, 0)} ` +
        "unidade(s). Quer ajustar a quantidade ou escolher outro dia?",
    };
  }
  const linhas = pedido.itens.map((i) => `• ${i.qtd}x ${i.sabor} (${reais(i.qtd * cfg.catalogo[i.sabor].preco)})`);
  const entrega = pedido.modalidade === "entrega"
    ? `Entrega em ${pedido.bairro} (taxa ${reais(pedido.taxa_entrega)}).`
    : cfg.retirada;
  return {
    status: "confirmado",
    resposta: [`Pedido anotado, ${primeiroNome}! 🍫`, ...linhas, `Total: ${reais(pedido.total)}`,
      `Para ${dataBr(pedido.data_entrega)}. ${entrega}`, `Pagamento via PIX: ${cfg.pix}.`].join("\n"),
  };
}

if (typeof module !== "undefined") module.exports = { decidir, dataBr, reais };
