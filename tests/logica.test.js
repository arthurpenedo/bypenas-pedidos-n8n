const { test } = require("node:test");
const assert = require("node:assert/strict");
const cfg = require("../config/config.json");
const { interpretarPedido, interpretarData, dataLocal } = require("../src/pedido.js");
const { decidir, dataBr } = require("../src/decisao.js");
const { resumirDia, textoResumo } = require("../src/resumo.js");

const AGORA = new Date("2026-10-01T15:00:00Z"); // quinta-feira, 12h em São Paulo
const pedir = (mensagem) => interpretarPedido({ cliente: "Ana Souza", telefone: "(11) 90000-0000", mensagem }, cfg, AGORA);

test("sabores, quantidades por extenso e sinônimos", () => {
  assert.deepEqual(pedir("Quero 3 ninho e 2 oreo pra sábado").itens, [{ sabor: "Ninho", qtd: 3 }, { sabor: "Oreo", qtd: 2 }]);
  assert.deepEqual(pedir("meia dúzia de tradicional amanhã").itens, [{ sabor: "Clássica", qtd: 6 }]);
  assert.deepEqual(pedir("duas palhas italianas de leite ninho e uma clássica amanhã").itens,
    [{ sabor: "Ninho", qtd: 2 }, { sabor: "Clássica", qtd: 1 }]);
  assert.deepEqual(pedir("2x oreo + 2 oreos amanhã").itens, [{ sabor: "Oreo", qtd: 4 }]);
});

test("datas relativas, dia da semana e dd/mm no fuso de São Paulo", () => {
  const hoje = "2026-10-01";
  assert.equal(interpretarData("pra amanha", hoje), "2026-10-02");
  assert.equal(interpretarData("depois de amanha", hoje), "2026-10-03");
  assert.equal(interpretarData("no sabado", hoje), "2026-10-03");
  assert.equal(interpretarData("na quinta-feira", hoje), "2026-10-08"); // quinta dita na quinta = a próxima
  assert.equal(interpretarData("dia 05/10", hoje), "2026-10-05");
  assert.equal(interpretarData("dia 05/01", hoje), "2027-01-05");
  assert.equal(dataLocal(new Date("2026-10-02T01:30:00Z"), cfg.fuso), "2026-10-01"); // 22h30 em SP ainda é dia 1
});

test("entrega com bairro, taxa e total", () => {
  const p = pedir("me manda meia dúzia de clássica amanhã no Centro");
  assert.equal(p.modalidade, "entrega");
  assert.equal(p.bairro, "Centro");
  assert.equal(p.total, 6 * 12 + 6);
  assert.equal(p.telefone, "11900000000");
});

test("o que não dá para atender vira atendimento, com o motivo", () => {
  assert.match(pedir("tem de morango?").problemas.join(), /sabores/);
  assert.match(pedir("quero 5 oreo pra hoje").problemas.join(), /antecedência/);
  assert.match(pedir("entrega de 2 ninho amanhã na Mooca").problemas.join(), /bairros atendidos/);
  assert.match(pedir("quero 40 ninho amanhã").problemas.join(), /acima de 30/);
  const d = decidir(pedir("tem de morango?"), 0, cfg);
  assert.equal(d.status, "atendimento");
  assert.match(d.resposta, /^Oi, Ana!/);
  assert.match(d.resposta, /Hoje temos: Clássica \(R\$ 12,00\), Ninho \(R\$ 14,00\), Oreo \(R\$ 15,00\)/);
});

test("capacidade do dia: confirma até o limite e oferece o que sobra", () => {
  const p = pedir("quero 10 ninho amanhã");
  assert.equal(decidir(p, 30, cfg).status, "confirmado");
  const cheio = decidir(p, 35, cfg);
  assert.equal(cheio.status, "sem_capacidade");
  assert.match(cheio.resposta, /mais 5 unidade/);
});

test("confirmação lista itens, total, data e pagamento", () => {
  const { resposta } = decidir(pedir("3 ninho e 2 oreo pra sábado, eu retiro"), 0, cfg);
  assert.match(resposta, /3x Ninho \(R\$ 42,00\)/);
  assert.match(resposta, /Total: R\$ 72,00/);
  assert.match(resposta, /sábado, 03\/10/);
  assert.equal(dataBr("2026-10-05"), "segunda, 05/10");
});

test("resumo do dia soma a produção por sabor e separa retiradas e entregas", () => {
  const linha = (cliente, itens, modalidade, bairro, total, taxa, status = "confirmado", data = "2026-10-02") =>
    ({ cliente, itens: JSON.stringify(itens), modalidade, bairro, total, taxa_entrega: taxa, status, data_entrega: data });
  const r = resumirDia([
    linha("Ana", [{ sabor: "Ninho", qtd: 3 }], "retirada", null, 42, 0),
    linha("Bruno", [{ sabor: "Ninho", qtd: 2 }, { sabor: "Oreo", qtd: 2 }], "entrega", "Centro", 64, 6),
    linha("Carla", [{ sabor: "Oreo", qtd: 9 }], "entrega", "Centro", 135, 0, "atendimento"),
    linha("Davi", [{ sabor: "Oreo", qtd: 1 }], "retirada", null, 15, 0, "confirmado", "2026-10-03"),
  ], "2026-10-02", cfg);
  assert.deepEqual(r.producao, { "Clássica": 0, Ninho: 5, Oreo: 2 });
  assert.equal(r.pedidos, 2);
  assert.equal(r.faturamento, 106);
  assert.deepEqual(Object.keys(r.entregas), ["Centro"]);
  const texto = textoResumo(r);
  assert.match(texto, /Ninho: 5/);
  assert.ok(!texto.includes("Clássica")); // sabor sem pedido não aparece
  assert.match(texto, /R\$ 106,00/);
});
