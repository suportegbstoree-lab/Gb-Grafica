import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { createHash, randomUUID } from "node:crypto";

async function makeLabels(
  pages: Array<{ tracking: string; rows: Array<[string, string, number | string, string?]> } | null>,
) {
  const pdf = await PDFDocument.create();
  for (const label of pages) {
    const page = pdf.addPage([450, 400]);
    if (!label) continue;
    const write = (s: string, x: number, y: number) => page.drawText(s, { x, y, size: 8 });
    write("Código de Rastreamento: " + label.tracking, 15, 360);
    const columns = [15, 40, 120, 300, 400];
    ["Nº", "SKU", "DESCRIÇÃO", "VARIAÇÃO", "QTD"].forEach((s, i) => write(s, columns[i], 300));
    let y = 286;
    for (const [i, [sku, description, qty, variation = ""]] of label.rows.entries()) {
      [String(i + 1), sku, description, variation, String(qty)].forEach((s, j) => {
        if (s) write(s, columns[j], y);
      });
      y -= 16;
    }
    write("Total", 306, y);
    write(String(label.rows.reduce((sum, row) => sum + (Number(row[2]) || 0), 0)), columns[4], y);
  }
  return Buffer.from(await pdf.save());
}

test("categoriza o produto uma vez para toda a equipe e conclui cada PDF independentemente", async ({
  page,
  browser,
}) => {
  const store = randomUUID();
  const url = "/__e2e/imported-labels?resume&label-store=" + store;
  await page.goto(url);
  const pane = page.getByRole("region", { name: "Importação de etiquetas" });
  const makeFile = (name: string, buffer: Buffer) => ({ name, mimeType: "application/pdf", buffer });
  const weekly = makeFile(
    "semana.pdf",
    await makeLabels([
      {
        tracking: "BR123456789012A",
        rows: [
          ["010", "Planner", 2],
          ["011", "Adesivo", 1],
        ],
      },
      { tracking: "BR123456789012B", rows: [["010", "Planner", 1]] },
    ]),
  );
  const single = makeFile(
    "dia.pdf",
    await makeLabels([{ tracking: "BR123456789012C", rows: [["010", "Planner", 1]] }]),
  );
  await expect(pane.getByLabel("PDFs de etiquetas", { exact: true })).toBeEnabled();
  await pane.getByLabel("PDFs de etiquetas", { exact: true }).setInputFiles([weekly, single]);
  await expect(pane.getByText("Crie a primeira categoria", { exact: false })).toBeVisible();
  const finish = pane.getByRole("button", { name: "Concluir importação" });
  await expect(finish).toBeDisabled();
  await pane.getByLabel("Nome da categoria").fill("Cadernos personalizados");
  await pane.getByRole("button", { name: "Criar categoria" }).click();
  const planner = pane.getByRole("article").filter({ hasText: "SKU 010" });
  await planner.getByLabel("Categoria do produto").selectOption({ label: "Cadernos personalizados" });
  await expect(planner.getByText(/às 2 etiqueta\(s\).*para toda a equipe/)).toBeVisible();
  await expect(finish).toBeDisabled();
  await planner.getByRole("button", { name: "Confirmar categoria" }).click();
  await expect(pane.getByText(/Faltam categorias em 1 de 2/)).toBeVisible();
  await pane.getByLabel("PDF em revisão").selectOption({ label: "dia.pdf · 1 etiqueta(s)" });
  await finish.click();
  await expect(pane.getByText("Importação concluída · 1 etiqueta(s).", { exact: true })).toBeVisible();
  await page.reload();
  await pane.getByLabel("PDF em revisão").selectOption({ label: "semana.pdf · 2 etiqueta(s)" });
  await expect(finish).toBeDisabled();
  await expect(pane.getByRole("article")).toHaveCount(1);
  await pane.getByRole("button", { name: "Criar categoria" }).click();
  await pane.getByLabel("Nome da categoria").fill("Adesivos");
  await pane.getByRole("button", { name: "Criar categoria" }).click();
  const sticker = pane.getByRole("article");
  await sticker.getByLabel("Categoria do produto").selectOption({ label: "Adesivos" });
  await sticker.getByRole("button", { name: "Confirmar categoria" }).click();
  await finish.click();
  await expect(pane.getByText("Importação concluída · 2 etiqueta(s).", { exact: true })).toBeVisible();
  await expect(pane.getByLabel("PDFs de etiquetas", { exact: true })).toBeEnabled();
  await pane.getByLabel("PDFs de etiquetas", { exact: true }).setInputFiles(weekly);
  await expect(pane.getByRole("status")).toContainText("0 PDF(s) novo(s)");
  await expect(pane.getByLabel("PDF em revisão").locator("option")).toHaveCount(2);
  const other = await browser.newPage({ baseURL: "http://127.0.0.1:4173" });
  try {
    await other.goto(url + "&owner=outra-pessoa");
    const next = other.getByRole("region", { name: "Importação de etiquetas" });
    await next
      .getByLabel("PDF em revisão")
      .selectOption({ label: "semana.pdf · 2 etiqueta(s) · Concluído" });
    await expect(next.getByText("Importação concluída · 2 etiqueta(s).")).toBeVisible();
    await next.getByText("Conferir etiquetas (2)").click();
    await expect(next.getByText(/Adesivo · SKU 011 · Adesivos/)).toBeVisible();
    await expect(next.getByText(/Planner · SKU 010 · Cadernos personalizados/)).toHaveCount(2);
    const secondPage = next.getByRole("listitem").filter({ hasText: "Página 2" });
    await secondPage.getByRole("button", { name: "Visualizar", exact: true }).click();
    const preview = other.getByRole("dialog", { name: "Visualizar etiqueta · Página 2", exact: true });
    const pdfBytes = await preview
      .locator('iframe[title="PDF das etiquetas"]')
      .evaluate(async (element: HTMLIFrameElement) =>
        Array.from(new Uint8Array(await (await fetch(element.src)).arrayBuffer())),
      );
    expect((await PDFDocument.load(new Uint8Array(pdfBytes))).getPageCount()).toBe(1);
    await preview.getByRole("button", { name: "Fechar visualização", exact: true }).click();
    await next.getByRole("button", { name: "Imprimir PDF completo" }).click();
    const sheets = other.getByRole("dialog", { name: "PDF completo sem os excluídos", exact: true });
    const combined = await sheets
      .locator('iframe[title="PDF das etiquetas"]')
      .evaluate(async (element: HTMLIFrameElement) =>
        Array.from(new Uint8Array(await (await fetch(element.src)).arrayBuffer())),
      );
    expect((await PDFDocument.load(new Uint8Array(combined))).getPageCount()).toBe(2);
    await sheets.getByRole("button", { name: "Fechar visualização", exact: true }).click();
    await next.getByText("Gerenciar categorias (2)").click();
    await next.getByRole("button", { name: "Editar categoria Adesivos" }).click();
    await next.getByLabel("Novo nome da categoria").fill("Cartelas");
    await next.getByRole("button", { name: "Salvar nome" }).click();
    await expect(next.getByText(/Adesivo · SKU 011 · Cartelas/)).toBeVisible();
    await next.getByRole("button", { name: "Excluir categoria Cartelas" }).click();
    await other.getByRole("button", { name: "Confirmar exclusão" }).click();
    await expect(next.getByText(/Faltam categorias em 1 de 2/)).toBeVisible();
    const firstPage = next.getByRole("listitem").filter({ hasText: "Página 1" });
    await firstPage.getByRole("button", { name: "Excluir etiqueta" }).click();
    await other.getByRole("button", { name: "Voltar", exact: true }).click();
    await expect(firstPage).toBeVisible();
    await firstPage.getByRole("button", { name: "Excluir etiqueta" }).click();
    await other.getByRole("button", { name: "Confirmar exclusão" }).click();
    await expect(firstPage).toHaveCount(0);
    await expect(secondPage).toBeVisible();
    await next.getByRole("button", { name: "Excluir etiquetas do arquivo", exact: true }).click();
    await other.getByRole("button", { name: "Confirmar exclusão" }).click();
    await expect(next.getByLabel("PDF em revisão").locator("option")).toHaveCount(1);
    await pane.getByRole("button", { name: "Atualizar importações e categorias" }).click();
    await expect(pane.getByLabel("PDF em revisão").locator("option")).toHaveCount(1);
  } finally {
    await other.close();
  }
});
test("uma página sem texto exige identificação e categoria antes de concluir", async ({ page }) => {
  await page.goto("/__e2e/imported-labels?resume&label-store=" + randomUUID());
  await expect(page.getByLabel("PDFs de etiquetas", { exact: true })).toBeEnabled();
  await page
    .getByLabel("PDFs de etiquetas", { exact: true })
    .setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: await makeLabels([null]) });
  await expect(page.getByRole("button", { name: "Concluir importação" })).toBeDisabled();
  await expect(page.getByText("Leitura incompleta em 1 de 1 etiqueta(s)",{exact:true})).toBeVisible();
  await expect(page.getByText(/Faltam categorias/)).toHaveCount(0);
  await page.getByText("Identificar produtos manualmente", { exact: false }).click();
  await page.getByLabel("SKU", { exact: true }).fill("00012");
  await page.getByLabel("Descrição", { exact: true }).fill("Caderno da foto");
  await page.getByRole("button", { name: "Confirmar produtos da etiqueta" }).click();
  await expect(page.getByRole("article")).toContainText("SKU 00012");
  await expect(page.getByRole("button", { name: "Concluir importação" })).toBeDisabled();
});

