// Tradução entre a WhatsApp Cloud API (Meta) e o workflow de pedidos.
// Roda dentro de nós Code do n8n (o build injeta este arquivo) e nos testes com node --test.

const TIPOS_NAO_TEXTO = {
  audio: "seu áudio", image: "sua foto", video: "seu vídeo", document: "seu arquivo",
  sticker: "sua figurinha", location: "sua localização",
};

// A Meta assina o corpo cru com o App Secret (header X-Hub-Signature-256: "sha256=<hex>").
// Sem essa conferência, qualquer pessoa que descubra a URL consegue criar pedidos falsos.
function assinaturaValida(corpoCru, cabecalho, segredo, crypto) {
  if (!cabecalho || !cabecalho.startsWith("sha256=")) return false;
  const esperado = Buffer.from(crypto.createHmac("sha256", segredo).update(corpoCru).digest("hex"));
  const recebido = Buffer.from(cabecalho.slice("sha256=".length));
  return esperado.length === recebido.length && crypto.timingSafeEqual(esperado, recebido);
}

// Um POST da Meta pode trazer várias mensagens e também avisos de status (entregue, lida), que são ignorados.
function extrairMensagens(payload) {
  const mensagens = [];
  for (const entrada of payload?.entry || []) {
    for (const mudanca of entrada.changes || []) {
      const valor = mudanca.value || {};
      const nomes = Object.fromEntries((valor.contacts || []).map((c) => [c.wa_id, c.profile?.name || ""]));
      for (const m of valor.messages || []) {
        mensagens.push({
          id: m.id,
          telefone: m.from,
          cliente: nomes[m.from] || "",
          tipo: m.type,
          texto: m.type === "text" ? m.text?.body || "" : "",
        });
      }
    }
  }
  return mensagens;
}

function respostaNaoTexto(mensagem) {
  const oQue = TIPOS_NAO_TEXTO[mensagem.tipo] || "sua mensagem";
  const nome = mensagem.cliente.split(" ")[0];
  return `Oi${nome ? `, ${nome}` : ""}! Recebi ${oQue}, mas por aqui eu só consigo ler pedidos em texto. ` +
    "Me manda algo como \"3 ninho e 2 oreo pra sábado, eu retiro\" que eu já calculo pra você. 😊";
}

function mensagemDeTexto(para, texto) {
  return { messaging_product: "whatsapp", recipient_type: "individual", to: para, type: "text",
    text: { preview_url: false, body: texto.slice(0, 4096) } };
}

if (typeof module !== "undefined") {
  module.exports = { assinaturaValida, extrairMensagens, respostaNaoTexto, mensagemDeTexto };
}
