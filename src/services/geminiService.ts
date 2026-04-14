import { GoogleGenAI } from "@google/genai";

// O Vite substituirá process.env.GEMINI_API_KEY pelo valor real durante o build.
// Usamos uma função para evitar erro de referência ao 'process' no carregamento do módulo.
const getAiClient = () => {
  try {
    // @ts-ignore - process.env é injetado pelo Vite
    const apiKey = typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : undefined;
    
    if (!apiKey) {
      console.warn("GEMINI_API_KEY não encontrada. As funções de IA estarão desativadas.");
      return null;
    }
    return new GoogleGenAI({ apiKey });
  } catch (e) {
    console.error("Erro ao inicializar cliente Gemini:", e);
    return null;
  }
};

const ai = getAiClient();

export const generateDescriptionFromTitle = async (title: string): Promise<string> => {
  if (!ai) throw new Error("IA não configurada");
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Gere uma descrição criativa e persuasiva para um produto chamado: "${title}". 
      O foco deve ser nos benefícios e casos de uso para uma loja de presentes e papelaria personalizada. 
      Retorne apenas o texto da descrição, sem títulos extras ou introduções.`,
    });
    return response.text || "";
  } catch (error) {
    console.error("Erro ao gerar descrição:", error);
    throw new Error("Falha ao gerar descrição com IA.");
  }
};

export const improveTitle = async (title: string): Promise<string> => {
  if (!ai) throw new Error("IA não configurada");
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Melhore este título de produto para torná-lo mais atraente e amigável para SEO: "${title}". 
      Retorne apenas o título melhorado, sem aspas ou explicações.`,
    });
    return response.text || "";
  } catch (error) {
    console.error("Erro ao melhorar título:", error);
    throw new Error("Falha ao melhorar título com IA.");
  }
};

export const improveDescription = async (description: string): Promise<string> => {
  if (!ai) throw new Error("IA não configurada");
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Melhore esta descrição de produto para torná-la mais envolvente e profissional: "${description}". 
      Foque em clareza e persuasão. Retorne apenas a descrição melhorada, sem introduções ou conclusões.`,
    });
    return response.text || "";
  } catch (error) {
    console.error("Erro ao melhorar descrição:", error);
    throw new Error("Falha ao melhorar descrição com IA.");
  }
};

export const generateDescriptionWithCustomPrompt = async (title: string, customPrompt: string): Promise<string> => {
  if (!ai) throw new Error("IA não configurada");
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Gere uma descrição para o produto "${title}" seguindo estas instruções específicas: "${customPrompt}". 
      O foco deve ser nos benefícios e casos de uso para uma loja de presentes e papelaria personalizada. 
      Retorne apenas o texto da descrição, sem títulos extras ou introduções.`,
    });
    return response.text || "";
  } catch (error) {
    console.error("Erro ao gerar descrição personalizada:", error);
    throw new Error("Falha ao gerar descrição personalizada com IA.");
  }
};