test("quantidade ilegível preserva os produtos, reutiliza a categoria e permite concluir o PDF", async ({page}) => {
  await page.goto("/__e2e/imported-labels?resume&label-store="+randomUUID());
  await expect(page.getByLabel("PDFs de etiquetas",{exact:true})).toBeEnabled();
  await page.getByLabel("PDFs de etiquetas",{exact:true}).setInputFiles({
    name:"quantidades.pdf",mimeType:"application/pdf",buffer:await makeLabels([
      {tracking:"BR100A",rows:[["010","Planner","?"]]},
      {tracking:"BR100B",rows:[["010","Planner",""]]},
      {tracking:"BR100C",rows:[["010","Planner","1.0"]]},
    ]),
  });
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByText("Conferir quantidades (2 etiqueta(s))",{exact:true})).toBeVisible();
  await expect(page.getByText(/Leitura incompleta em/)).toHaveCount(0);
  await expect(page.getByText(/Faltam categorias em 3 de 3/)).toBeVisible();
  await page.getByLabel("Nome da categoria").fill("Planners");
  await page.getByRole("button",{name:"Criar categoria",exact:true}).click();
  const product=page.getByRole("article");
  await product.getByLabel("Categoria do produto").selectOption({label:"Planners"});
  await product.getByRole("button",{name:"Confirmar categoria"}).click();
  await expect(page.getByText(/Faltam categorias/)).toHaveCount(0);
  await page.getByRole("button",{name:"Concluir importação"}).click();
  await expect(page.getByText("Importação concluída · 3 etiqueta(s).",{exact:true})).toBeVisible();
});

