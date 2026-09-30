// Interpreta a mensagem de pedido ("quero 3 ninho e 2 oreo pra sábado, retiro") e calcula o total.
// Roda dentro de um nó Code do n8n (o build injeta este arquivo) e nos testes com node --test.
//
// Regras em vez de LLM: o vocabulário de um pedido é pequeno e previsível (sabores, números,
// dias da semana). O que as regras não entendem vira "precisa de atendimento", nunca um chute.

const NUMEROS = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, "meia duzia": 6, "uma duzia": 12, duzia: 12,
};
const DIAS = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];

function normalizar(texto) {
  return (texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Datas como "AAAA-MM-DD" no fuso de São Paulo, sem depender do fuso do servidor.
function dataLocal(agora, fuso) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

function somarDias(iso, dias) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function interpretarData(texto, hoje) {
  if (/depois de amanha/.test(texto)) return somarDias(hoje, 2);
  if (/\bamanha\b/.test(texto)) return somarDias(hoje, 1);
  if (/\bhoje\b/.test(texto)) return hoje;
  const dm = texto.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dm) {
    const ano = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : Number(hoje.slice(0, 4));
    let iso = `${ano}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
    if (!dm[3] && iso < hoje) iso = `${ano + 1}${iso.slice(4)}`; // "05/01" dito em dezembro é do ano seguinte
    return iso;
  }
  const dia = DIAS.findIndex((d) => new RegExp(`\\b${d}(-feira)?\\b`).test(texto));
  if (dia >= 0) {
    const atual = new Date(`${hoje}T12:00:00Z`).getUTCDay();
    return somarDias(hoje, ((dia - atual + 7) % 7) || 7); // "sábado" dito no sábado é o próximo
  }
  return null;
}

function interpretarItens(texto, catalogo) {
  const sinonimos = [];
  for (const [sabor, info] of Object.entries(catalogo)) {
    for (const nome of [sabor, ...(info.sinonimos || [])]) sinonimos.push([normalizar(nome), sabor]);
  }
  sinonimos.sort((a, b) => b[0].length - a[0].length); // "ninho com oreo" antes de "ninho"
  const quantidade = `(\\d+|${Object.keys(NUMEROS).sort((a, b) => b.length - a.length).join("|")})`;
  const recheio = "(?:\\s*x)?\\s*(?:palhas?\\s*)?(?:italianas?\\s*)?(?:de\\s+|sabor\\s+|do\\s+|da\\s+)?";
  const itens = {};
  for (const [nome, sabor] of sinonimos) {
    const re = new RegExp(`${quantidade}${recheio}${nome.replace(/ /g, "\\s+")}\\b`, "g");
    texto = texto.replace(re, (_, qtd) => {
      itens[sabor] = (itens[sabor] || 0) + (NUMEROS[qtd] ?? Number(qtd));
      return " ";
    });
  }
  return Object.entries(itens).map(([sabor, qtd]) => ({ sabor, qtd }));
}

function interpretarPedido(entrada, cfg, agora = new Date()) {
  const texto = normalizar(entrada.mensagem);
  const hoje = dataLocal(agora, cfg.fuso);
  const itens = interpretarItens(texto, cfg.catalogo);
  const data = interpretarData(texto, hoje);
  const entrega = /\b(entreg\w*|mand\w*|envi\w*|delivery)\b/.test(texto);
  const bairro = Object.keys(cfg.taxas_entrega).find((b) => texto.includes(normalizar(b))) || null;
  const problemas = [];

  if (!itens.length) problemas.push("não identifiquei sabores e quantidades");
  if (!data) problemas.push("não identifiquei a data");
  else if (data < somarDias(hoje, cfg.antecedencia_dias)) {
    problemas.push(`pedidos precisam de ${cfg.antecedencia_dias} dia(s) de antecedência`);
  }
  if (entrega && !bairro) problemas.push("entrega fora dos bairros atendidos (ou bairro não informado)");
  const totalItens = itens.reduce((s, i) => s + i.qtd, 0);
  if (totalItens > cfg.maximo_por_pedido) problemas.push(`acima de ${cfg.maximo_por_pedido} unidades: combinar direto`);

  const subtotal = itens.reduce((s, i) => s + i.qtd * cfg.catalogo[i.sabor].preco, 0);
  const taxa = entrega && bairro ? cfg.taxas_entrega[bairro] : 0;
  return {
    cliente: (entrada.cliente || "").trim(),
    telefone: (entrada.telefone || "").replace(/\D/g, ""),
    mensagem: entrada.mensagem,
    itens,
    unidades: totalItens,
    data_entrega: data,
    modalidade: entrega ? "entrega" : "retirada",
    bairro,
    subtotal,
    taxa_entrega: taxa,
    total: subtotal + taxa,
    problemas,
  };
}

if (typeof module !== "undefined") {
  module.exports = { interpretarPedido, interpretarItens, interpretarData, dataLocal, somarDias, normalizar };
}
