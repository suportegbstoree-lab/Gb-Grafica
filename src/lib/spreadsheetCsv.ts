import { unzipSync, strFromU8 } from "fflate";
export interface WorksheetData {
  name: string;
  rows: string[][];
  columns: number;
}
export interface StaffWorkbook {
  sheets: WorksheetData[];
}
export function excelColumn(index: number) {
  let value = index + 1,
    text = "";
  while (value > 0) {
    value--;
    text = String.fromCharCode(65 + (value % 26)) + text;
    value = Math.floor(value / 26);
  }
  return text;
}
export function safeCsvCell(value: unknown) {
  let text = String(value ?? "");
  // Excel can interpret formula prefixes even after leading whitespace/control characters.
  if (
    /^[\s\u0000-\u001f]*[=+@-]/.test(text) &&
    !/^\s*-?\d+(?:[.,]\d+)?\s*$/.test(text)
  )
    text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function selectedColumnsCsv(
  rows: readonly (readonly unknown[])[],
  columns: number[],
  separator = ";",
  startRow = 0,
) {
  if (
    ![";", ",", "\t"].includes(separator) ||
    !columns.length ||
    new Set(columns).size !== columns.length ||
    columns.some((c) => !Number.isInteger(c) || c < 0 || c > 16383) ||
    !Number.isInteger(startRow) ||
    startRow < 0
  )
    throw new Error("Selecione colunas válidas para exportar.");
  return (
    "\ufeff" +
    rows
      .slice(startRow)
      .map((row) => columns.map((c) => safeCsvCell(row[c])).join(separator))
      .join("\r\n") +
    "\r\n"
  );
}
export function parseStaffXlsx(bytes: Uint8Array): StaffWorkbook {
  if (bytes.length > 10 * 1024 * 1024 || bytes[0] !== 80 || bytes[1] !== 75)
    throw new Error("Envie uma planilha XLSX válida de até 10 MB.");
  let total = 0,
    count = 0;
  const files = unzipSync(bytes, {
    filter(file) {
      if (++count > 1000 || file.originalSize > 32 * 1024 * 1024)
        throw new Error("A planilha excede os limites de leitura.");
      const wanted =
        /^(xl\/(workbook\.xml|styles\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml))$/.test(
          file.name,
        );
      if (wanted) {
        total += file.originalSize;
        if (total > 64 * 1024 * 1024)
          throw new Error("A planilha expandida excede 64 MB.");
      }
      return wanted;
    },
  });
  const xml = (name: string) => {
    if (!files[name]) throw new Error("Estrutura XLSX incompleta.");
    const text = strFromU8(files[name]);
    if (/<!DOCTYPE|<!ENTITY/i.test(text))
      throw new Error("XML com entidades não é permitido.");
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length)
      throw new Error("XML da planilha inválido.");
    return doc;
  };
  const nodes = (el: Document | Element, tag: string) =>
    Array.from(el.getElementsByTagNameNS("*", tag));
  const workbook = xml("xl/workbook.xml"),
    relations = xml("xl/_rels/workbook.xml.rels");
  const paths = new Map(
    nodes(relations, "Relationship")
      .filter((el) => el.getAttribute("TargetMode") !== "External")
      .map((el) => [el.getAttribute("Id"), el.getAttribute("Target") || ""]),
  );
  const shared = files["xl/sharedStrings.xml"]
    ? nodes(xml("xl/sharedStrings.xml"), "si").map((si) =>
        nodes(si, "t")
          .map((t) => t.textContent || "")
          .join(""),
      )
    : [];
  if (shared.length > 200000) throw new Error("Planilha com textos demais.");
  const styles = files["xl/styles.xml"] ? xml("xl/styles.xml") : undefined;
  const formats = new Map(
    styles
      ? nodes(styles, "numFmt").map((el) => [
          Number(el.getAttribute("numFmtId")),
          el.getAttribute("formatCode") || "",
        ])
      : [],
  );
  const cellStyles = styles
    ? nodes(styles, "cellXfs").flatMap((parent) =>
        Array.from(parent.children)
          .filter((el) => el.localName === "xf")
          .map((el) => Number(el.getAttribute("numFmtId") || 0)),
      )
    : [];
  const date1904 =
    nodes(workbook, "workbookPr")[0]?.getAttribute("date1904") === "1";
  const formatNumber = (value: string, styleIndex: number) => {
    const n = Number(value);
    if (!Number.isFinite(n) || value === "") return value;
    const format = cellStyles[styleIndex] || 0,
      code = formats.get(format) || "";
    if (/^0+$/.test(code))
      return String(Math.trunc(n)).padStart(Math.min(code.length, 100), "0");
    const stripped = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, "").toLowerCase(),
      dateFormat =
        (format >= 14 && format <= 22) ||
        (format >= 45 && format <= 47) ||
        (/[yd]/.test(stripped) && !/[0#?]/.test(stripped));
    if (!dateFormat) return value;
    const serial = n + (date1904 ? 1462 : 0),
      date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000));
    if (!Number.isFinite(date.getTime())) return value;
    const hasTime =
        (format >= 18 && format <= 22) ||
        (format >= 45 && format <= 47) ||
        /[hs]/.test(stripped),
      timeOnly =
        (format >= 18 && format <= 21) ||
        (format >= 45 && format <= 47) ||
        (!/[yd]/.test(stripped) && hasTime);
    return timeOnly
      ? date.toISOString().slice(11, 19)
      : date.toISOString().slice(0, 10) +
          (hasTime ? " " + date.toISOString().slice(11, 19) : "");
  };
  let cellCount = 0;
  const sheetNodes = nodes(workbook, "sheet");
  if (!sheetNodes.length || sheetNodes.length > 50)
    throw new Error("Use um arquivo com 1 a 50 abas.");
  const sheets = sheetNodes.map((sheet): WorksheetData => {
    const id =
        sheet.getAttribute("r:id") ||
        sheet.getAttributeNS(
          "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
          "id",
        ),
      target = paths.get(id);
    if (!target) throw new Error("Aba sem dados disponíveis.");
    const path = target.startsWith("/xl/")
      ? target.slice(1)
      : "xl/" + target.replace(/^\.\//, "");
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(path))
      throw new Error("Caminho de planilha inválido.");
    const data = xml(path),
      rows: string[][] = [];
    let columns = 0,
      lastRow = 0;
    for (const row of nodes(data, "row")) {
      const rowNumber = Number(row.getAttribute("r") || lastRow + 1);
      lastRow = rowNumber;
      if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > 50000)
        throw new Error("Use até 50.000 linhas por aba.");
      while (rows.length < rowNumber) rows.push([]);
      let previous = -1;
      for (const cell of nodes(row, "c")) {
        if (++cellCount > 200000)
          throw new Error("Use até 200.000 células por arquivo.");
        const ref = cell.getAttribute("r") || "",
          letters = /^([A-Z]+)\d+$/.exec(ref)?.[1];
        const column = letters
          ? [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1
          : previous + 1;
        if (column > 16383)
          throw new Error("Coluna fora dos limites do Excel.");
        previous = column;
        columns = Math.max(columns, column + 1);
        const type = cell.getAttribute("t"),
          value = nodes(cell, "v")[0]?.textContent || "";
        // Formulas are never executed. Use only the workbook's stored/cached value.
        rows[rowNumber - 1][column] =
          type === "s"
            ? shared[Number(value)] || ""
            : type === "inlineStr"
              ? nodes(cell, "t")
                  .map((t) => t.textContent || "")
                  .join("")
              : type === "b"
                ? value === "1"
                  ? "TRUE"
                  : "FALSE"
                : type === "str" || type === "e"
                  ? value
                  : formatNumber(value, Number(cell.getAttribute("s") || 0));
      }
    }
    return { name: sheet.getAttribute("name") || "Planilha", rows, columns };
  });
  if (!sheets.length || sheets.length > 50)
    throw new Error("Use um arquivo com 1 a 50 abas.");
  return { sheets };
}
