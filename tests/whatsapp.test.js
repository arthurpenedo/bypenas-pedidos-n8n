const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { assinaturaValida, extrairMensagens, respostaNaoTexto, mensagemDeTexto } = require("../src/whatsapp.js");

// Formato do webhook da WhatsApp Cloud API (mensagem recebida).
const payload = (mensagens, contatos = []) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA_ID", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp", metadata: { display_phone_number: "5511900000000", phone_number_id: "PNID" },
    contacts: contatos, messages: mensagens } }] }],
});

test("extrai texto, telefone e nome do perfil", () => {
  const p = payload([{ from: "5511911112222", id: "wamid.1", timestamp: "1790800000", type: "text",
    text: { body: "3 ninho pra amanhã" } }], [{ wa_id: "5511911112222", profile: { name: "Ana Souza" } }]);
  assert.deepEqual(extrairMensagens(p), [{ id: "wamid.1", telefone: "5511911112222", cliente: "Ana Souza",
    tipo: "text", texto: "3 ninho pra amanhã" }]);
});

test("ignora avisos de status e aceita várias mensagens no mesmo POST", () => {
  const status = { entry: [{ changes: [{ value: { statuses: [{ id: "wamid.x", status: "read" }] } }] }] };
  assert.deepEqual(extrairMensagens(status), []);
  const duas = payload([{ from: "1", id: "a", type: "text", text: { body: "oi" } }, { from: "2", id: "b", type: "audio", audio: {} }]);
  assert.deepEqual(extrairMensagens(duas).map((m) => [m.id, m.tipo, m.texto]), [["a", "text", "oi"], ["b", "audio", ""]]);
  assert.deepEqual(extrairMensagens({}), []);
});

test("assinatura HMAC da Meta: aceita a correta, recusa alterada, ausente ou de outro segredo", () => {
  const corpo = JSON.stringify(payload([]));
  const assinar = (s) => "sha256=" + crypto.createHmac("sha256", s).update(corpo).digest("hex");
  assert.ok(assinaturaValida(corpo, assinar("segredo"), "segredo", crypto));
  assert.ok(!assinaturaValida(corpo + " ", assinar("segredo"), "segredo", crypto));
  assert.ok(!assinaturaValida(corpo, assinar("outro"), "segredo", crypto));
  assert.ok(!assinaturaValida(corpo, undefined, "segredo", crypto));
  assert.ok(!assinaturaValida(corpo, "sha256=curta", "segredo", crypto));
});

test("responde áudio e foto pedindo texto, com o nome quando houver", () => {
  assert.match(respostaNaoTexto({ tipo: "audio", cliente: "Bruno Lima" }), /^Oi, Bruno! Recebi seu áudio/);
  assert.match(respostaNaoTexto({ tipo: "image", cliente: "" }), /^Oi! Recebi sua foto/);
  assert.match(respostaNaoTexto({ tipo: "reaction", cliente: "" }), /^Oi! Recebi sua mensagem/);
});

test("mensagem de envio no formato da Cloud API, cortada no limite de 4096 caracteres", () => {
  const m = mensagemDeTexto("5511911112222", "x".repeat(5000));
  assert.equal(m.messaging_product, "whatsapp");
  assert.equal(m.to, "5511911112222");
  assert.equal(m.text.body.length, 4096);
});