test("mantém os produtos já reconhecidos ao completar uma leitura parcial manualmente", async ({page}) => {
  await page.goto("/__e2e/imported-labels?resume&label-store="+randomUUID());
  await expect(page.getByLabel("PDFs de etiquetas",{exact:true})).toBeEnabled();
  await page.getByLabel("PDFs de etiquetas",{exact:true}).setInputFiles({
    name:"parcial.pdf",mimeType:"application/pdf",buffer:await makeLabels([
      {tracking:"BR100A",rows:[["010","Planner","?"],["","",1]]},
    ]),
  });
  await expect(page.getByText("Leitura incompleta em 1 de 1 etiqueta(s)",{exact:true})).toBeVisible();
  await expect(page.getByText(/Conferir quantidades/)).toHaveCount(0);
  await expect(page.getByRole("article")).toContainText("SKU 010");
  await page.getByText("Identificar produtos manualmente",{exact:false}).click();
  await expect(page.getByLabel("SKU",{exact:true})).toHaveValue("010");
  await expect(page.getByLabel("Descrição",{exact:true})).toHaveValue("Planner");
  await page.getByRole("button",{name:"Adicionar outro produto"}).click();
  await page.getByLabel("SKU",{exact:true}).nth(1).fill("011");
  await page.getByLabel("Descrição",{exact:true}).nth(1).fill("Adesivo");
  await page.getByRole("button",{name:"Confirmar produtos da etiqueta"}).click();
  await expect(page.getByText(/Leitura incompleta em/)).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("article").filter({hasText:"SKU 010"})).toContainText("Planner");
  await expect(page.getByRole("article").filter({hasText:"SKU 011"})).toContainText("Adesivo");
});

