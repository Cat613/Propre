// src/services/aiService.ts
import { GoogleGenAI } from "@google/genai";

export interface AIExtractionResult {
    success: boolean
    text?: string
    error?: string
}

export const extractLyricsFromImage = async (
    apiKey: string,
    base64Image: string,
    mimeType: string = 'image/jpeg'
): Promise<AIExtractionResult> => {
    try {
        const ai = new GoogleGenAI({ apiKey });

        const contents = [
            {
                inlineData: {
                    mimeType: mimeType,
                    data: base64Image,
                },
            },
            { text: "Extract the lyrics from this sheet music and format them with double newlines between verses." },
        ];

        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: contents,
            config: {
                systemInstruction: "You are an AI assistant specialized in extracting lyrics from sheet music specifically for presentation slides. Your ONLY output must be the extracted lyrics. Group them by logical verses or choruses. Separate each distinct slide block with exactly two newlines (\\n\\n). Do NOT include markdown blocks like ```, labels like [Verse 1], or any conversational filler. Just the plain text separated by double newlines.",
                temperature: 0.1,
            }
        });

        let extractedText = response.text || '';

        // Remove potential markdown wrappers if the AI ignored the system prompt
        extractedText = extractedText.replace(/^```[a-z]*\n/g, '').replace(/```$/g, '').trim()

        return {
            success: true,
            text: extractedText
        }

    } catch (error: any) {
        return {
            success: false,
            error: error.message || 'An unexpected error occurred during API request'
        }
    }
}
