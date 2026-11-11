import type { WorkApi } from "../services/workService";
import type { StaffDocumentApi } from "../services/staffDocumentService";
import { currentWorkTask } from "../services/workContext";
import type { StaffPdfApi } from '../services/staffPdfService';
const unavailable=async():Promise<never>=>{throw new Error('Use a fixture dedicada da oficina PDF.');};
export const emptyPdfLibrary:StaffPdfApi={list:async()=>({bases:[],layouts:[],truncated:false}),baseFile:unavailable,prepareProductCopy:unavailable,uploadBase:unavailable,deleteBase:unavailable,saveLayout:unavailable,deleteLayout:unavailable,importLayouts:unavailable,generate:unavailable,initial:async()=>undefined,uploadAlphabet:unavailable,saveCatalogInitialSize:unavailable};
export function fixtureWorkApi(role: string): WorkApi {
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(`/api/admin/work${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer e2e-work",
        "Content-Type": "application/json",
        "X-E2E-Role": role,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error((await response.json()).error);
    return response;
  };
  return {
    get: async (p) => (await request(p)).json(),
    post: async (p, b) => (await request(p, b)).json(),
    csv: async (p) => (await request(p)).blob(),
  };
}
export function fixtureDocumentApi(role: string): StaffDocumentApi {
  const request = async (path: string, body?: unknown) => {
    const task = await currentWorkTask();
    const response = await fetch(`/__e2e/documents${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer e2e-documents",
        "Content-Type": "application/json",
        "X-E2E-Role": role,
        ...(task ? { "X-Work-Task": task } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return data;
  };
  return {
    list: () => request(""),
    template: async (p, t) =>
      (await fetch((await request(`/templates/${p}/${t}`)).url)).blob(),
    generate: async (productId, templateId, customization, pdf, requestId) => {
      const created = await request("", {
        productId,
        templateId,
        customization,
        requestId,
      });
      if (created.document.status === "ready") return created.document;
      if (!created.uploadExists)
        await fetch(`/__e2e/staff-upload/${created.document.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/pdf" },
          body: pdf,
        });
      return (await request(`/${created.document.id}/finalize`, {})).document;
    },
    file: async (id, mode) =>
      (await fetch((await request(`/${id}/file?mode=${mode}`)).url)).blob(),
    share: async (id) => (await request(`/${id}/share`, {})).url,
    revoke: async (id) => {
      await request(`/${id}/revoke-sharing`, {});
    },
    email: (id, to, requestId) => request(`/${id}/email`, { to, requestId }),
    cancel: async (id) => {
      await request(`/${id}/cancel`, {});
    },
  };
}
