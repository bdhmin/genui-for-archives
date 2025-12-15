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
      max_tokens: 12,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "Create a 2-3 word title for this conversation. Be brief and direct. No quotes, no punctuation.",
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

