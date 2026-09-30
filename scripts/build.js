// Gera os workflows do n8n a partir de src/*.js e config/config.json.
//
//   node scripts/build.js           escreve workflows/*.json
//   node scripts/build.js --check   falha se os arquivos commitados estiverem desatualizados (usado no CI)
//
// A lógica dos nós Code vive em arquivos .js testados; o JSON do workflow é gerado, nunca editado à mão.

const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..");
const CR = String.fromCharCode(13);
const ler = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), "utf8").split(CR).join("");
const fonte = (nome) => ler("src", nome).replace(/^if \(typeof module !== "undefined"\)[\s\S]*$/m, "").trim();

const TABELA = "pedidos_bypenas";
const COLUNAS = [
  ["cliente", "string"], ["telefone", "string"], ["mensagem", "string"], ["itens", "string"],
  ["unidades", "number"], ["data_entrega", "string"], ["modalidade", "string"], ["bairro", "string"],
  ["subtotal", "number"], ["taxa_entrega", "number"], ["total", "number"], ["problemas", "string"],
  ["status", "string"], ["resposta", "string"],
];
const CFG = "$('Configuração').first().json";

const no = (id, nome, tipo, versao, posicao, parametros, extra = {}) =>
  ({ id, name: nome, type: `n8n-nodes-base.${tipo}`, typeVersion: versao, position: posicao, parameters: parametros, ...extra });
const code = (id, nome, posicao, js) => no(id, nome, "code", 2, posicao, { jsCode: js });
const tabela = { __rl: true, mode: "name", value: TABELA };
const liga = (...destinos) => ({ main: [destinos.map((d) => ({ node: d, type: "main", index: 0 }))] });

function configuracao(id, posicao) {
  return code(id, "Configuração", posicao,
    "// Catálogo, preços (de exemplo), bairros atendidos, capacidade e entrega. Edite aqui ou em config/config.json.\n" +
    `return [{ json: ${JSON.stringify(JSON.parse(ler("config", "config.json")), null, 2)} }];`);
}

function garantirTabela(id, posicao) {
  return no(id, "Garantir tabela", "dataTable", 1.1, posicao, {
    resource: "table",
    operation: "create",
    tableName: TABELA,
    columns: { column: COLUNAS.map(([name, type]) => ({ name, type })) },
    options: { createIfNotExists: true },
  });
}

function lerPedidos(id, posicao) {
  return no(id, "Pedidos registrados", "dataTable", 1.1, posicao,
    { resource: "row", operation: "get", dataTableId: tabela, returnAll: true }, { alwaysOutputData: true });
}

