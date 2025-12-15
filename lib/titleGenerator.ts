import OpenAI from "openai";

type TitleInput = {
  userMessage: string;
  assistantMessage?: string;
};

function fallbackTitle(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "New conversation";
  return trimmed.slice(0, 50);
}

export async function generateConversationTitle({
  userMessage,
  assistantMessage = "",
}: TitleInput): Promise<string> {
  const baseText = userMessage || assistantMessage || "New conversation";

  if (!process.env.OPENAI_API_KEY) {
    return fallbackTitle(baseText);
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 32,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content:
            "Create a concise (<=6 words) title for a conversation. Do not use quotes.",
        },
        {
          role: "user",
          content: `User: ${userMessage.slice(0, 400)}\nAssistant: ${assistantMessage.slice(0, 400)}`,
        },
      ],
    });

    const title = response.choices[0]?.message?.content?.trim();
    return title && title.length > 0 ? title : fallbackTitle(baseText);
  } catch (error) {
    console.error("Title generation failed", error);
    return fallbackTitle(baseText);
  }
}

