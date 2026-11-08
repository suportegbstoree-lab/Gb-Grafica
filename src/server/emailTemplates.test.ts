import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import {
  emailTestSamples,
  sendEmailTestSuite,
  singleTestEmail,
} from "./emailTestSend.js";
import {
  emailBranding,
  emailTemplateKinds,
  renderEmailPreview,
  resendEmailContent,
  resendTemplateDefinitions,
} from "./resendEmailTemplates.js";
import {
  campaignEmailMessage,
  orderReceiptEmailMessage,
  staffDocumentEmailMessage,
  welcomeEmailMessage,
} from "./emailMessages.js";
import type { Order } from "../types.js";

const env = {
  APP_URL: "https://store.example.test",
  RESEND_API_KEY: "test-only-secret",
  RESEND_USE_HOSTED_TEMPLATES: "true",
  EMAIL_FROM: "no-reply@example.test",
  ORDER_EMAIL_FROM: "orders@example.test",
  STAFF_EMAIL_FROM: "staff@example.test",
  EMAIL_MARKETING_FROM: "promo@example.test",
  EMAIL_REPLY_TO: "suporte@example.test",
  EMAIL_BANNER_URL: "",
};
let previous: Record<string, string | undefined>;
beforeEach(() => {
  previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
});
afterEach(() => {
  for (const [key, value] of Object.entries(previous))
    value === undefined ? delete process.env[key] : (process.env[key] = value);
});
const received = async (
  calls: Array<{ body: any; headers: Headers }>,
  _url: unknown,
  options?: RequestInit,
) => {
  calls.push({
    body: JSON.parse(String(options?.body)),
    headers: new Headers(options?.headers),
  });
  return Response.json({ id: `test-provider-${calls.length}` });
};
const noWait = async () => {};
const order: Order = {
  id: "GB-EXAMPLE",
  userId: "test-only",
  data: "2026-11-08T12:00:00Z",
  status: "Pendente",
  paymentStatus: "pendente",
  clienteNome: "Cliente",
  clienteEmail: "client@example.test",
  metodoEntrega: "retirada",
  metodoPagamento: "pagbank",
  itens: [
    {
      id: "a",
      productId: "a",
      nome: "Caderno",
      imagem: "",
      preco: "49.90",
      quantidade: 2,
      selecoes: {},
    },
  ],
  subtotal: "99.80",
  frete: "0.00",
  total: "99.80",
  totalCents: 9980,
};

