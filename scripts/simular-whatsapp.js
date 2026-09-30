// Teste de ponta a ponta do workflow do WhatsApp: simula a Meta chamando o n8n e confere as respostas
// que o workflow mandou para a "Meta falsa" (scripts/meta-falsa.js).
//
//   node scripts/simular-whatsapp.js http://localhost:5678 http://localhost:9999 <app-secret> <verify-token> [saida.json]

const crypto = require("node:crypto");
const fs = require("node:fs");

const [base, meta, segredo, verifyToken, saida] = process.argv.slice(2);
const falhas = [];
const conferir = (ok, descricao) => { console.log(`${ok ? "✓" : "✗"} ${descricao}`); if (!ok) falhas.push(descricao); };

const mensagem = (de, nome, conteudo) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp", metadata: { phone_number_id: "PNID" },
    contacts: [{ wa_id: de, profile: { name: nome } }],
    messages: [{ from: de, id: `wamid.${de}.${Date.now()}`, timestamp: "1790800000", ...conteudo }] } }] }],
});

async function postarComoMeta(payload, assinatura) {
  const corpo = JSON.stringify(payload);
  const hmac = "sha256=" + crypto.createHmac("sha256", segredo).update(corpo).digest("hex");
  const r = await fetch(`${base}/webhook/whatsapp`, { method: "POST", body: corpo,
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": assinatura ?? hmac } });
  return r.status;
}

async function esperar(condicao, segundos = 40) {
  for (let i = 0; i < segundos * 2; i++) {
    const enviadas = await (await fetch(`${meta}/enviadas`)).json();
    if (condicao(enviadas)) return enviadas;
    await new Promise((ok) => setTimeout(ok, 500));
  }
  return (await fetch(`${meta}/enviadas`)).json();
}

async function main() {
  // O n8n registra os webhooks alguns segundos depois de subir.
  for (let i = 0; i < 60 && (await fetch(`${base}/webhook/whatsapp`).catch(() => ({ status: 0 }))).status === 404; i++) {
    await new Promise((ok) => setTimeout(ok, 1000));
  }

  const q = (token) => `hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=1158201444`;
  const ok = await fetch(`${base}/webhook/whatsapp?${q(verifyToken)}`);
  conferir(ok.status === 200 && (await ok.text()) === "1158201444", "verificação da Meta devolve o challenge");
  const errado = await fetch(`${base}/webhook/whatsapp?${q("chute")}`);
  conferir(errado.status === 403, "verificação com token errado é recusada (403)");

  conferir(await postarComoMeta(mensagem("5511911110001", "Ana Souza",
    { type: "text", text: { body: "Oi! Quero 3 ninho e 2 oreo pra depois de amanhã, eu retiro" } })) === 200, "pedido em texto aceito (200)");
  conferir(await postarComoMeta(mensagem("5511911110002", "Bruno Lima", { type: "audio", audio: { id: "x" } })) === 200,
    "áudio aceito (200)");
  await postarComoMeta({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { statuses: [{ status: "read" }] } }] }] });
  await postarComoMeta(mensagem("5511911110003", "Invasor", { type: "text", text: { body: "quero 40 oreo amanhã" } }),
    "sha256=" + "0".repeat(64));

  const enviadas = await esperar((e) => e.length >= 2);
  await new Promise((ok) => setTimeout(ok, 3000)); // dá tempo de uma resposta indevida aparecer
  const finais = await (await fetch(`${meta}/enviadas`)).json();
  const para = (tel) => finais.filter((m) => m.para === tel);

  conferir(para("5511911110001").length === 1 && /Pedido anotado, Ana/.test(para("5511911110001")[0]?.texto),
    "Ana recebe a confirmação com o total");
  conferir(/Total: R\$ 72,00/.test(para("5511911110001")[0]?.texto || ""), "total calculado (3 Ninho + 2 Oreo = R$ 72,00)");
  conferir(para("5511911110002").length === 1 && /Recebi seu áudio/.test(para("5511911110002")[0]?.texto),
    "Bruno recebe o pedido para escrever em texto");
  conferir(para("5511911110003").length === 0, "mensagem com assinatura falsa não gera resposta");
  conferir(finais.length === 2, `exatamente 2 mensagens enviadas (status "lido" ignorado) · enviadas: ${finais.length}`);

  if (saida) fs.writeFileSync(saida, JSON.stringify(enviadas, null, 2));
  if (falhas.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