function receberPedido() {
  const nodes = [
    no("p1", "Mensagem de pedido", "webhook", 2.1, [0, 0],
      { httpMethod: "POST", path: "pedido", responseMode: "responseNode", options: {} },
      { webhookId: "2f6c1b0e-8a4d-4e0b-9a51-b1e5a0000001" }),
    configuracao("p2", [220, 0]),
    garantirTabela("p3", [440, 0]),
    lerPedidos("p4", [660, 0]),
    code("p5", "Interpretar e decidir", [880, 0],
      `${fonte("pedido.js")}\n\n${fonte("decisao.js")}\n\n` +
      `const cfg = ${CFG};\n` +
      "const pedido = interpretarPedido($('Mensagem de pedido').first().json.body, cfg);\n" +
      "// capacidade: soma o que já está confirmado para o mesmo dia\n" +
      "const reservado = $input.all().map((i) => i.json)\n" +
      "  .filter((l) => l.status === 'confirmado' && l.data_entrega === pedido.data_entrega)\n" +
      "  .reduce((soma, l) => soma + Number(l.unidades), 0);\n" +
      "const { status, resposta } = decidir(pedido, reservado, cfg);\n" +
      "return [{ json: { ...pedido, itens: JSON.stringify(pedido.itens), data_entrega: pedido.data_entrega || '',\n" +
      "  bairro: pedido.bairro || '', problemas: pedido.problemas.join('; '), status, resposta } }];"),
    no("p6", "Registrar pedido", "dataTable", 1.1, [1100, 0], {
      resource: "row",
      operation: "insert",
      dataTableId: tabela,
      columns: { mappingMode: "autoMapInputData", value: {}, matchingColumns: [], schema: [] },
      options: {},
    }),
    no("p7", "Responder ao cliente", "respondToWebhook", 1.5, [1320, 0], {
      respondWith: "json",
      responseBody: "={{ JSON.stringify({ status: $('Interpretar e decidir').first().json.status, " +
        "resposta: $('Interpretar e decidir').first().json.resposta, pedido: $('Interpretar e decidir').first().json }) }}",
      options: {},
    }),
  ];
  const connections = {
    "Mensagem de pedido": liga("Configuração"),
    "Configuração": liga("Garantir tabela"),
    "Garantir tabela": liga("Pedidos registrados"),
    "Pedidos registrados": liga("Interpretar e decidir"),
    "Interpretar e decidir": liga("Registrar pedido"),
    "Registrar pedido": liga("Responder ao cliente"),
  };
  return { id: "bypenasPedido001", name: "By.penas · Receber pedido", nodes, connections };
}

function resumoDoDia() {
  const nodes = [
    no("r1", "Todo dia às 7h", "scheduleTrigger", 1.2, [0, 0],
      { rule: { interval: [{ field: "cronExpression", expression: "0 7 * * *" }] } }),
    no("r2", "Consultar resumo", "webhook", 2.1, [0, 200],
      { httpMethod: "GET", path: "resumo", responseMode: "responseNode", options: {} },
      { webhookId: "2f6c1b0e-8a4d-4e0b-9a51-b1e5a0000002" }),
    configuracao("r3", [220, 100]),
    garantirTabela("r4", [440, 100]),
    lerPedidos("r5", [660, 100]),
    code("r6", "Montar resumo", [880, 100],
      `${fonte("pedido.js")}\n\n${fonte("resumo.js")}\n\n` +
      `const cfg = ${CFG};\n` +
      "// Pelo webhook dá para pedir outro dia: /webhook/resumo?data=AAAA-MM-DD\n" +
      "let data = dataLocal(new Date(), cfg.fuso);\n" +
      "try { data = $('Consultar resumo').first().json.query.data || data; } catch (e) { /* disparado pelo agendamento */ }\n" +
      "const linhas = $input.all().map((i) => i.json).filter((l) => l.status);\n" +
      "const resumo = resumirDia(linhas, data, cfg);\n" +
      "return [{ json: { ...resumo, texto: textoResumo(resumo) } }];"),
    no("r7", "Enviar no Telegram?", "if", 2.2, [1100, 0], {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 2 },
        conditions: [{ id: "t1", leftValue: `={{ ${CFG}.telegram.ativo }}`, rightValue: true,
          operator: { type: "boolean", operation: "true", singleValue: true } }],
        combinator: "and",
      },
      looseTypeValidation: true,
      options: {},
    }),
    no("r8", "Telegram", "telegram", 1.2, [1320, 0], {
      chatId: `={{ ${CFG}.telegram.chat_id }}`,
      text: "={{ $json.texto }}",
      additionalFields: { appendAttribution: false },
    }),
    no("r9", "Responder com o resumo", "respondToWebhook", 1.5, [1100, 200],
      { respondWith: "json", responseBody: "={{ JSON.stringify($json) }}", options: {} }),
  ];
  const connections = {
    "Todo dia às 7h": liga("Configuração"),
    "Consultar resumo": liga("Configuração"),
    "Configuração": liga("Garantir tabela"),
    "Garantir tabela": liga("Pedidos registrados"),
    "Pedidos registrados": liga("Montar resumo"),
    "Montar resumo": liga("Enviar no Telegram?", "Responder com o resumo"),
    "Enviar no Telegram?": { main: [[{ node: "Telegram", type: "main", index: 0 }], []] },
  };
  return { id: "bypenasResumo001", name: "By.penas · Resumo do dia", nodes, connections };
}