test("all seven sample templates have the supplied banner and a lossless hosted/inline rendering", async () => {
  const samples = await emailTestSamples(Date.parse("2026-11-08T12:00:00Z"));
  assert.deepEqual(
    samples.map((sample) => sample.kind),
    emailTemplateKinds,
  );
  assert.equal(
    new Set(resendTemplateDefinitions.map((definition) => definition.alias))
      .size,
    7,
  );
  for (const sample of samples) {
    const payload = resendEmailContent(sample.kind, sample.message);
    assert.ok(
      "template" in payload,
      `${sample.kind} should fit hosted variables`,
    );
    const definition = resendTemplateDefinitions.find(
      (item) => item.alias === payload.template!.id,
    )!;
    assert.ok(definition.variables.length <= 50);
    assert.ok(
      Object.values(payload.template!.variables).every(
        (value) => value.length <= 2000,
      ),
    );
    const fill = (value: string) =>
      value.replace(
        /\{\{\{([A-Z_0-9]+)\}\}\}/g,
        (_, key) => payload.template!.variables[key],
      );
    assert.equal(
      fill(definition.html),
      renderEmailPreview(sample.kind, sample.message),
    );
    assert.equal(fill(definition.text), sample.message.text);
    assert.match(
      fill(definition.html),
      /https:\/\/store.example.test\/email\/gb-grafica-banner.png/,
    );
    assert.match(fill(definition.html), /mailto:suporte@example.test/);
    assert.match(
      fill(definition.html),
      /@media only screen and \(max-width:480px\)/,
    );
  }
});
test("customer and merchant receipts contain quantities, totals and only actual delivery/billing data", () => {
  const message = orderReceiptEmailMessage(order.id, order, false, {
    endereco_comercial: "Rua da Loja, 100",
  });
  assert.match(message.text, /2 × Caderno — R\$\s99,80/);
  assert.match(message.text, /Total do pedido: R\$\s99,80/);
  assert.match(message.text, /Retirada na loja\nRua da Loja, 100/);
  assert.match(message.text, /não confirma pagamento/);
  assert.doesNotMatch(
    message.text,
    /Endereço de pagamento|Pagamento confirmado/,
  );
  const merchant = orderReceiptEmailMessage(
    order.id,
    { ...order, paymentStatus: "pago" },
    true,
  );
  assert.match(merchant.text, /pagamento deste pedido está confirmado/);
  assert.match(
    merchant.blocks!.join(""),
    /href="https:\/\/store.example.test\/admin"/,
  );
});
test("untrusted names, selections, addresses and notes are escaped and cannot create HTML or links", () => {
  const dangerous = '<img src=x onerror="bad()"> & <script>bad()</script>';
  const html = renderEmailPreview(
    "order-received",
    orderReceiptEmailMessage(order.id, {
      ...order,
      clienteNome: dangerous,
      observacoes: dangerous,
      itens: [
        {
          ...order.itens[0],
          nome: dangerous,
          selecoes: { Formato: dangerous },
          textoPersonalizado: dangerous,
        },
      ],
    }),
  );
  assert.doesNotMatch(html, /<script>|<img src=x|onerror="bad/);
  assert.match(html, /&lt;img src=x onerror=&quot;bad\(\)&quot;&gt;/);
  assert.doesNotMatch(
    renderEmailPreview(
      "staff-document",
      staffDocumentEmailMessage({
        reference: dangerous,
        expiresAt: "",
        attached: false,
        url: "javascript:alert(1)",
      }),
    ),
    /href="javascript:/,
  );
});
test("large bodies fall back to complete inline HTML instead of exceeding variable limits or truncating", () => {
  const message = orderReceiptEmailMessage(order.id, {
    ...order,
    observacoes: "Observação ".repeat(1000),
  });
  const result = resendEmailContent("order-received", message);
  assert.ok("html" in result);
  assert.equal(result.text, message.text);
  assert.match(result.html!, /Observação Observação/);
  process.env.EMAIL_BANNER_URL = `https://cdn.example.test/image?signature=${"a".repeat(2500)}`;
  assert.ok(
    "html" in resendEmailContent("welcome", welcomeEmailMessage("Cliente")),
  );
});
test("text chunks preserve Unicode boundaries and old template mode remains inline", () => {
  const message = {
    text: "a".repeat(1899) + "𐐀".repeat(500),
    blocks: ["<p>Mensagem de exemplo</p>"],
  };
  const result = resendEmailContent("welcome", message);
  assert.ok("template" in result);
  const parts = Object.entries(result.template!.variables)
    .filter(([key]) => key.startsWith("GB_MESSAGE_TEXT"))
    .map(([, value]) => value);
  assert.equal(parts.join(""), message.text);
  assert.ok(parts.every((part) => !/[\uD800-\uDBFF]$/.test(part)));
  assert.ok("html" in resendEmailContent("welcome", message, false));
  process.env.RESEND_USE_HOSTED_TEMPLATES = "false";
  assert.ok("html" in resendEmailContent("welcome", message));
});
test("campaign unsubscribe and arbitrary text remain visible in both representations", () => {
  const message = campaignEmailMessage(
    "Oferta <especial> & novidades\nSegunda linha",
    "promotions",
    "https://store.example.test/api/email/unsubscribe?token=a&x=b",
  );
  const html = renderEmailPreview("campaign", message);
  assert.match(
    html,
    /Oferta &lt;especial&gt; &amp; novidades<br>Segunda linha/,
  );
  assert.match(html, /token=a&amp;x=b/);
  assert.match(message.text, /Descadastrar: https:/);
});
test("the test recipient must be a single plain mailbox, never a list or header injection", () => {
  for (const email of [
    "a@example.test,b@example.test",
    "A <a@example.test>",
    "a@example.test\nb@example.test",
    "a@example.test;b@example.test",
    "",
    "not-email",
  ])
    assert.equal(singleTestEmail(email), "");
  assert.equal(
    singleTestEmail(" Client+test@Example.Test "),
    "client+test@example.test",
  );
});
test("one sample of each template goes only to the requested address with the correct senders and valid PDF attachments", async () => {
  const calls: Array<{ body: any; headers: Headers }> = [];
  const result = await sendEmailTestSuite("reviewer@example.test", {
    runId: "fixed-test",
    pause: noWait,
    fetcher: (url, options) => received(calls, url, options),
  });
  assert.equal(result.results.length, 7);
  assert.ok(result.results.every((row) => row.status === "accepted"));
  for (const [index, call] of calls.entries()) {
    assert.deepEqual(call.body.to, ["reviewer@example.test"]);
    assert.equal(call.body.cc, undefined);
    assert.equal(call.body.bcc, undefined);
    assert.equal(call.body.reply_to, "suporte@example.test");
    assert.ok(call.body.subject.startsWith(`[TESTE ${index + 1}/7]`));
    assert.equal(
      call.headers.get("Idempotency-Key"),
      `email-test-fixed-test-${emailTemplateKinds[index]}`,
    );
    assert.match(
      call.body.template.variables.GB_MESSAGE_TEXT,
      /dados fictícios/,
    );
    for (const attachment of call.body.attachments || [])
      assert.ok(
        (
          await PDFDocument.load(Buffer.from(attachment.content, "base64"))
        ).getPageCount() > 0,
      );
  }
  assert.equal(calls[0].body.from, env.EMAIL_FROM);
  assert.equal(calls[1].body.from, env.ORDER_EMAIL_FROM);
  assert.equal(calls[2].body.from, env.ORDER_EMAIL_FROM);
  assert.equal(calls[4].body.from, env.STAFF_EMAIL_FROM);
  assert.equal(calls[5].body.from, env.STAFF_EMAIL_FROM);
  assert.equal(calls[6].body.from, env.EMAIL_MARKETING_FROM);
  assert.equal(calls.filter((call) => call.body.attachments?.length).length, 3);
});
test("dry runs never call the provider and do not need a sending key", async () => {
  delete process.env.RESEND_API_KEY;
  let called = false;
  const result = await sendEmailTestSuite("reviewer@example.test", {
    dryRun: true,
    fetcher: async () => {
      called = true;
      throw new Error("Must not send");
    },
  });
  assert.ok(result.results.every((row) => row.status === "planned"));
  assert.equal(called, false);
  await assert.rejects(
    sendEmailTestSuite("reviewer@example.test"),
    /RESEND_API_KEY/,
  );
});
test("invalid or missing senders are checked before sending any part of the suite", async () => {
  process.env.EMAIL_MARKETING_FROM = "wrong";
  let called = false;
  await assert.rejects(
    sendEmailTestSuite("reviewer@example.test", {
      fetcher: async () => {
        called = true;
        return Response.json({ id: "never" });
      },
    }),
    /EMAIL_MARKETING_FROM/,
  );
  assert.equal(called, false);
});
test("authorization and quota errors stop remaining sends and never disclose provider bodies or secrets", async () => {
  for (const status of [401, 403, 429]) {
    let count = 0;
    const result = await sendEmailTestSuite("reviewer@example.test", {
      pause: noWait,
      fetcher: async () => {
        count++;
        return Response.json({ message: env.RESEND_API_KEY }, { status });
      },
    });
    assert.equal(count, 1);
    assert.equal(result.results[0].status, "failed");
    assert.equal(
      result.results.filter((row) => row.status === "not_sent").length,
      6,
    );
    assert.doesNotMatch(JSON.stringify(result), /test-only-secret/);
  }
});
test("explicit short rate limits retry the exact request once with the same idempotency key", async () => {
  const bodies: string[] = [],
    keys: Array<string | null> = [],
    waits: number[] = [];
  const result = await sendEmailTestSuite("reviewer@example.test", {
    samples: (await emailTestSamples()).slice(0, 1),
    pause: async (ms) => {
      waits.push(ms);
    },
    fetcher: async (_url, options) => {
      bodies.push(String(options?.body));
      keys.push(new Headers(options?.headers).get("Idempotency-Key"));
      return bodies.length === 1
        ? Response.json(
            { name: "rate_limit_exceeded" },
            { status: 429, headers: { "Retry-After": "1" } },
          )
        : Response.json({ id: "accepted" });
    },
  });
  assert.equal(result.results[0].status, "accepted");
  assert.equal(bodies[0], bodies[1]);
  assert.equal(keys[0], keys[1]);
  assert.deepEqual(waits, [1000]);
});
test("transport failures and 5xx responses are left unconfirmed without blindly repeating the email", async () => {
  for (const mode of ["throw", "500"]) {
    let count = 0;
    const result = await sendEmailTestSuite("reviewer@example.test", {
      samples: (await emailTestSamples()).slice(0, 1),
      pause: noWait,
      fetcher: async () => {
        count++;
        if (mode === "throw") throw new Error(env.RESEND_API_KEY);
        return new Response("private details", { status: 500 });
      },
    });
    assert.equal(count, 1);
    assert.equal(result.results[0].status, "unknown");
    assert.doesNotMatch(
      JSON.stringify(result),
      /test-only-secret|private details/,
    );
  }
});
test("a malformed success does not claim acceptance and each new invocation gets a unique run ID", async () => {
  const samples = (await emailTestSamples()).slice(0, 1);
  const a = await sendEmailTestSuite("reviewer@example.test", {
    samples,
    pause: noWait,
    fetcher: async () => Response.json({}),
  });
  const b = await sendEmailTestSuite("reviewer@example.test", {
    samples,
    dryRun: true,
  });
  assert.equal(a.results[0].status, "unknown");
  assert.notEqual(a.runId, b.runId);
});
test("unsafe banner settings fall back to the versioned public image", () => {
  process.env.EMAIL_BANNER_URL = "javascript:bad()";
  assert.equal(
    emailBranding().bannerUrl,
    "https://store.example.test/email/gb-grafica-banner.png",
  );
});

test("real tests reject local or missing site URLs before any provider call", async () => {
  let calls = 0;
  for (const origin of [
    "",
    "http://localhost:3000",
    "https://localhost",
    "https://user:pass@example.test",
  ]) {
    process.env.APP_URL = origin;
    await assert.rejects(
      sendEmailTestSuite("reviewer@example.test", {
        fetcher: async () => {
          calls++;
          return Response.json({ id: "never" });
        },
      }),
      /APP_URL/,
    );
  }
  assert.equal(calls, 0);
});
