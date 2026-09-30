// Imita o endpoint de envio da WhatsApp Cloud API para o teste de ponta a ponta.
//
//   node scripts/meta-falsa.js 9999 token-de-teste
//
// POST /<versao>/<phone_number_id>/messages  → confere o token e registra a mensagem
// GET  /enviadas                              → lista o que o workflow enviou

const http = require("node:http");

const [porta = "9999", tokenEsperado = "token-de-teste"] = process.argv.slice(2);
const enviadas = [];

http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/enviadas") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(enviadas));
  }
  let corpo = "";
  req.on("data", (parte) => { corpo += parte; });
  req.on("end", () => {
    if (req.method !== "POST" || !/^\/v[\d.]+\/[^/]+\/messages$/.test(req.url)) {
      res.writeHead(404); return res.end();
    }
    if (req.headers.authorization !== `Bearer ${tokenEsperado}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "Invalid OAuth access token", code: 190 } }));
    }
    const msg = JSON.parse(corpo);
    enviadas.push({ url: req.url, para: msg.to, texto: msg.text?.body, modelo: msg.template?.name,
      parametros: msg.template?.components?.[0]?.parameters?.map((p) => p.text) });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ messaging_product: "whatsapp", contacts: [{ input: msg.to, wa_id: msg.to }],
      messages: [{ id: `wamid.falso.${enviadas.length}` }] }));
  });
}).listen(Number(porta), () => console.log(`Meta falsa ouvindo na porta ${porta}`));