test("reprocessa erros antigos pelo Firebase e retoma uma falha de download sem novo upload", async ({page}) => {
  const store=randomUUID(),prefix="/__e2e/label-api/"+store;
  const cat=await (await page.request.post(prefix+"/create",{data:{name:"Planners"}})).json();
  const key=createHash("sha256").update(JSON.stringify(["sku","010"])).digest("hex");
  expect((await page.request.post(prefix+"/assign",{data:{key,categoryId:cat.id}})).ok()).toBe(true);
  await page.goto("/__e2e/imported-labels?resume&label-store="+store);
  // Store metadata produced by the previous reader, while retaining the actual PDF bytes.
  let uploads=0,reparses=0,downloads=0;
  await page.route("**/archive/upload/pages",async route=>{
    uploads++;
    const body=route.request().postDataJSON();
    for(const page of body.pages) page.label={products:[],issue:"Produto ou quantidade ilegível na tabela."};
    await route.continue({postData:JSON.stringify(body)});
  });
  page.on("request",request=>{
    if(request.url().endsWith("/archive/reparse")) reparses++;
    if(request.url().includes("/__e2e/uploads/")) downloads++;
  });
  const failedDownload="**/__e2e/uploads/*-2.pdf";
  await page.route(failedDownload,route=>route.fulfill({status:503,body:""}));
  await expect(page.getByLabel("PDFs de etiquetas",{exact:true})).toBeEnabled();
  await page.getByLabel("PDFs de etiquetas",{exact:true}).setInputFiles({
    name:"legado.pdf",mimeType:"application/pdf",buffer:await makeLabels([
      {tracking:"BR100A",rows:[["010","Planner","?"]]},
      {tracking:"BR100B",rows:[["010","Planner",1]]},
    ]),
  });
  await expect(page.getByRole("alert")).toContainText("Não foi possível reler 1 etiqueta(s)");
  await expect(page.getByText("Leitura incompleta em 1 de 2 etiqueta(s)",{exact:true})).toBeVisible();
  await expect(page.getByText(/Faltam categorias/)).toHaveCount(0);
  await expect(page.getByText("Conferir quantidades (1 etiqueta(s))",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Concluir importação"})).toBeDisabled();
  await page.unroute(failedDownload);
  await page.getByRole("button",{name:"Reprocessar leitura",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("Leitura atualizada");
  await expect(page.getByText(/Leitura incompleta em/)).toHaveCount(0);
  await expect(page.getByText(/Faltam categorias/)).toHaveCount(0);
  await page.getByRole("button",{name:"Concluir importação"}).click();
  await expect(page.getByText("Importação concluída · 2 etiqueta(s).",{exact:true})).toBeVisible();
  const beforeReload={uploads,reparses,downloads};
  await page.reload();
  await expect(page.getByText("Importação concluída · 2 etiqueta(s).",{exact:true})).toBeVisible();
  expect({uploads,reparses,downloads}).toEqual(beforeReload);
  expect(uploads).toBe(1);
  expect(reparses).toBe(2);
});

test("envia uma revisão antiga ao Firebase preservando a identificação manual", async ({ page }) => {
  const file = { name: "antigo.pdf", mimeType: "application/pdf", buffer: await makeLabels([null]) };
  const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
  const record = {
    id: hash(file.buffer),
    name: file.name,
    importedAt: Date.now(),
    pages: [
      {
        products: [
          {
            key: hash(JSON.stringify(["sku", "MANUAL"])),
            sku: "MANUAL",
            description: "Identificado pela equipe",
            variation: "",
          },
        ],
      },
    ],
  };
  await page.goto("/__e2e/imported-labels?resume&label-store=" + randomUUID());
  await page.evaluate(async (record) => {
    await new Promise<void>((resolve, reject) => {
      const pending = indexedDB.open("gb-label-imports", 1);
      pending.onupgradeneeded = () => pending.result.createObjectStore("imports");
      pending.onsuccess = () => {
        const db = pending.result,
          tx = db.transaction("imports", "readwrite");
        tx.objectStore("imports").put(record, ["fixture-owner", record.id]);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      pending.onerror = () => reject(pending.error);
    });
  }, record);
  await expect(page.getByText(/Esta revisão foi salva neste navegador/)).toBeVisible();
  await expect(page.getByLabel("PDFs de etiquetas", { exact: true })).toBeEnabled();
  await page.getByLabel("PDFs de etiquetas", { exact: true }).setInputFiles(file);
  await expect(page.getByRole("article")).toContainText("Identificado pela equipe");
  await page.reload();
  await expect(page.getByRole("article")).toContainText("SKU MANUAL");
  await expect(
    page.getByRole("button", { name: "Excluir etiquetas do arquivo", exact: true }),
  ).toBeEnabled();
});

test("retoma um arquivo interrompido sem duplicar as páginas gravadas", async ({ page }) => {
  await page.goto("/__e2e/imported-labels?resume&label-store=" + randomUUID());
  const file = {
    name: "semana-interrompida.pdf",
    mimeType: "application/pdf",
    buffer: await makeLabels(Array.from({ length: 21 }, () => null)),
  };
  let batches = 0;
  const route = "**/archive/upload/pages";
  await page.route(route, async (r) => {
    if (++batches === 2) return r.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    return r.continue();
  });
  await expect(page.getByLabel("PDFs de etiquetas", { exact: true })).toBeEnabled();
  await page.getByLabel("PDFs de etiquetas", { exact: true }).setInputFiles(file);
  await expect(page.getByText(/Envio incompleto · 20 de 21/)).toBeVisible();
  await page.unroute(route);
  const resumedPages: number[] = [];
  await page.route(route, async (request) => {
    resumedPages.push(
      ...request
        .request()
        .postDataJSON()
        .pages.map((p: { number: number }) => p.number),
    );
    return request.continue();
  });
  await page.reload();
  await expect(page.getByLabel("PDFs de etiquetas", { exact: true })).toBeEnabled();
  await page.getByLabel("PDFs de etiquetas", { exact: true }).setInputFiles(file);
  await expect(page.getByText("Conferir etiquetas (21)")).toBeVisible();
  expect(resumedPages).toEqual([21]);
  await page.getByRole("button", { name: "Excluir etiquetas do arquivo", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(page.getByLabel("PDF em revisão")).toHaveCount(0);
});

test("visualiza e imprime o PDF salvo dentro do painel com a política de segurança do site", async ({
  page,
}) => {
  await page.goto("/__e2e/imported-labels?resume&label-store=" + randomUUID());
  const pane = page.getByRole("region", { name: "Importação de etiquetas" });
  const file = pane.getByLabel("PDFs de etiquetas", { exact: true });
  await expect(file).toBeEnabled();
  await file.setInputFiles({
    name: "visualizacao.pdf",
    mimeType: "application/pdf",
    buffer: await makeLabels([{ tracking: "BR123456789012A", rows: [["010", "Planner", 1]] }]),
  });
  await pane.getByText("Conferir etiquetas (1)").click();
  await page.evaluate(() => {
    const state = { blobs: new Map<string, Blob>(), revoked: [] as string[] };
    (window as any).__labelViewer = state;
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (blob instanceof Blob) state.blobs.set(url, blob);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      state.revoked.push(url);
      revoke(url);
    };
  });
  const headers = (await page.request.get("/__e2e/email-csp")).headers();
  await page.evaluate((policy) => {
    const meta = document.createElement("meta");
    meta.httpEquiv = "Content-Security-Policy";
    meta.content = policy;
    document.head.append(meta);
    window.open = () => {
      throw new Error("Uma visualização interna não deve abrir outra aba.");
    };
  }, headers["content-security-policy"]);
  const originalUrl = page.url();
  await pane.getByRole("listitem").getByRole("button", { name: "Visualizar", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Visualizar etiqueta · Página 1", exact: true });
  const frame = modal.locator('iframe[title="PDF das etiquetas"]');
  await expect(frame).toHaveAttribute("src", /^blob:/);
  const pdfBytes = await frame.evaluate(async (frame: HTMLIFrameElement) =>
    Array.from(new Uint8Array(await (window as any).__labelViewer.blobs.get(frame.src).arrayBuffer())),
  );
  const pdf = await PDFDocument.load(new Uint8Array(pdfBytes));
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getPage(0).getSize()).toEqual({ width: 450, height: 400 });
  await expect(modal.getByRole("button", { name: "Imprimir", exact: true })).toBeEnabled();
  await frame.evaluate((frame: HTMLIFrameElement) => {
    frame.contentWindow!.print = () => {
      frame.dataset.printed = "yes";
    };
  });
  await modal.getByRole("button", { name: "Imprimir", exact: true }).click();
  await expect(frame).toHaveAttribute("data-printed", "yes");
  await expect(pane.getByRole("alert")).toHaveCount(0);
  expect(page.url()).toBe(originalUrl);
  const resource = await frame.getAttribute("src");
  await modal.getByRole("button", { name: "Fechar visualização", exact: true }).click();
  expect(
    await page.evaluate((url) => (window as any).__labelViewer.revoked.includes(url), resource),
  ).toBe(true);
});

test("o viewer informa a falha de download e permite tentar novamente no próprio painel", async ({
  page,
}) => {
  await page.goto("/__e2e/imported-labels?resume&label-store=" + randomUUID());
  const pane = page.getByRole("region", { name: "Importação de etiquetas" });
  await expect(pane.getByLabel("PDFs de etiquetas", { exact: true })).toBeEnabled();
  await pane.getByLabel("PDFs de etiquetas", { exact: true }).setInputFiles({
    name: "retry.pdf",
    mimeType: "application/pdf",
    buffer: await makeLabels([null]),
  });
  await pane.getByText("Conferir etiquetas (1)").click();
  const download = "**/__e2e/uploads/**";
  await page.route(download, (route) => route.fulfill({ status: 503, body: "Indisponível" }));
  await pane.getByRole("listitem").getByRole("button", { name: "Visualizar", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Visualizar etiqueta · Página 1", exact: true });
  await expect(modal.getByRole("alert")).toHaveText(
    "Não foi possível baixar a etiqueta salva. Tente novamente.",
  );
  await page.unroute(download);
  await modal.getByRole("button", { name: "Tentar novamente", exact: true }).click();
  await expect(modal.locator('iframe[title="PDF das etiquetas"]')).toBeVisible();
  await expect(modal.getByRole("alert")).toHaveCount(0);
  await modal.getByRole("button", { name: "Fechar visualização", exact: true }).click();
  await expect(
    pane.getByRole("button", { name: "Excluir etiquetas do arquivo", exact: true }),
  ).toBeEnabled();
});

test("exclui um produto pendente, separa os PDFs e permite concluir só as etiquetas ativas", async ({
  page,
}) => {
  await page.goto("/__e2e/imported-labels?resume&label-store=" + randomUUID());
  const pane = page.getByRole("region", { name: "Importação de etiquetas" });
  await expect(pane.getByLabel("PDFs de etiquetas", { exact: true })).toBeEnabled();
  await pane.getByLabel("PDFs de etiquetas", { exact: true }).setInputFiles({
    name: "revisao.pdf",
    mimeType: "application/pdf",
    buffer: await makeLabels([
      { tracking: "BR123456789012A", rows: [["CANCELAR", "Pedido cancelado", 1]] },
      { tracking: "BR123456789012B", rows: [["ATIVO", "Agenda", 1]] },
      { tracking: "BR123456789012C", rows: [["CANCELAR", "Pedido cancelado", 1]] },
      { tracking: "BR123456789012D", rows: [["ATIVO", "Agenda", 1]] },
    ]),
  });
  await pane
    .getByRole("article")
    .filter({ hasText: "SKU CANCELAR" })
    .getByRole("button", { name: "Excluir", exact: true })
    .click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("2 etiqueta(s) inteira(s)");
  await confirmation.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(pane.getByRole("article")).toHaveCount(1);
  const active = pane.getByRole("region", { name: "PDF completo sem os excluídos", exact: true });
  const cancelled = pane.getByRole("region", { name: "PDF de etiquetas excluídas", exact: true });
  await expect(active).toContainText("2 etiqueta(s)");
  await expect(cancelled).toContainText("2 etiqueta(s)");
  await pane.getByLabel("Nome da categoria").fill("Agendas");
  await pane.getByRole("button", { name: "Criar categoria", exact: true }).click();
  await pane.getByLabel("Categoria do produto").selectOption({ label: "Agendas" });
  await pane.getByRole("button", { name: "Confirmar categoria", exact: true }).click();
  await pane.getByRole("button", { name: "Concluir importação", exact: true }).click();
  await expect(pane.getByText("Importação concluída · 2 etiqueta(s).", { exact: true })).toBeVisible();
  for (const field of [active, cancelled]) {
    const transfer = page.waitForEvent("download");
    await field.getByRole("button", { name: "Baixar PDF", exact: true }).click();
    const download = await transfer;
    const { readFile } = await import("node:fs/promises");
    const result = await PDFDocument.load(await readFile((await download.path())!));
    expect(result.getPageCount()).toBe(2);
  }
  await page.reload();
  await expect(cancelled).toContainText("2 etiqueta(s)");
  await pane.getByText("Conferir etiquetas (2)").click();
  await expect(pane.getByRole("listitem").filter({ hasText: "Página 1" })).toHaveCount(0);
  await expect(pane.getByRole("listitem").filter({ hasText: "Página 3" })).toHaveCount(0);
  for (const n of [2, 4]) {
    const row = pane.getByRole("listitem").filter({ hasText: "Página " + n });
    await row.getByRole("button", { name: "Excluir etiqueta", exact: true }).click();
    await page.getByRole("button", { name: "Confirmar exclusão", exact: true }).click();
    await expect(row).toHaveCount(0);
  }
  await expect(active.getByRole("button", { name: "Visualizar", exact: true })).toBeDisabled();
  await expect(cancelled).toContainText("4 etiqueta(s)");
});

test("vincula IDs por produto e variação, compartilha e permite alterar e remover depois de recarregar", async ({
  page,
  browser,
}) => {
  const url = "/__e2e/imported-labels?resume&label-store=" + randomUUID();
  await page.goto(url);
  const pane = page.getByRole("region", { name: "Importação de etiquetas" });
  await expect(pane.getByLabel("PDFs de etiquetas", { exact: true })).toBeEnabled();
  await pane.getByLabel("PDFs de etiquetas", { exact: true }).setInputFiles({
    name: "vinculos.pdf",
    mimeType: "application/pdf",
    buffer: await makeLabels([
      { tracking: "BR123456789012A", rows: [["001A", "Caderneta", 1, "Rosa"]] },
      { tracking: "BR123456789012B", rows: [["001A", "Caderneta", 1, "Azul"]] },
    ]),
  });
  const details = pane
    .locator("details")
    .filter({ has: page.locator("summary").filter({ hasText: "Vínculos com bases" }) });
  await details.locator("summary").click();
  const rose = details.getByRole("listitem").filter({ hasText: "Rosa" });
  const blue = details.getByRole("listitem").filter({ hasText: "Azul" });
  await rose.getByRole("button", { name: "Selecionar base", exact: true }).click();
  let picker = page.getByRole("dialog", { name: "Vincular base ao produto da etiqueta", exact: true });
  await picker.getByLabel("Filtrar por nome").fill("Kit de teste");
  await picker.getByRole("button", { name: "Kit de teste.pdf", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Salvar vínculo", exact: true })
    .click();
  await expect(rose.locator("code")).toHaveText("a".repeat(32));
  await expect(blue.getByText("Base pendente", { exact: true })).toBeVisible();
  await blue.getByRole("button", { name: "Selecionar base", exact: true }).click();
  picker = page.getByRole("dialog", { name: "Vincular base ao produto da etiqueta", exact: true });
  await picker.getByRole("button", { name: "Base alternativa.pdf", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Salvar vínculo", exact: true })
    .click();
  await expect(blue.locator("code")).toHaveText("c".repeat(32));
  await page.reload();
  await details.locator("summary").click();
  await expect(rose.locator("code")).toHaveText("a".repeat(32));
  await expect(blue.locator("code")).toHaveText("c".repeat(32));
  const other = await browser.newPage({ baseURL: "http://127.0.0.1:4173" });
  try {
    await other.goto(url + "&owner=outra-pessoa");
    const shared = other
      .locator("details")
      .filter({ has: other.locator("summary").filter({ hasText: "Vínculos com bases" }) });
    await shared.locator("summary").click();
    const row = shared.getByRole("listitem").filter({ hasText: "Rosa" });
    await expect(row.locator("code")).toHaveText("a".repeat(32));
    await row.getByRole("button", { name: "Alterar base", exact: true }).click();
    await other
      .getByRole("dialog", { name: "Vincular base ao produto da etiqueta", exact: true })
      .getByRole("button", { name: "Base alternativa.pdf", exact: true })
      .click();
    await other
      .getByRole("alertdialog")
      .getByRole("button", { name: "Salvar vínculo", exact: true })
      .click();
    await expect(row.locator("code")).toHaveText("c".repeat(32));
    await row.getByRole("button", { name: "Remover vínculo", exact: true }).click();
    await other
      .getByRole("alertdialog")
      .getByRole("button", { name: "Remover vínculo", exact: true })
      .click();
    await expect(row.getByText("Base pendente", { exact: true })).toBeVisible();
    await details.getByRole("button", { name: "Atualizar bases e vínculos", exact: true }).click();
    await expect(rose.getByText("Base pendente", { exact: true })).toBeVisible();
    await expect(blue.locator("code")).toHaveText("c".repeat(32));
  } finally {
    await other.close();
  }
});

test("sugere a base pela variação, exige confirmação e mantém a escolha manual e os vínculos existentes", async ({page}) => {
  const url="/__e2e/imported-labels?resume&label-suggestions&label-store="+randomUUID();
  let writes=0;
  page.on("request",request=>{ if(request.url().endsWith("/base-bindings/save")) writes++; });
  await page.goto(url);
  await expect(page.getByLabel("PDFs de etiquetas",{exact:true})).toBeEnabled();
  await page.getByLabel("PDFs de etiquetas",{exact:true}).setInputFiles({
    name:"sugestoes.pdf",mimeType:"application/pdf",buffer:await makeLabels([
      {tracking:"BR100A",rows:[["10588006940","Caderneta de saude",1,"Gatinhas Brancas"]]},
    ]),
  });
  const details=page.locator("details").filter({has:page.locator("summary").filter({hasText:"Vínculos com bases"})});
  await details.locator("summary").click();
  const row=details.getByRole("listitem");
  await row.getByRole("button",{name:"Selecionar base",exact:true}).click();
  const picker=page.getByRole("dialog",{name:"Vincular base ao produto da etiqueta",exact:true});
  const suggested=picker.getByRole("region",{name:"Sugestões de bases",exact:true});
  await expect(picker.getByText(/SKU 10588006940/)).toBeVisible();
  await expect(suggested.getByRole("button")).toHaveCount(1);
  const choice=suggested.getByRole("button",{name:"Caderneta de saúde · Gatinha Branca.pdf",exact:true});
  await expect(choice).toContainText("Sugestão");
  await expect(choice).toContainText("Variação em comum");
  expect(writes).toBe(0);
  await choice.click();
  await expect(page.getByRole("alertdialog")).toContainText("Gatinha Branca.pdf");
  expect(writes).toBe(0);
  await page.getByRole("alertdialog").getByRole("button",{name:"Voltar",exact:true}).click();
  await expect(row.getByText("Base pendente",{exact:true})).toBeVisible();
  await row.getByRole("button",{name:"Selecionar base",exact:true}).click();
  await choice.click();
  await page.getByRole("alertdialog").getByRole("button",{name:"Salvar vínculo",exact:true}).click();
  await expect(row.locator("code")).toHaveText("d".repeat(32));
  expect(writes).toBe(1);
  await page.reload();
  await details.locator("summary").click();
  await expect(row.locator("code")).toHaveText("d".repeat(32));
  await row.getByRole("button",{name:"Alterar base",exact:true}).click();
  await expect(choice).toHaveAttribute("aria-pressed","true");
  expect(writes).toBe(1);
  await picker.getByLabel("Filtrar por nome").fill("alternativa");
  await expect(picker.getByRole("button",{name:"Caderneta de saúde · Gatinha Branca.pdf",exact:true})).toHaveCount(0);
  await picker.getByRole("button",{name:"Base alternativa.pdf",exact:true}).click();
  await page.getByRole("alertdialog").getByRole("button",{name:"Salvar vínculo",exact:true}).click();
  await expect(row.locator("code")).toHaveText("c".repeat(32));
  expect(writes).toBe(2);
});
