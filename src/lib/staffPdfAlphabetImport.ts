import {
  isFolderMetadata,
  matchingAlphabetName,
  readAlphabetFiles,
} from "./decorativeInitial";
import {
  baseForPdfLayout,
  compareStaffPdfNames,
  type StaffPdfBase,
  type StaffPdfLayoutView,
} from "./staffPdf";

export interface StaffPdfAlphabetFolder {
  path: string;
  files: File[];
  base?: StaffPdfBase;
  mold?: StaffPdfLayoutView;
  issue?: string;
}

export function planStaffPdfAlphabetImport(
  files: File[],
  bases: StaffPdfBase[],
  layouts: StaffPdfLayoutView[],
): StaffPdfAlphabetFolder[] {
  const folders = new Map<string, File[]>();
  for (const file of files) {
    if (isFolderMetadata(file)) continue;
    const path = file.webkitRelativePath?.split("/").slice(0, -1).join("/");
    if (!path) continue;
    const group = folders.get(path);
    if (group) group.push(file);
    else folders.set(path, [file]);
  }
  const internal = bases.filter((base) => base.source === "internal");
  const rows: StaffPdfAlphabetFolder[] = [];
  const targetCounts = new Map<string, number>();
  for (const [path, group] of folders) {
    if (!group.some((file) => /\.png$/i.test(file.name))) continue;
    const row: StaffPdfAlphabetFolder = { path, files: group };
    rows.push(row);
    const folderName = path.split("/").at(-1)!;
    const matched = layouts
      .filter((mold) => matchingAlphabetName(mold.name, folderName))
      .map((mold) => ({ mold, base: baseForPdfLayout(mold, bases) }));
    const targets = new Map<string, StaffPdfBase>();
    for (const { base } of matched)
      if (base?.source === "internal") targets.set(base.id, base);
    if (
      !targets.size &&
      !matched.some(
        ({ mold }) => mold.layout.base_id || mold.layout.base_pdf_name,
      )
    )
      for (const base of internal)
        if (matchingAlphabetName(base.name, folderName))
          targets.set(base.id, base);

    if (targets.size !== 1) {
      row.issue = targets.size
        ? "Mais de uma base corresponde à pasta. Importe na base desejada."
        : "Nenhuma base da equipe corresponde à pasta ou ao molde.";
      continue;
    }
    const base = [...targets.values()][0];
    const mold = matched.find((match) => match.base?.id === base.id)?.mold;
    try {
      readAlphabetFiles(group, mold?.name ?? base.name);
      row.base = base;
      row.mold = mold;
      targetCounts.set(base.id, (targetCounts.get(base.id) ?? 0) + 1);
    } catch (error) {
      row.issue = (error as Error).message;
    }
  }
  for (const row of rows)
    if (row.base && (targetCounts.get(row.base.id) ?? 0) > 1)
      row.issue =
        "Mais de uma pasta aponta para esta base. Selecione a pasta desejada separadamente.";
  return rows.sort((a, b) => compareStaffPdfNames(a.path, b.path));
}