// WhatsApp Cloud API (Meta). Segredos ficam fora do JSON: o token numa credencial Header Auth do n8n,
// o App Secret e o verify token em variáveis de ambiente (WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN).
function whatsapp() {
  const wa = JSON.parse(ler("config", "config.json")).whatsapp;
  const credencial = { httpHeaderAuth: { id: "waToken000000001", name: "WhatsApp Cloud API (token)" } };
  const nodes = [
    no("w1", "Verificação da Meta", "webhook", 2.1, [0, 0],
      { httpMethod: "GET", path: "whatsapp", responseMode: "responseNode", options: {} },
      { webhookId: "2f6c1b0e-8a4d-4e0b-9a51-b1e5a0000003" }),
    code("w2", "Conferir token de verificação", [220, 0],
      "// A Meta chama GET ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=... ao cadastrar o webhook.\n" +
      "const q = $input.first().json.query || {};\n" +
      "const esperado = $env.WHATSAPP_VERIFY_TOKEN;\n" +
      "const ok = Boolean(esperado) && q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === esperado;\n" +
      "return [{ json: { ok, challenge: String(q['hub.challenge'] || '') } }];"),
    no("w3", "Token confere?", "if", 2.2, [440, 0], {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 2 },
        conditions: [{ id: "v1", leftValue: "={{ $json.ok }}", rightValue: true,
          operator: { type: "boolean", operation: "true", singleValue: true } }],
        combinator: "and",
      },
      looseTypeValidation: true,
      options: {},
    }),
    no("w4", "Devolver challenge", "respondToWebhook", 1.5, [660, -80],
      { respondWith: "text", responseBody: "={{ $json.challenge }}", options: { responseCode: 200 } }),
    no("w5", "Recusar", "respondToWebhook", 1.5, [660, 80],
      { respondWith: "text", responseBody: "token inválido", options: { responseCode: 403 } }),

    no("m1", "Mensagem do WhatsApp", "webhook", 2.1, [0, 320],
      { httpMethod: "POST", path: "whatsapp", responseMode: "onReceived", options: { rawBody: true } },
      { webhookId: "2f6c1b0e-8a4d-4e0b-9a51-b1e5a0000004" }),
    code("m2", "Validar e extrair", [220, 320],
      `${fonte("whatsapp.js")}\n\n` +
      "const crypto = require('crypto');\n" +
      "const segredo = $env.WHATSAPP_APP_SECRET;\n" +
      "if (!segredo) throw new Error('Defina WHATSAPP_APP_SECRET: sem ele não dá para conferir a assinatura da Meta.');\n" +
      "const requisicao = $input.first();\n" +
      "const cru = await this.helpers.getBinaryDataBuffer(0, 'data');\n" +
      "if (!assinaturaValida(cru, requisicao.json.headers['x-hub-signature-256'], segredo, crypto)) {\n" +
      "  return []; // assinatura inválida: descarta sem processar nada\n" +
      "}\n" +
      "return extrairMensagens(requisicao.json.body).map((m) => ({ json: m }));"),
    code("m3", "Configuração", [440, 320],
      "// URLs e o ID do número na Meta. O token fica na credencial do nó \"Responder no WhatsApp\".\n" +
      `const config = ${JSON.stringify(wa, null, 2)};\n` +
      "return $input.all().map((i) => ({ json: { ...i.json, config } }));"),
    no("m4", "É texto?", "if", 2.2, [660, 320], {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 2 },
        conditions: [{ id: "m1", leftValue: "={{ $json.tipo }}", rightValue: "text",
          operator: { type: "string", operation: "equals" } }],
        combinator: "and",
      },
      looseTypeValidation: true,
      options: {},
    }),
    no("m5", "Processar pedido", "httpRequest", 4.2, [880, 240], {
      method: "POST",
      url: "={{ $json.config.pedidos_url }}",
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ cliente: $json.cliente, telefone: $json.telefone, mensagem: $json.texto }) }}",
      options: { timeout: 20000 },
    }, { onError: "continueRegularOutput" }),
    code("m6", "Resposta do pedido", [1100, 240],
      `${fonte("whatsapp.js")}\n\n` +
      "return $input.all().map((item, i) => {\n" +
      "  const msg = $('É texto?').itemMatching(i).json;\n" +
      "  const texto = item.json.resposta || 'Recebi sua mensagem! Já te respondo por aqui. 😊'; // pedidos fora do ar\n" +
      "  return { json: { config: msg.config, status: item.json.status || 'erro', envio: mensagemDeTexto(msg.telefone, texto) } };\n" +
      "});"),
    code("m7", "Resposta para não-texto", [1100, 400],
      `${fonte("whatsapp.js")}\n\n` +
      "return $input.all().map((item) => ({ json: { config: item.json.config, status: 'nao_texto',\n" +
      "  envio: mensagemDeTexto(item.json.telefone, respostaNaoTexto(item.json)) } }));"),
    no("m8", "Responder no WhatsApp", "httpRequest", 4.2, [1320, 320], {
      method: "POST",
      url: "={{ $json.config.graph_url }}/{{ $json.config.phone_number_id }}/messages",
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json.envio) }}",
      options: { timeout: 20000 },
    }, { credentials: credencial, retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 }),
  ];
  const connections = {
    "Verificação da Meta": liga("Conferir token de verificação"),
    "Conferir token de verificação": liga("Token confere?"),
    "Token confere?": { main: [[{ node: "Devolver challenge", type: "main", index: 0 }],
      [{ node: "Recusar", type: "main", index: 0 }]] },
    "Mensagem do WhatsApp": liga("Validar e extrair"),
    "Validar e extrair": liga("Configuração"),
    "Configuração": liga("É texto?"),
    "É texto?": { main: [[{ node: "Processar pedido", type: "main", index: 0 }],
      [{ node: "Resposta para não-texto", type: "main", index: 0 }]] },
    "Processar pedido": liga("Resposta do pedido"),
    "Resposta do pedido": liga("Responder no WhatsApp"),
    "Resposta para não-texto": liga("Responder no WhatsApp"),
  };
  return { id: "bypenasWhats0001", name: "By.penas · WhatsApp", nodes, connections };
}

const saidas = {};
for (const [arquivo, wf] of [["receber-pedido.json", receberPedido()], ["resumo-do-dia.json", resumoDoDia()],
  ["whatsapp.json", whatsapp()]]) {
  const completo = { ...wf, active: false, settings: { executionOrder: "v1", timezone: "America/Sao_Paulo" }, pinData: {}, tags: [] };
  saidas[path.join(RAIZ, "workflows", arquivo)] = JSON.stringify(completo, null, 2) + "\n";
}

if (process.argv.includes("--check")) {
  const velhos = Object.entries(saidas).filter(([f, txt]) => !fs.existsSync(f) || ler(path.relative(RAIZ, f)) !== txt);
  if (velhos.length) {
    console.error(`Desatualizado: ${velhos.map(([f]) => path.basename(f)).join(", ")}. Rode \`npm run build\` e commite.`);
    process.exit(1);
  }
  console.log("workflows em dia");
} else {
  fs.mkdirSync(path.join(RAIZ, "workflows"), { recursive: true });
  for (const [f, txt] of Object.entries(saidas)) fs.writeFileSync(f, txt);
  console.log(`gerados: ${Object.keys(saidas).map((f) => path.basename(f)).join(", ")}`);
}
