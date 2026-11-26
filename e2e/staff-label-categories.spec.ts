import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { randomUUID } from "node:crypto";

async function makeLabels(pages: Array<{ tracking: string; rows: Array<[string, string, number]> } | null>) {
  const pdf = await PDFDocument.create();
  for (const label of pages) {
    const page = pdf.addPage([450, 400]);
    if (!label) continue;
    const write = (s: string, x: number, y: number) => page.drawText(s, { x, y, size: 8 });
    write("Código de Rastreamento: " + label.tracking, 15, 360);
    const columns = [15, 40, 120, 300, 400];
    ["Nº", "SKU", "DESCRIÇÃO", "VARIAÇÃO", "QTD"].forEach((s, i) => write(s, columns[i], 300));
    let y = 286;
    for (const [i, [sku, description, qty]] of label.rows.entries()) {
      [String(i + 1), sku, description, "", String(qty)].forEach((s, j) => {
        if (s) write(s, columns[j], y);
      });
      y -= 16;
    }
    write("Total", 306, y);
    write(String(label.rows.reduce((sum, row) => sum + row[2], 0)), columns[4], y);
  }
  return Buffer.from(await pdf.save());
}

test("categoriza o produto uma vez para toda a equipe e conclui cada PDF independentemente", async ({
  page,
  browser,
}) => {
  const store = randomUUID();
  const url = "/__e2e/staff-pdf?resume&label-store=" + store;
  await page.goto(url);
  await page.getByRole("button", { name: "Importar etiquetas", exact: true }).click();
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
  await page.getByRole("button", { name: "Importar etiquetas", exact: true }).click();
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
  await pane.getByLabel("PDFs de etiquetas", { exact: true }).setInputFiles(weekly);
  await expect(pane.getByRole("status")).toContainText("0 PDF(s) novo(s)");
  await expect(pane.getByLabel("PDF em revisão").locator("option")).toHaveCount(2);
  const other = await browser.newPage({ baseURL: "http://127.0.0.1:4173" });
  try {
    await other.goto(url + "&owner=outra-pessoa");
    await other.getByRole("button", { name: "Importar etiquetas", exact: true }).click();
    const next = other.getByRole("region", { name: "Importação de etiquetas" });
    await next.getByLabel("PDFs de etiquetas", { exact: true }).setInputFiles(weekly);
    await expect(next.getByRole("button", { name: "Concluir importação" })).toBeEnabled();
    await next.getByText("Conferir etiquetas (2)").click();
    await expect(next.getByText(/Adesivo · SKU 011 · Adesivos/)).toBeVisible();
    await expect(next.getByText(/Planner · SKU 010 · Cadernos personalizados/)).toHaveCount(2);
  } finally {
    await other.close();
  }
});
test("uma página sem texto exige identificação e categoria antes de concluir", async ({ page }) => {
  await page.goto("/__e2e/staff-pdf?resume&label-store=" + randomUUID());
  await page.getByRole("button", { name: "Importar etiquetas", exact: true }).click();
  await page
    .getByLabel("PDFs de etiquetas", { exact: true })
    .setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: await makeLabels([null]) });
  await expect(page.getByRole("button", { name: "Concluir importação" })).toBeDisabled();
  await page.getByText("Identificar produtos manualmente", { exact: false }).click();
  await page.getByLabel("SKU", { exact: true }).fill("00012");
  await page.getByLabel("Descrição", { exact: true }).fill("Caderno da foto");
  await page.getByRole("button", { name: "Confirmar produtos da etiqueta" }).click();
  await expect(page.getByRole("article")).toContainText("SKU 00012");
  await expect(page.getByRole("button", { name: "Concluir importação" })).toBeDisabled();
});
